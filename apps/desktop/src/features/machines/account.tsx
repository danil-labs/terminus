/**
 * With the Danil account signed in, this window shows the tasks of every
 * computer of the person, as the web does (`web/transport.ts`): its own engine
 * keeps the native IPC and its ids; each other computer is one relay session.
 * Without an account, or with no other computer, nothing is installed and the
 * window is exactly the local one. Loaded lazily from `app/main.tsx`.
 */
import "../../web/phrases";
import {
  type Computer,
  listComputers,
  machineCompatibility,
  orderComputers,
  RelaySession,
  wakes,
} from "@terminus/computers";
import { createSignal, For } from "solid-js";
import { render } from "solid-js/web";
import { t } from "../../lib/i18n";
import { whenConnected } from "../../lib/engineConnection";
import { capabilities, setCapabilities, type Capabilities } from "../../lib/platform";
import { listen } from "../../lib/serviceEvents";
import { isMac } from "../../lib/window";
import { Toast, ToastPortal } from "../../ui/Toast";
import type { MachineStatus } from "../../web/fleet";
import { type BrowserHost, createWebTransport, type WebTransport } from "../../web/transport";
import { refetchMachines } from "./store";

declare const __TERMINUS_CONTRACT__: string;

type Args = Record<string, unknown>;
type Options = { headers?: HeadersInit } | undefined;
type Invoke = (command: string, args?: Args, options?: Options) => Promise<unknown>;
type Internals = { invoke: Invoke };
type Target = Window & { __TAURI_INTERNALS__?: Internals };

/** `account_relay_token` (`proxy.rs`): the engine's short-lived client token of the account. */
type ClientToken = { token: string; expires_at: number; endpoint: string; computer_id: string };
type DanilStatus = { state: string; computer_id?: string | null };

/** Handled by the window itself, never by an engine. */
const WINDOW = new Set([
  "request_close",
  "close_confirmed",
  "window_to_background",
  "tray_update",
  "quit_completely",
  "restart_app",
  "tray_notify",
  "window_ready",
  "window_vitals",
  "window_painted",
  "window_background",
  "launcher_state",
  "launcher_continue",
  "service_filter",
  "service_prepare_update",
  "service_cancel_update",
  "update_install",
  "update_pending",
  "account_relay_token",
  "open_external",
]);
/** What opens a file of a task in this computer: a task of another machine has its files there. */
const FILES = /^(site_|typst_live_)|^(open_file_external|tree_open_external)$/;
const RELIST = 10 * 60_000;
const TOKEN_MARGIN = 60_000;
const TOAST_FOR = 5_000;

const HOST: BrowserHost = {
  openUrl: () => {},
  confirm: () => false,
  alert: () => {},
  reload: () => window.location.reload(),
  writeText: async () => {},
  readText: async () => "",
};

type Installed = { key: string; transport: WebTransport; relays: RelaySession[]; restore: () => void };

let started = false;
let installed: Installed | null = null;
let syncing: Promise<void> | null = null;

const homeName = () => (isMac() ? t("shell.machines.this_mac") : t("shell.machines.this_computer"));

/** Every string in `args` that names another machine's workspace, folder or task. */
function namesRemote(transport: WebTransport, value: unknown): boolean {
  if (typeof value === "string") return transport.fleet.unwrap(value) !== null;
  if (Array.isArray(value)) return value.some((v) => namesRemote(transport, v));
  if (value && typeof value === "object") return Object.values(value).some((v) => namesRemote(transport, v));
  return false;
}

/** Tell every list of the window to read again: the machines behind it changed. */
function refresh() {
  for (const name of ["harness:workspace-name", "harness:sources", "harness:tasks-changed", "harness:service-resync"]) {
    window.dispatchEvent(new CustomEvent(name));
  }
  void refetchMachines();
}

export function startAccountMachines(target: Target = window) {
  if (started) return;
  const found = target.__TAURI_INTERNALS__;
  if (!found) return;
  const internals: Internals = found;
  started = true;
  const native: Invoke = internals.invoke.bind(internals);
  // The window's own IPC under its usual name: the command guards read these two literally.
  const invoke = native;
  let token: ClientToken | null = null;

  const getToken = async (): Promise<ClientToken> => {
    if (token && token.expires_at - Date.now() > TOKEN_MARGIN) return token;
    token = (await invoke("account_relay_token", {})) as ClientToken;
    return token;
  };

  const uninstall = () => {
    if (!installed) return;
    const gone = installed;
    installed = null;
    gone.restore();
    for (const r of gone.relays) r.close();
    refresh();
  };

  function install(self: string, endpoint: string, others: Computer[], key: string) {
    const [changed, bump] = createSignal(0);
    const relays: RelaySession[] = [];
    const links = others.map((c) => {
      const relay = new RelaySession({
        endpoint,
        computerId: c.computer_id,
        getToken: async () => (await getToken()).token,
        onUnauthorized: () => {
          token = null;
          void sync();
        },
      });
      relays.push(relay);
      relay.onState(() => bump((n) => n + 1));
      const info = {
        id: c.computer_id,
        name: c.name?.trim() || c.computer_id,
        wakes: wakes(c),
        outdated: machineCompatibility(c.contract, __TERMINUS_CONTRACT__) === "outdated",
      };
      return { info, relay };
    });
    const transport = createWebTransport(links, "", HOST, () => bump((n) => n + 1), {
      info: { id: self, name: homeName(), wakes: false },
      call: (command, args, options) => native(command, args, options),
    });

    const previous: Capabilities = capabilities();
    setCapabilities({ ...previous, machineName: (id) => (id === self ? homeName() : transport.fleet.name(id)) });
    const route: Invoke = (command, args = {}, options) => {
      if (command.startsWith("plugin:") || WINDOW.has(command)) return native(command, args, options);
      if (FILES.test(command)) {
        if (!namesRemote(transport, args)) return native(command, args, options);
        return Promise.reject({ what: t("shell.machines.local_only"), detail: "machine_files" });
      }
      return transport.handle(command, args, options) as Promise<unknown>;
    };
    internals.invoke = route;
    const layer = document.createElement("div");
    document.body.append(layer);
    const unmount = render(
      () => (
        <MachineToasts
          machines={() => {
            changed();
            return links.map(({ info, relay }) => ({ id: info.id, name: info.name, status: transport.status(info.id), known: relay.state() !== "unknown" }));
          }}
        />
      ),
      layer,
    );
    installed = {
      key,
      transport,
      relays,
      restore: () => {
        if (internals.invoke === route) internals.invoke = native;
        setCapabilities(previous);
        unmount();
        layer.remove();
      },
    };
    for (const r of relays) r.start();
    // The groups of workspaces and the open one come from this read; the lists read after it.
    void transport
      .handle("list_workspaces", {})
      .catch(() => null)
      .then(() => {
        if (installed?.transport === transport) refresh();
      });
  }

  /** Reads the account and its computers; installs, replaces or removes the fan-out to match. */
  async function check() {
    const status = (await invoke("danil_connect_status", {}).catch(() => null)) as DanilStatus | null;
    const self = status?.state === "connected" ? status.computer_id : null;
    if (!self) {
      token = null;
      return uninstall();
    }
    let client: ClientToken;
    try {
      client = await getToken();
    } catch {
      // An engine without `danil_client_token`, or a control plane without client tokens.
      return uninstall();
    }
    const answer = await listComputers(client.endpoint, client.token);
    if (answer.kind === "unauthorized" || answer.kind === "license") {
      token = null;
      return uninstall();
    }
    if (answer.kind !== "ok") return;
    const others = orderComputers(answer.value.filter((c) => c.computer_id !== self));
    const key = JSON.stringify([self, client.endpoint, others.map((c) => [c.computer_id, c.name, c.contract, wakes(c)])]);
    if (installed?.key === key) return;
    uninstall();
    if (others.length) install(self, client.endpoint, others, key);
  }

  const sync = () => {
    syncing ??= check()
      .catch(() => {})
      .finally(() => {
        syncing = null;
      });
    return syncing;
  };

  void whenConnected().then(() => {
    void listen("danil-connect", () => void sync());
    setInterval(() => void sync(), RELIST);
    return sync();
  });
}

/** `known`: the relay already said its state; before that `offline` only means not asked yet. */
type Row = { id: string; name: string; status: MachineStatus; known: boolean };

/** A machine of the account that turns on or off says so once, without asking for anything. */
function MachineToasts(props: { machines: () => Row[] }) {
  const [shown, setShown] = createSignal<{ key: number; text: string }[]>([]);
  const last = new Map<string, MachineStatus>();
  let n = 0;
  const said = (row: Row) => {
    if (row.status === "online") return t("shell.machines.now_on", { name: row.name });
    if (row.status === "starting") return t("shell.machines.waking", { name: row.name });
    if (row.status === "offline") return t("shell.machines.now_off", { name: row.name });
    return null;
  };
  const watch = () => {
    for (const row of props.machines()) {
      if (!row.known) continue;
      const before = last.get(row.id);
      last.set(row.id, row.status);
      // The first state is how it was found, not a change.
      if (before === undefined || before === row.status) continue;
      const text = said(row);
      if (!text) continue;
      const key = ++n;
      setShown((list) => [...list.filter((x) => x.text !== text), { key, text }]);
      setTimeout(() => setShown((list) => list.filter((x) => x.key !== key)), TOAST_FOR);
    }
    return shown();
  };
  return (
    <ToastPortal>
      <For each={watch()}>
        {(toast) => (
          <Toast data-machine-toast="" onDismiss={() => setShown((list) => list.filter((x) => x.key !== toast.key))}>
            <span class="text-xs text-neutral-700">{toast.text}</span>
          </Toast>
        )}
      </For>
    </ToastPortal>
  );
}
