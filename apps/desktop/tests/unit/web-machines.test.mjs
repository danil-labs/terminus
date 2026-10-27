/**
 * One panel over every computer of the person: the browser build opens a relay
 * session per computer, joins their workspaces and projects by id (the same on
 * every machine) and their tasks (each with its machine and an id that cannot
 * collide), sends each command to the machine it names, creates where the
 * person chose (making the workspace that machine's own first), fails short and
 * neutral on a computer that is off and cannot be woken, leaves out one that
 * speaks another contract, and groups AI accounts by provider and email.
 * Mounts `dist-web/`.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { engine, fleet } from "../helpers/fake-relay.mjs";
import { boot, sleep } from "../helpers/jsdom-app.mjs";

const SAME = { id: "w", name: "W", context_root: null, provider: "github", remote: "danil/panel" };
const row = (id, title) => ({ id, title, last_message: "", provider: "codex", model: "gpt-5.6", refs: [], updated_at: 0, turns: 0, parent: null, esperando: false });
const account = (id, identity, label = "Cuenta 1") => ({ id, label, created_at: 0, identity, authenticated_at: 1 });
const folder = (id, name, extra = {}) => ({ id, name, working_directory: `/lab/${id}`, kind: "git", portfolio: null, sources: [], ...extra });

/** The same workspace on both machines, each with its own project; task ids collide and only the namespace keeps them apart. */
function table(project, task, extra = {}, id = "p1") {
  return {
    ...engine,
    list_workspaces: { workspaces: [SAME], active: "w" },
    workspaces_startup: { workspaces: [SAME], active: "w" },
    list_projects: [folder(id, project)],
    list_live_sessions: ({ project: p }) => (p === id ? [row("t1", task)] : []),
    send_message: () => "t1",
    create_project: ({ name }) => ({ id: "p9", name, working_directory: "/lab/p9", kind: "folder", sources: [] }),
    remove_account: true,
    ...extra,
  };
}

async function until(check, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await sleep(100);
  }
  return false;
}

const VM = { computer_id: "cmp_vm", name: "Danil VM", state: "online", provider: "aws-ec2" };
const MAC = { computer_id: "cmp_mac", name: "Mac de Ana", state: "online", provider: "self", kind: "physical" };

test("storage keeps its machine and workspace and never waits for an offline VM", async () => {
  const storage = (bytes) => ({ bytes, tareas: [], compartido: [], sueltos: [], recuperable: 0, medido_en: 1, aviso: null });
  const resources = { measured_at: 1, storage: [{ id: "volume", total_bytes: 1000, free_bytes: 400, available_bytes: 300, terminus_bytes: null, attribution: "unknown" }] };
  const { app, invoke, calls, f } = await open("web-storage-target", [VM, MAC], {
    cmp_vm: { state: "offline", table: table("Panel", "Tarea VM", { list_storage: storage(111) }) },
    cmp_mac: { table: table("Notas", "Tarea Mac", {
      list_storage: storage(222), reclaim_storage: { bytes: 1, cuantos: 1, detalle: "" },
      empty_build_cache: { bytes: 2, cuantos: 1, detalle: "" }, collect_orphans: { bytes: 3, cuantos: 1, detalle: "" },
      list_workspaces: (_args, call) => ({ workspaces: [SAME], active: "w", ...(call.workspace === null ? { machine_resources: resources } : {}) }),
    }) },
  });
  const target = { headers: { "x-terminus-machine": "cmp_mac", "x-terminus-workspace": "w" } };
  assert.equal((await invoke("list_storage", { refrescar: true }, target)).bytes, 222);
  f.relays.cmp_vm.setState("online");
  await invoke("set_active_workspace", { id: "another" });
  f.relays.cmp_vm.setState("offline");
  assert.equal((await invoke("list_storage", { refrescar: false }, target)).bytes, 222);
  assert.equal(calls("cmp_mac", "list_storage").at(-1).workspace, "w", "a captured workspace survives a later selection");
  for (const command of ["reclaim_storage", "empty_build_cache", "collect_orphans"]) {
    await invoke(command, command === "reclaim_storage" ? { session: "cmp_mac~t1", project: "p1", rutas: [] } : {}, target);
    assert.equal(calls("cmp_mac", command).at(-1).workspace, "w");
    assert.equal(calls("cmp_vm", command).length, 0);
  }
  assert.deepEqual((await invoke("list_workspaces", {}, target)).machine_resources, resources);
  assert.equal(calls("cmp_mac", "list_workspaces").at(-1).workspace, null);
  const joined = await invoke("list_workspaces");
  assert.equal(joined.machine_resources, undefined, "a merged startup never labels one machine as all machines");
  assert.deepEqual(joined.machine_resources_by_machine.cmp_mac, resources);
  await sleep(1100);
  const cached = JSON.parse(app.w.localStorage.getItem("terminus-web:reads:v2:cmp_mac") ?? "{}");
  assert.ok(Object.keys(cached).some((key) => JSON.parse(key)[0] === "list_workspaces"), "the listing itself is persisted");
  for (const entry of Object.values(cached)) assert.equal(JSON.parse(entry.value)?.machine_resources, undefined, "machine resources stay in memory");
  await assert.rejects(invoke("list_storage", { refrescar: true }, { headers: { "x-terminus-machine": "cmp_vm", "x-terminus-workspace": "w" } }), (e) => e.detail === "machine_off");
  assert.equal(calls("cmp_vm", "list_storage").length, 0, "an offline machine is not asked to measure");
  await assert.rejects(invoke("collect_orphans", {}, { headers: { "x-terminus-machine": "missing" } }), (e) => e.detail === "invalid_request");
  await assert.rejects(invoke("reclaim_storage", { session: "cmp_vm~t1", project: "p1", rutas: [] }, target), (e) => e.detail === "cross_machine");
  f.relays.cmp_mac.setState("offline");
  await assert.rejects(invoke("collect_orphans", {}, target), (e) => e.detail === "machine_off");
  assert.equal(calls("cmp_mac", "collect_orphans").length, 1, "cleanup is never queued while off");
  assert.deepEqual(app.fallos, []);
});

async function open(name, computers, relays) {
  const f = fleet(relays);
  const app = await boot("listo", name, {}, undefined, {}, {
    web: true,
    antes: (w) => {
      globalThis.WebSocket = f.Socket;
      w.terminusWeb = { endpoint: "https://relay.test", computers, getToken: async () => "tok" };
    },
  });
  await sleep(2500);
  const invoke = (command, args, options) => app.w.__TAURI_INTERNALS__.invoke(command, args, options);
  const calls = (id, command) => f.relays[id].calls.filter((c) => c.command === command);
  return { app, f, invoke, calls, doc: app.w.document, text: () => app.w.document.body.textContent ?? "" };
}

test("two machines show together and each command goes to the machine it names", async () => {
  const { app, invoke, calls, doc, text } = await open("web-machines", [VM, MAC], {
    cmp_vm: { table: table("Panel", "Tarea de la VM", {}, "pv") },
    cmp_mac: { table: table("Notas", "Tarea del Mac", { list_session_git: ({ project: p }) => (p === "pm" ? { t1: { kind: "branch", branch: "feat/notas", repository: "/lab/pm" } } : {}) }, "pm") },
  });

  assert.ok(text().includes("Panel") && text().includes("Notas"), "the projects of both machines are in the sidebar");
  assert.ok(doc.querySelector('[data-sesion="cmp_vm~t1"]'), "the VM task has its namespaced id");
  assert.ok(doc.querySelector('[data-sesion="cmp_mac~t1"]'), "the Mac task with the same raw id does not collide");
  assert.equal(doc.querySelector("[data-sesion] [data-machine]"), null, "a sidebar row leaves its machine to the task card");
  assert.ok(calls("cmp_vm", "list_projects").some((c) => c.workspace === "w"), "the VM gets the workspace id");
  assert.ok(calls("cmp_mac", "list_projects").some((c) => c.workspace === "w"), "the Mac gets the same workspace id");
  assert.deepEqual([...doc.querySelectorAll("[data-machine-row]")].map((r) => r.dataset.state), ["online", "online"]);
  const projects = await invoke("list_projects");
  assert.deepEqual(projects.map((p) => [p.id, p.machines]), [["pv", ["cmp_vm"]], ["pm", ["cmp_mac"]]], "projects keep their ids and say where they live");

  const git = await invoke("list_session_git", { project: "pm", remote: false, priority: ["cmp_mac~t1"] });
  assert.deepEqual(Object.keys(git), ["cmp_mac~t1"], "a task's git status is keyed by the id the panel knows");
  assert.equal(git["cmp_mac~t1"].branch, "feat/notas");
  assert.deepEqual(calls("cmp_mac", "list_session_git").at(-1).args.priority, ["t1"], "the Mac is asked with its own task ids");

  const task = await invoke("load_session", { project: "pm", id: "cmp_mac~t1" });
  assert.equal(task.id, "cmp_mac~t1");
  const read = calls("cmp_mac", "load_session").at(-1);
  assert.deepEqual([read.args.project, read.args.id, read.workspace], ["pm", "t1", "w"], "the Mac reads its task with the same project and workspace ids");
  assert.equal(calls("cmp_vm", "load_session").length, 0, "the VM is not asked for the Mac's task");

  assert.equal(await invoke("send_message", { session: "cmp_mac~t1", text: "hola" }), "cmp_mac~t1");
  assert.equal(calls("cmp_mac", "send_message").length, 1);
  assert.equal(calls("cmp_vm", "send_message").length, 0);

  assert.equal((await invoke("create_project", { name: "Nuevo" })).id, "p9", "a new project keeps the id its engine gave it");
  assert.equal(calls("cmp_vm", "create_project").length, 1, "without a choice a project is made on the managed VM");
  await invoke("create_project", { name: "Otro" }, { headers: { "x-terminus-machine": "cmp_mac" } });
  assert.equal(calls("cmp_mac", "create_project").length, 1, "the picked machine makes it");
  await invoke("create_project", { name: "Tercero" });
  assert.equal(calls("cmp_mac", "create_project").length, 2, "then the last machine used is the default");
  const machines = await invoke("machine_list");
  assert.deepEqual(machines.map((m) => [m.id, m.active, m.hosts]), [["cmp_vm", false, true], ["cmp_mac", true, true]]);

  doc.querySelector('[data-sesion="cmp_vm~t1"]').click();
  await sleep(600);
  const where = doc.querySelector("[data-task-location]");
  assert.equal(where?.querySelector("[data-task-location-machine]")?.textContent, "Danil VM", "the task window names the machine that runs it");
  assert.equal(where?.querySelector("[data-task-location-project]")?.textContent, "Panel");
  assert.deepEqual(app.fallos, []);
});

test("workspaces join by id alone, never by name, and a project is one row with its machines", async () => {
  const LOGO = "/Users/ana/ws/y/logo.png";
  const PNG = "data:image/png;base64,iVBORw0KGgo=";
  const vmList = { workspaces: [SAME, { id: "x", name: "Notas", context_root: null }], active: "w" };
  const macList = { workspaces: [{ ...SAME, name: "W en la Mac" }, { id: "y", name: "Notas", context_root: null, logo: LOGO }], active: "w" };
  const { app, invoke, calls } = await open("web-machines-ids", [VM, MAC], {
    cmp_vm: { table: table("Panel", "Tarea de la VM", { list_workspaces: vmList, workspaces_startup: vmList, list_projects: [folder("p1", "Panel"), folder("pv", "Solo VM")] }) },
    cmp_mac: { table: table("Panel", "Tarea del Mac", { list_workspaces: macList, workspaces_startup: macList, list_projects: [folder("p1", "Panel en la Mac"), folder("pm", "Solo Mac")], preview_file: ({ path }) => ({ data_url: path === LOGO ? PNG : null }) }) },
  });

  const list = await invoke("list_workspaces");
  assert.deepEqual(list.workspaces.map((w) => [w.id, w.name, w.machines]), [["w", "W", ["cmp_vm", "cmp_mac"]], ["x", "Notas", ["cmp_vm"]], ["y", "Notas", ["cmp_mac"]]], "the same id is one workspace; the same name is not");
  const y = list.workspaces.find((w) => w.id === "y");
  assert.equal(y.logo, `cmp_mac~${LOGO}`, "a logo path carries its machine");
  assert.equal((await invoke("preview_file", { path: y.logo, rel: y.logo })).data_url, PNG, "and is read there");
  assert.equal(calls("cmp_vm", "preview_file").length, 0);

  const projects = await invoke("list_projects");
  assert.deepEqual(projects.map((p) => [p.id, p.name, p.machines]), [["p1", "Panel", ["cmp_vm", "cmp_mac"]], ["pv", "Solo VM", ["cmp_vm"]], ["pm", "Solo Mac", ["cmp_mac"]]]);
  await invoke("list_live_sessions", { project: "pm" });
  assert.ok(calls("cmp_mac", "list_live_sessions").some((c) => c.args.project === "pm"));
  assert.ok(!calls("cmp_vm", "list_live_sessions").some((c) => c.args.project === "pm"), "the tasks of a project are asked only where its folder is");
  assert.deepEqual(app.fallos, []);
});

test("a new task is born on the machine chosen, with the same project id, and makes the workspace its own first", async () => {
  const W2 = { id: "w2", name: "Producto", context_root: null };
  const vmWorkspaces = [SAME];
  const vmListing = () => ({ workspaces: [...vmWorkspaces], active: "w" });
  const macListing = { workspaces: [SAME, W2], active: "w" };
  const { app, invoke, calls } = await open("web-machines-create", [VM, MAC], {
    cmp_vm: {
      table: table("Panel", "Tarea de la VM", {
        list_workspaces: vmListing,
        workspaces_startup: vmListing,
        list_projects: [folder("p1", "Panel", { remote_url: "https://github.com/danil/panel", materialized: false, working_directory: null })],
        materialize_workspace: ({ id }) => (vmWorkspaces.push({ ...W2, id }), { ...W2, id }),
        send_message: () => "r1",
      }),
    },
    cmp_mac: { table: table("Panel", "Tarea del Mac", { list_workspaces: macListing, workspaces_startup: macListing, list_projects: [folder("p1", "Panel", { remote_url: "https://github.com/danil/panel" })], set_active_workspace: null }) },
  });

  const projects = await invoke("list_projects");
  assert.deepEqual(projects.map((p) => [p.id, p.machines, p.remote_url]), [["p1", ["cmp_mac"], "https://github.com/danil/panel"]], "the VM knows it from the account but has no folder yet");
  const vm = { headers: { "x-terminus-machine": "cmp_vm" } };
  assert.equal(await invoke("send_message", { project: "p1", session: null, prompt: "hola" }, vm), "cmp_vm~r1");
  assert.deepEqual(calls("cmp_vm", "send_message").map((c) => [c.args.project, c.workspace]), [["p1", "w"]], "the VM got it with the same project id");
  assert.equal(calls("cmp_mac", "send_message").length, 0, "nothing is born on the Mac");
  assert.equal(calls("cmp_vm", "materialize_workspace").length, 0, "a machine that has the workspace makes nothing");

  await invoke("set_active_workspace", { id: "w2" });
  await invoke("list_projects");
  assert.equal((await invoke("machine_list")).find((m) => m.id === "cmp_vm").hosts, false, "the VM lacks the open workspace");
  assert.equal(await invoke("send_message", { project: "p1", session: null, prompt: "otra" }, vm), "cmp_vm~r1");
  assert.deepEqual(calls("cmp_vm", "materialize_workspace").map((c) => [c.args.id, c.workspace]), [["w2", null]], "the VM makes the workspace its own with the same id");
  assert.deepEqual(calls("cmp_vm", "send_message").at(-1).workspace, "w2", "and then gets the task in it");
  const after = await invoke("list_workspaces");
  assert.deepEqual(after.workspaces.find((w) => w.id === "w2").machines, ["cmp_vm", "cmp_mac"]);
  assert.deepEqual(app.fallos, []);
});

test("«Ejecutar en» disables, with the reason, a machine that cannot make the workspace its own or lacks a folder without remote", async () => {
  const VM2 = { computer_id: "cmp_old", name: "VM vieja", state: "online", provider: "aws-ec2" };
  const empty = { workspaces: [], active: null };
  const { app, invoke, calls, doc } = await open("web-machines-picker", [VM, MAC, VM2], {
    cmp_vm: { table: table("Panel", "Tarea de la VM", {}, "pv") },
    cmp_mac: { table: table("Notas", "Tarea del Mac", {}, "pm") },
    cmp_old: { table: table("Nada", "Nada", { list_workspaces: empty, workspaces_startup: empty, list_projects: [] }) },
  });

  const old = { headers: { "x-terminus-machine": "cmp_old" } };
  await assert.rejects(invoke("send_message", { project: "pv", session: null, prompt: "hola" }, old), (e) => {
    assert.equal(e.what, "VM vieja no tiene este workspace y su motor todavía no sabe crearlo. Actualízalo para crear tareas ahí.");
    return true;
  });
  assert.equal(calls("cmp_old", "materialize_workspace").length, 1, "it was asked once");
  assert.equal(calls("cmp_old", "send_message").length, 0, "and never got the task");
  assert.deepEqual((await invoke("machine_list")).find((m) => m.id === "cmp_old"), { id: "cmp_old", local: false, active: false, on: true, hosts: false, materializes: false });

  doc.querySelector('[aria-label="Proyecto"]').click();
  assert.ok(await until(() => [...doc.querySelectorAll("button")].some((b) => b.textContent.includes("Notas") && b.textContent.includes("tarea"))), "the project picker opens");
  [...doc.querySelectorAll("button")].find((b) => b.textContent.includes("Notas") && b.textContent.includes("tarea")).click();
  await sleep(300);
  doc.querySelector('[aria-label="Ejecutar en"]').click();
  assert.ok(await until(() => doc.querySelector("[data-machine-option]")), "the picker opens");
  const option = (id) => doc.querySelector(`[data-machine-option="${id}"]`);
  assert.ok(await until(() => option("cmp_old")?.getAttribute("title")?.includes("no tiene este workspace")), "it reads the machines again when it opens");
  assert.equal(option("cmp_mac").disabled, false, "the machine with the folder is offered");
  assert.equal(option("cmp_vm").disabled, true, "a folder without remote of another machine runs only there");
  assert.equal(option("cmp_vm").getAttribute("title"), "«Notas» es una carpeta sin remoto de otra máquina: sus tareas solo corren ahí.");
  assert.ok(option("cmp_vm").textContent.includes("sin este proyecto"));
  assert.equal(option("cmp_old").disabled, true);
  assert.deepEqual(app.fallos, []);
});

test("an action on a computer that is off and cannot be woken fails short and neutral", async () => {
  const { app, invoke, calls, doc, text } = await open("web-machines-off", [VM, MAC], {
    cmp_vm: { table: table("Panel", "Tarea de la VM") },
    cmp_mac: { table: table("Notas", "Tarea del Mac"), state: "offline", cachedAt: "2026-10-18T21:30:00Z" },
  });

  assert.ok(doc.querySelector('[data-sesion="cmp_mac~t1"]'), "the Mac's copy shows");
  assert.equal(doc.querySelector('[data-machine-row="cmp_mac"]')?.dataset.state, "offline");
  const fila = doc.querySelector('[data-sesion="cmp_mac~t1"]');
  assert.equal(fila.querySelector("[data-folder-chip]")?.getAttribute("title") ?? null, null, "no native tooltip over the task card");
  fila.parentElement.dispatchEvent(new app.w.PointerEvent("pointerenter", { pointerType: "mouse" }));
  await sleep(900);
  const machine = doc.querySelector('[data-hover-machine="cmp_mac"]');
  assert.ok(machine?.parentElement.textContent.includes("Mac de Ana"), "the task card names its machine");
  assert.equal(machine.getAttribute("aria-label"), "apagada");
  await assert.rejects(invoke("send_message", { session: "cmp_mac~t1", text: "hola" }), (e) => {
    assert.equal(e.what, "Mac de Ana está apagada. Enciéndela para seguir.");
    return true;
  });
  assert.equal(calls("cmp_mac", "send_message").length, 0, "nothing tries to start a computer the relay cannot start");
  assert.equal(doc.querySelector('[data-machine-row="cmp_mac"]')?.dataset.state, "offline", "it stays off, not starting");
  assert.ok(!text().includes("Algo se rompió"), "no generic failure");
  assert.deepEqual(app.fallos, []);
});

test("a machine with another engine contract needs an update and never breaks the panel", async () => {
  const OLD = { computer_id: "cmp_old", name: "Servidor viejo", state: "online", provider: "aws-ec2" };
  const { app, invoke, calls, doc, text } = await open("web-machines-outdated", [VM, MAC, OLD], {
    cmp_vm: { table: table("Panel", "Tarea de la VM", {}, "pv") },
    cmp_mac: { table: table("Notas", "Tarea del Mac", {}, "pm") },
    cmp_old: { table: table("Viejo", "Tarea vieja", {}, "po"), outdated: true },
  });

  const old = doc.querySelector('[data-machine-row="cmp_old"]');
  assert.equal(old?.dataset.state, "outdated");
  assert.ok(old.textContent.includes("Necesita actualizarse"));
  assert.ok(text().includes("Panel") && text().includes("Notas"), "the other machines still fill the panel");
  const projects = await invoke("list_projects");
  assert.deepEqual(projects.map((p) => p.id).sort(), ["pm", "pv"]);
  const before = calls("cmp_old", "list_projects").length;
  await invoke("list_projects");
  assert.equal(calls("cmp_old", "list_projects").length, before, "it is left out of later reads");
  await assert.rejects(invoke("send_message", { session: "cmp_old~t1", text: "hola" }), (e) => {
    assert.equal(e.what, "Servidor viejo necesita actualizarse antes de usarla desde aquí.");
    return true;
  });
  assert.equal(calls("cmp_old", "send_message").length, 0);
  assert.ok(!(await invoke("machine_list")).some((m) => m.id === "cmp_old"), "it is not offered to run new tasks");
  assert.deepEqual(app.fallos, []);
});

test("AI accounts are grouped by provider and email with the machines they are signed in on", async () => {
  const vmAccounts = { provider: "claude", env_var: "", shared_credential: null, secret_note: null, active: "a1", accounts: [account("a1", "ana@example.com"), account("a2", null, "Cuenta 2")] };
  const macAccounts = { provider: "claude", env_var: "", shared_credential: null, secret_note: null, active: "m1", accounts: [account("m1", "Ana@Example.com")] };
  const { app, invoke, calls } = await open("web-machines-accounts", [VM, MAC], {
    cmp_vm: { table: table("Panel", "Tarea de la VM", { list_accounts: vmAccounts }) },
    cmp_mac: { table: table("Notas", "Tarea del Mac", { list_accounts: macAccounts }) },
  });

  const list = await invoke("list_accounts", { provider: "claude" });
  assert.equal(list.accounts.length, 2, "one card per provider and email, plus the one without email");
  const [ana, other] = list.accounts;
  assert.equal(ana.id, "cmp_vm~a1");
  assert.deepEqual(ana.machines.map((m) => [m.machine, m.id, m.on]), [["cmp_vm", "cmp_vm~a1", true], ["cmp_mac", "cmp_mac~m1", true]]);
  assert.equal(list.active, "cmp_vm~a1");
  assert.equal(other.label, "Cuenta 2 · Danil VM", "an account without email stays its own, named with its machine");
  assert.deepEqual(other.machines.map((m) => m.machine), ["cmp_vm"]);

  await invoke("remove_account", { provider: "claude", id: "cmp_mac~m1" });
  assert.deepEqual(calls("cmp_mac", "remove_account").map((c) => c.args.id), ["m1"], "signing out is per machine");
  assert.equal(calls("cmp_vm", "remove_account").length, 0);
  await invoke("add_account", { provider: "claude", label: "" }, { headers: { "x-terminus-machine": "cmp_mac" } }).catch(() => {});
  assert.equal(calls("cmp_mac", "add_account").length, 1, "signing in on another machine goes to that machine");
  assert.deepEqual(app.fallos, []);
});

test("the computer list says which engine needs an update before anything is asked", async () => {
  const own = createHash("sha256").update(readFileSync(new URL("../../src-tauri/crates/engine-protocol/commands.json", import.meta.url))).digest("hex");
  const { app, calls, doc, text } = await open("web-machines-contract", [{ ...VM, contract: own }, { ...MAC, contract: "0".repeat(64) }], {
    cmp_vm: { table: table("Panel", "Tarea de la VM") },
    cmp_mac: { table: table("Notas", "Tarea del Mac") },
  });
  assert.equal(doc.querySelector('[data-machine-row="cmp_vm"]')?.dataset.state, "online", "the same contract works as usual");
  assert.equal(doc.querySelector('[data-machine-row="cmp_mac"]')?.dataset.state, "outdated", "another contract needs an update");
  assert.equal(calls("cmp_mac", "list_projects").length, 0, "it is never asked for panel reads");
  assert.ok(text().includes("Panel") && !text().includes("Notas"));
  assert.deepEqual(app.fallos, []);
});

test("a computer the relay cannot start answers off at once, never starting", async () => {
  // Without `provider` the list does not say it is the person's own: the relay does.
  const OWN = { computer_id: "cmp_own", name: "Portátil", state: "offline" };
  const { app, invoke, calls, doc } = await open("web-machines-not-startable", [VM, OWN], {
    cmp_vm: { table: table("Panel", "Tarea de la VM") },
    cmp_own: { table: table("Notas", "Tarea del portátil"), state: "offline", notStartable: true },
  });
  await assert.rejects(invoke("send_message", { session: "cmp_own~t1", text: "hola" }), (e) => {
    assert.equal(e.what, "Portátil está apagada. Enciéndela para seguir.");
    return true;
  });
  assert.equal(calls("cmp_own", "send_message").length, 1, "the relay was asked and refused");
  assert.equal(doc.querySelector('[data-machine-row="cmp_own"]')?.dataset.state, "offline", "it never shows as starting");
  assert.deepEqual(app.fallos, []);
});
