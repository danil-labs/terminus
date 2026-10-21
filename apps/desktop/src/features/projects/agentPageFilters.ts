import type { SessionRow } from "./Sessions";

export type FiltroDeTareas = "all" | "running" | "waiting" | "done";

export function filtrarTareas(rows: SessionRow[], filtro: FiltroDeTareas, vivas: string[], aprobando: string[]): SessionRow[] {
  if (filtro === "running") return rows.filter(row => vivas.includes(row.id));
  if (filtro === "waiting") return rows.filter(row => row.esperando || aprobando.includes(row.id));
  if (filtro === "done") return rows.filter(row => row.stage === "done");
  return rows;
}

/** Las `n` raíces más nuevas con todas sus descendientes: cortar por fila dejaría hijas sin su padre. */
export function primerasRaices(rows: SessionRow[], n: number): { rows: SessionRow[]; quedan: boolean } {
  const ids = new Set(rows.map(row => row.id));
  const raices = rows.filter(row => !row.parent || !ids.has(row.parent))
    .sort((a, b) => b.created_at - a.created_at);
  const dentro = new Set(raices.slice(0, n).map(row => row.id));
  let crecio = true;
  while (crecio) {
    crecio = false;
    for (const row of rows) {
      if (!dentro.has(row.id) && row.parent && dentro.has(row.parent)) {
        dentro.add(row.id);
        crecio = true;
      }
    }
  }
  return { rows: rows.filter(row => dentro.has(row.id)), quedan: raices.length > n };
}
