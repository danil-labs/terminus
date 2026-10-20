/**
 * El evento `attention` trae una entrada por workspace (`[entrada]`): se junta
 * con lo que ya se sabía de los demás, no lo reemplaza. Una entrada sin tareas
 * deja ese workspace sin nada que esperar.
 */
export function mergeAttention<E extends { workspace: string }>(current: readonly E[], update: readonly E[]): E[] {
  const changed = new Map(update.map((entry) => [entry.workspace, entry]));
  const kept = current.map((entry) => changed.get(entry.workspace) ?? entry);
  return [...kept, ...update.filter((entry) => !current.some((c) => c.workspace === entry.workspace))];
}
