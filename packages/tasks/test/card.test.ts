import assert from "node:assert/strict";
import { test } from "node:test";
import { taskCard } from "../src/index.ts";

const row = { id: "t1", title: "Tarea", esperando: false, folder: "p1", agent: "Ada", last_message: "¿Borro la rama?" };

test("si te necesita, la línea 2 es lo que pide", () => {
  const card = taskCard({ ...row, esperando: true }, { live: [], approving: [] });
  assert.equal(card.state, "asked");
  assert.equal(card.needsYou, true);
  assert.equal(card.request, "¿Borro la rama?");
});

test("si no, carpeta, agente y máquina; el chat del agente no repite su cara", () => {
  const card = taskCard({ ...row, machine: "Mac", machine_on: false }, { live: ["t1"], approving: [] });
  assert.equal(card.state, "working");
  assert.equal(card.request, null);
  assert.equal(card.folder, "p1");
  assert.equal(card.agent, "Ada");
  assert.deepEqual(card.machine, { id: "Mac", on: false });
  assert.equal(taskCard({ ...row, chat_de_agente: true }, { live: [], approving: [] }).agent, null);
  assert.equal(taskCard(row, { live: [], approving: [], hideFolder: true }).folder, null);
});

test("aprobar gana a todo y una entregada sin estado lleva su marca", () => {
  assert.equal(taskCard({ ...row, esperando: true }, { live: ["t1"], approving: ["t1"] }).state, "approving");
  const delivered = taskCard({ ...row, outcome: "delivered" as const }, { live: [], approving: [] });
  assert.equal(delivered.state, null);
  assert.equal(delivered.delivered, true);
  assert.equal(taskCard({ ...row, chat_de_agente: true }, { live: [], approving: [] }).pinned, true);
});
