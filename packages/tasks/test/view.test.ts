import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SIDEBAR_VIEW, agentOptions, applySidebarView, groupKey, groupLabel } from "../src/index.ts";

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

const byFolder = { ...DEFAULT_SIDEBAR_VIEW, group: "folder" as const };
const names = (id: string) => ({ terminus: "Terminus", radiant: "Radiant" })[id] ?? id;

test("una carpeta con tareas en una sola máquina es un grupo sin sufijo, aunque sea otra", () => {
  const tasks = [task("t1", null, { folder: "terminus", machine: "vm-1" }), task("t2", null, { folder: "terminus", machine: "vm-1" }), task("t3", null, { folder: "radiant" })];
  const grouped = applySidebarView(tasks, byFolder, ctx);
  assert.deepEqual(grouped.map((g) => [g.key, g.machine, g.tasks.map((t) => t.id)]), [["terminus", undefined, ["t1", "t2"]], ["radiant", undefined, ["t3"]]]);
  assert.equal(groupLabel("es", grouped[0], names, (id) => id), "Terminus");
  assert.equal(groupKey(grouped[0]), "folder:terminus");
});

test("una carpeta en dos máquinas son dos grupos rotulados, esta primero y las demás por su tarea más nueva", () => {
  const tasks = [
    task("t1", null, { folder: "terminus", machine: "vm-2" }),
    task("t2", null, { folder: "radiant" }),
    task("t3", null, { folder: "terminus", machine: "vm-1" }),
    task("t4", null, { folder: "terminus" }),
    task("t5", null, { folder: "terminus", machine: "vm-2", pinned: true }),
  ];
  const grouped = applySidebarView(tasks, byFolder, ctx);
  assert.deepEqual(grouped.map((g) => [g.key, g.machine, g.tasks.map((t) => t.id)]), [
    ["terminus", "", ["t4"]],
    ["terminus", "vm-2", ["t5", "t1"]],
    ["terminus", "vm-1", ["t3"]],
    ["radiant", undefined, ["t2"]],
  ]);
  const machine = (id: string) => ({ "vm-1": "vm-principal", "vm-2": "vm-pruebas" })[id] ?? id;
  assert.deepEqual(grouped.map((g) => groupLabel("es", g, names, machine)), ["Terminus · Esta máquina", "Terminus · vm-pruebas", "Terminus · vm-principal", "Radiant"]);
  assert.deepEqual(grouped.map(groupKey), ["folder:terminus@", "folder:terminus@vm-2", "folder:terminus@vm-1", "folder:radiant"]);
});

test("la máquina se puede leer de otro campo, y «sin carpeta» no se parte", () => {
  const tasks = [task("t1", null, { folder: "terminus", host: "a" }), task("t2", null, { folder: "terminus", host: "b" }), task("t3", null, { host: "a" }), task("t4", null, { host: "b" })];
  const grouped = applySidebarView(tasks, byFolder, { ...ctx, machineOf: (t) => (t as { host?: string }).host });
  assert.deepEqual(grouped.map((g) => [g.key, g.machine, g.tasks.map((t) => t.id)]), [["terminus", "a", ["t1"]], ["terminus", "b", ["t2"]], ["", undefined, ["t3", "t4"]]]);
});

test("la carpeta sin tareas sale una sola vez, sin máquina", () => {
  assert.deepEqual(applySidebarView([], byFolder, ctx), []);
  const empty = { kind: "folder" as const, key: "terminus", tasks: [] };
  assert.equal(groupLabel("es", empty, names, (id) => id), "Terminus");
  assert.equal(groupKey(empty), "folder:terminus");
});

test("el filtro por carpeta junta las tareas de todas sus máquinas", () => {
  const tasks = [task("t1", null, { folder: "terminus" }), task("t2", null, { folder: "terminus", machine: "vm-1" }), task("t3", null, { folder: "radiant", machine: "vm-1" })];
  const none = applySidebarView(tasks, { ...DEFAULT_SIDEBAR_VIEW, group: "none", folders: ["terminus"] }, ctx);
  assert.deepEqual(none.map((g) => g.tasks.map((t) => t.id)), [["t1", "t2"]]);
  const split = applySidebarView(tasks, { ...byFolder, folders: ["terminus"] }, ctx);
  assert.deepEqual(split.map((g) => [g.machine, g.tasks.map((t) => t.id)]), [["", ["t1"]], ["vm-1", ["t2"]]]);
});
