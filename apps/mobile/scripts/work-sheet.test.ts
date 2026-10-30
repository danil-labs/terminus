/**
 * El almacén de la hoja (`src/lib/workSheet.ts`): la misma tarea puede estar dos veces en la pila.
 *
 *   node --test apps/mobile/scripts/work-sheet.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { type WorkSheetState, publishWork, releaseWork, workState } from "../src/lib/workSheet.ts";

const state = (note: string): WorkSheetState => ({ runs: [], since: null, permissions: [], deciding: new Set(), asleep: null, waking: null, note, questions: 0, decide: () => {} });

test("el dueño que se va solo borra lo suyo", () => {
  const a = {};
  const b = {};
  publishWork("t", a, state("a"));
  publishWork("t", b, state("b"));
  assert.equal(workState("t")?.note, "b");
  releaseWork("t", b);
  assert.equal(workState("t")?.note, "a", "la pantalla de abajo sigue siendo dueña");
  releaseWork("t", b);
  assert.equal(workState("t")?.note, "a", "soltar dos veces no borra a otro");
  releaseWork("t", a);
  assert.equal(workState("t"), null);
});

test("el estado publicado es estable entre lecturas", () => {
  const owner = {};
  const published = state("x");
  publishWork("u", owner, published);
  assert.equal(workState("u"), published);
  assert.equal(workState("u"), workState("u"));
  releaseWork("u", owner);
});
