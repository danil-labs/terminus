import { type TaskActivity, taskPriority } from "@terminus/design";
import { authorKey, shownUnderLauncher } from "../projects/taskAuthors";

/** Lo mínimo de una tarea que la lista del riel necesita para repartirla. */
export type FlatRow = {
  id: string;
  created_at: number;
  archived?: boolean | null;
  pinned?: boolean | null;
  chat_de_agente?: boolean;
  inbox?: boolean;
  agent?: string | null;
  stage?: string | null;
  outcome?: "delivered" | "failed" | null;
  esperando?: boolean;
  sin_ver?: boolean;
  delegated_activity?: TaskActivity;
  launched_by?: string | null;
  launcher_available?: boolean;
  parent?: string | null;
  subagent?: string | null;
  launcher_name?: string | null;
  parent_agent?: string | null;
};

/** Una tarea con la carpeta de la que viene; `""` es «sin carpeta», como en el backend. */
export type FlatTask<R extends FlatRow = FlatRow> = { project: string; row: R };

export type SidebarGrouping = "none" | "folder" | "status" | "agent";
export type SidebarDensity = "comfortable" | "compact";

export type SidebarFilter = {
  /** Vacío es «todas las carpetas». */
  folders: string[];
  agent: string | null;
  group: SidebarGrouping;
  density: SidebarDensity;
};

export const DEFAULT_SIDEBAR_FILTER: SidebarFilter = {
  folders: [],
  agent: null,
  group: "none",
  density: "comfortable",
};

/** Lo guardado puede venir de otra versión: lo que no se reconoce vuelve a su valor por omisión. */
export function normalizeFilter(saved: Partial<SidebarFilter> | null | undefined): SidebarFilter {
  const value = saved ?? {};
  return {
    folders: Array.isArray(value.folders) ? value.folders.filter((f): f is string => typeof f === "string") : [],
    agent: typeof value.agent === "string" && value.agent ? value.agent : null,
    group: (["none", "folder", "status", "agent"] as const).includes(value.group as SidebarGrouping)
      ? (value.group as SidebarGrouping)
      : "none",
    density: value.density === "compact" ? "compact" : "comfortable",
  };
}

/** Cuántos ajustes se apartan del valor por omisión: es la cifra del botón de filtro. */
export function activeFilterCount(filter: SidebarFilter): number {
  return (filter.folders.length > 0 ? 1 : 0) + (filter.agent ? 1 : 0)
    + (filter.group !== "none" ? 1 : 0) + (filter.density !== "comfortable" ? 1 : 0);
}

export function rowActivity(row: FlatRow, vivas: readonly string[], aprobando: readonly string[]): TaskActivity {
  return row.delegated_activity ?? {
    aprobando: aprobando.includes(row.id),
    viva: vivas.includes(row.id),
    esperando: !!row.esperando,
    outcome: row.outcome,
    sinVer: row.sin_ver,
  };
}

export type TaskBucket = "need" | "tasks" | "settled";

/**
 * Dónde cae una tarea: lo que no avanza sin ti arriba, lo entregado y ya visto
 * —o marcado como hecho— abajo, plegado. Lo que trabaja nunca se asienta.
 */
export function bucketOf(row: FlatRow, activity: TaskActivity): TaskBucket {
  const state = taskPriority(activity);
  if (state === "approving" || state === "asked" || state === "failed") return "need";
  if (state) return "tasks";
  return row.outcome === "delivered" || row.stage === "done" ? "settled" : "tasks";
}

/**
 * Todas las tareas vivas de todas las carpetas en una sola lista, de la más
 * nueva a la más vieja. Una tarea que su lanzador ya enseña no se repite,
 * salvo fijada o buscando: es la misma regla que la lista por carpeta.
 */
export function flattenTasks<R extends FlatRow>(
  byProject: Record<string, R[]>,
  searching = false,
): FlatTask<R>[] {
  const out: FlatTask<R>[] = [];
  const vistas = new Set<string>();
  // «Sin carpeta» al final: si una fila llegara repetida, gana la carpeta.
  const entradas = Object.entries(byProject).sort(([a], [b]) => Number(a === "") - Number(b === ""));
  for (const [project, rows] of entradas) {
    for (const row of rows) {
      if (row.archived || vistas.has(row.id)) continue;
      vistas.add(row.id);
      if (!searching && !row.pinned && shownUnderLauncher(row, rows)) continue;
      out.push({ project, row });
    }
  }
  return out.sort((a, b) => b.row.created_at - a.row.created_at);
}

/** Cuántas tareas tiene cada carpeta, antes de filtrar: el menú solo ofrece carpetas con tareas. */
export function folderCounts(tasks: readonly FlatTask[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const task of tasks) counts.set(task.project, (counts.get(task.project) ?? 0) + 1);
  return counts;
}

/**
 * Las carpetas elegidas que todavía tienen tareas. Si ninguna sigue ahí, se
 * vuelve a «todas»: un filtro que deja la lista vacía sin decir por qué parece
 * que se borró el trabajo.
 */
export function effectiveFolders(filter: SidebarFilter, counts: Map<string, number>): string[] {
  return filter.folders.filter((folder) => (counts.get(folder) ?? 0) > 0);
}

export function applyFilter<R extends FlatRow>(
  tasks: readonly FlatTask<R>[],
  folders: readonly string[],
  agent: string | null,
): FlatTask<R>[] {
  return tasks.filter((task) => (folders.length === 0 || folders.includes(task.project))
    && (!agent || task.row.agent === agent));
}

export type TaskGroup<R extends FlatRow = FlatRow> = { key: string; tasks: FlatTask<R>[] };

const STATUS_KEYS = ["need", "working", "idle"] as const;

/**
 * Los grupos de «Agrupar», en orden fijo y sin grupos vacíos. Por carpeta
 * sigue el orden del riel y deja «sin carpeta» al final; por agente, «Mis
 * tareas» primero y los agentes por nombre.
 */
export function groupTasks<R extends FlatRow>(
  tasks: readonly FlatTask<R>[],
  grouping: Exclude<SidebarGrouping, "none">,
  activityOf: (row: R) => TaskActivity,
  folderOrder: readonly string[],
): TaskGroup<R>[] {
  const keyOf = (task: FlatTask<R>): string => {
    if (grouping === "folder") return task.project;
    if (grouping === "agent") return authorKey(task.row, true);
    const state = taskPriority(activityOf(task.row));
    return state === "approving" || state === "asked" || state === "failed" ? "need"
      : state === "working" ? "working" : "idle";
  };
  const groups = new Map<string, FlatTask<R>[]>();
  for (const task of tasks) {
    const key = keyOf(task);
    groups.set(key, [...(groups.get(key) ?? []), task]);
  }
  const rank = (key: string): number => {
    if (grouping === "folder") {
      const at = folderOrder.indexOf(key);
      return key === "" ? Number.MAX_SAFE_INTEGER : at === -1 ? folderOrder.length : at;
    }
    if (grouping === "status") return STATUS_KEYS.indexOf(key as (typeof STATUS_KEYS)[number]);
    return key === "unassigned" ? -1 : 0;
  };
  return [...groups.keys()]
    .sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0))
    .map((key) => ({ key, tasks: groups.get(key) ?? [] }));
}
