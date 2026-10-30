/**
 * Lo que se comparte con el equipo de un workspace: skills, MCP y agentes. Vive en
 * la cuenta de Danil y se administra por workspace. Las rutas de la cuenta no
 * existen todavía: sin `SharedSource`, /admin marca estas secciones como «pronto».
 */
import { createResource, createSignal, For } from "solid-js";
import { SettingsPanel, SettingsRow, SettingsSection } from "../../features/settings/layout";
import { t } from "../../lib/i18n";
import { Badge } from "../../ui/Badge";
import { Select } from "../../ui/Select";
import { Toggle } from "../../ui/Toggle";

export type Audience = "team" | "managers" | "chosen";
export type SharedSkillSource = { id: string; repo: string; branch: string; commit: string; skills: number; current: boolean };
export type SharedSkill = { id: string; name: string; path: string; audience: Audience; required: boolean };
export type SharedServer = { id: string; name: string; host: string; credential: "personal" | "team"; machines: number; audience: Audience };
export type SharedAgent = { id: string; name: string; path: string; audience: Audience };
export type SharedSource = {
  skills: () => Promise<{ sources: SharedSkillSource[]; skills: SharedSkill[] }>;
  servers: () => Promise<SharedServer[]>;
  agents: () => Promise<SharedAgent[]>;
  setAudience: (kind: "skill" | "server" | "agent", id: string, audience: Audience) => Promise<void>;
  setRequired: (id: string, required: boolean) => Promise<void>;
};

function AudienceSelect(props: { value: Audience; onChange: (value: Audience) => void }) {
  return (
    <Select class="w-44" aria-label={t("web.admin.audience")} value={props.value} onChange={(e) => props.onChange(e.currentTarget.value as Audience)}>
      <option value="team">{t("web.admin.audience_team")}</option>
      <option value="managers">{t("web.admin.audience_managers")}</option>
      <option value="chosen">{t("web.admin.audience_chosen")}</option>
    </Select>
  );
}

export function SharedSkills(props: { source: SharedSource }) {
  const [data, { refetch }] = createResource(() => props.source.skills());
  return (
    <SettingsPanel data-admin-shared="skills">
      <SettingsSection title={t("web.admin.sources")} description={t("web.admin.sources_hint")}>
        <For each={data()?.sources}>
          {(row) => (
            <SettingsRow label={row.repo} description={t("web.admin.source_detail", { branch: row.branch, commit: row.commit, count: row.skills })}>
              <Badge tone={row.current ? "success" : "warning"}>{row.current ? t("web.admin.source_current") : t("web.admin.source_behind")}</Badge>
            </SettingsRow>
          )}
        </For>
      </SettingsSection>
      <SettingsSection title={t("web.admin.skills")}>
        <For each={data()?.skills}>
          {(row) => (
            <SettingsRow label={row.name} description={row.path}>
              <AudienceSelect value={row.audience} onChange={(value) => void props.source.setAudience("skill", row.id, value).then(() => refetch())} />
              <span class="text-xs text-neutral-500">{t("web.admin.required")}</span>
              <Toggle
                checked={row.required}
                label={t("web.admin.required_named", { name: row.name })}
                onChange={(value) => void props.source.setRequired(row.id, value).then(() => refetch())}
              />
            </SettingsRow>
          )}
        </For>
      </SettingsSection>
    </SettingsPanel>
  );
}

export function SharedMcp(props: { source: SharedSource }) {
  const [rows, { refetch }] = createResource(() => props.source.servers());
  const credential = (row: SharedServer) =>
    row.credential === "personal" ? t("web.admin.credential_personal") : t("web.admin.credential_team", { count: row.machines });
  return (
    <SettingsPanel data-admin-shared="mcp">
      <SettingsSection title={t("web.admin.mcp_title")} description={t("web.admin.mcp_hint")}>
        <For each={rows()}>
          {(row) => (
            <SettingsRow label={row.name} description={`${row.host} · ${credential(row)}`}>
              <AudienceSelect value={row.audience} onChange={(value) => void props.source.setAudience("server", row.id, value).then(() => refetch())} />
            </SettingsRow>
          )}
        </For>
      </SettingsSection>
    </SettingsPanel>
  );
}

export function SharedAgents(props: { source: SharedSource }) {
  const [rows, { refetch }] = createResource(() => props.source.agents());
  return (
    <SettingsPanel data-admin-shared="agents">
      <SettingsSection title={t("web.admin.agents")} description={t("web.admin.agents_hint")}>
        <For each={rows()}>
          {(row) => (
            <SettingsRow label={row.name} description={row.path}>
              <AudienceSelect value={row.audience} onChange={(value) => void props.source.setAudience("agent", row.id, value).then(() => refetch())} />
            </SettingsRow>
          )}
        </For>
      </SettingsSection>
    </SettingsPanel>
  );
}

/** `/admin?demo=1`: en memoria, sin red. */
export function sharedDemo(): SharedSource {
  const [skills, setSkills] = createSignal<SharedSkill[]>([
    { id: "1", name: "revisar-pr", path: "practicas/revisar-pr", audience: "team", required: true },
    { id: "2", name: "escribir-en-espanol", path: "practicas/escribir", audience: "team", required: false },
  ]);
  const [servers, setServers] = createSignal<SharedServer[]>([
    { id: "1", name: "Jira", host: "mcp.atlassian.com", credential: "personal", machines: 0, audience: "team" },
    { id: "2", name: "Inventario", host: "mcp.ejemplo.mx", credential: "team", machines: 4, audience: "managers" },
  ]);
  const [agents, setAgents] = createSignal<SharedAgent[]>([
    { id: "1", name: "QA", path: "practicas/agents/qa", audience: "team" },
  ]);
  return {
    skills: async () => ({ sources: [{ id: "1", repo: "ejemplo/practicas", branch: "main", commit: "a1b2c3d", skills: skills().length, current: true }], skills: skills() }),
    servers: async () => servers(),
    agents: async () => agents(),
    setAudience: async (kind, id, audience) => {
      const change = <T extends { id: string; audience: Audience }>(rows: T[]) => rows.map((row) => (row.id === id ? { ...row, audience } : row));
      if (kind === "skill") setSkills(change);
      else if (kind === "server") setServers(change);
      else setAgents(change);
    },
    setRequired: async (id, required) => void setSkills((rows) => rows.map((row) => (row.id === id ? { ...row, required } : row))),
  };
}
