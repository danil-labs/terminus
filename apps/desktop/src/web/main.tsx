/**
 * The browser entry (`web.html`, `pnpm web:build`), served by the Danil app on
 * its own origin. It reads the Supabase session that app stored, picks the
 * computer and mounts the app over the relay. A page that sets
 * `window.terminusWeb` before this module loads can replace any setting, or
 * give `computerId` and `getToken` and skip the session and the picker.
 */
import { createSignal } from "solid-js";
import { setCapabilities } from "../lib/platform";
// In the page, not in the lazy app chunk: the stylesheet loads with the HTML.
import "../styles/global.css";
import { installIpc } from "./ipc";
import { type RelayConfig, RelaySession } from "./relay";
import { type BrowserHost, createWebTransport } from "./transport";

declare const __TERMINUS_VERSION__: string;
/** Set at build time in `vite.config.ts`; all public values. */
declare const __TERMINUS_WEB__: WebSettings;

type WebSettings = { endpoint: string; supabaseUrl: string; supabaseKey: string; login: string };

export type TerminusWebConfig = Partial<WebSettings> & Partial<RelayConfig>;

const browser: BrowserHost = {
  openUrl: (url) => void window.open(url, "_blank", "noopener,noreferrer"),
  confirm: (message) => window.confirm(message),
  alert: (message) => window.alert(message),
  reload: () => window.location.reload(),
  writeText: (text) => navigator.clipboard.writeText(text),
  readText: () => navigator.clipboard.readText(),
};

function mountApp(config: RelayConfig) {
  setCapabilities({ nativeWindow: false, updater: false, localSetup: false });
  const relay = new RelaySession(config);
  const [syncedAt, setSyncedAt] = createSignal<number | null>(null);
  const [state, setState] = createSignal(relay.state());
  relay.onState(setState);
  installIpc(window, createWebTransport(relay, config.computerId, __TERMINUS_VERSION__, browser, setSyncedAt));
  relay.start();
  void import("../app/main");
  void Promise.all([import("solid-js/web"), import("./SyncNote"), import("./phrases")]).then(([{ render }, { SyncNote }]) => {
    const layer = document.createElement("div");
    document.body.append(layer);
    render(() => <SyncNote at={syncedAt} off={() => state() !== "online"} />, layer);
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
  const block = (initial: { t: "license" } | { t: "not_yours" }) => {
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
        onOpen={(computerId) => {
          dispose();
          mountApp({
            endpoint,
            computerId,
            getToken: () => session.getToken(),
            onUnauthorized: () => void session.unauthorized(),
            beforeReconnect: async () => {
              const answer = await computersOf(endpoint, session);
              if (answer.kind === "license") block({ t: "license" });
              else if (answer.kind === "ok" && !answer.value.some((c) => c.computer_id === computerId)) block({ t: "not_yours" });
              else return answer.kind !== "unauthorized";
              return false;
            },
          });
        }}
      />
    ),
    document.getElementById("root") as HTMLElement,
  );
}

const given = (window as Window & { terminusWeb?: TerminusWebConfig }).terminusWeb ?? {};
if (given.computerId && given.getToken) mountApp({ ...__TERMINUS_WEB__, ...given } as RelayConfig);
else void start({ ...__TERMINUS_WEB__, ...given } as WebSettings);
