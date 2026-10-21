/**
 * Varias computadoras detrás de un panel. Un workspace tiene el mismo id en cada
 * máquina que lo tiene (`apps/desktop/docs/account-workspace.md`): dos filas son
 * el mismo workspace solo si su id es igual, nunca por nombre ni remoto. Es la
 * regla de `Fleet` en `apps/desktop/src/web/fleet.ts`.
 */

export type WorkspaceRow = { id: string; name?: string | null; provider?: string | null; remote?: string | null };

/** Un workspace juntado: su fila (la de la primera máquina) y su id en cada máquina, que es el mismo. */
export type WorkspaceGroup<R extends WorkspaceRow = WorkspaceRow> = {
  /** El id del workspace. */
  key: string;
  row: R;
  members: Map<string, string>;
};

/** `lists` en el orden de las máquinas (`orderComputers`): la primera pone la fila. */
export function groupWorkspaces<R extends WorkspaceRow>(lists: readonly { machine: string; rows: readonly R[] }[]): WorkspaceGroup<R>[] {
  const groups = new Map<string, WorkspaceGroup<R>>();
  for (const { machine, rows } of lists)
    for (const w of rows) {
      const g = groups.get(w.id) ?? { key: w.id, row: w, members: new Map<string, string>() };
      g.members.set(machine, w.id);
      groups.set(w.id, g);
    }
  return [...groups.values()];
}
