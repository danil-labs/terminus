/**
 * Una recarga de la lista del teléfono (`src/lib/reconcile.ts` sobre lo que
 * arma `mergeSnapshots`): cada lectura trae objetos nuevos, pero las tareas que
 * no cambiaron conservan su objeto, la nueva se agrega y la que cambió es la
 * única nueva. Sin cambios, el mismo objeto entero (React no repinta nada).
 *
 *   node --test apps/mobile/scripts/reconcile.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { type HostSnapshot, type Task, mergeSnapshots } from "../src/lib/engine.ts";
import { keepSame, sameCard } from "../src/lib/reconcile.ts";

const row = (host: string, id: string, extra: Partial<Task> = {}): Task =>
  ({ id, host, workspace: "w1", folder: "p1", folderKey: `${host}/p1`, title: `Tarea ${id}`, created_at: Number(id.replace(/\D/g, "")), pinned: false, ...extra }) as Task;

/** Lo que contesta cada máquina, siempre con objetos nuevos, como una lectura de verdad. */
const part = (host: string, tasks: Task[], live: string[] = []): HostSnapshot => ({
  host,
  folders: [{ id: "p1", name: "Aplicación", key: `${host}/p1`, host } as HostSnapshot["folders"][number]],
  spaces: [{ id: "s1", name: null, folders: ["p1"] } as HostSnapshot["spaces"][number]],
  tasks: tasks.map((t) => ({ ...t })),
  delegated: [],
  agents: [{ name: "ana", description: null, status: "asleep", liveTasks: 0, minutesSinceLastTurn: null, places: [{ host, folder: "p1" }] }],
  live,
  providers: [],
  cachedAt: null,
});
const tag = () => null;
const read = (vm: Task[], mac: Task[], live: string[] = []) => mergeSnapshots([part("vm", vm, live), part("mac", mac)], tag);

test("sin cambios, la recarga devuelve el mismo objeto", () => {
  const before = read([row("vm", "t1"), row("vm", "t2")], [row("mac", "t3")]);
  const after = keepSame(before, read([row("vm", "t1"), row("vm", "t2")], [row("mac", "t3")]));
  assert.equal(after, before);
});

test("una tarea nueva se agrega y las demás conservan su objeto", () => {
  const before = read([row("vm", "t1"), row("vm", "t2")], [row("mac", "t3")]);
  const after = keepSame(before, read([row("vm", "t1"), row("vm", "t2"), row("vm", "t9")], [row("mac", "t3")]));
  assert.notEqual(after, before);
  assert.notEqual(after.tasks, before.tasks);
  // La nueva va arriba (la más reciente); las de abajo no se movieron de objeto aunque cambiaron de lugar.
  assert.deepEqual(after.tasks.map((t) => t.id), ["t9", "t3", "t2", "t1"]);
  for (const task of before.tasks) assert.equal(after.tasks.find((t) => t.host === task.host && t.id === task.id), task, task.id);
  assert.equal(after.folders, before.folders);
  assert.equal(after.spaces, before.spaces);
  assert.equal(after.agents, before.agents);
  assert.equal(after.live, before.live);
});

test("una tarea que cambia es la única nueva", () => {
  const before = read([row("vm", "t1"), row("vm", "t2")], [row("mac", "t3")]);
  const after = keepSame(before, read([row("vm", "t1"), row("vm", "t2", { title: "Otro título" })], [row("mac", "t3")], ["t2"]));
  const t2 = after.tasks.find((t) => t.id === "t2")!;
  assert.equal(t2.title, "Otro título");
  assert.notEqual(t2, before.tasks.find((t) => t.id === "t2"));
  assert.equal(after.tasks.find((t) => t.id === "t1"), before.tasks.find((t) => t.id === "t1"));
  assert.equal(after.tasks.find((t) => t.id === "t3"), before.tasks.find((t) => t.id === "t3"));
  assert.deepEqual([...after.live], ["vm/t2"]);
});

test("el mismo id en dos máquinas no se confunde", () => {
  const before = read([row("vm", "t1")], [row("mac", "t1")]);
  const after = keepSame(before, read([row("vm", "t1", { title: "Cambió en la VM" })], [row("mac", "t1")]));
  assert.equal(after.tasks.find((t) => t.host === "mac"), before.tasks.find((t) => t.host === "mac"));
  assert.equal(after.tasks.find((t) => t.host === "vm")?.title, "Cambió en la VM");
});

test("una tarea que se va sale de la lista", () => {
  const before = read([row("vm", "t1"), row("vm", "t2")], []);
  const after = keepSame(before, read([row("vm", "t2")], []));
  assert.deepEqual(after.tasks.map((t) => t.id), ["t2"]);
  assert.equal(after.tasks[0], before.tasks.find((t) => t.id === "t2"));
});

test("dos tarjetas que dicen lo mismo son iguales aunque sean objetos distintos", () => {
  const card = { activity: { aprobando: false, esperando: false, viva: false, outcome: null }, state: null, delivered: false, pinned: false, needsYou: false, provider: "claude", folder: "vm/p1", agent: null, machine: { id: "VM", on: true } } as const;
  assert.ok(sameCard({ ...card, machine: { ...card.machine } } as never, { ...card, machine: { ...card.machine } } as never));
  assert.ok(!sameCard(card as never, { ...card, state: "working" } as never));
  assert.ok(!sameCard(card as never, { ...card, machine: { id: "VM", on: false } } as never));
  assert.ok(!sameCard(card as never, { ...card, activity: { ...card.activity, viva: true } } as never));
});
