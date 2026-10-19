/**
 * Todas las tareas vivas de todas las carpetas en una sola lista: la lista
 * plana del sidebar (#151) y la del teléfono.
 */

/** Lo que hace falta de una fila para saber si su lanzador ya la enseña. */
export type LauncherRow = {
  launched_by?: string | null;
  parent?: string | null;
  launcher_available?: boolean;
};

/**
 * Si la lista esconde una tarea para mostrarla bajo su lanzador. Solo cuenta un
 * lanzador de la misma lista: el de otra carpeta no la muestra en esta.
 */
export function shownUnderLauncher(session: LauncherRow, rows: readonly { id: string }[]): boolean {
  const launcher = session.parent ?? session.launched_by;
  return !!launcher && session.launcher_available !== false
    && rows.some((row) => row.id === launcher);
}

/** Lo mínimo de una tarea para juntarla con las de las demás carpetas. */
export type FlatRow = LauncherRow & {
  id: string;
  created_at: number;
  archived?: boolean | null;
  pinned?: boolean | null;
  subagent?: string | null;
  launcher_name?: string | null;
  parent_agent?: string | null;
  agent?: string | null;
};

/** Una tarea con la carpeta de la que viene; `""` es «sin carpeta», como en el backend. */
export type FlatTask<R extends FlatRow = FlatRow> = { project: string; row: R };

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

/** Cuántas tareas tiene cada carpeta, antes de filtrar: el filtro solo ofrece carpetas con tareas. */
export function folderCounts(tasks: readonly FlatTask[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const task of tasks) counts.set(task.project, (counts.get(task.project) ?? 0) + 1);
  return counts;
}
