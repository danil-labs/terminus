import assert from "node:assert/strict";
import { test } from "node:test";
import { type AccountWorkspace, type Fetch, groupWorkspaces, hasAccountWorkspaces, listWorkspaces, registryProjects, withRegistry } from "../src/index.ts";

const answer = (status: number, body: unknown = null): Fetch => async () => ({ status, ok: status >= 200 && status < 300, json: async () => body });

const ROW = {
  id: "w1",
  name: "Producto",
  radiant_workspace_id: null,
  settings: { lengua: "es", lengua_de_salida: null, default_permission_mode: null, terminal_theme: null },
  settings_version: 3,
  created_at: "2026-10-20T10:00:00Z",
  updated_at: "2026-10-20T10:00:00Z",
  projects: [{ id: "p1", name: "app", remote_url: "https://github.com/org/app", default_branch: "main", home_computer_id: "vm" }],
  computers: ["vm"],
};

test("GET /v1/workspaces con el token de la persona y la forma del contrato", async () => {
  let seen: { url: string; headers?: Record<string, string> } | undefined;
  const ok = await listWorkspaces("https://computers.example", "tok", async (url, init) => {
    seen = { url, headers: init?.headers };
    return { status: 200, ok: true, json: async () => ({ workspaces: [ROW, { name: "sin id" }, { id: "w2", name: "", projects: [{ bad: 1 }], computers: [1, "mac"] }] }) };
  });
  assert.equal(seen?.url, "https://computers.example/v1/workspaces");
  assert.equal(seen?.headers?.authorization, "Bearer tok");
  assert.equal(ok.kind, "ok");
  const list = ok.kind === "ok" ? ok.value : [];
  assert.deepEqual(list.map((w) => [w.id, w.name, w.projects.map((p) => p.id), w.computers]), [["w1", "Producto", ["p1"], ["vm"]], ["w2", "w2", [], ["mac"]]]);
  assert.equal(list[0].settings?.lengua, "es");
});

test("un plano de control sin registro, o una respuesta sin forma, no es una lista vacía", async () => {
  assert.equal((await listWorkspaces("x.example", "t", answer(404))).kind, "missing");
  assert.equal((await listWorkspaces("x.example", "t", answer(401))).kind, "unauthorized");
  assert.equal((await listWorkspaces("x.example", "t", answer(500))).kind, "error");
  assert.equal((await listWorkspaces("x.example", "t", answer(200, [{ id: "w1" }]))).kind, "error");
  assert.equal((await listWorkspaces("x.example", "t", async () => Promise.reject(new Error("red")))).kind, "error");
  const empty = await listWorkspaces("x.example", "t", answer(200, { workspaces: [] }));
  assert.deepEqual(empty, { kind: "ok", value: [] });
});

test("el registro suma los workspaces de máquinas dormidas; la fila de una máquina que contestó manda", () => {
  const registry: AccountWorkspace[] = [
    { ...ROW, name: "Producto (cuenta)", computers: ["vm", "mac"] },
    { id: "w3", name: "Notas", projects: [], computers: ["vm2"] },
  ];
  const live = groupWorkspaces([{ machine: "mac", rows: [{ id: "w1", name: "Producto en la Mac" }] }]);
  const rowOf = (w: AccountWorkspace) => ({ id: w.id, name: w.name });
  const groups = withRegistry(live, registry, ["vm", "vm2", "mac"], new Set(["mac"]), rowOf);
  assert.deepEqual(
    groups.map((g) => [g.key, g.row.name, [...g.members.keys()]]),
    [["w1", "Producto en la Mac", ["vm", "mac"]], ["w3", "Notas", ["vm2"]]],
  );
  // Una máquina que contestó sin el workspace no lo tiene, diga lo que diga el registro.
  const without = withRegistry([], registry, ["vm", "mac"], new Set(["mac"]), rowOf);
  assert.deepEqual([...without[0].members.keys()], ["vm"]);
  assert.deepEqual(withRegistry(live, null, ["mac"], new Set(["mac"]), rowOf), live, "sin registro, lo de hoy");
});

test("los proyectos del registro que ninguna máquina listó, y si la cuenta tiene workspaces", () => {
  assert.deepEqual(registryProjects([ROW], "w1", new Set()).map((p) => p.id), ["p1"]);
  assert.deepEqual(registryProjects([ROW], "w1", new Set(["p1"])), []);
  assert.deepEqual(registryProjects(null, "w1", new Set()), []);
  assert.equal(hasAccountWorkspaces([ROW]), true);
  assert.equal(hasAccountWorkspaces([]), false);
  assert.equal(hasAccountWorkspaces(null), false);
});
