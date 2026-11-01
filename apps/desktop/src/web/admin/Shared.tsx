/**
 * Lo que se comparte con el equipo de un workspace: skills, MCP y agentes. Las
 * rutas de la cuenta no existen todavía: sin `SharedSource`, /admin no las muestra.
 * Sus escrituras directas no se ofrecen aquí mientras se decide si la autoridad
 * es la cuenta o el repositorio: un cambio se propone por `PolicyFlow`.
 */
import { createResource, createSignal, For, Show } from "solid-js";
import { SettingsPanel, SettingsRow, SettingsSection } from "../../features/settings/layout";
import { t } from "../../lib/i18n";
import { Badge } from "../../ui/Badge";
import { PolicyFlow, type PolicyArea, type PolicySource } from "./PolicyFlow";

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

const audienceName = (value: Audience) =>
  value === "team" ? t("web.admin.audience_team") : value === "managers" ? t("web.admin.audience_managers") : t("web.admin.audience_chosen");

function AudienceBadge(props: { value: Audience }) {
  return <Badge title={t("web.admin.audience")}>{audienceName(props.value)}</Badge>;
}

type Props = { source: SharedSource; policy?: PolicySource; canPropose: boolean };

/** Abajo de cada lista: quién manda aún no se decide, y lo cambiado va por propuesta. */
function Governed(props: { area: PolicyArea; policy?: PolicySource; canPropose: boolean }) {
  return (
    <>
      <p role="status" class="m-0 rounded-md border border-border bg-surface-muted px-3 py-2 text-xs text-neutral-950" data-admin-authority="">
        {t("web.admin.authority_open")}
      </p>
      <Show when={props.policy}>{(policy) => <PolicyFlow area={props.area} source={policy()} canPropose={props.canPropose} />}</Show>
    </>
  );
}

export function SharedSkills(props: Props) {
  const [data] = createResource(() => props.source.skills());
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
              <AudienceBadge value={row.audience} />
              <Show when={row.required}><Badge tone="active">{t("web.admin.required")}</Badge></Show>
            </SettingsRow>
          )}
        </For>
      </SettingsSection>
      <Governed area="skills" policy={props.policy} canPropose={props.canPropose} />
    </SettingsPanel>
  );
}

export function SharedMcp(props: Props) {
  const [rows] = createResource(() => props.source.servers());
  const credential = (row: SharedServer) =>
    row.credential === "personal" ? t("web.admin.credential_personal") : t("web.admin.credential_team", { count: row.machines });
  return (
    <SettingsPanel data-admin-shared="mcp">
      <SettingsSection title={t("web.admin.mcp_title")} description={t("web.admin.mcp_hint")}>
        <For each={rows()}>
          {(row) => (
            <SettingsRow label={row.name} description={`${row.host} · ${credential(row)}`}>
              <AudienceBadge value={row.audience} />
            </SettingsRow>
          )}
        </For>
      </SettingsSection>
      <Governed area="mcp" policy={props.policy} canPropose={props.canPropose} />
    </SettingsPanel>
  );
}

export function SharedAgents(props: Props) {
  const [rows] = createResource(() => props.source.agents());
  return (
    <SettingsPanel data-admin-shared="agents">
      <SettingsSection title={t("web.admin.agents")} description={t("web.admin.agents_hint")}>
        <For each={rows()}>
          {(row) => (
            <SettingsRow label={row.name} description={row.path}>
              <AudienceBadge value={row.audience} />
            </SettingsRow>
          )}
        </For>
      </SettingsSection>
      <Governed area="agents" policy={props.policy} canPropose={props.canPropose} />
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
