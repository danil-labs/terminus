import { render } from "solid-js/web";
import { createSupportAccess, type Membership } from "../../../../../packages/attention/src/support-access.ts";
import { aplicarLengua, aplicarLenguaDeWorkspace, t } from "../../lib/i18n";
import { activeAccountOf, type AuditEntry, webAuditLog } from "../audit-log";
import { authLocation } from "../auth/return";
import { AdminPage, type AdminSource } from "./AdminPage";
import "../phrases";
import "../../styles/global.css";

const root = () => document.getElementById("root") as HTMLElement;
const home = () => import.meta.env.BASE_URL;

/** `/admin` con la sesión de la app de Danil en este mismo origen; sin ella, a entrar. */
export async function startAdmin(settings: { login: string; supabaseUrl: string; supabaseKey: string }) {
  aplicarLengua();
  const [{ seguirElTema }, { supabaseSession }] = await Promise.all([import("../../lib/theme"), import("../session")]);
  seguirElTema();
  const leave = () => window.location.assign(authLocation(settings.login, window.location.origin, `${window.location.pathname}${window.location.search}`));
  const session = supabaseSession(settings.supabaseUrl, settings.supabaseKey, { onGone: leave });
  const { data } = await session.client.auth.getSession();
  if (!data.session) return leave();
  const api = createSupportAccess(session, fetch, `${import.meta.env.BASE_URL}alpha-api`);
  const source: AdminSource = {
    memberships: api.memberships,
    active: async () => activeAccountOf(await session.getToken()),
    support: { demo: false, workspaces: api.workspaces, list: api.list },
    auditLog: webAuditLog(settings.supabaseUrl, settings.supabaseKey, () => session.getToken(), () => void session.unauthorized()),
    home: home(),
  };
  render(() => <AdminPage source={source} />, root());
}

/** `/admin?demo=1`: datos de ejemplo, sin red ni sesión. */
export async function startAdminDemo(options: { dark: boolean }) {
  const [{ beginDemoIsolation }, { supportAccessDemo }, { seguirElTema }] = await Promise.all([import("../attention/demo"), import("../attention/support-access"), import("../../lib/theme")]);
  const storage = beginDemoIsolation();
  storage.setItem("harness:apariencia", options.dark ? "oscuro" : "claro");
  aplicarLenguaDeWorkspace(null);
  seguirElTema();
  const workspace = t("web.alpha.demo_workspace");
  const rows: Membership[] = [
    { id: 1, name: workspace, role: "owner", organization: "Danil", plan: "Teams" },
    { id: 2, name: t("web.admin.demo_other"), role: "member", organization: "Danil", plan: "Teams" },
  ];
  const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
  const entry = (id: number, over: Partial<AuditEntry>): AuditEntry => ({
    id, created_at: ago(id * 45), event_type: "row.update", entity_type: "agents", action: "update", changed_fields: [], actor_type: "user",
    actor_name: null, actor_email: null, on_behalf_of_name: null, on_behalf_of_email: null, support_grant_id: null, ...over,
  });
  const entries = [
    entry(1, { actor_type: "ai", changed_fields: ["instructions"], on_behalf_of_email: "maria@danil.ai" }),
    entry(2, { actor_type: "member", entity_type: "channels", action: "insert", actor_email: "jose@danil.ai" }),
    entry(3, { actor_type: "danil_support", event_type: "support_access.granted", actor_email: "soporte@danil.ai" }),
  ];
  const source: AdminSource = {
    memberships: async () => rows,
    active: async () => 1,
    support: supportAccessDemo(workspace),
    auditLog: { list: async () => ({ kind: "ok", entries, more: false }) },
    home: `${home()}?demo=1${options.dark ? "&theme=dark" : ""}`,
  };
  render(() => <AdminPage source={source} />, root());
}
