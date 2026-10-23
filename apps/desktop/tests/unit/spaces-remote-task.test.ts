/**
 * Una tarea de otra máquina de la cuenta trae un space de esa máquina, que en
 * esta ventana no existe: no se esconde de los escritorios de aquí.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import "../helpers/catalog.ts";
import { carpetasDelEscritorio, enEscritorio } from "../../src/lib/spaces.ts";

test("a task of another machine shows in this window's space although its space is the other machine's", () => {
  assert.equal(enEscritorio({ space: "cmp_vm~jpycve7w", machine: "cmp_vm" }, "esc1"), true);
  assert.equal(enEscritorio({ space: "esc2" }, "esc1"), false, "a task of this computer in another space stays hidden");
  assert.equal(enEscritorio({ space: "esc1" }, "esc1"), true);
  const desk = { id: "esc1", name: null, folders: [], created_at: 0, updated_at: 0 };
  const folders = carpetasDelEscritorio([{ id: "p1" }], desk, { p1: [{ space: "cmp_vm~s", machine: "cmp_vm" }] });
  assert.deepEqual(folders.map((p) => p.id), ["p1"], "its folder is listed too");
});
