/**
 * La lista de workspaces del teléfono (`src/lib/engine.ts`): un workspace es de
 * la cuenta, no de una máquina. Con la VM dormida (sin copia en el relay) y la
 * única máquina encendida sin workspaces, la lista trae los de la cuenta y sus
 * carpetas, en la VM; sin registro, lo de antes.
 *
 *   node --test apps/mobile/scripts/workspaces.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { AccountWorkspace } from "@terminus/computers";
import { delegatedOf } from "@terminus/tasks";
import { type Folder, mergeSnapshots, taskInSpace, tasksOf, withAccountFolders, workspaceEntries } from "../src/lib/engine.ts";

const REGISTRY: AccountWorkspace[] = [
  {
    id: "w1",
    name: "Producto",
    projects: [
      { id: "p1", name: "Aplicación", remote_url: "https://github.com/ana/app", home_computer_id: "cmp_vm" },
      { id: "p2", name: "Notas", remote_url: null, home_computer_id: "cmp_otra" },
    ],
    computers: ["cmp_vm"],
  },
];
const HOSTS = [{ id: "cmp_vm" }, { id: "cmp_mac" }];

test("con la VM dormida y la Mac sin workspaces, la lista trae los de la cuenta", () => {
  // La VM no contestó (`null`); la Mac contestó sin ninguno.
  const perHost = { cmp_vm: null, cmp_mac: [] };
  assert.deepEqual(workspaceEntries(HOSTS, perHost, null), [], "sin registro, la lista vacía de hoy");
  const list = workspaceEntries(HOSTS, perHost, REGISTRY);
  assert.deepEqual(
    list.map((w) => [w.id, w.name, w.hosts]),
    [["w1", "Producto", ["cmp_vm"]]],
  );
});

test("la fila de una máquina que contesta manda, y la que contestó sin el workspace no es miembro", () => {
  const list = workspaceEntries(HOSTS, { cmp_vm: null, cmp_mac: [{ id: "w1", name: "Producto en la Mac" }] }, REGISTRY);
  assert.deepEqual(list.map((w) => [w.name, w.hosts]), [["Producto en la Mac", ["cmp_vm", "cmp_mac"]]]);
  const awake = workspaceEntries(HOSTS, { cmp_vm: [], cmp_mac: [] }, REGISTRY);
  assert.deepEqual(awake.map((w) => w.hosts), [[]], "la VM despierta dice que ya no lo tiene");
});

test("las carpetas del registro se ven en la máquina donde nacieron, o en la primera del workspace", () => {
  const empty = { folders: [] as Folder[], spaces: [{ id: "s", name: null, folders: [] as string[] }], tasks: [] };
  const filled = withAccountFolders(empty, REGISTRY, "w1", ["cmp_vm"]);
  assert.deepEqual(filled.folders.map((f) => [f.key, f.name]), [["cmp_vm/p1", "Aplicación"], ["cmp_vm/p2", "Notas"]]);
  assert.deepEqual(filled.spaces[0].folders, ["cmp_vm/p1", "cmp_vm/p2"], "y en el space que se ve");
  const live = { ...empty, folders: [{ id: "p1", name: "Aplicación", key: "cmp_mac/p1", host: "cmp_mac" }] };
  assert.deepEqual(withAccountFolders(live, REGISTRY, "w1", ["cmp_vm", "cmp_mac"]).folders.map((f) => f.key), ["cmp_mac/p1", "cmp_vm/p2"], "lo que una máquina lista manda");
  assert.equal(withAccountFolders(empty, REGISTRY, "w1", []), empty, "sin máquinas del workspace, nada");
  assert.equal(withAccountFolders(empty, null, "w1", ["cmp_vm"]), empty, "sin registro, nada");
});

test("los spaces son de todas las máquinas: uno por id o por nombre, y cada tarea va en el de su fila", () => {
  const part = (host: string, spaces: { id: string; name: string | null; folders: string[] }[], tasks: { id: string; space: string | null }[]) => ({
    host,
    folders: [],
    spaces,
    tasks: tasks.map((t) => ({ ...t, title: t.id, provider: "codex", model: null, created_at: 0, updated_at: 0, esperando: false, agent: null, host, workspace: "w1", folder: "p1", folderKey: `${host}/p1` })),
    delegated: [],
    agents: [],
    live: [],
    providers: [],
    cachedAt: null,
  });
  // La VM (primera) dormida no tiene spaces; la Mac sí.
  const vm = part("cmp_vm", [], [{ id: "t-vm", space: null }]);
  const mac = part("cmp_mac", [{ id: "s-gen", name: null, folders: ["p1"] }, { id: "s-web", name: "Web", folders: [] }], [{ id: "t-gen", space: "s-gen" }, { id: "t-web", space: "s-web" }]);
  const merged = mergeSnapshots([vm, mac], () => null);
  assert.deepEqual(merged.spaces.map((s) => [s.id, s.on]), [["s-gen", { cmp_mac: "s-gen" }], ["s-web", { cmp_mac: "s-web" }]]);
  assert.deepEqual(merged.spaces[0].folders, ["cmp_vm/p1", "cmp_mac/p1"], "la carpeta tiene el mismo id en cada máquina");
  const web = merged.spaces[1];
  assert.deepEqual(merged.tasks.filter((t) => taskInSpace(t, web)).map((t) => t.id), ["t-vm", "t-web"], "una sin space resuelto va en todos");
  // Con las dos despiertas, el space por defecto de cada una es uno.
  const both = mergeSnapshots([part("cmp_vm", [{ id: "s-vm", name: null, folders: [] }], [{ id: "t-vm", space: "s-vm" }]), mac], () => null);
  assert.deepEqual(both.spaces.map((s) => s.on), [{ cmp_vm: "s-vm", cmp_mac: "s-gen" }, { cmp_mac: "s-web" }]);
  assert.ok(taskInSpace(both.tasks.find((t) => t.id === "t-vm")!, both.spaces[0]));
  assert.ok(!taskInSpace(both.tasks.find((t) => t.id === "t-vm")!, both.spaces[1]));
});

test("la lista del teléfono esconde las delegadas bajo su lanzador, como el escritorio, y las guarda para su chat", () => {
  const row = (id: string, created_at: number, extra: object = {}) => ({ id, title: id, provider: "codex", model: null, created_at, updated_at: 0, esperando: false, agent: null, ...extra });
  const { tasks, delegated } = tasksOf({
    p1: [row("lanzador", 3), row("delegada", 2, { launched_by: "lanzador", launcher_available: true }), row("huerfana", 1, { launched_by: "borrado", launcher_available: false })],
    "": [row("vieja", 0, { launched_by: "lanzador", archived: true })],
  }, "cmp_mac", "w1");
  assert.deepEqual(tasks.map((t) => t.id), ["lanzador", "huerfana"], "la de un lanzador que ya no existe sale suelta");
  assert.deepEqual(delegated.map((t) => [t.id, t.folderKey]), [["delegada", "cmp_mac/p1"]], "la archivada no");
  const merged = mergeSnapshots([{ host: "cmp_mac", folders: [], spaces: [], tasks, delegated, agents: [], live: [], providers: [], cachedAt: null }], () => ({ machine: "Mac", on: false }));
  assert.deepEqual(merged.delegated.map((t) => [t.id, t.machine, t.machine_on]), [["delegada", "Mac", false]], "con la máquina apagada siguen en el chat de su lanzador");
  assert.deepEqual(delegatedOf(merged.delegated, "lanzador").map((t) => t.id), ["delegada"]);
});
