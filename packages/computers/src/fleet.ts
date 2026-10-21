/**
 * Varias computadoras detrás de un panel. Cada motor guarda sus propios ids:
 * dos workspaces de máquinas distintas son el mismo si tienen el mismo
 * proveedor y remoto o, si no, el mismo nombre, y solo cuando el parecido es
 * único en las dos. Es la regla de `Fleet` en `apps/desktop/src/web/fleet.ts`.
 */

export type WorkspaceRow = { id: string; name?: string | null; provider?: string | null; remote?: string | null };

/** Un workspace juntado: su fila (la de la primera máquina) y su id local en cada máquina. */
export type WorkspaceGroup<R extends WorkspaceRow = WorkspaceRow> = {
  /** `máquina~id` de la máquina que lo encabeza (el separador de la web): estable mientras ella lo tenga. */
  key: string;
  row: R;
  members: Map<string, string>;
};

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** `lists` en el orden de las máquinas (`orderComputers`): la primera encabeza cada grupo. */
export function groupWorkspaces<R extends WorkspaceRow>(lists: readonly { machine: string; rows: readonly R[] }[]): WorkspaceGroup<R>[] {
  const groups: WorkspaceGroup<R>[] = [];
  for (const { machine, rows } of lists) {
    const free = groups.filter((g) => !g.members.has(machine));
    const pick = (same: (a: R, b: R) => boolean, w: R) => {
      const theirs = free.filter((g) => same(g.row, w));
      const mine = rows.filter((x) => same(x, w));
      return theirs.length === 1 && mine.length === 1 ? theirs[0] : undefined;
    };
    const remote = (a: R, b: R) => !!text(a.provider) && !!text(a.remote) && a.provider === b.provider && a.remote === b.remote;
    const named = (a: R, b: R) => !!text(a.name) && text(a.name).toLowerCase() === text(b.name).toLowerCase();
    for (const w of rows) {
      const g = pick(remote, w) ?? pick(named, w);
      if (g) {
        g.members.set(machine, w.id);
        free.splice(free.indexOf(g), 1);
      } else groups.push({ key: `${machine}~${w.id}`, row: w, members: new Map([[machine, w.id]]) });
    }
  }
  return groups;
}
