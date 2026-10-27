/**
 * What the Tauri window does for each invoke, redone over one relay session per
 * computer. Engine commands become `call` with the same workspace envelope as
 * `src-tauri/src/extracted/proxy.rs`, sent to the machine `fleet.ts` picks;
 * `service_poll` reads the `subscribe` feeds; window-only commands and plugins
 * answer from the browser or refuse with a sentence the interface already knows.
 */
import { INTENT_COMMANDS, callWorkspace } from "@terminus/computers";
import { t } from "../lib/i18n";
import { leerPref } from "../lib/prefs";
import { deliver } from "../lib/serviceEvents.ts";
import { CREATE, FAN, Fleet, type MachineInfo, type MachineStatus } from "./fleet";
import { ReadCache } from "./reads";
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

/** When the panel shows copies made while the computer was on: the newest one's time, or null. */
export type SyncListener = (at: number | null) => void;

export type WebTransport = {
  handle(command: string, args?: Args, options?: Options): Promise<unknown>;
  fleet: Fleet;
  status(machine: string): MachineStatus;
  /** Where something new of `workspace` is made now, and whether that machine leads it (its spaces are the panel's). */
  createsOn(workspace: string | null): { machine: string; lead: boolean } | null;
};

export type MachineLink = { info: MachineInfo; relay: RelayLike; onSync?: SyncListener };

/** What the transport uses of a relay session (`./relay` or `@terminus/computers`). */
export type RelayLike = Pick<RelaySession, "state" | "connected" | "onState" | "onEvents" | "onLink" | "call" | "subscribe">;

/**
 * The desktop's own engine, reached through the window's native IPC: its ids
 * stay as they are, its calls keep their options and channels, and its feed
 * stays the window's own `service_poll`.
 */
export type HomeLink = { info: MachineInfo; call(command: string, args: Args, options: Options): Promise<unknown> };

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
  if (code === "start_failed" || code === "start_timeout") return { what: t("web.start_failed"), detail: code };
  if (code === "revoked") return { what: t("web.revoked"), detail: code };
  if (code === "workspace_not_linked") return { what: t("web.workspace_not_linked"), detail: code };
  if (code === "engine_missing") return { what: { clave: "shell.service.engine_missing" }, detail: e.detail ?? code };
  return { what: { clave: KEYS[code] ?? "shell.service.failed" }, detail: code };
}

const desktopOnly = (command: string): Failure => ({ what: t("web.desktop_only"), detail: command });

/** The workspace travels in a header for these, as in the window. */
const STORAGE = new Set(["list_storage", "reclaim_storage", "empty_build_cache", "collect_orphans"]);
const HEADER_SCOPED = new Set(["stop_turn", "stop_shell_command", "write_shell_input", "pending_requests", ...STORAGE]);
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
/** What wakes an off computer at the relay: its list (`INTENT_COMMANDS` of computers' `src/protocol.ts`), shared with the phone. */
const INTENT = INTENT_COMMANDS;
const READ = /^(list_|load_|read_|get_|preview_)|_status$|^(workspaces_startup|session_usage|task_history|session_folder|setup_required|check_environment|account_limits|chat_background)$/;
/** With the computer off and nothing read before: a managed computer is prepared at install. */
const OFF_ANSWERS: Record<string, unknown> = { setup_required: false };
const RETRY_OFF = 5_000;
const POLL_WAIT = 20_000;
const LINK_WAIT = 5_000;
const STATE_WAIT = 2_000;
const HOME_FAN_WAIT = 6_000;

const isWeb = (url: unknown): url is string => typeof url === "string" && /^https?:\/\//i.test(url);

function requestId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function headerOf(options: Options, name = "x-terminus-workspace"): string | null {
  try {
    return new Headers(options?.headers).get(name) || null;
  } catch {
    return null;
  }
}

/** A relay returns only the completion of a stream command: its channel stays behind. */
function withoutChannel(command: string, args: Args): Args {
  const channel = CHANNELS[command];
  if (!channel || !(channel in args)) return args;
  const { [channel]: _dropped, ...rest } = args;
  return rest;
}

/** Resolves when `wake` is called or after `ms`. */
function changes() {
  const wakers = new Set<() => void>();
  const wake = () => {
    for (const w of [...wakers]) w();
  };
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
  return { wake, changeOr };
}

const LAST = "terminus-web:computer";
function lastMachine(): string | null {
  try {
    return localStorage.getItem(LAST);
  } catch {
    return null;
  }
}
function rememberMachine(id: string) {
  try {
    localStorage.setItem(LAST, id);
  } catch {}
}

const OUTDATED = new Set(["version_mismatch", "service_version"]);
/** Commands about the machine, not a workspace: a machine without the open workspace takes them without one. */
const OF_THE_MACHINE = /(^|_)accounts?($|_)|login|^radiant_|^danil_/;
/** How an engine says it does not know a command. */
const UNKNOWN = new Set(["command", "unsupported", "command_not_allowed"]);
type Event = NonNullable<EventsPage["events"]>[number];
const NONE = Symbol("none");
type Link = ReturnType<typeof createLink>;

/** One computer: its calls with the off rules, its read copies and its own feed. */
function createLink(relay: RelayLike, computerId: string, onSync: SyncListener, onOutdated: () => void, visible: (events: Event[]) => Event[]) {
  let subscribedAt: number | null | undefined;
  const queue: EventsPage[] = [];
  const { wake, changeOr } = changes();
  relay.onEvents((page) => {
    if (subscribedAt === undefined) return;
    queue.push(page);
    wake();
  });
  relay.onState(wake);
  let synced: number | null = null;
  const copied = (at: number) => {
    if (synced !== null && synced >= at) return;
    synced = at;
    onSync(at);
  };
  relay.onState((state) => {
    if (state !== "online" || synced === null) return;
    synced = null;
    onSync(null);
  });
  relay.onLink(wake);

  const reads = new ReadCache(computerId);

  /** Until the relay says the computer is on, or a while if it never said it was off. */
  async function untilOn() {
    if (!OFF.includes(relay.state()) && relay.state() !== "starting") return changeOr(RETRY_OFF);
    while (relay.state() !== "online") await changeOr(POLL_WAIT);
  }

  /**
   * With the computer off a read answers from its last copy and anything else
   * waits: never an error. Without `wait`, what would wait answers `NONE`.
   */
  async function send(command: string, workspace: string | null, args: Args, wait = true): Promise<unknown> {
    const waits = !INTENT.has(command);
    const key = READ.test(command) ? JSON.stringify([command, workspace, args]) : null;
    const offline = async () => {
      const kept = key ? reads.get(key) : null;
      if (kept) {
        copied(kept.at);
        return kept;
      }
      if (command in OFF_ANSWERS) return { value: OFF_ANSWERS[command] };
      if (!wait) return { value: NONE };
      await untilOn();
      return null;
    };
    for (;;) {
      // A read still asks: the relay may answer it from its own copy.
      if (waits && !key && OFF.includes(relay.state())) {
        const answer = await offline();
        if (answer) return answer.value;
        continue;
      }
      try {
        const { value, cached } = await relay.call(requestId(), command, workspace, null, args);
        if (cached) {
          const at = typeof cached.updated_at === "number" ? cached.updated_at : Date.parse(cached.updated_at);
          if (Number.isFinite(at)) copied(at < 1e12 ? at * 1000 : at);
        } else if (key) {
          if (command === "list_workspaces" && value && typeof value === "object") {
            const { machine_resources: _resources, ...listing } = value as Args;
            reads.put(key, listing);
          } else reads.put(key, value);
        }
        return value;
      } catch (error) {
        const failure = failureOf(error);
        if (typeof failure.detail === "string" && OUTDATED.has(failure.detail)) onOutdated();
        if (!waits || failure.detail !== "machine_off") throw failure;
        const answer = await offline();
        if (answer) return answer.value;
      }
    }
  }

  /** The feed of this computer alone, as the window's `service_poll` reads it. */
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
    deliver(visible(pages.flatMap((p) => p.events ?? [])));
    subscribedAt = last.cursor;
    return {
      cursor: last.cursor,
      gap: pages.some((p) => p.gap === true),
      replay: last.replay === true,
      runtime: last.runtime ?? runtime,
      reset: false,
    };
  }

  return { relay, send, poll };
}

export function createWebTransport(
  machines: MachineLink[],
  version: string,
  host: BrowserHost,
  onStatus: () => void = () => {},
  home: HomeLink | null = null,
): WebTransport {
  const links = new Map<string, Link>();
  const homeId = home?.info.id ?? null;
  const fleet = new Fleet(
    [...(home ? [home.info] : []), ...machines.map((m) => m.info)],
    (id) => id === homeId || links.get(id)?.relay.state() === "online",
    homeId,
  );
  for (const m of machines) {
    const mark = () => {
      if (fleet.isOutdated(m.info.id)) return;
      fleet.markOutdated(m.info.id);
      onStatus();
    };
    m.relay.onState((state) => {
      if (state === "version_mismatch" || state === "outdated") mark();
      if (typeof window !== "undefined") window.dispatchEvent(new window.Event("harness:machines"));
    });
    links.set(m.info.id, createLink(m.relay, m.info.id, m.onSync ?? (() => {}), mark, (events) => fleet.linkedEvents(m.info.id, events)));
  }
  const link = (id: string) => links.get(id) as Link;
  const on = (id: string) => id === homeId || link(id).relay.state() === "online";
  const status = (id: string): MachineStatus => {
    if (id === homeId) return "online";
    if (fleet.isOutdated(id)) return "outdated";
    const state = links.get(id)?.relay.state();
    return state === "online" ? "online" : state === "starting" ? "starting" : "offline";
  };
  let active: string | null = null;
  let ordered: Promise<unknown> = Promise.resolve();
  const { wake, changeOr } = changes();

  /**
   * Where something new goes without a choice: the last machine used, else the
   * window's (the first of the workspace), as long as it has the workspace and
   * can run the project.
   */
  const fallback = (workspace: string | null, project: unknown = null) => {
    const members = fleet.multi ? fleet.membersOf(workspace) : fleet.usable();
    const able = members.filter((m) => fleet.canRun(m, workspace, project));
    const last = lastMachine();
    return last && able.includes(last) ? last : (able[0] ?? members[0] ?? fleet.usable()[0] ?? fleet.machines[0].id);
  };
  /** Whether `machine` can take a new task of `workspace`: it has it or can make it its own. */
  const takes = (machine: string, workspace: string | null) => fleet.has(machine, workspace) !== false || fleet.materializes(machine);
  /** The machine picked in «Ejecutar en» for this workspace (`features/machines/store.ts`), if it can run the project. */
  const picked = (workspace: string | null, project: unknown) => {
    const id = workspace ? leerPref<Record<string, string>>("machines.run_on", {})[workspace] : undefined;
    return id && fleet.usable().includes(id) && takes(id, workspace) && fleet.canRun(id, workspace, project) ? id : null;
  };

  const off = (machine: string): Failure => ({ what: t("web.machines.off_action", { name: fleet.name(machine) }), detail: "machine_off" });
  const missing = (machine: string): Failure => ({ what: t("web.machines.missing_workspace", { name: fleet.name(machine) }), detail: "workspace_missing" });
  const outdated = (machine: string): Failure => ({ what: t("web.machines.outdated_action", { name: fleet.name(machine) }), detail: "version_mismatch" });

  /** One machine: an outdated one refuses, and one that cannot be woken says it is off instead of waiting. */
  async function one(machine: string, command: string, workspace: string | null, args: Args, options?: Options): Promise<unknown> {
    if (home && machine === homeId) return home.call(command, args, options);
    if (fleet.isOutdated(machine)) throw outdated(machine);
    args = withoutChannel(command, args);
    const l = link(machine);
    if (STORAGE.has(command) && l.relay.state() !== "online") throw off(machine);
    const asleep = !fleet.info(machine)?.wakes && OFF.includes(l.relay.state());
    if (asleep && !READ.test(command)) throw off(machine);
    try {
      const value = await l.send(command, callWorkspace(workspace, args), args, !asleep && !STORAGE.has(command) && command !== "list_workspaces");
      if (value === NONE) throw off(machine);
      return fleet.linkedOnly(machine, command, value);
    } catch (error) {
      if (fleet.isOutdated(machine)) throw outdated(machine);
      // The relay cannot start the person's own computer: off, said plainly.
      if ((error as Failure | undefined)?.detail === "not_remotely_startable") throw off(machine);
      throw error;
    }
  }

  /** With a home, a machine that does not answer soon adds nothing: the window's own lists never wait on the network. */
  const late = (answer: Promise<unknown>): Promise<unknown> =>
    home ? Promise.race([answer, new Promise((done) => setTimeout(() => done(NONE), HOME_FAN_WAIT))]) : answer;

  /** Every machine answers its part; one that is off without a copy adds nothing until it is on. */
  async function fan(command: string, targets: string[], args: Args, workspace: string | null): Promise<unknown> {
    if (command === "list_accounts") {
      const lead = fallback(workspace);
      targets = [...targets].sort((a, b) => Number(b === lead) - Number(a === lead));
    }
    for (;;) {
      const usable = targets.filter((m) => !fleet.isOutdated(m));
      const results = await Promise.all(
        usable.map(async (machine) => {
          try {
            const raw = fleet.argsFor(machine, args);
            const value =
              home && machine === homeId
                ? await home.call(command, raw, undefined)
                : await late(link(machine).send(command, callWorkspace(fleet.workspaceOn(machine, workspace), raw), raw, false));
            return value === NONE ? null : { machine, value: fleet.linkedOnly(machine, command, value) };
          } catch (error) {
            return fleet.isOutdated(machine) ? null : { machine, error };
          }
        }),
      );
      const answers = results.filter((r): r is { machine: string; value: unknown } => !!r && "value" in r);
      if (answers.length || usable.length === 0) {
        if (!answers.length && FAN.has(command)) return [];
        return fleet.merge(command, answers, workspace);
      }
      const failed = results.find((r) => r && "error" in r) as { error: unknown } | undefined;
      if (failed && results.every((r) => r && "error" in r)) throw failed.error;
      await changeOr(POLL_WAIT);
    }
  }

  async function send(command: string, workspace: string | null, args: Args, options: Options): Promise<unknown> {
    const chosen = headerOf(options, "x-terminus-machine") ?? (CREATE.has(command) ? picked(workspace, args.project) : null);
    if (chosen && !fleet.info(chosen) && (STORAGE.has(command) || command === "list_workspaces")) throw failureOf({ code: "invalid_request" });
    if (STORAGE.has(command) && !workspace) throw failureOf({ code: "workspace_missing" });
    let route: ReturnType<Fleet["route"]>;
    try {
      route = fleet.route(command, args, workspace, chosen && fleet.info(chosen) ? chosen : null, fallback(workspace, args.project));
    } catch {
      throw { what: t("web.machines.cross_machine"), detail: "cross_machine" };
    }
    if (STORAGE.has(command) && chosen && "machine" in route && route.machine !== chosen) {
      throw { what: t("web.machines.cross_machine"), detail: "cross_machine" };
    }
    if ("fan" in route) return fan(command, route.fan, route.args, workspace);
    let target = route.workspace;
    if (route.missing && workspace) {
      if (CREATE.has(command)) target = await materialize(route.machine, workspace);
      else if (!OF_THE_MACHINE.test(command)) throw missing(route.machine);
    }
    const value = await one(route.machine, command, target, route.args, options);
    // A workspace just made on a machine is that machine's before it lists its workspaces again.
    const made = (value as { id?: unknown } | null)?.id;
    if (command === "add_workspace" && typeof made === "string") fleet.materialized(route.machine, made);
    if (fleet.multi && CREATE.has(command) && !route.named) rememberMachine(route.machine);
    return fleet.encode(route.machine, value, command);
  }

  /**
   * A machine that lacks the workspace of something new makes it its own first,
   * with the same id. An engine that does not know how yet says so once, and the
   * machine is left out of «Ejecutar en» for workspaces it lacks.
   */
  async function materialize(machine: string, workspace: string): Promise<string> {
    if (!fleet.materializes(machine)) throw missing(machine);
    try {
      await one(machine, "materialize_workspace", null, { id: workspace });
    } catch (error) {
      const detail = (error as Failure | undefined)?.detail;
      if (typeof detail !== "string" || !UNKNOWN.has(detail)) throw error;
      fleet.cannotMaterialize(machine);
      throw missing(machine);
    }
    fleet.materialized(machine, workspace);
    return workspace;
  }

  /** The active workspace on each of its machines that is on; nothing waits for one that is off. */
  async function activate(id: string, args: Args): Promise<unknown> {
    const members = fleet.membersOf(id).filter((m) => !fleet.isOutdated(m));
    const sent = members
      .filter((m) => on(m) || members.length === 1)
      .map((m) => one(m, "set_active_workspace", fleet.workspaceOn(m, id), fleet.argsFor(m, args)).catch(() => null));
    return (await Promise.all(sent))[0] ?? null;
  }

  async function engine(command: string, args: Args, options: Options): Promise<unknown> {
    const header = headerOf(options);
    let workspace = command === "list_workspaces" ? null : active;
    if (command === "tree_show" && args.tree === "terminus-chat-visuals") {
      if (!header) throw failureOf({ code: "invalid_request" });
      workspace = header;
    } else if (HEADER_SCOPED.has(command)) workspace = header ?? active;
    if (!home) args = withoutChannel(command, args);
    if (command === "set_active_workspace" && typeof args.id === "string") {
      const id = args.id;
      active = id;
      const run = ordered.then(() => (fleet.multi ? activate(id, args) : send(command, workspace, args, options)));
      ordered = run.catch(() => {});
      try {
        return await run;
      } catch (error) {
        if (active === id) active = workspace;
        throw error;
      }
    }
    const value = await send(command, workspace, args, options);
    const startup = value as { active?: unknown } | null;
    // The desktop installs this after its first read: its next `list_workspaces` says which one is open.
    if ((command === "workspaces_startup" || command === "list_workspaces") && !headerOf(options, "x-terminus-machine") && active === null && typeof startup?.active === "string") active = startup.active;
    if (command === "remove_workspace" && workspace !== null && workspace === args.id) active = null;
    return value;
  }

  // The feeds of every machine in one: the window sees a single stream.
  let subscribed = false;
  let tick = 0;
  let cameOn = false;
  const pages: { machine: string; page: EventsPage }[] = [];
  const runtimes = new Map<string, string>();
  for (const m of machines) {
    let was = m.relay.state();
    m.relay.onEvents((page) => {
      if (!subscribed || !fleet.multi) return;
      pages.push({ machine: m.info.id, page });
      wake();
    });
    m.relay.onState((state) => {
      // A machine that comes on brings what it did while it was off.
      if (state === "online" && was !== "online" && subscribed) cameOn = true;
      was = state;
      wake();
    });
  }

  async function pollAll(): Promise<unknown> {
    if (!subscribed) {
      subscribed = true;
      for (const id of fleet.usable()) link(id).relay.subscribe(null);
    }
    const deadline = Date.now() + POLL_WAIT;
    while (!pages.length && !cameOn) {
      const left = deadline - Date.now();
      if (left <= 0) break;
      await changeOr(left);
    }
    const taken = pages.splice(0).filter(({ machine }) => !fleet.isOutdated(machine));
    let gap = taken.some(({ page }) => page.gap === true);
    for (const { machine, page } of taken) {
      const known = runtimes.get(machine);
      if (page.runtime && known && known !== page.runtime) gap = true;
      if (page.runtime) runtimes.set(machine, page.runtime);
    }
    deliver(
      taken.flatMap(({ machine, page }) =>
        fleet.linkedEvents(machine, page.events ?? []).map((e) => ({ name: e.name, payload: fleet.encodeEvent(machine, e.name, e.payload) })),
      ),
    );
    const streams = cameOn;
    cameOn = false;
    tick += 1;
    return { cursor: tick, gap, replay: false, runtime: "fleet", reset: false, streams };
  }

  /** Whether `args` carry an id of a machine other than home. */
  const namesRemote = (args: Args) => {
    try {
      const route = fleet.route("load_session", args, null, null, homeId ?? "");
      return "machine" in route && route.machine !== homeId;
    } catch {
      return true;
    }
  };

  // With a home, the window keeps polling its own engine; the other machines'
  // events go to the listeners as they arrive, and their gaps ride on the next page.
  let remoteGap = false;
  let homeSubscribed = false;
  if (home) {
    for (const m of machines) {
      let was = m.relay.state();
      m.relay.onEvents((page) => {
        if (!homeSubscribed || fleet.isOutdated(m.info.id)) return;
        const known = runtimes.get(m.info.id);
        if (page.gap === true || (page.runtime && known && known !== page.runtime)) remoteGap = true;
        if (page.runtime) runtimes.set(m.info.id, page.runtime);
        deliver(fleet.linkedEvents(m.info.id, page.events ?? []).map((e) => ({ name: e.name, payload: fleet.encodeEvent(m.info.id, e.name, e.payload) })));
      });
      m.relay.onState((state) => {
        if (state === "online" && was !== "online" && homeSubscribed) remoteGap = true;
        was = state;
      });
    }
  }

  async function pollHome(args: Args, options: Options): Promise<unknown> {
    if (!homeSubscribed && fleet.multi) {
      homeSubscribed = true;
      for (const id of fleet.usable()) if (id !== homeId) link(id).relay.subscribe(null);
    }
    const page = (await (home as HomeLink).call("service_poll", args, options)) as Record<string, unknown> | null;
    // The home's `attention` speaks only of its machine: the window gets the list of every machine.
    if (fleet.multi && page && Array.isArray(page.batches)) {
      page.batches = (page.batches as { events?: { name: string; payload: unknown }[] }[]).map((b) =>
        Array.isArray(b?.events) ? { ...b, events: b.events.map((e) => (e.name === "attention" ? { ...e, payload: fleet.encodeEvent(homeId as string, e.name, e.payload) } : e)) } : b,
      );
    }
    if (!remoteGap || !page || typeof page !== "object") return page;
    remoteGap = false;
    return { ...page, streams: true };
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
        host.alert(t("web.local_files"));
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

  function createsOn(workspace: string | null) {
    const ws = workspace ?? active;
    try {
      const route = fleet.route("create_project", {}, ws, picked(ws, null), fallback(ws));
      return "machine" in route ? { machine: route.machine, lead: !fleet.multi || fleet.membersOf(ws)[0] === route.machine } : null;
    } catch {
      return null;
    }
  }

  return {
    fleet,
    status,
    createsOn,
    async handle(command, args = {}, options) {
      if (command.startsWith("plugin:")) return plugin(command, args);
      if (command === "service_poll") return home ? pollHome(args, options) : fleet.multi ? pollAll() : link(fleet.machines[0].id).poll(args);
      if (command === "launcher_state") return { phase: "ready" };
      if (command === "tray_notify") return "focused";
      if (command === "restart_app") return host.reload();
      if (QUIET.has(command)) return null;
      if (command === "machine_list") {
        const lead = fallback(active);
        return fleet.usable().map((id) => ({ id, local: id === homeId, active: id === lead, on: on(id), hosts: fleet.has(id, active), materializes: fleet.materializes(id) }));
      }
      if (command === "machine_select") {
        if (typeof args.id !== "string" || !fleet.info(args.id)) throw failureOf({ code: "command" });
        return { runtime: null };
      }
      if (command === "load_history") return home && !namesRemote(args) ? home.call(command, args, options) : history(args, options);
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
