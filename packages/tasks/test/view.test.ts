import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SIDEBAR_VIEW, agentOptions, applySidebarView, groupLabel } from "../src/index.ts";

const task = (id: string, agent: string | null, extra: object = {}) => ({ id, agent, esperando: false, ...extra });
const ctx = { live: [], approving: [] };

test("el filtro no ofrece un agente desinstalado sin tareas y avisa del que aún tiene", () => {
  const options = agentOptions(["the-bride"], [task("t1", "the-bride"), task("t2", "bill"), task("t3", "cm", { archived: true })]);
  assert.deepEqual(options, [
    { name: "the-bride", installed: true },
    { name: "bill", installed: false },
  ]);
});

test("el mismo agente con otra mayúscula sale una vez, como se llama el instalado", () => {
  const options = agentOptions(["cottonmouth"], [task("t1", "Cottonmouth"), task("t2", "cottonmouth"), task("t3", "Bill"), task("t4", "bill")]);
  assert.deepEqual(options, [
    { name: "cottonmouth", installed: true },
    { name: "Bill", installed: false },
  ]);
});

test("filtrar y agrupar por agente no distinguen mayúsculas", () => {
  const tasks = [task("t1", "Cottonmouth"), task("t2", "cottonmouth"), task("t3", "bill")];
  const filtered = applySidebarView(tasks, { ...DEFAULT_SIDEBAR_VIEW, agent: "cottonmouth" }, ctx);
  assert.deepEqual(filtered[0].tasks.map((t) => t.id), ["t1", "t2"]);
  const grouped = applySidebarView(tasks, { ...DEFAULT_SIDEBAR_VIEW, group: "agent" }, ctx);
  assert.deepEqual(grouped.map((g) => [g.key, g.tasks.length]), [["Cottonmouth", 2], ["bill", 1]]);
});

test("por máquina, la de la ventana primero y las demás por su tarea más nueva", () => {
  const tasks = [task("t1", null, { machine: "vm-2" }), task("t2", null), task("t3", null, { machine: "vm-1" }), task("t4", null, { machine: "vm-2" })];
  const grouped = applySidebarView(tasks, { ...DEFAULT_SIDEBAR_VIEW, group: "machine" }, ctx);
  assert.deepEqual(grouped.map((g) => [g.key, g.tasks.map((t) => t.id)]), [["", ["t2"]], ["vm-2", ["t1", "t4"]], ["vm-1", ["t3"]]]);
  assert.equal(groupLabel("es", grouped[0], (id) => id), "Esta máquina");
  assert.equal(groupLabel("es", grouped[1], (id) => id, (id) => id.toUpperCase()), "VM-2");
});
