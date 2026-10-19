import { type TaskActivity, type TaskState, TASK_STATES, taskPriority } from "@terminus/design";
import { t } from "./i18n.ts";
import { escribirPref, leerPref } from "./prefs.ts";

/** Qué enseña la lista de tareas del sidebar. `folders` vacío son todas las carpetas. */
export type SidebarView = {
  folders: string[];
  agent: string | null;
  group: SidebarGrouping;
  density: SidebarDensity;
};

export type SidebarGrouping = "none" | "folder" | "status" | "agent";
export type SidebarDensity = "comfortable" | "compact";
export type SidebarSection = "needs_you" | "active";

export const DEFAULT_SIDEBAR_VIEW: SidebarView = {
  folders: [],
  agent: null,
  group: "none",
  density: "comfortable",
};

const GROUPINGS: readonly SidebarGrouping[] = ["none", "folder", "status", "agent"];
const DENSITIES: readonly SidebarDensity[] = ["comfortable", "compact"];

/** Lo que el sidebar sabe de una fila (`SessionRow`) y basta para colocarla. */
export type SidebarTask = {
  id: string;
  folder?: string | null;
  agent?: string | null;
  pinned?: boolean | null;
  chat_de_agente?: boolean;
  inbox?: boolean;
  archived?: boolean | null;
  esperando: boolean;
  outcome?: "delivered" | "failed" | null;
  sin_ver?: boolean;
  stage?: "in_progress" | "review" | "done" | null;
  delegated_activity?: TaskActivity;
};

export type SidebarContext<T extends SidebarTask = SidebarTask> = {
  /** Tareas con un turno en marcha (`vivas`). */
  live: Iterable<string>;
  /** Tareas paradas esperando que se apruebe una acción (`aprobando`). */
  approving: Iterable<string>;
  /** De qué carpeta es la tarea; por omisión `task.folder`. */
  folderOf?: (task: T) => string | null | undefined;
};

export type SidebarGroup<T> = {
  kind: "section" | "folder" | "status" | "agent";
  /** Sección, id de carpeta, estado o nombre de agente; `""` es sin carpeta o sin agente. */
  key: string;
  tasks: T[];
};

export type SidebarStatusKey = TaskState | "idle" | "finished";

function sanitize(raw: unknown): SidebarView {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_SIDEBAR_VIEW };
  const v = raw as Record<string, unknown>;
  const folders = Array.isArray(v.folders)
    ? [...new Set(v.folders.filter((f): f is string => typeof f === "string" && f !== ""))]
    : [];
  return {
    folders,
    agent: typeof v.agent === "string" && v.agent !== "" ? v.agent : null,
    group: GROUPINGS.includes(v.group as SidebarGrouping) ? (v.group as SidebarGrouping) : "none",
    density: DENSITIES.includes(v.density as SidebarDensity) ? (v.density as SidebarDensity) : "comfortable",
  };
}

/** La vista se guarda por workspace y espacio, como la tira de pestañas. */
export function sidebarViewKey(workspace: string | null, space: string | null): string {
  return space ? `sidebar.view.${workspace ?? ""}.${space}` : `sidebar.view.${workspace ?? ""}`;
}

export function loadSidebarView(key: string): SidebarView {
  return sanitize(leerPref<unknown>(key, null));
}

export function saveSidebarView(key: string, view: SidebarView) {
  escribirPref(key, sanitize(view));
}

/** Igual que la fila del historial: sin valor del backend, el chat del agente y la bandeja van fijados. */
export function isPinned(task: SidebarTask): boolean {
  return task.pinned ?? (!!task.chat_de_agente || task.inbox === true);
}

function has(ids: Iterable<string>, id: string): boolean {
  if (ids instanceof Set) return ids.has(id);
  if (Array.isArray(ids)) return ids.includes(id);
  for (const x of ids) if (x === id) return true;
  return false;
}

/** La actividad que pinta `EstadoDeTarea` para esta fila. */
export function activityOf(task: SidebarTask, ctx: Pick<SidebarContext, "live" | "approving">): TaskActivity {
  return task.delegated_activity ?? {
    aprobando: has(ctx.approving, task.id),
    viva: has(ctx.live, task.id),
    esperando: task.esperando,
    outcome: task.outcome,
    sinVer: task.sin_ver,
  };
}

export function sectionOf(task: SidebarTask, ctx: Pick<SidebarContext, "live" | "approving">): SidebarSection {
  const state = taskPriority(activityOf(task, ctx));
  if (state === "approving" || state === "asked" || state === "failed") return "needs_you";
  return "active";
}

function statusKey(task: SidebarTask, ctx: Pick<SidebarContext, "live" | "approving">): SidebarStatusKey {
  return taskPriority(activityOf(task, ctx)) ?? (task.stage === "done" || task.outcome === "delivered" ? "finished" : "idle");
}

const pinnedFirst = <T extends SidebarTask>(tasks: T[]): T[] =>
  tasks.map((task, i) => ({ task, i }))
    .sort((a, b) => Number(isPinned(b.task)) - Number(isPinned(a.task)) || a.i - b.i)
    .map(({ task }) => task);

function groupBy<T extends SidebarTask>(tasks: T[], keyOf: (task: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const task of tasks) {
    const key = keyOf(task);
    const list = groups.get(key);
    if (list) list.push(task);
    else groups.set(key, [task]);
  }
  return groups;
}

/**
 * Filtra por carpetas y agente y reparte en grupos, conservando el orden de
 * entrada (la más nueva primero). Sin agrupar devuelve siempre las dos
 * secciones; agrupando, solo los grupos con tareas.
 */
export function applySidebarView<T extends SidebarTask>(
  tasks: readonly T[],
  view: SidebarView,
  ctx: SidebarContext<T>,
): SidebarGroup<T>[] {
  const folderOf = (task: T) => (ctx.folderOf ? ctx.folderOf(task) : task.folder) ?? "";
  const visible = tasks.filter((task) => !task.archived
    && (view.folders.length === 0 || view.folders.includes(folderOf(task)))
    && (view.agent === null || task.agent === view.agent));

  const sections = groupBy(visible, (task) => sectionOf(task, ctx));
  const section = (key: SidebarSection): SidebarGroup<T> => ({
    kind: "section",
    key,
    tasks: pinnedFirst(sections.get(key) ?? []),
  });
  if (view.group === "none") return [section("needs_you"), section("active")];

  let groups: Map<string, T[]>;
  let order: string[];
  if (view.group === "status") {
    groups = groupBy(visible, (task) => statusKey(task, ctx));
    order = [...TASK_STATES, "idle", "finished"];
  } else {
    groups = groupBy(visible, view.group === "folder" ? folderOf : (task) => task.agent ?? "");
    order = [...[...groups.keys()].filter((key) => key !== ""), ""];
  }
  const kind = view.group;
  return order.filter((key) => groups.has(key)).map((key) => ({ kind, key, tasks: pinnedFirst(groups.get(key)!) }));
}

export function nonDefaultCount(view: SidebarView): number {
  return Number(view.folders.length > 0)
    + Number(view.agent !== null)
    + Number(view.group !== DEFAULT_SIDEBAR_VIEW.group)
    + Number(view.density !== DEFAULT_SIDEBAR_VIEW.density);
}

export function groupingLabel(group: SidebarGrouping): string {
  switch (group) {
    case "folder": return t("shell.sidebar.view.group_folder");
    case "status": return t("shell.sidebar.view.group_status");
    case "agent": return t("shell.sidebar.view.group_agent");
    default: return t("shell.sidebar.view.group_none");
  }
}

/** La línea bajo «Nueva tarea» que dice qué se enseña. */
export function scopeLabel(view: SidebarView, folderName: (id: string) => string): string {
  const parts = [view.folders.length ? view.folders.map(folderName).join(", ") : t("shell.sidebar.view.all_folders")];
  if (view.agent) parts.push(view.agent);
  switch (view.group) {
    case "folder": parts.push(t("shell.sidebar.view.scope_by_folder")); break;
    case "status": parts.push(t("shell.sidebar.view.scope_by_status")); break;
    case "agent": parts.push(t("shell.sidebar.view.scope_by_agent")); break;
  }
  return parts.join(" · ");
}

export function sectionLabel(section: SidebarSection): string {
  switch (section) {
    case "needs_you": return t("shell.sidebar.view.section_needs_you");
    default: return t("shell.sidebar.view.section_active");
  }
}

export function statusGroupLabel(key: SidebarStatusKey): string {
  switch (key) {
    case "approving": return t("shell.sidebar.view.status_approving");
    case "asked": return t("shell.sidebar.view.status_asked");
    case "working": return t("shell.sidebar.view.status_working");
    case "failed": return t("shell.sidebar.view.status_failed");
    case "unseen": return t("shell.sidebar.view.status_unseen");
    case "finished": return t("shell.sidebar.view.status_finished");
    default: return t("shell.sidebar.view.status_idle");
  }
}

export function groupLabel(group: SidebarGroup<unknown>, folderName: (id: string) => string): string {
  switch (group.kind) {
    case "section": return sectionLabel(group.key as SidebarSection);
    case "status": return statusGroupLabel(group.key as SidebarStatusKey);
    case "folder": return group.key ? folderName(group.key) : t("shell.sidebar.view.no_folder");
    default: return group.key || t("shell.sidebar.view.no_agent");
  }
}
