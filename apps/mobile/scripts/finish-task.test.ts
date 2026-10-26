import assert from "node:assert/strict";
import { test } from "node:test";
import { archiveTask, deleteTask, finishTask } from "../src/lib/engine.ts";
import { type Host, HostError } from "../src/lib/hosts.ts";

function machine({ power = "on", blockers = { unsaved: [], not_finished: false }, cachedAt = null, reject = false }: { power?: string; blockers?: unknown; cachedAt?: number | null; reject?: boolean } = {}) {
  const calls: { command: string; workspace: string | null; args?: object }[] = [];
  const host = { label: "VM", power: () => power, call: async (command: string, workspace: string | null, args?: object) => {
    calls.push({ command, workspace, args });
    if (reject) throw new Error("unreachable");
    return { value: command === "task_blockers" ? blockers : null, cachedAt };
  } } as unknown as Host;
  return { host, calls };
}

test("finalizar comprueba bloqueos y actúa sobre la tarea de la misma máquina y workspace", async () => {
  const { host, calls } = machine();
  assert.deepEqual(await finishTask(host, "workspace", "folder", "task"), { finished: true });
  assert.deepEqual(calls, [
    { command: "task_blockers", workspace: "workspace", args: { project: "folder", id: "task", finish: true } },
    { command: "finish_task", workspace: "workspace", args: { project: "folder", id: "task" } },
  ]);
});

test("cambios sin guardar o trabajo sin integrar impiden finalizar", async () => {
  for (const blockers of [{ unsaved: [{ session: "t", title: "T", files: ["a"] }] }, { unsaved: [], not_finished: true }]) {
    const { host, calls } = machine({ blockers });
    assert.deepEqual(await finishTask(host, "w", "p", "t"), { blocked: blockers });
    assert.equal(calls.some((call) => call.command === "finish_task"), false);
  }
});

test("una máquina apagada, una respuesta vieja o un fallo no permite eliminar trabajo", async () => {
  const asleep = machine({ power: "off" });
  await assert.rejects(finishTask(asleep.host, "w", "p", "t"), (error) => error instanceof HostError && error.code === "machine_asleep");
  assert.deepEqual(asleep.calls, []);
  for (const options of [{ cachedAt: 100 }, { reject: true }, { blockers: null }]) {
    const { host, calls } = machine(options);
    await assert.rejects(finishTask(host, "w", "p", "t"));
    assert.equal(calls.some((call) => call.command === "finish_task"), false);
  }
});

test("eliminar se limita a la máquina elegida, sin forzar y sin encenderla", async () => {
  const { host, calls } = machine();
  await deleteTask(host, "w", "p", "t");
  assert.deepEqual(calls, [{ command: "delete_session", workspace: "w", args: { project: "p", id: "t", force: false } }]);
  const asleep = machine({ power: "off" });
  await assert.rejects(deleteTask(asleep.host, "w", "p", "t"));
  assert.deepEqual(asleep.calls, []);
  const failed = machine({ reject: true });
  await assert.rejects(deleteTask(failed.host, "w", "p", "t"));
});

test("archivar no toma una copia vieja o una respuesta vacía como permiso", async () => {
  for (const options of [{ cachedAt: 100 }, { blockers: null }]) {
    const { host, calls } = machine(options);
    await assert.rejects(archiveTask(host, "w", "p", "t"), (error) => error instanceof HostError && error.code === "task_status_unavailable");
    assert.equal(calls.some((call) => call.command === "set_task_archived"), false);
  }
});
