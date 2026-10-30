/**
 * `/admin`: lo que administra al equipo de un workspace de Danil, aparte de
 * Configuración. Solo owner y admin; el rol sale de `/auth/profile`, igual que
 * en Acceso de soporte.
 */
import ArrowLeft from "lucide-solid/icons/arrow-left";
import Building2 from "lucide-solid/icons/building-2";
import CreditCard from "lucide-solid/icons/credit-card";
import ExternalLink from "lucide-solid/icons/external-link";
import History from "lucide-solid/icons/history";
import LifeBuoy from "lucide-solid/icons/life-buoy";
import Settings from "lucide-solid/icons/settings";
import Users from "lucide-solid/icons/users";
import { createResource, createSignal, For, type JSX, lazy, Match, Show, Suspense, Switch } from "solid-js";
import { isManager, type Membership } from "../../../../../packages/attention/src/support-access.ts";
import { t } from "../../lib/i18n";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { Select } from "../../ui/Select";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../../ui/sidebar";
import type { SupportAccessSource } from "../../features/settings/SupportAccess";
import { SettingsPanel, SettingsRow, SettingsSection } from "../../features/settings/layout";
import type { AuditLogSource } from "../audit-log";

const SupportAccess = lazy(() => import("../../features/settings/SupportAccess"));
const AuditLog = lazy(() => import("../../features/settings/AuditLog"));

/** Canales y plan de conversaciones siguen en la app de Danil. */
const AGENTS_URL = "https://app.danil.ai";

export type AdminSource = {
  memberships: () => Promise<Membership[]>;
  /** El workspace activo de la sesión: la bitácora solo lee ese. */
  active: () => Promise<number | null>;
  support: SupportAccessSource;
  auditLog?: AuditLogSource;
  /** Adónde lleva «Volver a Terminus». */
  home: string;
};

type Section = "general" | "members" | "support" | "audit" | "workspaces" | "plan";

const SECTIONS: { id: Section; group: "workspace" | "organization"; soon: boolean; icon: () => JSX.Element; name: () => string }[] = [
  { id: "general", group: "workspace", soon: false, icon: () => <Settings size={15} />, name: () => t("web.admin.general") },
  { id: "members", group: "workspace", soon: true, icon: () => <Users size={15} />, name: () => t("web.admin.members") },
  { id: "support", group: "workspace", soon: false, icon: () => <LifeBuoy size={15} />, name: () => t("web.admin.support") },
  { id: "audit", group: "workspace", soon: false, icon: () => <History size={15} />, name: () => t("audit.title") },
  { id: "workspaces", group: "organization", soon: true, icon: () => <Building2 size={15} />, name: () => t("web.admin.org_workspaces") },
  { id: "plan", group: "organization", soon: true, icon: () => <CreditCard size={15} />, name: () => t("web.admin.plan") },
];

const GROUPS = [
  { id: "workspace", name: () => t("web.admin.group_workspace") },
  { id: "organization", name: () => t("web.admin.group_organization") },
] as const;

const roleName = (role: string) =>
  role === "owner" ? t("web.admin.role_owner") : role === "admin" ? t("web.admin.role_admin") : role === "member" ? t("web.admin.role_member") : role;

/** Acceso de soporte de un solo workspace: el selector de arriba ya lo eligió. */
const scoped = (source: SupportAccessSource, workspace: Membership): SupportAccessSource => ({
  ...source,
  workspaces: async () => [{ id: workspace.id, name: workspace.name }],
});

export function AdminPage(props: { source: AdminSource }) {
  const [data] = createResource(async () => {
    const [rows, active] = await Promise.all([props.source.memberships(), props.source.active().catch(() => null)]);
    return { rows, active };
  });
  const [chosen, setChosen] = createSignal<number | null>(null);
  const [section, setSection] = createSignal<Section>("general");
  const managed = () => data()?.rows.filter((m) => isManager(m.role)) ?? [];
  const current = () => {
    const rows = data()?.rows ?? [];
    const wanted = chosen() ?? (managed().some((m) => m.id === data()?.active) ? data()?.active : managed()[0]?.id);
    return rows.find((m) => m.id === wanted) ?? managed()[0] ?? null;
  };
  const back = (
    <Button as="a" variant="ghost" size="sm" href={props.source.home} class="justify-self-start" data-admin-back="">
      <ArrowLeft size={15} />
      {t("web.admin.back")}
    </Button>
  );

  return (
    <main class="flex h-dvh min-h-0 flex-col bg-bg text-neutral-950 md:flex-row" data-admin-page="">
      <Switch>
        <Match when={data.loading}>
          <p role="status" class="m-auto text-sm text-neutral-500">{t("web.admin.loading")}</p>
        </Match>
        <Match when={data.error}>
          <div class="m-auto grid max-w-md gap-3 p-6">
            <p role="alert" class="m-0 text-sm text-error-strong">{t("web.admin.failed")}</p>
            {back}
          </div>
        </Match>
        <Match when={managed().length === 0}>
          <div class="m-auto grid max-w-md gap-3 p-6" data-admin-denied="">
            <h1 class="m-0 text-lg font-semibold">{t("web.admin.title")}</h1>
            <p role="status" class="m-0 text-sm text-neutral-500">{t("web.admin.denied")}</p>
            {back}
          </div>
        </Match>
        <Match when={current()}>
          {(w) => (
            <>
              <nav aria-label={t("web.admin.title")} class="flex shrink-0 flex-col gap-1 bg-rail px-2 py-3 md:w-60">
                <div class="mx-1 mb-3 grid gap-1.5 rounded-lg border border-border bg-surface p-2" data-admin-scope="">
                  <div class="flex min-w-0 items-center gap-2">
                    <span class="grid size-7 shrink-0 place-items-center rounded-md bg-neutral-950 text-xs font-bold text-bg">
                      {(w().name || "?").slice(0, 1).toUpperCase()}
                    </span>
                    <div class="min-w-0 leading-tight">
                      <p class="m-0 truncate text-[0.8125rem] font-semibold">{w().name || t("settings.support_access.unnamed", { id: w().id })}</p>
                      <p class="m-0 truncate text-xs text-neutral-500">
                        {[w().organization, w().plan, roleName(w().role)].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                  </div>
                  <Show when={data()!.rows.length > 1}>
                    <Select
                      aria-label={t("web.admin.switch")}
                      value={String(w().id)}
                      onChange={(e) => setChosen(Number(e.currentTarget.value))}
                    >
                      <For each={data()!.rows}>
                        {(m) => <option value={String(m.id)}>{m.name || t("settings.support_access.unnamed", { id: m.id })}</option>}
                      </For>
                    </Select>
                  </Show>
                </div>
                <For each={GROUPS}>
                  {(g) => (
                    <div class="grid gap-1 pb-3">
                      <p class="m-0 px-3 pb-1 text-xs text-neutral-500">{g.name()}</p>
                      <SidebarMenu class="gap-0.5">
                        <For each={SECTIONS.filter((s) => s.group === g.id)}>
                          {(s) => (
                            <SidebarMenuItem>
                              <SidebarMenuButton
                                isActive={section() === s.id}
                                selectionMark={false}
                                aria-current={section() === s.id ? "page" : undefined}
                                data-admin-section={s.id}
                                class="h-9 min-h-9 grid-cols-[18px_minmax(0,1fr)_auto] gap-2.5 rounded-md border-0 py-0 pl-3 pr-2 data-[active=true]:bg-surface data-[active=true]:font-semibold"
                                onClick={() => setSection(s.id)}
                              >
                                <span class="flex size-4 items-center justify-center">{s.icon()}</span>
                                <span class="truncate">{s.name()}</span>
                                <Show when={s.soon}>
                                  <Badge forma="dato">{t("settings.nav.soon")}</Badge>
                                </Show>
                              </SidebarMenuButton>
                            </SidebarMenuItem>
                          )}
                        </For>
                      </SidebarMenu>
                    </div>
                  )}
                </For>
                <div class="mt-auto border-0 border-t border-solid border-border px-1 pt-2">{back}</div>
              </nav>
              <section class="min-h-0 min-w-0 flex-1 overflow-auto bg-surface px-6 pb-10 pt-6 md:px-8">
                <div class="mx-auto max-w-3xl">
                  <Show when={isManager(w().role)} fallback={<p role="status" class="m-0 text-sm text-neutral-500" data-admin-denied="">{t("web.admin.denied_workspace")}</p>}>
                    <Show when={w().id} keyed>
                      {(_id) => <Body section={section()} workspace={w()} source={props.source} active={data()!.active} />}
                    </Show>
                  </Show>
                </div>
              </section>
            </>
          )}
        </Match>
      </Switch>
    </main>
  );
}

function Body(props: { section: Section; workspace: Membership; source: AdminSource; active: number | null }) {
  const soon = (title: string) => (
    <SettingsSection title={title} description={t("settings.nav.soon_why")} data-admin-soon="" />
  );
  return (
    <SettingsPanel>
      <Switch>
        <Match when={props.section === "general"}>
          <SettingsSection title={t("web.admin.general")}>
            <SettingsRow label={t("web.admin.name")} description={props.workspace.name || t("settings.support_access.unnamed", { id: props.workspace.id })} />
            <SettingsRow label={t("web.admin.channels")} description={t("web.admin.channels_hint")}>
              <Button as="a" size="sm" variant="secondary" href={AGENTS_URL} target="_blank" rel="noopener noreferrer">
                {t("web.admin.open")}
                <ExternalLink size={13} />
              </Button>
            </SettingsRow>
          </SettingsSection>
        </Match>
        <Match when={props.section === "members"}>{soon(t("web.admin.members"))}</Match>
        <Match when={props.section === "support"}>
          <Suspense fallback={null}>
            <SupportAccess source={scoped(props.source.support, props.workspace)} />
          </Suspense>
        </Match>
        <Match when={props.section === "audit"}>
          <Show
            when={props.source.auditLog && props.active === props.workspace.id ? props.source.auditLog : undefined}
            fallback={<SettingsSection title={t("audit.title")} description={props.source.auditLog ? t("web.admin.audit_other") : t("audit.unavailable")} />}
          >
            {(source) => (
              <Suspense fallback={null}>
                <AuditLog source={source()} />
              </Suspense>
            )}
          </Show>
        </Match>
        <Match when={props.section === "workspaces"}>{soon(t("web.admin.org_workspaces"))}</Match>
        <Match when={props.section === "plan"}>{soon(t("web.admin.plan"))}</Match>
      </Switch>
    </SettingsPanel>
  );
}
