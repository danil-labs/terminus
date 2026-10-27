/** The approval page's own entry: no relay, no app, only the session and the control plane. */
import { render } from "solid-js/web";
import { aplicarLengua } from "../../lib/i18n";
import "../../locales/danilPhrases";
import { supabaseSession } from "../session";
import { authLocation } from "../auth/return";
import { ConnectPage } from "./ConnectPage";
import { normalizeCode } from "./devices";

export type ConnectSettings = { endpoint: string; supabaseUrl: string; supabaseKey: string; login: string };

export function startConnect(settings: ConnectSettings, root: HTMLElement) {
  aplicarLengua();
  if (!settings.supabaseUrl || !settings.supabaseKey) {
    console.error("terminus web: built without TERMINUS_WEB_SUPABASE_URL and TERMINUS_WEB_SUPABASE_KEY");
    return;
  }
  const leave = () => window.location.assign(authLocation(settings.login, window.location.origin, `${window.location.pathname}${window.location.search}`));
  const session = supabaseSession(settings.supabaseUrl, settings.supabaseKey, { onGone: leave });
  const code = normalizeCode(new URLSearchParams(window.location.search).get("code"));
  render(() => <ConnectPage session={session} endpoint={settings.endpoint} code={code} />, root);
}
