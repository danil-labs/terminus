/**
 * Qué tramo de la transcripción entera tiene la ventana de cada tarea. `service history`
 * trae los últimos turnos; lo anterior llega por páginas al subir.
 */

/** El campo `history` de `service history`: `turns[i]` es el turno `start + i`. */
export type HistoryPage = { version?: number; revision?: string; total: number; start: number; end: number; limit: number; has_more: boolean };

export type LoadedHistory<T> = { revision?: string; start: number; total: number; turns: T[] };

/**
 * Una relectura del final. Conserva lo anterior ya cargado si la transcripción solo creció
 * por el final; si se reescribió, queda la página nueva sola. Sin `page`, vino entera.
 */
export function refreshHistory<T>(previous: LoadedHistory<T> | undefined, turns: T[], page?: HistoryPage | null): LoadedHistory<T> {
  if (!page) return { start: 0, total: turns.length, turns };
  const fresh = { ...(page.revision ? { revision: page.revision } : {}), start: page.start, total: page.total, turns };
  if (!previous || (page.revision && previous.revision !== page.revision) || page.start <= previous.start || page.total < previous.total) return bounded(fresh, page.version, "tail");
  const kept = page.start - previous.start;
  if (kept > previous.turns.length) return bounded(fresh, page.version, "tail");
  return bounded({ ...(page.revision ? { revision: page.revision } : {}), start: previous.start, total: page.total, turns: [...previous.turns.slice(0, kept), ...turns] }, page.version, "tail");
}

/** Una página anterior delante de lo cargado; `null` si ya no encaja y hay que releer el final. */
export function prependHistory<T>(previous: LoadedHistory<T>, turns: T[], page?: HistoryPage | null): LoadedHistory<T> | null {
  if (!page || (page.revision && previous.revision !== page.revision) || page.end !== previous.start || page.total < previous.total) return null;
  return bounded({ ...(page.revision ? { revision: page.revision } : {}), start: page.start, total: previous.total, turns: [...turns, ...previous.turns] }, page.version, "head");
}

const HISTORY_BYTES = 2 * 1024 * 1024;
function bounded<T>(history: LoadedHistory<T>, version: number | undefined, edge: "head" | "tail"): LoadedHistory<T> {
  if (version !== 1) return history;
  const sizes = history.turns.map(turn => new TextEncoder().encode(JSON.stringify(turn)).length);
  let bytes = sizes.reduce((sum, value) => sum + value, 0);
  let from = 0, end = sizes.length;
  while (bytes > HISTORY_BYTES && end - from > 1) {
    bytes -= edge === "tail" ? sizes[from++] : sizes[--end];
  }
  return from === 0 && end === sizes.length ? history : { ...history, start: history.start + from, turns: history.turns.slice(from, end) };
}
