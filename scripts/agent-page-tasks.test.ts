import assert from "node:assert/strict";
import { test } from "node:test";
import { filtrarTareas, primerasRaices } from "../src/features/projects/agentPageFilters.ts";
import type { SessionRow } from "../src/features/projects/Sessions.tsx";

const fila = (id: string, created_at: number, parent: string | null = null, extra: Partial<SessionRow> = {}) =>
  ({ id, created_at, parent, esperando: false, stage: null, ...extra }) as SessionRow;

test("la página corta por tareas raíz y una subtarea vieja sigue con su padre nuevo", () => {
  const rows = [
    fila("vieja", 10),
    fila("nieta", 1, "hija"),
    fila("nueva", 30),
    fila("hija", 2, "nueva"),
    fila("media", 20),
  ];
  const { rows: vistas, quedan } = primerasRaices(rows, 1);
  assert.deepEqual(vistas.map(row => row.id).sort(), ["hija", "nieta", "nueva"]);
  assert.equal(quedan, true);
});

test("sin más raíces que la página no ofrece ver más", () => {
  const rows = [fila("a", 2), fila("b", 1), fila("hija", 0, "a")];
  assert.equal(primerasRaices(rows, 2).quedan, false);
});

test("una hija filtrada sin su padre cuenta como raíz y no se pierde", () => {
  const rows = [fila("hija", 5, "padre-fuera-del-filtro")];
  assert.deepEqual(primerasRaices(rows, 1).rows.map(row => row.id), ["hija"]);
});

test("esperan incluye la que espera una aprobación aunque no haya preguntado", () => {
  const rows = [fila("pregunta", 1, null, { esperando: true }), fila("aprobar", 2), fila("nada", 3)];
  assert.deepEqual(filtrarTareas(rows, "waiting", [], ["aprobar"]).map(row => row.id), ["pregunta", "aprobar"]);
});
