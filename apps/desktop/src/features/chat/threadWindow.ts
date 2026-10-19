/**
 * Qué tramos del hilo están montados. Un tramo son `CHUNK` bloques contados
 * desde el principio: su id no cambia cuando el hilo crece por el final, y
 * anteponer uno no mueve lo que ya está pintado. Abrir monta los dos últimos.
 */

export const CHUNK = 10;

/** El tramo en el que empieza lo montado al abrir un hilo de `total` bloques. */
export function tailChunk(total: number): number {
  return Math.max(0, Math.floor((total - 1) / CHUNK) - 1);
}

/** Los ids de tramo montados, del primero al último que tiene bloques. */
export function chunkIds(total: number, first: number): number[] {
  if (total <= 0) return [];
  const last = Math.floor((total - 1) / CHUNK);
  const ids: number[] = [];
  for (let id = Math.min(first, last); id <= last; id++) ids.push(id);
  return ids;
}

export function chunkOf<T>(blocks: T[], id: number): T[] {
  return blocks.slice(id * CHUNK, (id + 1) * CHUNK);
}

/**
 * Dónde se quedó leyendo alguien: el mensaje con que empieza el bloque y su
 * distancia al borde de arriba. Un índice de bloque cambia al plegarse un turno.
 */
export type Lectura = { mensaje: number; desfase: number };

/** El bloque que contiene `message`, dado el primer mensaje de cada bloque en orden. */
export function blockOfMessage(starts: number[], message: number): number | null {
  let found: number | null = null;
  for (let k = 0; k < starts.length && starts[k] <= message; k++) found = k;
  return found;
}
