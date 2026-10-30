import assert from "node:assert/strict";
import { test } from "node:test";
import { delegatedOf, flattenTasks, launcherOf } from "../src/index.ts";

const row = (id: string, created_at: number, extra: object = {}) => ({ id, created_at, ...extra });

test("una delegada no sale suelta: cuelga de su lanzador, como en el escritorio", () => {
  const rows = { p: [row("lanzador", 3), row("delegada", 2, { launched_by: "lanzador", launcher_available: true }), row("subagente", 1, { parent: "lanzador" })] };
  assert.deepEqual(flattenTasks(rows).map((t) => t.row.id), ["lanzador"]);
  assert.deepEqual(flattenTasks(rows, true).map((t) => t.row.id), ["lanzador", "delegada", "subagente"], "buscando sí sale");
});

// Al archivar o finalizar la madre, sus subtareas subían al riel: la regla miraba
// si el lanzador estaba en la lista, no si la tarea era una subtarea.
test("una subtarea no sube al riel aunque su lanzador no esté en la lista", () => {
  const archivado = { p: [row("lanzador", 3, { archived: true }), row("delegada", 2, { launched_by: "lanzador", launcher_available: true })] };
  assert.deepEqual(flattenTasks(archivado).map((t) => t.row.id), []);
  const ida = { p: [row("delegada", 2, { launched_by: "borrado" })] };
  assert.deepEqual(flattenTasks(ida).map((t) => t.row.id), []);
  const noDisponible = { p: [row("lanzador", 3), row("delegada", 2, { launched_by: "lanzador", launcher_available: false })] };
  assert.deepEqual(flattenTasks(noDisponible).map((t) => t.row.id), ["lanzador"]);
  const fijada = { p: [row("delegada", 2, { launched_by: "borrado", pinned: true })] };
  assert.deepEqual(flattenTasks(fijada).map((t) => t.row.id), ["delegada"], "fijada sí sale");
});

test("con prefijo de máquina (la web) la regla es la misma", () => {
  const rows = { p: [row("mac~l", 3), row("mac~d", 2, { launched_by: "mac~l" }), row("vm~d", 1, { launched_by: "vm~l" })] };
  assert.deepEqual(flattenTasks(rows).map((t) => t.row.id), ["mac~l"]);
});

test("las delegadas de un lanzador: vivas, directas y de la más nueva a la más vieja", () => {
  const rows = [
    row("l", 1),
    row("d1", 2, { launched_by: "l" }),
    row("d2", 4, { parent: "l" }),
    row("vieja", 3, { launched_by: "l", archived: true }),
    row("nieta", 5, { launched_by: "d1" }),
    row("otra", 6),
  ];
  assert.deepEqual(delegatedOf(rows, "l").map((r) => r.id), ["d2", "d1"]);
  assert.equal(launcherOf({ parent: "p", launched_by: "q" }), "p");
  assert.equal(launcherOf({}), null);
});
