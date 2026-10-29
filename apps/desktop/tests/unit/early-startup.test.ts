import assert from "node:assert/strict";
import test from "node:test";

import { listaBasta, reconciliar } from "../../src/features/settings/early-startup.ts";

/**
 * **La ventana no espera a `workspaces_startup`.** El arranque migra dentro y
 * ha tardado minutos; la lista ligera abre la ventana y el arranque la
 * confirma. Lo que no se adelanta es el alta ni la negativa (`bloqueo`).
 */

const ws = (...ids: string[]) => ids.map((id) => ({ id }));

test("una lista con activo abre la ventana", () => {
  assert.equal(listaBasta({ workspaces: ws("a", "b"), active: "a" }), true);
});

test("sin activo no se adelanta: abriría el alta antes de saber si hay negativa", () => {
  assert.equal(listaBasta({ workspaces: [], active: null }), false);
  assert.equal(listaBasta({ workspaces: ws("a"), active: null }), false);
});

test("un activo que no está en la lista no se adelanta", () => {
  assert.equal(listaBasta({ workspaces: ws("b"), active: "a" }), false);
});

test("una lista que ya trae negativa no abre nada", () => {
  assert.equal(listaBasta({ workspaces: ws("a"), active: "a", bloqueo: { clave: "x" } }), false);
});

test("sin lista aplicada, el arranque se aplica", () => {
  assert.equal(reconciliar(null, { workspaces: ws("a"), active: "a" }), "aplicar");
});

test("el arranque que dice lo mismo no reaplica: no cierra la tarea abierta", () => {
  const lista = { workspaces: ws("a", "b"), active: "a", migrations: [1, 2] };
  const arranque = { workspaces: ws("b", "a"), active: "a", migrations: [1, 2] };
  assert.equal(reconciliar(lista, arranque), "nada");
});

test("otro activo, otros workspaces o una migración nueva reaplican", () => {
  const lista = { workspaces: ws("a"), active: "a", migrations: [1] };
  assert.equal(reconciliar(lista, { ...lista, active: "b", workspaces: ws("a", "b") }), "aplicar");
  assert.equal(reconciliar(lista, { ...lista, workspaces: ws("a", "c") }), "aplicar");
  assert.equal(reconciliar(lista, { ...lista, migrations: [1, 2] }), "aplicar");
});
