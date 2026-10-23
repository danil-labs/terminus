/**
 * The browser entry (`web.html`, `pnpm web:build`), served by the Danil app on
 * its own origin. It reads the Supabase session that app stored, lists the
 * person's computers and mounts the app at once over the account's fleet
 * (`@terminus/fleet`, the desktop's router): each machine is one relay session
 * and one slice, the saved one first and the live one behind; nothing waits for
 * a machine to answer. A page that sets `window.terminusWeb` before this module
 * loads can replace any setting, or give `getToken` with `computerId` or
 * `computers` and skip the session.
 */
import {
  type Computer,
  type MachineState,
  RelaySession,
  linkedWorkspaces,
  listComputers,
  listWorkspaces,
  orderComputers,
  renameComputer,
  screenProtocols,
  screenUrl,
  sessionProbe,
  startComputer,
  wakes,
} from "@terminus/computers";
import { chosenWebLayout, MOBILE_WEB_DIR } from "@terminus/design";
import { Fleet, type Link, type MachineInfo, unwrap } from "@terminus/fleet";
import { createSignal, lazy, Suspense } from "solid-js";
import { createRouter, type Router, type SliceChange } from "../features/machines/router";
import { t } from "../lib/i18n";
import { leerPref } from "../lib/prefs";
import { setCapabilities } from "../lib/platform";
import { deliver } from "../lib/serviceEvents";
// In the page, not in the lazy app chunk: the stylesheet loads with the HTML.
import "../styles/global.css";
import { machineCompatibility } from "./compatibility";
import { HomeLink } from "./HomeLink";
import { installIpc } from "./ipc";
import { webAccountProfile } from "./account";
import { webWorkspaceAssets } from "./workspace-assets";
import type { MachineRow, MachineStatus } from "./SyncNote";
import { type BrowserHost, createWebTransport } from "./transport";

declare const __TERMINUS_VERSION__: string;
declare const __TERMINUS_CONTRACT__: string;
/** Set at build time in `vite.config.ts`; all public values. */
declare const __TERMINUS_WEB__: WebSettings;

type WebSettings = { endpoint: string; supabaseUrl: string; supabaseKey: string; login: string };

type Base = { endpoint: string; getToken: () => string | Promise<string>; onUnauthorized?: () => void };
export type TerminusWebConfig = Partial<WebSettings & Base & { computerId: string; computers: Computer[] }>;

/** How often the page lists the computers again to pick up machines and links changed since it loaded; the desktop's cadence. */
const RELIST = 10 * 60_000;

const Picker = lazy(() => import("../features/machines/MachinePicker").then((m) => ({ default: m.MachinePicker })));
const AccountMachines = lazy(() => import("./AccountMachines"));

const browser: BrowserHost = {
  openUrl: (url) => void window.open(url, "_blank", "noopener,noreferrer"),
  confirm: (message) => window.confirm(message),
  alert: (message) => window.alert(message),
  reload: () => window.location.reload(),
  writeText: (text) => navigator.clipboard.writeText(text),
  readText: () => navigator.clipboard.readText(),
};

const pageStorage = () => {
  try {
    return localStorage;
  } catch {
    return null;
  }
};

/** The machine picked in «Ejecutar en» for `workspace` (`features/machines/store.ts`), remembered per workspace. */
const pickedFor = (workspace: string | null) => (workspace ? (leerPref<Record<string, string>>("machines.run_on", {})[workspace] ?? null) : null);

const infoOf = (c: Computer): MachineInfo => ({
  id: c.computer_id,
  name: c.name?.trim() || c.computer_id,
  wakes: wakes(c),
  outdated: machineCompatibility(c.contract) === "outdated",
  linked: linkedWorkspaces(c),
});

/**
 * A relay session whose state, until the relay says it, is the one of its row
 * in `/v1/computers`: a machine listed off with a saved slice is not asked.
 */
function rowLink(relay: RelaySession, row: () => string | undefined): Link {
  return {
    state: () => (relay.state() === "unknown" ? ((row() as MachineState | undefined) ?? "unknown") : relay.state()),
    call: (id, command, workspace, folder, args, timeout) => relay.call(id, command, workspace, folder, args, timeout),
    onState: (listener) => relay.onState(listener),
    onEvents: (listener) => relay.onEvents(listener),
    onEngine: (listener) => relay.onEngine(listener),
    blocked: () => relay.blocked(),
    onBlocked: (listener) => relay.onBlocked(listener),
    retry: () => relay.retry(),
    onDeferred: (listener) => relay.onDeferred(listener),
    deferred: () => relay.deferred(),
    subscribe: (after) => relay.subscribe(after),
    start: () => relay.start(),
    close: () => relay.close(),
  };
}

/** Another machine's slice changed: the window rereads just that. */
function slicesChanged(changes: SliceChange[]) {
  window.dispatchEvent(new CustomEvent("harness:machine-slices", { detail: { changes } }));
  if (changes.includes("attention")) window.dispatchEvent(new CustomEvent("harness:service-resync"));
}

/** Mounts the app; what it returns applies a newer computer list (machines, names, links) without remounting. */
function mountApp(computers: Computer[], base: Base, before?: (id: string) => () => Promise<boolean>): (computers: Computer[]) => void {
  const [changed, bump] = createSignal(0);
  let rows = new Map(computers.map((c) => [c.computer_id, c]));
  const token = async () => base.getToken();
  let router: Router | null = null;
  const powers = new Map<string, string>();
  const fleet = new Fleet({
    self: null,
    connect: (info) =>
      rowLink(
        new RelaySession({
          endpoint: base.endpoint,
          computerId: info.id,
          getToken: base.getToken,
          onUnauthorized: base.onUnauthorized,
          beforeReconnect: before?.(info.id),
          // Con otro contrato el relay ni reenvía ni contesta del espejo: `version_mismatch`.
          contracts: [__TERMINUS_CONTRACT__],
          // Un upgrade sin licencia no trae cuerpo: se pregunta por HTTP para no reintentar en bucle.
          probe: async () => sessionProbe(base.endpoint, await token(), info.id),
        }),
        () => rows.get(info.id)?.state,
      ),
    compatible: (contract) => {
      const verdict = machineCompatibility(contract);
      return verdict === "unknown" ? null : verdict === "ok";
    },
    wake: async (id) => (await startComputer(base.endpoint, await token(), id)).kind === "ok",
    storage: pageStorage(),
    onSlice: () => bump((n) => n + 1),
    // La cola de aplazadas cambió (aquí, en el escritorio o en el teléfono): la lista se relee.
    onDeferred: (machine) => router?.deferredChanged(machine),
    onChange: (machine) => {
      bump((n) => n + 1);
      const now = fleet.power(machine);
      // Sin workspaces de nadie al abrir: la primera máquina que se enciende los trae.
      if (now === "on" && powers.get(machine) !== "on" && router?.unlisted()) window.dispatchEvent(new CustomEvent("harness:workspace"));
      powers.set(machine, now);
    },
    onEvents: (machine, events, gap) => {
      if (events.length) router?.events(machine, events);
      if (gap) window.dispatchEvent(new CustomEvent("harness:service-resync"));
    },
  });
  // The account's workspaces list even with every machine of theirs asleep; an older control plane answers none.
  const registry = async () => {
    const answer = await listWorkspaces(base.endpoint, await token());
    if (answer.kind === "unauthorized") base.onUnauthorized?.();
    return answer.kind === "ok" ? answer.value : null;
  };
  const active = createRouter({ self: null, fleet, native: null, registry, onSlices: slicesChanged, deliver, pickedFor });
  router = active;
  fleet.setMachines(orderComputers(computers).map(infoOf));
  fleet.subscribeEvents();

  const status = (id: string): MachineStatus => {
    const power = fleet.power(id);
    return power === "on" ? "online" : power === "off" ? "offline" : power;
  };
  const machines = (): MachineRow[] => {
    changed();
    const slices = fleet.sliceStatuses();
    return fleet.machines().map((m) => ({ id: m.id, name: m.name, status: status(m.id), at: slices[m.id]?.status === "cached" ? slices[m.id].at : null }));
  };
  const several = () => {
    changed();
    return fleet.machines().length > 1;
  };
  // A file dropped outside the chat would replace the page with it.
  for (const type of ["dragover", "drop"]) window.addEventListener(type, (e) => e.preventDefault());
  setCapabilities({
    nativeWindow: false,
    updater: false,
    localSetup: false,
    computerStatus: true,
    browserFiles: true,
    sidebarExtra: () => <HomeLink />,
    accountProfile: webAccountProfile(base.endpoint, base.getToken, base.onUnauthorized),
    accountAssets: webWorkspaceAssets(base.endpoint, base.getToken, base.onUnauthorized),
    accountMemory: { endpoint: base.endpoint, getToken: token },
    machineName: (id) => fleet.name(id),
    taskMachine: (id) => unwrap(id, fleet.remotes())?.machine ?? null,
    windowMachine: () => {
      const id = active.createsOn(null)?.machine;
      return id ? { id, name: fleet.name(id), local: false } : undefined;
    },
    remoteCreate: (workspace) => active.createsOn(workspace),
    machineScreen: (id) => (fleet.info(id)?.wakes ? async () => new WebSocket(screenUrl(base.endpoint, id), screenProtocols(await token())) : null),
    machineOnCreate: (workspace) =>
      several() ? (
        <Suspense fallback={null}>
          <div class="flex items-center gap-1 pt-2 text-xs text-neutral-500" data-create-on="">
            <span>{t("web.machines.create_on")}</span>
            <Picker workspace={workspace} />
          </div>
        </Suspense>
      ) : null,
    accountComputers: {
      list: async () => listComputers(base.endpoint, await token()),
      rename: async (id, name) => renameComputer(base.endpoint, await token(), id, name),
      outdated: (c) => machineCompatibility(c.contract) === "outdated",
      onRenamed: (id, name) => rename(id, name),
    },
    connectMachine: {
      list: async () => listComputers(base.endpoint, await token()),
      outdated: (c) => machineCompatibility(c.contract) === "outdated",
      // La nueva suma su rebanada sin recargar la página ni cerrar las demás.
      onReady: () => void relistNow?.(),
    },
    accountMachines: (props) =>
      several() ? (
        <Suspense fallback={null}>
          <AccountMachines {...props} machines={machines} />
        </Suspense>
      ) : null,
    machinesLicense: () => {
      changed();
      return fleet.license();
    },
    retryMachines: () => {
      fleet.retry();
      for (const name of ["harness:workspace-name", "harness:service-resync"]) window.dispatchEvent(new CustomEvent(name));
    },
  });
  /** A name changed in Configuración: the chips, the toasts and the picker read it without reloading. */
  function rename(id: string, name: string) {
    if (!fleet.rename(id, name)) return;
    namesChanged();
  }
  function namesChanged() {
    bump((n) => n + 1);
    void import("../features/machines/store").then(({ machineNamesChanged, refetchMachines }) => {
      machineNamesChanged();
      void refetchMachines();
    });
  }
  installIpc(window, createWebTransport(active, __TERMINUS_VERSION__, browser));
  window.addEventListener("pagehide", () => fleet.flush());
  void import("../app/main");
  void Promise.all([import("solid-js/web"), import("./SyncNote"), import("./phrases")]).then(([{ render }, { SyncNote }]) => {
    const layer = document.createElement("div");
    document.body.append(layer);
    render(() => <SyncNote machines={machines} />, layer);
  });
  return (fresh) => {
    rows = new Map(fresh.map((c) => [c.computer_id, c]));
    const before = fleet.machines().map((m) => `${m.id}\u0000${m.name}`).join("\n");
    fleet.setMachines(orderComputers(fresh).map(infoOf));
    // Renamed from another window or the phone.
    if (fleet.machines().map((m) => `${m.id}\u0000${m.name}`).join("\n") !== before) namesChanged();
    // Every list of the window reads again, with the machines and links as they are now.
    for (const name of ["harness:workspace-name", "harness:service-resync"]) window.dispatchEvent(new CustomEvent(name));
  };
}

/** Lists the computers again now; set once the page is mounted with a session. */
let relistNow: (() => Promise<void>) | null = null;

async function start(settings: WebSettings) {
  const [{ render }, { Gate, computersOf }, { supabaseSession }, { aplicarLengua }] = await Promise.all([
    import("solid-js/web"),
    import("./Gate"),
    import("./session"),
    import("../lib/i18n"),
    import("./phrases"),
  ]);
  aplicarLengua();
  const { endpoint } = settings;
  const leave = () => window.location.assign(settings.login);
  if (!settings.supabaseUrl || !settings.supabaseKey) {
    console.error("terminus web: built without TERMINUS_WEB_SUPABASE_URL and TERMINUS_WEB_SUPABASE_KEY");
    return;
  }
  const session = supabaseSession(settings.supabaseUrl, settings.supabaseKey, leave);

  /** A refusal found after mounting covers the app: retrying the socket would not change it. */
  let blocked = false;
  const block = (initial: { t: "license" } | { t: "not_yours" }) => {
    if (blocked) return;
    blocked = true;
    const layer = document.createElement("div");
    layer.className = "fixed inset-0 z-50";
    document.body.append(layer);
    render(() => <Gate session={session} endpoint={endpoint} initial={initial} />, layer);
  };

  const dispose = render(
    () => (
      <Gate
        session={session}
        endpoint={endpoint}
        onOpen={(computers) => {
          dispose();
          const several = computers.length > 1;
          const relink = mountApp(
            computers,
            { endpoint, getToken: () => session.getToken(), onUnauthorized: () => void session.unauthorized() },
            (computerId) => async () => {
              const answer = await computersOf(endpoint, session);
              if (answer.kind === "license") block({ t: "license" });
              // One computer gone from several only stops its own session.
              else if (answer.kind === "ok" && !answer.value.some((c) => c.computer_id === computerId)) {
                if (!several) block({ t: "not_yours" });
              } else return answer.kind !== "unauthorized";
              return false;
            },
          );
          // A machine connected or a workspace linked since the page loaded shows up here without reloading it.
          const relist = async () => {
            const answer = await computersOf(endpoint, session).catch(() => null);
            if (answer?.kind === "ok") relink(answer.value);
          };
          relistNow = relist;
          if (!relisting) {
            relisting = true;
            setInterval(() => void relist(), RELIST);
            document.addEventListener("visibilitychange", () => {
              if (document.visibilityState === "visible") void relist();
            });
          }
        }}
      />
    ),
    document.getElementById("root") as HTMLElement,
  );
}

/** The re-list timer and listener are installed once per page, however many times the gate opens. */
let relisting = false;

const given = (window as Window & { terminusWeb?: TerminusWebConfig }).terminusWeb ?? {};
const preset = given.computers ?? (given.computerId ? [{ computer_id: given.computerId, state: "unknown" }] : null);
const connecting = window.location.pathname.replace(/\/+$/, "") === `${import.meta.env.BASE_URL}connect`;

/**
 * Un teléfono abre el Terminus del teléfono (`<base>m/`, la app de Expo para
 * web) salvo que la persona haya elegido este. Una ruta del teléfono que cae
 * aquí (el respaldo de página única sirve esta copia) se pasa a su raíz con
 * `?to=`; su raíz misma solo llega aquí si no está publicada (`web:dev`), y
 * entonces sigue esta.
 */
function toPhone(): boolean {
  const phone = `${import.meta.env.BASE_URL}${MOBILE_WEB_DIR}/`;
  const path = window.location.pathname;
  if (path.startsWith(phone) && path !== phone) {
    window.location.replace(`${phone}?to=${encodeURIComponent(path.slice(phone.length - 1) + window.location.search)}`);
    return true;
  }
  if (path.startsWith(phone) || connecting || preset || chosenWebLayout(window) !== "mobile") return false;
  window.location.replace(phone);
  return true;
}

if (toPhone()) {
  // Se va al del teléfono: no se monta nada aquí.
} else if (connecting) void import("./connect/main").then((m) => m.startConnect({ ...__TERMINUS_WEB__, ...given } as WebSettings, document.getElementById("root") as HTMLElement));
else if (preset && given.getToken) mountApp(preset, { ...__TERMINUS_WEB__, ...given } as Base);
else void start({ ...__TERMINUS_WEB__, ...given } as WebSettings);
