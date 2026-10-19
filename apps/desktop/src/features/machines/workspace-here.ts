import { createRoot, createSignal } from "solid-js";
import { invoke } from "../../lib/invoke.ts";
import { t } from "../../lib/i18n";
import { asFailure, type Failure } from "../../ui/Failure";
import { machineName, machines, refetchMachines, setRunOn } from "./store";

/**
 * «Usar este workspace aquí»: crea en otra máquina el workspace que solo tiene
 * una, con el mismo nombre, para que la web los junte (`web/fleet.ts`). Copia
 * lo que no lleva credenciales y, si el workspace es de una organización,
 * inicia sesión en Radiant en esa máquina con la misma organización.
 */

type Row = {
  id: string;
  name: string;
  machines?: string[];
  lengua?: string | null;
  lengua_de_salida?: string | null;
  default_permission_mode?: string | null;
  terminal_theme?: string | null;
  worktrees_root?: string | null;
  logo?: string | null;
};
type Listing = { workspaces: Row[] };
type Prompt = { uri: string; code: string };
type RadiantStatus = {
  server: string | null;
  signed_in: boolean;
  workspace: { id: string; name: string } | null;
  login: { running: boolean; prompt: Prompt | null; failure: Failure | null } | null;
};
type Identity = { status: string; organization: string | null; organizations: { id: string; name: string }[] };
type Known = { id: string; clave: string; name: string; conectado: boolean };
type Server = { name: string; managed?: boolean };
type SkillSource = { id: string; rotulo: string; nombre: string; location: string; branch: string; managed: boolean; missing: boolean; enabled: boolean };

export type Phase = "creating" | "copying" | "signing_in" | "done" | "failed";
export type WorkspaceHere = {
  workspace: string;
  machine: string;
  name: string;
  phase: Phase;
  organization: string | null;
  prompt: Prompt | null;
  copied: string[];
  skipped: string[];
  failure: Failure | null;
};

const POLL = 1500;
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const on = (machine: string) => ({ headers: { "x-terminus-machine": machine } });

const [current, setCurrent] = createRoot(() => createSignal<WorkspaceHere | null>(null));
export { current as workspaceHere };

let cancelled = false;

const update = (patch: Partial<WorkspaceHere>) => setCurrent((c) => (c ? { ...c, ...patch } : c));

/** Lo que tiene sesión o vale solo en la otra máquina: se dice, no se copia. */
function notCopyable(row: Row, target: string): string[] {
  const out = [t("shell.machines.here.sign_in", { name: machineName(target) })];
  if (row.worktrees_root) out.push(t("shell.machines.here.skip_worktrees"));
  return out;
}

async function copySettings(row: Row, workspace: string, from: ReturnType<typeof on>, to: ReturnType<typeof on>, copied: string[], skipped: string[]) {
  const step = async (label: string, run: () => Promise<unknown>) => {
    try {
      await run();
      copied.push(label);
    } catch {
      skipped.push(t("shell.machines.here.skip_failed", { what: label }));
    }
  };
  if (row.lengua) await step(t("shell.machines.here.language"), () => invoke("set_workspace_language", { id: workspace, lengua: row.lengua }, to));
  if (row.lengua_de_salida)
    await step(t("shell.machines.here.output_language"), () => invoke("set_workspace_output_language", { id: workspace, lengua: row.lengua_de_salida }, to));
  if (row.default_permission_mode)
    await step(t("shell.machines.here.permission_mode"), () => invoke("set_workspace_permission_mode", { id: workspace, mode: row.default_permission_mode }, to));
  if (row.terminal_theme)
    await step(t("shell.machines.here.terminal_theme"), () => invoke("set_workspace_terminal_theme", { id: workspace, theme: row.terminal_theme }, to));

  // El logo viaja en bytes: su ruta es de la otra máquina, y `preview_file` la lee allí por el id que lleva.
  if (row.logo) {
    const logo = row.logo;
    await step(t("shell.machines.here.logo"), async () => {
      const { data_url } = await invoke<{ data_url: string | null }>("preview_file", { path: logo, rel: logo });
      const png = /^data:image\/png;base64,(.+)$/i.exec(data_url ?? "")?.[1];
      if (!png) throw new Error("not_png");
      await invoke("set_workspace_logo_png", { id: workspace, pngBase64: png }, to);
    });
  }

  // Conectores del catálogo: conectar declara el servidor; la sesión la pide el agente en esa máquina.
  const known = await invoke<Known[]>("list_known_mcp", {}, from).catch(() => [] as Known[]);
  const there = await invoke<Known[]>("list_known_mcp", {}, to).catch(() => [] as Known[]);
  for (const k of known.filter((k) => k.conectado)) {
    if (there.some((x) => x.id === k.id && x.conectado)) continue;
    await step(t("shell.machines.here.connector", { name: k.name }), () => invoke("connect_known_mcp", { id: k.id }, to));
  }
  // Un servidor pegado a mano puede llevar claves en su bloque, y el motor no lo devuelve entero.
  const servers = await invoke<Server[]>("list_mcp_servers", {}, from).catch(() => [] as Server[]);
  for (const s of servers.filter((s) => !s.managed && !known.some((k) => k.clave === s.name)))
    skipped.push(t("shell.machines.here.skip_mcp", { name: s.name }));

  const sources = await invoke<{ fuentes: SkillSource[] }>("list_skill_sources", {}, from).catch(() => ({ fuentes: [] as SkillSource[] }));
  const present = await invoke<{ fuentes: SkillSource[] }>("list_skill_sources", {}, to).catch(() => ({ fuentes: [] as SkillSource[] }));
  for (const f of sources.fuentes.filter((f) => !f.managed && !f.missing && f.location)) {
    if (present.fuentes.some((x) => x.location === f.location)) continue;
    await step(t("shell.machines.here.skills", { name: f.nombre }), async () => {
      const added = await invoke<{ id: string }>("add_skill_source", { url: f.location, branch: f.branch || null, rotulo: f.rotulo }, to);
      if (!f.enabled) await invoke("set_skill_source_enabled", { id: added.id, enabled: false }, to);
    });
  }
}

/** Radiant en `to` con el mismo servidor, organización y workspace que tiene la otra máquina. */
async function signIn(org: RadiantStatus, who: Identity | null, to: ReturnType<typeof on>) {
  const remote = org.workspace as { id: string; name: string };
  let status = await invoke<RadiantStatus>("radiant_status", {}, to);
  if (org.server && status.server !== org.server) status = await invoke<RadiantStatus>("radiant_set_server", { server: org.server }, to);
  if (!status.signed_in) {
    status = await invoke<RadiantStatus>("radiant_login", {}, to);
    while (!status.signed_in) {
      if (cancelled) throw { what: t("shell.machines.here.cancelled"), detail: "cancelled" };
      if (status.login?.failure) throw status.login.failure;
      if (status.login && !status.login.running) throw { what: t("shell.machines.here.login_stopped"), detail: "radiant_login" };
      update({ prompt: status.login?.prompt ?? null });
      await sleep(POLL);
      status = await invoke<RadiantStatus>("radiant_status", {}, to);
    }
  }
  update({ prompt: null });
  const identity = await invoke<Identity>("get_radiant_identity", {}, to);
  if (identity.status === "organization_selection_required") {
    const same = identity.organizations.find((o) => o.name === who?.organization);
    if (same) status = await invoke<RadiantStatus>("radiant_select_organization", { id: same.id }, to);
  }
  if (status.workspace?.id !== remote.id) await invoke<RadiantStatus>("radiant_select_workspace", { id: remote.id }, to);
}

export async function startWorkspaceHere(workspace: string, machine: string) {
  if (current() && !["done", "failed"].includes(current()?.phase ?? "")) return;
  cancelled = false;
  setCurrent({ workspace, machine, name: "", phase: "creating", organization: null, prompt: null, copied: [], skipped: [], failure: null });
  try {
    const listing = await invoke<Listing>("list_workspaces");
    const row = listing.workspaces.find((w) => w.id === workspace);
    const source = row?.machines?.find((m) => m !== machine);
    if (!row || !source) throw { what: t("shell.machines.here.no_source"), detail: "no_source" };
    update({ name: row.name });
    const from = on(source);
    const to = on(machine);

    const radiant = await invoke<RadiantStatus>("radiant_status", {}, from).catch(() => null);
    const org = radiant?.signed_in && radiant.workspace ? radiant : null;
    const who = org ? await invoke<Identity>("get_radiant_identity", {}, from).catch(() => null) : null;
    update({ organization: org ? (who?.organization ?? org.workspace?.name ?? null) : null });

    await invoke("add_workspace", { name: row.name }, to);
    const merged = await invoke<Listing>("list_workspaces");
    if (!merged.workspaces.find((w) => w.id === workspace)?.machines?.includes(machine))
      throw { what: t("shell.machines.here.not_merged", { name: machineName(machine) }), detail: "not_merged" };
    await invoke("set_active_workspace", { id: workspace });

    update({ phase: "copying" });
    const copied: string[] = [];
    const skipped: string[] = [];
    await copySettings(row, workspace, from, to, copied, skipped);
    skipped.push(...notCopyable(row, machine));
    update({ copied, skipped });

    if (org) {
      update({ phase: "signing_in" });
      await signIn(org, who, to);
    }

    await refetchMachines();
    const now = machines().find((m) => m.id === machine);
    setRunOn(workspace, now?.active ? null : machine);
    update({ phase: "done" });
  } catch (error) {
    update({ phase: "failed", prompt: null, failure: asFailure(error) });
  }
}

export function cancelWorkspaceHere() {
  const c = current();
  if (!c) return;
  cancelled = true;
  if (c.phase === "signing_in") void invoke("radiant_cancel_login", {}, on(c.machine)).catch(() => {});
}

export const dismissWorkspaceHere = () => setCurrent(null);
