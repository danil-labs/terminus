/**
 * Varias computadoras detrás de un panel. Un workspace tiene el mismo id en cada
 * máquina que lo tiene (`apps/desktop/docs/account-workspace.md`): dos filas son
 * el mismo workspace solo si su id es igual, nunca por nombre ni remoto. Es la
 * regla de `Fleet` en `apps/desktop/src/web/fleet.ts`.
 */
import type { AccountProject, AccountWorkspace } from "./api.ts";

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

/**
 * Los grupos de las máquinas más el registro de la cuenta (`GET /v1/workspaces`):
 * un workspace no desaparece porque sus máquinas duerman. La fila de una máquina
 * que contestó manda; el registro suma los workspaces que nadie listó (con
 * `rowOf`) y, como miembros, las computadoras ligadas que no contestaron.
 * `machines`, las de la persona en su orden; `answered`, las que listaron hoy.
 */
export function withRegistry<R extends WorkspaceRow>(
  groups: readonly WorkspaceGroup<R>[],
  registry: readonly AccountWorkspace[] | null,
  machines: readonly string[],
  answered: ReadonlySet<string>,
  rowOf: (w: AccountWorkspace) => R,
): WorkspaceGroup<R>[] {
  if (!registry) return [...groups];
  const out = groups.map((g) => ({ ...g, members: new Map(g.members) }));
  for (const w of registry) {
    let g = out.find((x) => x.key === w.id);
    if (!g) out.push((g = { key: w.id, row: rowOf(w), members: new Map<string, string>() }));
    for (const c of w.computers) if (machines.includes(c) && !answered.has(c) && !g.members.has(c)) g.members.set(c, w.id);
  }
  // Los miembros en el orden de las máquinas: el primero pone la fila y los spaces.
  for (const g of out) g.members = new Map([...g.members].sort(([a], [b]) => machines.indexOf(a) - machines.indexOf(b)));
  return out;
}

/** Los proyectos del registro de `workspace` que ninguna máquina listó (`known`, sus ids). */
export function registryProjects(registry: readonly AccountWorkspace[] | null, workspace: string | null, known: ReadonlySet<string>): AccountProject[] {
  const w = workspace ? registry?.find((x) => x.id === workspace) : undefined;
  return w ? w.projects.filter((p) => !known.has(p.id)) : [];
}

/** Si la cuenta tiene algún workspace: con uno, el alta de «crea tu workspace» sobra. */
export function hasAccountWorkspaces(registry: readonly AccountWorkspace[] | null): boolean {
  return !!registry && registry.length > 0;
}
