export type SessionLists<T> = Record<string, T[]>;

/** Iguales campo a campo, para datos que vienen de `JSON.parse`. */
function mismoValor(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const claves = Object.keys(a);
  if (claves.length !== Object.keys(b).length) return false;
  return claves.every((c) =>
    mismoValor((a as Record<string, unknown>)[c], (b as Record<string, unknown>)[c]),
  );
}

/**
 * La fila que no cambió conserva su objeto.
 *
 * `For` de Solid reconcilia por referencia: con filas nuevas en cada refresco
 * destruye y reconstruye el DOM de la lista entera, y una animación de la fila
 * se vuelve a disparar sin que nada haya cambiado.
 */
export function conservar<T>(previous: T[], incoming: T[], key: (row: T) => string): T[] {
  if (previous.length === 0) return incoming;
  const antes = new Map(previous.map((row) => [key(row), row]));
  const kept = incoming.map((row) => {
    const anterior = antes.get(key(row));
    return anterior !== undefined && mismoValor(anterior, row) ? anterior : row;
  });
  // La lista entera también: una nueva con las mismas filas despierta a quien la mira.
  return kept.length === previous.length && kept.every((row, i) => row === previous[i]) ? previous : kept;
}

/** Como `conservar`, por posición: para listas que solo crecen por el final y no tienen clave única. */
export function conservarEnOrden<T>(previous: T[], incoming: T[]): T[] {
  const kept = incoming.map((row, i) => (i < previous.length && mismoValor(previous[i], row) ? previous[i] : row));
  return kept.length === previous.length && kept.every((row, i) => row === previous[i]) ? previous : kept;
}

// Descartar una respuesta cuando salió otra después deja la lista vacía si esa
// otra no vuelve; pintar vacío ante un fallo esconde las tareas hasta el
// siguiente aviso.
export function sessionRefresh<T>(options: {
  read: (project: string) => Promise<T[]>;
  apply: (update: (previous: SessionLists<T>) => SessionLists<T>) => void;
  projects: () => string[];
  /** Qué hace a una fila la misma fila entre dos lecturas. */
  key: (row: T) => string;
  schedule?: (run: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
  /** Cuánto espera `gathered` a juntar en una sola lectura los avisos que llegan seguidos. */
  gather?: number;
}) {
  const schedule = options.schedule ?? ((run, ms) => setTimeout(run, ms));
  const cancel = options.cancel ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let generation = 0;
  let started = 0;
  let applied = 0;
  let delay = 0;
  let retry: unknown;
  let batch: { projects: Set<string>; handle: unknown; waiting: (() => void)[] } | null = null;

  function clearRetry() {
    if (retry === undefined) return;
    cancel(retry);
    retry = undefined;
  }

  async function refresh(projects: string[]): Promise<void> {
    const current = generation;
    const request = ++started;
    const results = await Promise.all(projects.map(async (project) => {
      try {
        return [project, await options.read(project)] as const;
      } catch {
        return [project, null] as const;
      }
    }));
    if (current !== generation || request < applied) return;
    applied = request;
    options.apply((previous) => Object.fromEntries(
      results.map(([project, rows]) => [
        project,
        rows === null
          ? previous[project] ?? []
          : conservar(previous[project] ?? [], rows, options.key),
      ]),
    ));
    clearRetry();
    if (results.every(([, rows]) => rows !== null)) {
      delay = 0;
      return;
    }
    delay = Math.min(delay === 0 ? 1000 : delay * 2, 30_000);
    retry = schedule(() => {
      retry = undefined;
      if (current === generation) void refresh(options.projects());
    }, delay);
  }

  function gathered(projects: string[]): Promise<void> {
    return new Promise((resolve) => {
      if (!batch) {
        const current = { projects: new Set<string>(), handle: undefined as unknown, waiting: [] as (() => void)[] };
        batch = current;
        current.handle = schedule(() => {
          batch = null;
          void refresh([...current.projects]).then(() => { for (const done of current.waiting) done(); });
        }, options.gather ?? 0);
      }
      for (const project of projects) batch.projects.add(project);
      batch.waiting.push(resolve);
    });
  }

  return {
    refresh,
    gathered,
    reset() {
      generation++;
      delay = 0;
      clearRetry();
      if (batch) {
        cancel(batch.handle);
        for (const done of batch.waiting) done();
        batch = null;
      }
    },
  };
}
