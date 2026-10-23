/**
 * Una tarea de otra máquina creada desde esta ventana va en el escritorio donde
 * nació, aunque esa máquina la guarde en su propio space; las demás tareas de
 * esa máquina siguen en el suyo.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import "../helpers/catalog.ts";

// Las preferencias de la ventana viven en `localStorage`; en Node, uno en memoria.
const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
});
const { enEscritorio, escritorioDeFila, rememberTaskSpace } = await import("../../src/lib/spaces.ts");

const space = (id: string) => ({ id, name: null, folders: [], created_at: 0, updated_at: 0 });

test("a task created here on another machine shows only in the space it was created from, and opens there", () => {
  rememberTaskSpace("cmp_vm~t1", "esc1");
  const row = { id: "cmp_vm~t1", space: "cmp_vm~jpycve7w", machine: "cmp_vm" };
  assert.equal(enEscritorio(row, "esc1"), true);
  assert.equal(enEscritorio(row, "esc2"), false, "not in every space");
  assert.equal(enEscritorio(row, "cmp_vm~jpycve7w"), false, "not in the other machine's space either");
  assert.equal(escritorioDeFila(row, [space("esc1"), space("cmp_vm~jpycve7w")]), "esc1", "opening it stays in the space it was created from");
});

test("a task of another machine not created here stays in that machine's space", () => {
  const row = { id: "cmp_vm~old", space: "cmp_vm~jpycve7w", machine: "cmp_vm" };
  assert.equal(enEscritorio(row, "esc1"), false);
  assert.equal(enEscritorio(row, "cmp_vm~jpycve7w"), true);
  assert.equal(escritorioDeFila({ space: "esc1" }, [space("esc1")]), "esc1", "a task of this computer opens in its space");
});
