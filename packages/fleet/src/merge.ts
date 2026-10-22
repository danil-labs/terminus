/**
 * Las rebanadas de varias máquinas juntas en lo que la ventana ya lee. Solo
 * suman las que traen valor: una máquina que no contestó no borra ni vacía
 * nada, y si ninguna trae valor no hay respuesta (`undefined`), nunca `[]`.
 *
 * Un workspace y sus proyectos tienen el mismo id en todas las máquinas
 * (`apps/desktop/docs/account-workspace.md`); lo demás lleva el prefijo de su
 * máquina (`ids.ts`). Las filas de otra máquina dicen cuál es y en qué estado
 * está su rebanada.
 */
import { type AccountWorkspace, registryProjects } from "../../computers/src/index.ts";
import { mergeAttention } from "../../protocol/src/index.ts";
import { wrap } from "./ids.ts";
import type { Slice } from "./slices.ts";

type Row = Record<string, unknown>;
type Entry = { workspace: string; tasks: unknown[] };

export type MergeContext = {
  /** La máquina de la ventana, cuyas filas y ids quedan como están; `null` en la web. */
  self: string | null;
  /** Si `machine` contesta ahora: sus filas lo dicen (`machine_on`). */
  on(machine: string): boolean;
  /** El orden de las máquinas: la primera pone la fila de lo que comparten. */
  order: readonly string[];
  /** El registro de la cuenta, o `null` si el plano de control no lo dice. */
  registry: readonly AccountWorkspace[] | null;
};

/** Llaves cuyo texto es un id de la máquina que lo mandó. */
const KEYS = new Set(["session", "parent", "portfolio", "account", "space"]);
/** Llaves cuyo valor es un archivo de imagen de esa máquina: `preview_file` lo lee allá. */
const FILES = new Set(["logo", "background", "avatar"]);
const isPath = (v: string) => /^(\/|~\/|[a-z]:[\\/])/i.test(v);
/** Respuestas cuyas filas traen el id de lo que listan. */
const ROW_IDS = new Set(["list_portfolios", "list_live_sessions", "list_spaces"]);
/** Respuestas con un objeto por id de tarea. */
const KEYED = new Set(["list_session_git"]);
/** Respuestas que son un objeto con su propio id. */
const OWN_ID = new Set(["load_session", "add_account", "create_space", "rename_space", "set_space_folders", "move_task_to_space"]);
/** Filas que la barra marca con su máquina. */
const TAGGED = new Set(["list_live_sessions"]);

const isRow = (v: unknown): v is Row => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const isEntry = (v: unknown): v is Entry => isRow(v) && typeof v.workspace === "string";

/** Una respuesta o evento de `machine` con los ids del panel. */
export function encode(ctx: MergeContext, machine: string, value: unknown, command = ""): unknown {
  if (machine === ctx.self) return value;
  if (command === "list_active_turns" && Array.isArray(value)) return value.map((v) => (typeof v === "string" ? wrap(machine, v) : v));
  if (command === "send_message" && typeof value === "string") return wrap(machine, value);
  const walk = (v: unknown, key: string | null): unknown => {
    if (typeof v === "string") {
      if (!key || !v) return v;
      return KEYS.has(key) || (FILES.has(key) && isPath(v)) ? wrap(machine, v) : v;
    }
    if (Array.isArray(v)) return v.map((x) => walk(x, key));
    if (isRow(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]));
    return v;
  };
  const out = walk(value, null);
  const ownId = (row: Row) => (typeof row.id === "string" ? { ...row, id: wrap(machine, row.id) } : row);
  if (ROW_IDS.has(command) && Array.isArray(out)) return out.map((r) => (isRow(r) ? ownId(r) : r));
  if (OWN_ID.has(command) && isRow(out)) return ownId(out);
  if (KEYED.has(command) && isRow(out)) return Object.fromEntries(Object.entries(out).map(([id, v]) => [wrap(machine, id), v]));
  return out;
}

/** Un evento de `machine` para el panel: también el id suelto de `account-rejected`. */
export function encodeEvent(ctx: MergeContext, machine: string, name: string, payload: unknown): unknown {
  if (name === "account-rejected" && typeof payload === "string" && machine !== ctx.self) return wrap(machine, payload);
  return encode(ctx, machine, payload);
}

const position = (ctx: MergeContext, machine: string) => {
  if (machine === ctx.self) return -1;
  const i = ctx.order.indexOf(machine);
  return i < 0 ? ctx.order.length : i;
};
const sorted = (ctx: MergeContext, slices: readonly Slice[]) => slices.filter((s) => s.has).sort((a, b) => position(ctx, a.machine) - position(ctx, b.machine));

/** La fila de una máquina que no es la de la ventana: dice de cuál es y en qué estado está su rebanada. */
function tag(ctx: MergeContext, slice: Slice, row: Row): Row {
  if (slice.machine === ctx.self) return row;
  return { ...row, machine: slice.machine, machine_on: ctx.on(slice.machine), machine_status: slice.status, machine_at: slice.at };
}

/**
 * Las rebanadas de una lectura juntas, o `undefined` si ninguna trae valor:
 * quien llama dice entonces por qué (`machine_off`, `machine_timeout`), en vez
 * de enseñar una lista vacía que no es cierta.
 */
export function merge(ctx: MergeContext, command: string, slices: readonly Slice[], workspace: string | null = null): unknown {
  const parts = sorted(ctx, slices);
  if (command === "list_workspaces" || command === "workspaces_startup") return mergeWorkspaces(ctx, parts);
  if (command === "list_projects") return parts.length || inRegistry(ctx, workspace) ? mergeProjects(ctx, parts, workspace) : undefined;
  if (!parts.length) return undefined;
  if (command === "list_workspace_attention") return joinAttention(parts.map((s) => ({ machine: s.machine, entries: entriesOf(encode(ctx, s.machine, s.value)) })));
  const encoded = parts.map((s) => {
    const value = encode(ctx, s.machine, s.value, command);
    return TAGGED.has(command) && Array.isArray(value) ? value.map((r) => (isRow(r) ? tag(ctx, s, r) : r)) : value;
  });
  if (encoded.every(Array.isArray)) {
    const all = (encoded as unknown[][]).flat();
    if (command !== "list_live_sessions") return all;
    const at = (r: unknown) => (isRow(r) && typeof r.updated_at === "number" ? r.updated_at : 0);
    return all.sort((a, b) => at(b) - at(a));
  }
  if (encoded.every(isRow)) {
    const joined: Row = { ...(encoded[0] as Row) };
    for (const p of encoded.slice(1) as Row[])
      for (const [k, v] of Object.entries(p)) if (Array.isArray(v) && Array.isArray(joined[k])) joined[k] = [...(joined[k] as unknown[]), ...v];
    return joined;
  }
  return encoded.find((p) => p !== null && p !== undefined) ?? null;
}

const inRegistry = (ctx: MergeContext, workspace: string | null) => !!workspace && !!ctx.registry?.some((w) => w.id === workspace);

/** Un workspace del registro como la ventana lee una fila de `list_workspaces`. */
export function registryRow(w: AccountWorkspace): Row {
  const at = Date.parse(w.created_at ?? "");
  const setting = (key: "lengua" | "lengua_de_salida" | "default_permission_mode" | "terminal_theme") => w.settings?.[key] ?? null;
  return {
    id: w.id,
    name: w.name,
    context_root: null,
    lengua: setting("lengua"),
    lengua_de_salida: setting("lengua_de_salida"),
    default_permission_mode: setting("default_permission_mode"),
    terminal_theme: setting("terminal_theme"),
    worktrees_root: null,
    git_host: null,
    remote: null,
    memoria: { tipo: "local" },
    created_at: Number.isFinite(at) ? Math.floor(at / 1000) : 0,
    sessions: 0,
    logo: null,
  };
}

/**
 * Una fila por workspace: de la primera máquina que lo lista, con las máquinas
 * que lo tienen (`machines`): las que lo listaron y, de la cuenta, las que dice
 * el registro. El activo es el de la ventana (o el de la primera máquina).
 */
function mergeWorkspaces(ctx: MergeContext, parts: Slice[]): unknown {
  const lists = parts.filter((s) => isRow(s.value) && Array.isArray((s.value as Row).workspaces));
  if (!lists.length && !ctx.registry?.length) return parts[0]?.value;
  const rows = new Map<string, { row: Row; owner: string | null; machines: Set<string> }>();
  for (const s of lists)
    for (const w of (s.value as Row).workspaces as Row[]) {
      if (typeof w?.id !== "string") continue;
      const seen = rows.get(w.id) ?? { row: w, owner: s.machine, machines: new Set<string>() };
      seen.machines.add(s.machine);
      rows.set(w.id, seen);
    }
  const known = new Set(ctx.order);
  for (const w of ctx.registry ?? []) {
    const seen = rows.get(w.id) ?? { row: registryRow(w), owner: null, machines: new Set<string>() };
    for (const c of w.computers) if (known.has(c)) seen.machines.add(c);
    rows.set(w.id, seen);
  }
  const fileOf = (row: Row, owner: string | null) => (owner && owner !== ctx.self && typeof row.logo === "string" && isPath(row.logo) ? { logo: wrap(owner, row.logo) } : {});
  const order = (m: string) => position(ctx, m);
  const workspaces = [...rows].map(([id, { row, owner, machines }]) => ({ ...row, ...fileOf(row, owner), id, machines: [...machines].sort((a, b) => order(a) - order(b)) }));
  const lead = lists[0];
  const live = lists.map((s) => (s.value as Row).active).find((a): a is string => typeof a === "string" && rows.has(a)) ?? null;
  const base = lead ? (encode(ctx, lead.machine, lead.value) as Row) : { migrations: [] };
  return { ...base, workspaces, active: live ?? (lead ? null : (workspaces[0]?.id ?? null)) };
}

/**
 * Una fila por proyecto, con las máquinas que tienen su carpeta (`machines`).
 * La fila de una máquina que solo lo conoce por la cuenta (`materialized: false`)
 * no suma máquina; su remoto dice si otra puede clonarlo.
 */
function mergeProjects(ctx: MergeContext, parts: Slice[], workspace: string | null): unknown[] {
  const joined = new Map<string, { row: Row; machines: string[]; remote: string | null; here: boolean }>();
  for (const s of parts) {
    if (!Array.isArray(s.value)) continue;
    for (const raw of s.value) {
      if (!isRow(raw) || typeof raw.id !== "string") continue;
      const row = encode(ctx, s.machine, raw) as Row;
      const here = raw.materialized !== false;
      const seen = joined.get(raw.id);
      const entry = seen ?? { row, machines: [], remote: null, here };
      if (seen && here && !seen.here) Object.assign(entry, { row, here });
      if (here) entry.machines.push(s.machine);
      entry.remote ??= text(raw.remote_url) || null;
      joined.set(raw.id, entry);
    }
  }
  for (const p of registryProjects(ctx.registry, workspace, new Set(joined.keys()))) {
    const home = p.home_computer_id && ctx.order.includes(p.home_computer_id) ? [p.home_computer_id] : [];
    const row = { id: p.id, name: p.name, node: null, sources: [], portfolio: null, working_directory: null, kind: p.remote_url ? "git" : "folder", created_at: 0, updated_at: 0, sessions: 0, materialized: false };
    joined.set(p.id, { row, machines: home, remote: text(p.remote_url) || null, here: false });
  }
  return [...joined.values()].map((e) => ({ ...e.row, ...(e.remote ? { remote_url: e.remote } : {}), machines: e.machines }));
}

const entriesOf = (value: unknown): Entry[] => (Array.isArray(value) ? value.filter(isEntry) : []);

/** Una entrada por workspace con las tareas que esperan en todas sus máquinas. */
function joinAttention(lists: readonly { machine: string; entries: readonly Entry[] }[]): Entry[] {
  const joined = new Map<string, Entry>();
  for (const { entries } of lists)
    for (const e of entries) {
      const before = joined.get(e.workspace);
      const tasks = Array.isArray(e.tasks) ? e.tasks : [];
      joined.set(e.workspace, before ? { ...before, tasks: [...before.tasks, ...tasks] } : { ...e, tasks });
    }
  return [...joined.values()];
}

/**
 * Lo que espera a la persona según cada máquina, para el evento `attention`:
 * la ventana recibe siempre la lista de todas. Un workspace que tenía algo y ya
 * no queda sin tareas, así la ventana lo lee como la lista entera.
 */
export class AttentionBook {
  private byMachine = new Map<string, Entry[]>();
  private seen = new Set<string>();

  /** La lista entera de `machine` (de `list_workspace_attention`). */
  set(machine: string, value: unknown) {
    const entries = entriesOf(value);
    this.byMachine.set(machine, entries);
    for (const e of entries) this.seen.add(e.workspace);
  }

  /** Un evento `attention` de `machine`, entero o de un solo workspace. */
  update(machine: string, payload: unknown): Entry[] {
    const entries = entriesOf(payload);
    this.byMachine.set(machine, mergeAttention(this.byMachine.get(machine) ?? [], entries));
    for (const e of entries) this.seen.add(e.workspace);
    return this.list();
  }

  forget(machine: string) {
    this.byMachine.delete(machine);
  }

  list(): Entry[] {
    const joined = joinAttention([...this.byMachine].map(([machine, entries]) => ({ machine, entries })));
    const have = new Set(joined.map((e) => e.workspace));
    for (const id of this.seen) if (!have.has(id)) joined.push({ workspace: id, tasks: [] });
    return joined;
  }
}
