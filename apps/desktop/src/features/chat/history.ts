/**
 * Qué tramo de la transcripción entera tiene la ventana de cada tarea. `service history`
 * trae los últimos turnos; lo anterior llega por páginas al subir.
 */

/** El campo `history` de `service history`: `turns[i]` es el turno `start + i`. */
export type HistoryPage = { total: number; start: number; end: number; limit: number; has_more: boolean };

export type LoadedHistory<T> = { start: number; total: number; turns: T[] };

/**
 * Una relectura del final. Conserva lo anterior ya cargado si la transcripción solo creció
 * por el final; si se reescribió, queda la página nueva sola. Sin `page`, vino entera.
 */
export function refreshHistory<T>(previous: LoadedHistory<T> | undefined, turns: T[], page?: HistoryPage | null): LoadedHistory<T> {
  if (!page) return { start: 0, total: turns.length, turns };
  const fresh = { start: page.start, total: page.total, turns };
  if (!previous || page.start <= previous.start || page.total < previous.total) return fresh;
  const kept = page.start - previous.start;
  if (kept > previous.turns.length) return fresh;
  return { start: previous.start, total: page.total, turns: [...previous.turns.slice(0, kept), ...turns] };
}

/** Una página anterior delante de lo cargado; `null` si ya no encaja y hay que releer el final. */
export function prependHistory<T>(previous: LoadedHistory<T>, turns: T[], page?: HistoryPage | null): LoadedHistory<T> | null {
  if (!page || page.end !== previous.start || page.total < previous.total) return null;
  return { start: page.start, total: previous.total, turns: [...turns, ...previous.turns] };
}
