import type { ChatBackground } from "@terminus/protocol";
import { createRoot, createSignal } from "solid-js";
import { invoke } from "../../lib/invoke.ts";
import { t } from "../../lib/i18n";
import { asFailure, type Failure } from "../../ui/Failure";
import { machineName, machines, refetchMachines, setRunOn } from "./store";

/**
 * «Usar este workspace aquí»: crea en otra máquina el workspace que solo tiene
 * una, con el mismo nombre, para que la web los junte (`web/fleet.ts`). Copia
 * en silencio lo que no lleva credenciales y, si el workspace es de una organización,
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
type SkillSource = { id: string; rotulo: string; nombre: string; location: string; branch: string; managed: boolean; missing: boolean; enabled: boolean };

export type Phase = "creating" | "copying" | "signing_in" | "failed";
export type WorkspaceHere = {
  workspace: string;
  machine: string;
  name: string;
  phase: Phase;
  organization: string | null;
  prompt: Prompt | null;
  failure: Failure | null;
};

const POLL = 1500;
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const on = (machine: string) => ({ headers: { "x-terminus-machine": machine } });

const [current, setCurrent] = createRoot(() => createSignal<WorkspaceHere | null>(null));
export { current as workspaceHere };

let cancelled = false;

const update = (patch: Partial<WorkspaceHere>) => setCurrent((c) => (c ? { ...c, ...patch } : c));

/** Lo que falle al copiar se queda sin copiar: el workspace ya existe allá y se ajusta a mano. */
async function copySettings(row: Row, workspace: string, from: ReturnType<typeof on>, to: ReturnType<typeof on>) {
  const step = (run: () => Promise<unknown>) => run().catch(() => {});
  if (row.lengua) await step(() => invoke("set_workspace_language", { id: workspace, lengua: row.lengua }, to));
  if (row.lengua_de_salida)
    await step(() => invoke("set_workspace_output_language", { id: workspace, lengua: row.lengua_de_salida }, to));
  if (row.default_permission_mode)
    await step(() => invoke("set_workspace_permission_mode", { id: workspace, mode: row.default_permission_mode }, to));
  if (row.terminal_theme)
    await step(() => invoke("set_workspace_terminal_theme", { id: workspace, theme: row.terminal_theme }, to));

  // El logo viaja en bytes: su ruta es de la otra máquina, y `preview_file` la lee allí por el id que lleva.
  if (row.logo) {
    const logo = row.logo;
    await step(async () => {
      const { data_url } = await invoke<{ data_url: string | null }>("preview_file", { path: logo, rel: logo });
      const png = /^data:image\/png;base64,(.+)$/i.exec(data_url ?? "")?.[1];
      if (!png) throw new Error("not_png");
      await invoke("set_workspace_logo_png", { id: workspace, pngBase64: png }, to);
    });
  }

  // El fondo de los chats es del workspace: la imagen viaja en bytes, y el patrón y el velo con ella.
  const fondo = await invoke<ChatBackground | null>("chat_background", {}, from).catch(() => null);
  const imagen = fondo && !fondo.preset ? fondo.data_url : null;
  const resto = fondo && (fondo.preset || fondo.veil != null) ? { preset: fondo.preset ?? null, veil: fondo.veil ?? null } : null;
  if (imagen || resto) {
    await step(async () => {
      if (imagen) await invoke("import_chat_background_data", { dataUrl: imagen }, to);
      if (resto) await invoke("set_chat_background", resto, to);
    });
  }

  // Conectores del catálogo: conectar declara el servidor; la sesión la pide el agente en esa máquina.
  const known = await invoke<Known[]>("list_known_mcp", {}, from).catch(() => [] as Known[]);
  const there = await invoke<Known[]>("list_known_mcp", {}, to).catch(() => [] as Known[]);
  for (const k of known.filter((k) => k.conectado)) {
    if (there.some((x) => x.id === k.id && x.conectado)) continue;
    await step(() => invoke("connect_known_mcp", { id: k.id }, to));
  }
  // Un servidor pegado a mano puede llevar claves en su bloque, y el motor no lo devuelve entero: no viaja.

  const sources = await invoke<{ fuentes: SkillSource[] }>("list_skill_sources", {}, from).catch(() => ({ fuentes: [] as SkillSource[] }));
  const present = await invoke<{ fuentes: SkillSource[] }>("list_skill_sources", {}, to).catch(() => ({ fuentes: [] as SkillSource[] }));
  for (const f of sources.fuentes.filter((f) => !f.managed && !f.missing && f.location)) {
    if (present.fuentes.some((x) => x.location === f.location)) continue;
    await step(async () => {
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
  if (current() && current()?.phase !== "failed") return;
  cancelled = false;
  setCurrent({ workspace, machine, name: "", phase: "creating", organization: null, prompt: null, failure: null });
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
    await copySettings(row, workspace, from, to);

    if (org) {
      update({ phase: "signing_in" });
      await signIn(org, who, to);
    }

    await refetchMachines();
    const now = machines().find((m) => m.id === machine);
    setRunOn(workspace, now?.active ? null : machine);
    // Al terminar no queda nota: la máquina ya sale elegida en «Ejecutar en».
    setCurrent(null);
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
