/**
 * The browser entry (`web.html`, `pnpm web:build`). The host page sets
 * `window.terminusWeb = { endpoint, computerId, getToken }` before or after
 * this module loads; the app mounts once it has that and the transport.
 */
import { setCapabilities } from "../lib/platform";
// In the page, not in the lazy app chunk: the stylesheet loads with the HTML.
import "../styles/global.css";
import { installIpc } from "./ipc";
import { type RelayConfig, RelaySession } from "./relay";
import { type BrowserHost, createWebTransport } from "./transport";

declare const __TERMINUS_VERSION__: string;

export type TerminusWebConfig = RelayConfig;

type HostWindow = Window & { terminusWeb?: TerminusWebConfig };

const browser: BrowserHost = {
  openUrl: (url) => void window.open(url, "_blank", "noopener,noreferrer"),
  confirm: (message) => window.confirm(message),
  alert: (message) => window.alert(message),
  reload: () => window.location.reload(),
  writeText: (text) => navigator.clipboard.writeText(text),
  readText: () => navigator.clipboard.readText(),
};

let started = false;

function boot(config: TerminusWebConfig | undefined) {
  if (started || !config) return;
  if (typeof config.endpoint !== "string" || typeof config.computerId !== "string" || typeof config.getToken !== "function") {
    console.error("terminusWeb needs { endpoint, computerId, getToken }");
    return;
  }
  started = true;
  setCapabilities({ nativeWindow: false, updater: false });
  const relay = new RelaySession(config);
  installIpc(window, createWebTransport(relay, config.computerId, __TERMINUS_VERSION__, browser));
  relay.start();
  void import("../app/main");
}

const host = window as HostWindow;
if (host.terminusWeb) boot(host.terminusWeb);
else {
  Object.defineProperty(host, "terminusWeb", {
    configurable: true,
    get: () => undefined,
    set(config: TerminusWebConfig) {
      Object.defineProperty(host, "terminusWeb", { configurable: true, writable: true, value: config });
      boot(config);
    },
  });
}
