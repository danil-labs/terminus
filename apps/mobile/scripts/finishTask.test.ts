import assert from "node:assert/strict";
import { test } from "node:test";
import { isAppCommand } from "@terminus/protocol";
import { finishTask } from "../src/lib/engine.ts";
import type { Host } from "../src/lib/hosts.ts";

function fixture(blockers: unknown) {
  const calls: { command: string; workspace: string | null; args?: object }[] = [];
  const host: Host = {
    id: "vm", label: "VM", kind: "computer", managed: true, linked: new Set(["workspace"]),
    power: () => "on", canAct: () => "now", onChange: () => () => {}, onEvents: () => () => {},
    close: () => {}, wake: async () => {},
    async call<T>(command, workspace, args) {
      calls.push({ command, workspace, args });
      return { value: (command === "task_blockers" ? blockers : null) as T, cachedAt: null };
    },
  };
  return { host, calls };
}

test("Finalizar usa el workspace y la validación del motor antes de cerrar", async () => {
  const { host, calls } = fixture({ unsaved: [], not_finished: false });
  assert.equal(isAppCommand("finish_task"), true);
  assert.deepEqual(await finishTask(host, "workspace", "folder", "task"), { finished: true });
  assert.deepEqual(calls, [
    { command: "task_blockers", workspace: "workspace", args: { project: "folder", id: "task", finish: true } },
    { command: "finish_task", workspace: "workspace", args: { project: "folder", id: "task" } },
  ]);
});

test("un PR sin confirmar, archivos sin guardar o una respuesta inválida no permiten cerrar", async () => {
  for (const blockers of [
    { unsaved: [], not_finished: true },
    { unsaved: [{ session: "task", title: "Draft", files: ["draft.md"] }], not_finished: false },
  ]) {
    const { host, calls } = fixture(blockers);
    assert.deepEqual(await finishTask(host, "workspace", "folder", "task"), { blocked: blockers });
    assert.equal(calls.some(c => c.command === "finish_task"), false);
  }
  const { host, calls } = fixture(null);
  await assert.rejects(finishTask(host, "workspace", "folder", "task"));
  assert.equal(calls.some(c => c.command === "finish_task"), false);
});
