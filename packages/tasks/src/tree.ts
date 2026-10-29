export type TaskTreeRow = {
  id: string;
  parent?: string | null;
  launched_by?: string | null;
  launcher_available?: boolean;
  machine?: string | null;
  workspace?: string | null;
};

export type TaskBranch<T> = { tarea: T; hijas: TaskBranch<T>[] };

export function taskParent(row: TaskTreeRow): string | null {
  return row.parent ?? (row.launcher_available === false ? null : row.launched_by ?? null);
}

export const taskIdentity = (row: TaskTreeRow): string => JSON.stringify([row.workspace ?? null, row.machine ?? null, row.id]);

function relationships<T extends TaskTreeRow>(rows: readonly T[]) {
  const unique = new Map<string, T>();
  const byId = new Map<string, T[]>();
  for (const row of rows) {
    if (unique.has(taskIdentity(row))) continue;
    unique.set(taskIdentity(row), row);
    const candidates = byId.get(row.id) ?? [];
    candidates.push(row);
    byId.set(row.id, candidates);
  }
  const parents = new Map<string, string>();
  for (const row of unique.values()) {
    const id = taskParent(row);
    const candidates = id === null ? [] : byId.get(id) ?? [];
    const compatible = candidates.filter((candidate) =>
      (!row.machine || !candidate.machine || row.machine === candidate.machine)
      && (!row.workspace || !candidate.workspace || row.workspace === candidate.workspace));
    const exact = compatible.find((candidate) =>
      (candidate.machine ?? null) === (row.machine ?? null)
      && (candidate.workspace ?? null) === (row.workspace ?? null));
    // Missing scope is usable only when the reference is unambiguous.
    const parent = exact ?? (compatible.length === 1 ? compatible[0] : undefined);
    if (parent && taskIdentity(parent) !== taskIdentity(row)) parents.set(taskIdentity(row), taskIdentity(parent));
  }
  return { unique, parents };
}

export function buildTaskTree<T extends TaskTreeRow>(
  rows: readonly T[], previous?: readonly TaskBranch<T>[],
): TaskBranch<T>[] {
  const { unique, parents } = relationships(rows);
  const children = new Map<string, T[]>();
  for (const row of unique.values()) {
    const parent = parents.get(taskIdentity(row));
    if (parent === undefined) continue;
    const siblings = children.get(parent) ?? [];
    siblings.push(row);
    children.set(parent, siblings);
  }
  const before = new Map<string, TaskBranch<T>>();
  const index = (branches: readonly TaskBranch<T>[]) => {
    for (const branch of branches) {
      before.set(taskIdentity(branch.tarea), branch);
      index(branch.hijas);
    }
  };
  if (previous) index(previous);
  const visited = new Set<string>();
  const build = (row: T): TaskBranch<T> => {
    const key = taskIdentity(row);
    visited.add(key);
    const hijas = (children.get(key) ?? []).filter((child) => !visited.has(taskIdentity(child))).map(build);
    const old = before.get(key);
    return old && old.tarea === row && old.hijas.length === hijas.length && old.hijas.every((child, i) => child === hijas[i])
      ? old : { tarea: row, hijas };
  };
  const result: TaskBranch<T>[] = [];
  for (const row of unique.values()) if (!parents.has(taskIdentity(row)) && !visited.has(taskIdentity(row))) result.push(build(row));
  // Components made entirely of cycles still need a visible root.
  for (const row of unique.values()) if (!visited.has(taskIdentity(row))) result.push(build(row));
  return result;
}

export function withTaskAncestors<T extends TaskTreeRow>(allRows: readonly T[], matchingRows: readonly T[]): T[] {
  const { unique, parents } = relationships(allRows);
  const included = new Set<string>();
  for (const row of matchingRows) {
    let key: string | undefined = taskIdentity(row);
    while (key !== undefined && unique.has(key) && !included.has(key)) {
      included.add(key);
      key = parents.get(key);
    }
  }
  return [...unique.values()].filter((row) => included.has(taskIdentity(row)));
}

export function taskDescendants<T extends TaskTreeRow>(rows: readonly T[], roots: readonly TaskTreeRow[]): T[] {
  // Absent roots participate in link resolution but never in the returned rows.
  const { parents } = relationships<TaskTreeRow>([...rows, ...roots]);
  const { unique } = relationships(rows);
  const seeds = new Set(roots.map(taskIdentity));
  const included = new Set(seeds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [child, parent] of parents) if (included.has(parent) && !included.has(child)) {
      included.add(child);
      changed = true;
    }
  }
  return [...unique.values()].filter((row) => included.has(taskIdentity(row)) && !seeds.has(taskIdentity(row)));
}
