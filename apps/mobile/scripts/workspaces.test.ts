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
import { type Folder, withAccountFolders, workspaceEntries } from "../src/lib/engine.ts";

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
