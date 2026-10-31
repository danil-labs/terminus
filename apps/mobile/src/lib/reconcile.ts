/**
 * Lo nuevo de una lectura sobre lo de antes: cada parte que no cambió conserva
 * el objeto anterior. Cada recarga trae objetos nuevos aunque digan lo mismo;
 * así React (y los `memo` de las tarjetas) ve el mismo objeto en las filas que
 * no cambiaron y solo repinta la que cambió o la que llega. Las filas de un
 * arreglo se emparejan por su id (`key`, `host/id`, `id` o `name`), no por su
 * lugar: una tarea nueva arriba no cambia las de abajo. Sin React: se prueba en
 * Node.
 */
import type { TaskCard } from "@terminus/tasks";

type Row = Record<string, unknown>;

const isRow = (v: unknown): v is Row => !!v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype;

/** El id de una fila para emparejarla con la de antes; `null` si no tiene. */
function rowKey(v: unknown): string | null {
  if (!isRow(v)) return null;
  if (typeof v.key === "string") return `k:${v.key}`;
  if (typeof v.host === "string" && typeof v.id === "string") return `h:${v.host}/${v.id}`;
  if (typeof v.id === "string") return `i:${v.id}`;
  if (typeof v.name === "string") return `n:${v.name}`;
  return null;
}

function sameArray(old: unknown[], next: unknown[]): unknown[] {
  const byKey = new Map<string, unknown>();
  for (const row of old) {
    const key = rowKey(row);
    if (key !== null) byKey.set(key, row);
  }
  let changed = old.length !== next.length;
  const out = next.map((row, i) => {
    const key = rowKey(row);
    const before = key !== null ? byKey.get(key) : old[i];
    const kept = before === undefined ? row : keepSame(before, row);
    if (kept !== old[i]) changed = true;
    return kept;
  });
  return changed ? out : old;
}

function sameRow(old: Row, next: Row): Row {
  const keys = Object.keys(next);
  let changed = keys.length !== Object.keys(old).length;
  const out: Row = {};
  for (const key of keys) {
    const kept = key in old ? keepSame(old[key], next[key]) : next[key];
    if (kept !== old[key] || !(key in old)) changed = true;
    out[key] = kept;
  }
  return changed ? out : old;
}

/** `next`, con los objetos de `old` donde dicen lo mismo; `old` entero si nada cambió. */
export function keepSame<T>(old: T, next: T): T {
  if (Object.is(old, next)) return old;
  if (Array.isArray(old) && Array.isArray(next)) return sameArray(old, next) as T;
  if (old instanceof Set && next instanceof Set) return (old.size === next.size && [...next].every((v) => old.has(v)) ? old : next) as T;
  if (isRow(old) && isRow(next)) return sameRow(old, next) as T;
  return next;
}

/** Mismas llaves con los mismos valores, sin bajar más. */
function shallowSame(a: Row, b: Row): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => key in b && Object.is(a[key], b[key]));
}

/**
 * Si dos tarjetas dicen lo mismo: `cardOf` arma una nueva en cada render aunque
 * la tarea no cambie, con `activity` y `machine` también nuevos.
 */
export function sameCard(a: TaskCard, b: TaskCard): boolean {
  if (a === b) return true;
  const x = a as unknown as Row;
  const y = b as unknown as Row;
  const keys = Object.keys(x);
  if (keys.length !== Object.keys(y).length) return false;
  return keys.every((key) => Object.is(x[key], y[key]) || (isRow(x[key]) && isRow(y[key]) && shallowSame(x[key] as Row, y[key] as Row)));
}
