import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SIDEBAR_VIEW, agentOptions, applySidebarView } from "../src/index.ts";

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
