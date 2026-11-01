/** Lo de la organización: sus workspaces, su plan y, en Enterprise, solo lo que ya esté configurado. */
import { createResource, For, Show } from "solid-js";
import { SettingsPanel, SettingsRow, SettingsSection } from "../../features/settings/layout";
import { t } from "../../lib/i18n";

export type IdentityRow = { id: "sso" | "scim" | "domains" | "retention" | "roles"; value: string };
export type OrganizationSource = {
  workspaces?: () => Promise<{ id: number; name: string; members: number }[]>;
  plan?: () => Promise<{ name: string; detail: string }>;
  /** Lo propio de Enterprise que esta organización ya tiene; sin filas, la sección no existe. */
  identity?: IdentityRow[];
};

export function OrganizationWorkspaces(props: { source: () => Promise<{ id: number; name: string; members: number }[]> }) {
  const [rows] = createResource(() => props.source());
  return (
    <SettingsSection title={t("web.admin.org_workspaces")}>
      <For each={rows()}>{(row) => <SettingsRow label={row.name} description={t("web.admin.org_workspace_members", { count: row.members })} />}</For>
    </SettingsSection>
  );
}

export function Plan(props: { source: () => Promise<{ name: string; detail: string }> }) {
  const [plan] = createResource(() => props.source());
  return (
    <SettingsSection title={t("web.admin.plan")}>
      <Show when={plan()}>{(value) => <SettingsRow label={value().name} description={value().detail} />}</Show>
    </SettingsSection>
  );
}

export function Identity(props: { rows: IdentityRow[] }) {
  return (
    <SettingsPanel>
      <SettingsSection title={t("web.admin.identity")}>
        <For each={props.rows}>{(row) => <SettingsRow label={t(`web.admin.identity_${row.id}`)} description={row.value} />}</For>
      </SettingsSection>
    </SettingsPanel>
  );
}
