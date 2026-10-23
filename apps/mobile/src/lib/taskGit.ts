/**
 * El git de las tarjetas que se ven (`list_session_git`), para el PR de la
 * línea 2. Va por máquina, workspace y carpeta, y `priority` dice qué tareas
 * refrescar primero: una llamada por carpeta con sus tareas visibles, nunca una
 * por fila. Las tareas sin carpeta no tienen git.
 *
 * Lo leído se guarda por `host/id`, como el resto de la lista. Lo que no se
 * pudo releer (la máquina no contesta, o está apagada) se conserva con
 * `stale`: la tarjeta lo enseña en gris, sin afirmar ni el rojo del CI.
 */
import type { TaskGit } from "@terminus/tasks";

export type GitAsk = { host: string; workspace: string; project: string; priority: string[] };

export function gitAsks(visible: readonly { host: string; workspace: string; folder: string; id: string }[]): GitAsk[] {
  const asks = new Map<string, GitAsk>();
  for (const task of visible) {
    if (!task.folder) continue;
    const key = `${task.host}\u0000${task.workspace}\u0000${task.folder}`;
    const ask = asks.get(key) ?? { host: task.host, workspace: task.workspace, project: task.folder, priority: [] };
    if (!ask.priority.includes(task.id)) ask.priority.push(task.id);
    asks.set(key, ask);
  }
  return [...asks.values()];
}

/** Una firma estable de lo pedido: si no cambia, no se vuelve a preguntar. */
export const gitAsksKey = (asks: readonly GitAsk[]) =>
  asks.map((a) => `${a.host}/${a.workspace}/${a.project}:${a.priority.join(",")}`).sort().join("|");

export type GitBook = Readonly<Record<string, TaskGit>>;

const isRow = (v: unknown): v is TaskGit => !!v && typeof v === "object" && "pull_known" in v;

/**
 * La respuesta de una carpeta en el libro. Una fila que el motor no pudo leer
 * (`kind: "unknown"`) no borra lo que ya se sabía: queda vieja.
 */
export function withGitAnswer(book: GitBook, host: string, answer: unknown): GitBook {
  if (!answer || typeof answer !== "object") return book;
  let next: Record<string, TaskGit> | null = null;
  for (const [id, row] of Object.entries(answer as Record<string, unknown>)) {
    if (!isRow(row)) continue;
    const key = `${host}/${id}`;
    const before = book[key];
    const value = (row as { kind?: string }).kind === "unknown" && before ? { ...before, stale: true } : row;
    if (before && JSON.stringify(before) === JSON.stringify(value)) continue;
    next ??= { ...book };
    next[key] = value;
  }
  return next ?? book;
}

/** Lo que ya se sabía de esas tareas, ahora viejo: no se pudo releer. */
export function staleGit(book: GitBook, host: string, ids: readonly string[]): GitBook {
  let next: Record<string, TaskGit> | null = null;
  for (const id of ids) {
    const key = `${host}/${id}`;
    const before = book[key];
    if (!before || before.stale) continue;
    next ??= { ...book };
    next[key] = { ...before, stale: true };
  }
  return next ?? book;
}
