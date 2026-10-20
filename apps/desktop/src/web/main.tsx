/**
 * The browser entry (`web.html`, `pnpm web:build`), served by the Danil app on
 * its own origin. It reads the Supabase session that app stored, lists the
 * person's computers and mounts the app over one relay session each. A page
 * that sets `window.terminusWeb` before this module loads can replace any
 * setting, or give `getToken` with `computerId` or `computers` and skip the session.
 */
import { linkedWorkspaces } from "@terminus/computers";
import { createSignal, lazy, Suspense } from "solid-js";
import { t } from "../lib/i18n";
import { setCapabilities } from "../lib/platform";
// In the page, not in the lazy app chunk: the stylesheet loads with the HTML.
import "../styles/global.css";
import type { Computer } from "./computers";
import { machineCompatibility } from "./compatibility";
import { wakes } from "./fleet";
import { HomeLink } from "./HomeLink";
import { installIpc } from "./ipc";
import { webAccountProfile } from "./account";
import { type RelayConfig, RelaySession } from "./relay";
import type { MachineRow } from "./SyncNote";
import { type BrowserHost, createWebTransport } from "./transport";

declare const __TERMINUS_VERSION__: string;
/** Set at build time in `vite.config.ts`; all public values. */
declare const __TERMINUS_WEB__: WebSettings;

type WebSettings = { endpoint: string; supabaseUrl: string; supabaseKey: string; login: string };

export type TerminusWebConfig = Partial<WebSettings & RelayConfig & { computers: Computer[] }>;
type Base = Omit<RelayConfig, "computerId" | "beforeReconnect">;

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

function mountApp(computers: Computer[], base: Base, before?: (id: string) => () => Promise<boolean>) {
  const [changed, bump] = createSignal(0);
  const links = computers.map((c) => {
    const [at, setAt] = createSignal<number | null>(null);
    // No longer shared with this account: the page lists the computers again.
    const relay = new RelaySession({ ...base, computerId: c.computer_id, beforeReconnect: before?.(c.computer_id), onUnlinked: () => window.location.reload() });
    relay.onState(() => bump((n) => n + 1));
    const info = {
      id: c.computer_id,
      name: c.name || c.computer_id,
      wakes: wakes(c),
      outdated: machineCompatibility(c.contract) === "outdated",
      linked: linkedWorkspaces(c),
      member: c.role === "member",
    };
    return { info, relay, onSync: setAt, at };
  });
  const transport = createWebTransport(links, __TERMINUS_VERSION__, browser, () => bump((n) => n + 1));
  const machines = (): MachineRow[] => {
    changed();
    return transport.fleet.machines.map((m) => {
      const l = links.find((x) => x.info.id === m.id);
      return { id: m.id, name: m.name, status: transport.status(m.id), at: l?.at() ?? null };
    });
  };
  const multi = transport.fleet.multi;
  setCapabilities({
    nativeWindow: false,
    updater: false,
    localSetup: false,
    computerStatus: true,
    sidebarExtra: () => <HomeLink />,
    accountProfile: webAccountProfile(base.endpoint, base.getToken, base.onUnauthorized),
    machineName: (id) => transport.fleet.name(id),
    workspaceOnMachine: multi,
    machineOnCreate: multi
      ? (workspace) => (
          <Suspense fallback={null}>
            <div class="flex items-center gap-1 pt-2 text-xs text-neutral-500" data-create-on="">
              <span>{t("web.machines.create_on")}</span>
              <Picker workspace={workspace} />
            </div>
          </Suspense>
        )
      : undefined,
    accountMachines: multi
      ? (props) => (
          <Suspense fallback={null}>
            <AccountMachines {...props} machines={machines} />
          </Suspense>
        )
      : undefined,
  });
  installIpc(window, transport);
  for (const l of links) l.relay.start();
  void import("../app/main");
  void Promise.all([import("solid-js/web"), import("./SyncNote"), import("./phrases")]).then(([{ render }, { SyncNote }]) => {
    const layer = document.createElement("div");
    document.body.append(layer);
    render(() => <SyncNote machines={machines} />, layer);
  });
}

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
          mountApp(
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
        }}
      />
    ),
    document.getElementById("root") as HTMLElement,
  );
}

const given = (window as Window & { terminusWeb?: TerminusWebConfig }).terminusWeb ?? {};
const preset = given.computers ?? (given.computerId ? [{ computer_id: given.computerId, state: "unknown" }] : null);
const connecting = window.location.pathname.replace(/\/+$/, "") === `${import.meta.env.BASE_URL}connect`;
if (connecting) void import("./connect/main").then((m) => m.startConnect({ ...__TERMINUS_WEB__, ...given } as WebSettings, document.getElementById("root") as HTMLElement));
else if (preset && given.getToken) mountApp(preset, { ...__TERMINUS_WEB__, ...given } as Base);
else void start({ ...__TERMINUS_WEB__, ...given } as WebSettings);
