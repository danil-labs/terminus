/**
 * What the Tauri window does for each invoke, redone over the relay session.
 * Engine commands become `call` with the same workspace envelope as
 * `src-tauri/src/extracted/proxy.rs`; `service_poll` reads the `subscribe`
 * feed; window-only commands and plugins answer from the browser or refuse
 * with a sentence the interface already knows how to show.
 */
import { t } from "../lib/i18n";
import { deliver } from "../lib/serviceEvents.ts";
import type { EventsPage, MachineState, RelayFailure, RelaySession } from "./relay";

type Args = Record<string, unknown>;
type Options = { headers?: HeadersInit } | undefined;
type Failure = { what: unknown; detail: unknown };

export type BrowserHost = {
  openUrl(url: string): void;
  confirm(message: string): boolean;
  alert(message: string): void;
  reload(): void;
  writeText(text: string): Promise<void>;
  readText(): Promise<string>;
};

export type WebTransport = {
  handle(command: string, args?: Args, options?: Options): Promise<unknown>;
};

const KEYS: Record<string, string> = {
  service_busy: "shell.service.busy",
  task_busy: "shell.service.busy",
  invalid_token: "shell.service.unreachable",
  io: "shell.service.unreachable",
  version_mismatch: "shell.service.version",
  service_version: "shell.service.version",
  no_host: "shell.service.no_host",
  command: "shell.service.command",
  unsupported: "shell.service.command",
  command_not_allowed: "shell.service.command",
};

/** The same shapes as `failure()` in `proxy.rs`, plus the relay's own codes. */
export function failureOf(error: unknown): Failure {
  if (error && typeof error === "object" && "what" in error) return error as Failure;
  const e = (error ?? {}) as RelayFailure;
  const code = typeof e.code === "string" ? e.code : "io";
  const detail = e.detail as { what?: unknown } | string | undefined;
  if (code === "operation_failed" && (typeof detail === "string" || detail?.what)) return detail as unknown as Failure;
  if (code === "machine_off") return { what: { clave: "shell.service.machine_off" }, detail: "machine_off" };
  if (code === "app_unavailable") return { what: { clave: "shell.service.engine_down" }, detail: "engine_down" };
  if (code === "start_failed" || code === "start_timeout") return { what: t("shell.web.start_failed"), detail: code };
  if (code === "revoked") return { what: t("shell.web.revoked"), detail: code };
  if (code === "engine_missing") return { what: { clave: "shell.service.engine_missing" }, detail: e.detail ?? code };
  return { what: { clave: KEYS[code] ?? "shell.service.failed" }, detail: code };
}

const desktopOnly = (command: string): Failure => ({ what: t("shell.web.desktop_only"), detail: command });

/** The workspace travels in a header for these, as in the window. */
const HEADER_SCOPED = new Set(["stop_turn", "stop_shell_command", "write_shell_input", "pending_requests"]);
/** Stream commands lose their channel: the relay returns only the completion. */
const CHANNELS: Record<string, string> = { clone_project: "progress", list_session_git: "progress", watch_task_tree: "changes" };
const REFUSED = /^(site_|typst_live_)|^(open_file_external|tree_open_external)$/;
const QUIET = new Set([
  "launcher_continue",
  "window_ready",
  "window_vitals",
  "window_painted",
  "window_background",
  "request_close",
  "close_confirmed",
  "window_to_background",
  "tray_update",
  "quit_completely",
  "service_filter",
  "service_prepare_update",
  "service_cancel_update",
  "update_install",
  "update_pending",
]);
const OFF: MachineState[] = ["offline", "stopped", "provisioning"];
const POLL_WAIT = 20_000;
const LINK_WAIT = 5_000;
const STATE_WAIT = 2_000;

const isWeb = (url: unknown): url is string => typeof url === "string" && /^https?:\/\//i.test(url);

function requestId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function headerOf(options: Options): string | null {
  try {
    return new Headers(options?.headers).get("x-terminus-workspace") || null;
  } catch {
    return null;
  }
}

export function createWebTransport(relay: RelaySession, computerId: string, version: string, host: BrowserHost): WebTransport {
  let active: string | null = null;
  let ordered: Promise<unknown> = Promise.resolve();
  let subscribedAt: number | null | undefined;
  const queue: EventsPage[] = [];
  const wakers = new Set<() => void>();
  const wake = () => {
    for (const w of [...wakers]) w();
  };
  relay.onEvents((page) => {
    if (subscribedAt === undefined) return;
    queue.push(page);
    wake();
  });
  relay.onState(wake);
  relay.onLink(wake);

  /** Resolves when something changes or after `ms`. */
  const changeOr = (ms: number) =>
    new Promise<void>((done) => {
      const finish = () => {
        clearTimeout(timer);
        wakers.delete(finish);
        done();
      };
      const timer = setTimeout(finish, ms);
      wakers.add(finish);
    });

  async function send(command: string, workspace: string | null, args: Args): Promise<unknown> {
    try {
      return await relay.call(requestId(), command, workspace, null, args);
    } catch (error) {
      throw failureOf(error);
    }
  }

  async function engine(command: string, args: Args, options: Options): Promise<unknown> {
    const header = headerOf(options);
    let workspace = active;
    if (command === "tree_show" && args.tree === "terminus-chat-visuals") {
      if (!header) throw failureOf({ code: "invalid_request" });
      workspace = header;
    } else if (HEADER_SCOPED.has(command)) workspace = header ?? active;
    const channel = CHANNELS[command];
    if (channel && channel in args) {
      const { [channel]: _dropped, ...rest } = args;
      args = rest;
    }
    if (command === "set_active_workspace" && typeof args.id === "string") {
      const id = args.id;
      active = id;
      const run = ordered.then(() => send(command, workspace, args));
      ordered = run.catch(() => {});
      try {
        return await run;
      } catch (error) {
        if (active === id) active = workspace;
        throw error;
      }
    }
    const value = await send(command, workspace, args);
    const startup = value as { active?: unknown } | null;
    if (command === "workspaces_startup" && active === null && typeof startup?.active === "string") active = startup.active;
    if (command === "remove_workspace" && workspace !== null && workspace === args.id) active = null;
    return value;
  }

  async function poll(args: Args): Promise<unknown> {
    const cursor = typeof args.cursor === "number" ? args.cursor : null;
    const runtime = typeof args.runtime === "string" && args.runtime ? args.runtime : null;
    if (subscribedAt !== cursor) {
      queue.length = 0;
      subscribedAt = cursor;
      relay.subscribe(cursor);
    }
    const deadline = Date.now() + POLL_WAIT;
    for (;;) {
      const state = relay.state();
      if (state === "starting" || OFF.includes(state)) {
        await changeOr(STATE_WAIT);
        const now = relay.state();
        if (now === "starting") throw { what: { clave: "shell.service.machine_starting" }, detail: "starting" };
        if (OFF.includes(now)) throw { what: { clave: "shell.service.machine_off" }, detail: "machine_off" };
        continue;
      }
      if (!relay.connected()) {
        await changeOr(LINK_WAIT);
        if (!relay.connected()) throw failureOf({ code: "io", detail: "relay" });
        continue;
      }
      if (queue.length) break;
      const left = deadline - Date.now();
      if (left <= 0) return { cursor, gap: false, replay: args.replay === true, runtime, reset: false };
      await changeOr(left);
    }
    const pages = queue.splice(0);
    const changed = pages.find((p) => runtime && p.runtime && p.runtime !== runtime);
    if (changed) {
      subscribedAt = null;
      relay.subscribe(null);
      return { cursor: null, gap: false, replay: true, runtime: changed.runtime, reset: true };
    }
    const last = pages[pages.length - 1];
    deliver(pages.flatMap((p) => p.events ?? []));
    subscribedAt = last.cursor;
    return {
      cursor: last.cursor,
      gap: pages.some((p) => p.gap === true),
      replay: last.replay === true,
      runtime: last.runtime ?? runtime,
      reset: false,
    };
  }

  async function history(args: Args, options: Options): Promise<unknown> {
    const session = (await engine("load_session", { project: args.project, id: args.id }, options)) as { turns?: unknown[] };
    const total = Array.isArray(session?.turns) ? session.turns.length : 0;
    return { ...session, history: { total, start: 0, end: total, limit: total, has_more: false } };
  }

  function dialog(args: Args): string {
    const message = String(args.message ?? "");
    const buttons = args.buttons as string | Record<string, string[] | string> | undefined;
    const custom = buttons && typeof buttons === "object" ? Object.values(buttons)[0] : undefined;
    if (buttons === "OkCancel" || buttons === "YesNo" || Array.isArray(custom)) {
      const [yes, no] = Array.isArray(custom) ? custom : buttons === "YesNo" ? ["Yes", "No"] : ["Ok", "Cancel"];
      return host.confirm(message) ? yes : no;
    }
    host.alert(message);
    return typeof custom === "string" ? custom : "Ok";
  }

  async function plugin(command: string, args: Args): Promise<unknown> {
    const [name, action] = command.slice("plugin:".length).split("|");
    switch (name) {
      case "event":
      case "window":
      case "webview":
      case "updater":
        return null;
      case "app":
        return action === "version" ? version : action === "name" ? "Terminus" : null;
      case "dialog":
        if (action === "message") return dialog(args);
        host.alert(t("shell.web.local_files"));
        return null;
      case "clipboard-manager":
        if (action === "write_text") return host.writeText(String(args.text ?? ""));
        if (action === "read_text") return host.readText();
        throw desktopOnly(command);
      case "process":
        host.reload();
        return null;
    }
    throw desktopOnly(command);
  }

  return {
    async handle(command, args = {}, options) {
      if (command.startsWith("plugin:")) return plugin(command, args);
      if (command === "service_poll") return poll(args);
      if (command === "launcher_state") return { phase: "ready" };
      if (command === "tray_notify") return "focused";
      if (command === "restart_app") return host.reload();
      if (QUIET.has(command)) return null;
      if (command === "machine_list") return [{ id: computerId, local: false, active: true, on: relay.state() === "online" }];
      if (command === "machine_select") {
        if (args.id !== computerId) throw failureOf({ code: "command" });
        return { runtime: null };
      }
      if (command === "load_history") return history(args, options);
      if (command === "site_open_external" || command === "open_external") {
        const url = command === "open_external" ? args.target : args.url;
        if (!isWeb(url)) throw desktopOnly(command);
        host.openUrl(url);
        return null;
      }
      if (REFUSED.test(command)) throw desktopOnly(command);
      return engine(command, args, options);
    },
  };
}
