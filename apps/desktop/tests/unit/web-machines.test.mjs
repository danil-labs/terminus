/**
 * One panel over every computer of the person: the browser build opens a relay
 * session per computer, joins their workspaces and projects by id (the same on
 * every machine) and their tasks (each with its machine and an id that cannot
 * collide), sends each command to the machine of its envelope (the
 * `x-terminus-machine` header, never its arguments), creates where the person
 * chose (making the workspace that machine's own first), fails short and
 * neutral on a computer that is off and cannot be woken, leaves out one that
 * speaks another contract, and keeps each registered AI credential separate.
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

const VM = { computer_id: "cmp_vm", name: "Danil VM", state: "online", provider: "aws-ec2", os: "linux" };
const MAC = { computer_id: "cmp_mac", name: "Mac de Ana", state: "online", provider: "self", kind: "physical", os: "macos" };

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
  await sleep(31000);
  const cached = JSON.parse(app.w.localStorage.getItem("terminus-fleet:slices:v1") ?? "{}");
  assert.ok(Object.keys(cached).some((key) => key.includes("list_workspaces")), "the listing itself is persisted");
  for (const entry of Object.values(cached)) assert.equal(JSON.parse(entry.value)?.machine_resources, undefined, "machine resources stay in memory");
  await assert.rejects(invoke("list_storage", { refrescar: true }, { headers: { "x-terminus-machine": "cmp_vm", "x-terminus-workspace": "w" } }), (e) => e.detail === "machine_off");
  assert.equal(calls("cmp_vm", "list_storage").length, 0, "an offline machine is not asked to measure");
  await assert.rejects(invoke("collect_orphans", {}, { headers: { "x-terminus-machine": "missing" } }), (e) => e.detail === "unknown_machine");
  await assert.rejects(invoke("reclaim_storage", { session: "cmp_vm~t1", project: "p1", rutas: [] }, target), (e) => e.detail === "cross_machine");
  f.relays.cmp_mac.setState("offline");
  await assert.rejects(invoke("collect_orphans", {}, target), (e) => e.detail === "machine_off");
  assert.equal(calls("cmp_mac", "collect_orphans").length, 1, "cleanup is never queued while off");
  f.relays.cmp_mac.setState("online");
  const trigger = app.w.document.querySelector('button[aria-label="Almacenamiento"]');
  assert.ok(trigger);
  trigger.click();
  assert.ok(await until(() => app.w.document.querySelector('[data-storage-machine="cmp_mac"]')));
  const measured = calls("cmp_mac", "list_storage").length;
  f.relays.cmp_mac.setState("offline");
  assert.ok(await until(() => app.w.document.querySelector('[data-storage-machine="cmp_mac"]')?.textContent.includes("Sin conexión")), "the open panel follows relay state without interaction");
  assert.equal(calls("cmp_mac", "list_storage").length, measured, "a status transition does not scan storage");
  trigger.click();
  assert.deepEqual(app.fallos, []);
});

/** The account's registry: `w` (and any other given) on the machines named. */
const registry = (spaces) =>
  Object.entries(spaces).map(([id, computers]) => ({ id, name: id === "w" ? "W" : id, radiant_workspace_id: null, settings: null, settings_version: 1, created_at: "2026-10-01T10:00:00Z", updated_at: "2026-10-01T10:00:00Z", projects: [], computers }));

/** The envelope of a call to a machine, as the window builds it from the task's row. */
const on = (machine) => ({ headers: { "x-terminus-machine": machine } });

async function open(name, computers, relays, workspaces) {
  const f = fleet(relays);
  const app = await boot("listo", name, {}, undefined, {}, {
    web: true,
    workspaces,
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

test("a primary context on another machine clears the empty-context notice", async () => {
  const configured = { workspaces: [{ ...SAME, context_root: "/lab/context" }], active: "w" };
  const { app, invoke, text } = await open("web-context-source", [VM, MAC], {
    cmp_vm: { table: table("Panel", "VM") },
    cmp_mac: { table: table("Notas", "Mac", { list_workspaces: configured, workspaces_startup: configured }) },
  });
  try {
    for (const command of ["workspaces_startup", "list_workspaces"]) {
      const startup = await invoke(command);
      assert.equal(startup.workspaces[0].context_root, "/lab/context");
    }
    assert.ok(!text().includes("Sin fuente de contexto"), "the workspace has context on the Mac");
  } finally {
    app.w.close();
  }
});

test("two machines show together and each command goes to the machine it names", async () => {
  const { app, invoke, calls, doc, text } = await open("web-machines", [VM, MAC], {
    cmp_vm: { table: table("Panel", "Tarea de la VM", { list_slash_menu: { commands: [], skills: [], side_question: "btw" } }, "pv") },
    cmp_mac: { table: table("Notas", "Tarea del Mac", {
      list_slash_menu: { commands: [], skills: [], side_question: "btw" },
      ask_side_question: { answer: "Respuesta de la Mac" },
      list_workspace_attention: [{ workspace: "w", tasks: [{ session: "t1", project: "pm", state: "unseen" }] }],
      mark_task_seen: null,
      load_session: (args) => ({ ...engine.load_session(args), turns: [{ id: "a1", role: "agent", text: "Respuesta guardada", at: 1 }] }),
      prepare_session_continuation: { path: "/lab/continuation.md", last_prompt: "", last_reply: "Respuesta guardada", sources: [], excluded_sources: [] },
      list_session_git: ({ project: p }) => (p === "pm" ? { t1: { kind: "branch", branch: "feat/notas", repository: "/lab/pm" } } : {}),
    }, "pm") },
  });

  assert.ok(text().includes("Panel") && text().includes("Notas"), "the projects of both machines are in the sidebar");
  assert.ok(doc.querySelector('[data-sesion="cmp_vm~t1"]'), "the VM task has its namespaced id");
  assert.ok(doc.querySelector('[data-sesion="cmp_mac~t1"]'), "the Mac task with the same raw id does not collide");
  assert.ok(doc.querySelector('[data-sesion="cmp_vm~t1"] [data-machine="cmp_vm"]'), "a sidebar row says the machine that runs it");
  assert.ok(calls("cmp_vm", "list_projects").some((c) => c.workspace === "w"), "the VM gets the workspace id");
  assert.ok(calls("cmp_mac", "list_projects").some((c) => c.workspace === "w"), "the Mac gets the same workspace id");
  assert.deepEqual([...doc.querySelectorAll("[data-machine-row]")].map((r) => r.dataset.state), ["online", "online"]);
  const projects = await invoke("list_projects");
  assert.deepEqual(projects.map((p) => [p.id, p.machines]), [["pv", ["cmp_vm"]], ["pm", ["cmp_mac"]]], "projects keep their ids and say where they live");

  const git = await invoke("list_session_git", { project: "pm", remote: false, priority: ["cmp_mac~t1"] });
  assert.deepEqual(Object.keys(git), ["cmp_mac~t1"], "a task's git status is keyed by the id the panel knows");
  assert.equal(git["cmp_mac~t1"].branch, "feat/notas");
  assert.deepEqual(calls("cmp_mac", "list_session_git").at(-1).args.priority, ["t1"], "the Mac is asked with its own task ids");

  const task = await invoke("load_session", { project: "pm", id: "cmp_mac~t1" }, on("cmp_mac"));
  assert.equal(task.id, "cmp_mac~t1");
  const read = calls("cmp_mac", "load_session").at(-1);
  assert.deepEqual([read.args.project, read.args.id, read.workspace], ["pm", "t1", "w"], "the Mac reads its task with the same project and workspace ids");
  assert.equal(calls("cmp_vm", "load_session").length, 0, "the VM is not asked for the Mac's task");

  assert.equal(await invoke("send_message", { session: "cmp_mac~t1", text: "hola" }, on("cmp_mac")), "cmp_mac~t1");
  await assert.rejects(invoke("send_message", { session: "cmp_mac~t1", text: "hola" }, on("cmp_vm")), (e) => e.detail === "cross_machine", "an id of another machine in the args is refused, not followed");
  assert.equal(calls("cmp_mac", "send_message").length, 1);
  assert.equal(calls("cmp_vm", "send_message").length, 0);

  assert.equal((await invoke("create_project", { name: "Nuevo" })).id, "p9", "a new project keeps the id its engine gave it");
  assert.equal(calls("cmp_vm", "create_project").length, 1, "without a choice a project is made on the managed VM");
  await invoke("create_project", { name: "Otro" }, { headers: { "x-terminus-machine": "cmp_mac" } });
  assert.equal(calls("cmp_mac", "create_project").length, 1, "the picked machine makes it");
  await invoke("create_project", { name: "Tercero" });
  assert.equal(calls("cmp_vm", "create_project").length, 2, "without a choice it is the workspace's first machine again, as on the desktop");
  const machines = await invoke("machine_list");
  assert.deepEqual(machines.map((m) => [m.id, m.active, m.hosts]), [["cmp_vm", true, true], ["cmp_mac", false, true]]);

  doc.querySelector('[data-sesion="cmp_mac~t1"]').click();
  await sleep(600);
  const where = doc.querySelector("[data-task-location]");
  assert.equal(where?.querySelector("[data-task-location-machine]")?.textContent, "Mac de Ana", "the task window names the machine that runs it");
  assert.ok(!where?.textContent?.includes("(macOS)"), "the task bar does not name the system");
  assert.equal(where?.querySelector("[data-machine-form]")?.getAttribute("data-machine-form"), "computer", "a physical machine keeps the laptop");
  assert.equal(where?.querySelector("[data-task-location-project]")?.textContent, "Notas");
  assert.ok(calls("cmp_mac", "list_mentions").some((c) => c.args.session === "t1" && c.workspace === "w"), "opening the second machine’s task reads its mention files on that machine");
  assert.ok(!calls("cmp_vm", "list_mentions").some((c) => c.args.session === "t1"), "the first machine never receives the other machine’s task");
  const field = doc.querySelector("textarea");
  field.value = "/btw ¿Qué está pasando?";
  field.dispatchEvent(new app.w.Event("input", { bubbles: true }));
  field.closest("form").dispatchEvent(new app.w.Event("submit", { bubbles: true, cancelable: true }));
  assert.ok(await until(() => text().includes("Respuesta de la Mac")), "the side question is answered by the task’s machine");
  assert.equal(calls("cmp_mac", "ask_side_question").at(-1)?.args.session, "t1");
  assert.equal(calls("cmp_vm", "ask_side_question").length, 0);
  assert.ok(calls("cmp_mac", "mark_task_seen").some((c) => c.args.session === "t1"), "opening the task marks it seen on its machine");
  assert.equal(calls("cmp_vm", "mark_task_seen").length, 0);
  assert.ok(calls("cmp_mac", "task_history").some((c) => c.args.id === "t1" && c.workspace === "w"), "the task’s work history is read from its machine");
  assert.ok(!calls("cmp_vm", "task_history").some((c) => c.args.project === "pm"), "another machine’s history never goes to the default machine");
  doc.querySelector('[aria-label="Crear tarea desde aquí"]').click();
  await sleep(100);
  const continueButton = [...doc.querySelectorAll("button")].find((b) => b.textContent === "Conversación completa");
  assert.ok(continueButton, "the continuation dialog opens");
  continueButton.click();
  assert.ok(await until(() => calls("cmp_mac", "prepare_session_continuation").length === 1), "the continuation is prepared on the task’s machine");
  assert.equal(calls("cmp_mac", "prepare_session_continuation")[0].args.id, "t1");
  assert.equal(calls("cmp_vm", "prepare_session_continuation").length, 0);
  assert.deepEqual(app.fallos, []);
});

test("the usage strip reads an account from its machine when the default machine has no account list", async () => {
  const providers = [{ id: "codex", label: "Codex", available: true, driver: true, limits: true }];
  const { app, calls } = await open("web-machines-usage", [VM, MAC], {
    cmp_vm: { table: table("Panel", "Tarea de la VM", { list_providers: providers, list_accounts: null }) },
    cmp_mac: { table: table("Notas", "Tarea del Mac", {
      list_providers: providers,
      list_accounts: { provider: "codex", accounts: [account("m1", "ana@example.com")], active: "m1" },
      account_limits: { mode: "read", windows: [], at: Date.now() },
      account_status: { id: "m1", authenticated: true, detail: "" },
    }) },
  });
  assert.ok(await until(() => calls("cmp_mac", "account_limits").length > 0), "usage is read from the machine with the account");
  assert.equal(calls("cmp_mac", "account_limits").at(-1).args.id, "m1");
  assert.equal(calls("cmp_mac", "account_status").at(-1)?.args.id, "m1");
  assert.equal(calls("cmp_vm", "account_limits").length, 0);
  assert.equal(calls("cmp_vm", "account_status").length, 0);
  assert.deepEqual(app.fallos, []);
});

test("a tab of one machine's task leaves the other machines' tasks in every folder", async () => {
  const { app, invoke, calls } = await open("web-machines-open-tabs", [VM, MAC], {
    cmp_vm: { table: table("Panel", "Tarea de la VM") },
    cmp_mac: { table: table("Panel", "Tarea del Mac") },
  });
  const rows = await invoke("list_live_sessions", { project: "p1", open: ["cmp_vm~t1"] });
  assert.deepEqual(rows.map((r) => r.id).sort(), ["cmp_mac~t1", "cmp_vm~t1"], "the open tab does not send the folder's read to its machine alone");
  assert.deepEqual(calls("cmp_vm", "list_live_sessions").at(-1)?.args.open, ["t1"], "the VM gets its open task with its own id");
  assert.deepEqual(calls("cmp_mac", "list_live_sessions").at(-1)?.args.open, [], "the Mac gets none of another machine's");
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
  assert.equal((await invoke("preview_file", { path: y.logo, rel: y.logo }, on("cmp_mac"))).data_url, PNG, "and is read there");
  assert.equal(calls("cmp_vm", "preview_file").length, 0);

  const projects = await invoke("list_projects");
  assert.deepEqual(projects.map((p) => [p.id, p.name, p.machines]), [["p1", "Panel", ["cmp_vm", "cmp_mac"]], ["pv", "Solo VM", ["cmp_vm"]], ["pm", "Solo Mac", ["cmp_mac"]]]);
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
  }, registry({ w: ["cmp_vm", "cmp_mac"], w2: ["cmp_mac"] }));

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
  assert.deepEqual(calls("cmp_vm", "materialize_workspace").map((c) => [c.args.id, c.workspace]), [["w2", "w2"]], "the VM makes the workspace its own with the same id, said in the envelope");
  assert.deepEqual(calls("cmp_vm", "send_message").at(-1).workspace, "w2", "and then gets the task in it");
  let after = await invoke("list_workspaces");
  for (let attempt = 0; attempt < 20 && !after.workspaces.find(w => w.id === "w2")?.machines.includes("cmp_vm"); attempt++) {
    await sleep(50);
    after = await invoke("list_workspaces");
  }
  assert.deepEqual(after.workspaces.find((w) => w.id === "w2").machines, ["cmp_vm", "cmp_mac"]);
  assert.deepEqual(app.fallos, []);
});

test("«Ejecutar en» disables, with the reason, a machine that cannot make the workspace its own, and offers a folder without remote while its machine is on", async () => {
  const VM2 = { computer_id: "cmp_old", name: "VM vieja", state: "online", provider: "aws-ec2" };
  const empty = { workspaces: [], active: null };
  const { app, invoke, calls, doc } = await open("web-machines-picker", [VM, MAC, VM2], {
    cmp_vm: { table: table("Panel", "Tarea de la VM", {}, "pv") },
    cmp_mac: { table: table("Notas", "Tarea del Mac", {}, "pm") },
    cmp_old: { table: table("Nada", "Nada", { list_workspaces: empty, workspaces_startup: empty, list_projects: [] }) },
  }, registry({ w: ["cmp_vm", "cmp_mac"] }));

  const old = { headers: { "x-terminus-machine": "cmp_old" } };
  await assert.rejects(invoke("send_message", { project: "pv", session: null, prompt: "hola" }, old), (e) => {
    assert.equal(e.what, "VM vieja no tiene este workspace y su motor todavía no sabe crearlo. Actualízalo para crear tareas ahí.");
    return true;
  });
  assert.equal(calls("cmp_old", "materialize_workspace").length, 1, "it was asked once");
  assert.equal(calls("cmp_old", "send_message").length, 0, "and never got the task");
  assert.deepEqual((await invoke("machine_list")).find((m) => m.id === "cmp_old"), { id: "cmp_old", local: false, active: false, on: true, hosts: false, materializes: false, wakes: true });

  doc.querySelector('[aria-label="Ejecutar en"]').click();
  assert.ok(await until(() => doc.querySelector('[data-machine-option="cmp_mac"]')), "the machine picker opens");
  doc.querySelector('[data-machine-option="cmp_mac"]').click();
  await sleep(300);
  doc.querySelector('[aria-label="Proyecto"]').click();
  assert.ok(await until(() => [...doc.querySelectorAll("button")].some((b) => b.textContent.includes("Notas") && b.textContent.includes("tarea"))), "the project picker opens with that machine's folders");
  [...doc.querySelectorAll("button")].find((b) => b.textContent.includes("Notas") && b.textContent.includes("tarea")).click();
  await sleep(300);
  doc.querySelector('[aria-label="Ejecutar en"]').click();
  assert.ok(await until(() => doc.querySelector("[data-machine-option]")), "the picker opens");
  const option = (id) => doc.querySelector(`[data-machine-option="${id}"]`);
  assert.ok(await until(() => option("cmp_old")?.getAttribute("title")?.includes("no tiene este workspace")), "it reads the machines again when it opens");
  assert.equal(option("cmp_mac").disabled, false, "the machine with the folder is offered");
  assert.equal(option("cmp_vm").querySelector("[data-machine-form]")?.getAttribute("data-machine-form"), "vm");
  assert.equal(option("cmp_mac").querySelector("[data-machine-form]")?.getAttribute("data-machine-form"), "computer", "a physical machine keeps the laptop");
  assert.equal(option("cmp_vm").disabled, false, "a folder without remote is carried from its machine while that one is on");
  assert.ok(!option("cmp_vm").textContent.includes("sin este proyecto"));
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
  assert.ok(machine?.parentElement.textContent.includes("(macOS)"), "the task card names the system after the machine");
  assert.equal(machine.getAttribute("aria-label"), "apagada");
  const vmRow = doc.querySelector('[data-sesion="cmp_vm~t1"]');
  vmRow.parentElement.dispatchEvent(new app.w.PointerEvent("pointerenter", { pointerType: "mouse" }));
  await sleep(900);
  const vmCard = doc.querySelector('[data-hover-machine="cmp_vm"]');
  assert.ok(vmCard?.parentElement.textContent.includes("Danil VM"), "the VM card names its machine");
  assert.ok(vmCard?.parentElement.textContent.includes("(Linux)"), "the VM card names Linux when the row says so");
  await assert.rejects(invoke("send_message", { session: "cmp_mac~t1", text: "hola" }, on("cmp_mac")), (e) => {
    assert.equal(e.what, "Mac de Ana está sin conexión. Verifica que Terminus esté abierto y tenga acceso a internet.");
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
  await assert.rejects(invoke("send_message", { session: "cmp_old~t1", text: "hola" }, on("cmp_old")), (e) => {
    assert.equal(e.what, "Servidor viejo necesita actualizarse antes de usarla desde aquí.");
    return true;
  });
  assert.equal(calls("cmp_old", "send_message").length, 0);
  assert.ok(!(await invoke("machine_list")).some((m) => m.id === "cmp_old"), "it is not offered to run new tasks");
  assert.deepEqual(app.fallos, []);
});

test("AI credentials with the same email keep separate cards and machine actions", async () => {
  const vmAccounts = { provider: "claude", env_var: "", shared_credential: null, secret_note: null, active: "a1", accounts: [account("a1", "ana@example.com", "Personal"), account("a2", "ana@example.com", "Team")] };
  const macAccounts = { provider: "claude", env_var: "", shared_credential: null, secret_note: null, active: "m1", accounts: [account("m1", "Ana@Example.com")] };
  const { app, invoke, calls } = await open("web-machines-accounts", [VM, MAC], {
    cmp_vm: { table: table("Panel", "Tarea de la VM", {
      list_accounts: vmAccounts,
      account_limits: ({ id }) => ({ mode: "read", plan: id === "a1" ? "Personal" : "Team", windows: [] }),
      set_active_account: null,
    }) },
    cmp_mac: { table: table("Notas", "Tarea del Mac", { list_accounts: macAccounts }) },
  });

  const list = await invoke("list_accounts", { provider: "claude" });
  assert.equal(list.accounts.length, 3, "Personal, Team and the Mac credential stay separate despite sharing email");
  const [ana, other] = list.accounts;
  assert.equal(ana.id, "cmp_vm~a1");
  assert.deepEqual(ana.machines.map((m) => [m.machine, m.id, m.on]), [["cmp_vm", "cmp_vm~a1", true]]);
  assert.deepEqual(list.accounts[2].machines.map((m) => [m.machine, m.id, m.on]), [["cmp_mac", "cmp_mac~m1", true]]);
  assert.equal(list.active, "cmp_vm~a1");
  assert.equal(other.label, "Team", "the second credential keeps its own label");
  assert.deepEqual(other.machines.map((m) => m.machine), ["cmp_vm"]);
  const personal = await invoke("account_limits", { provider: "claude", id: ana.id, force: false }, on("cmp_vm"));
  const team = await invoke("account_limits", { provider: "claude", id: other.id, force: false }, on("cmp_vm"));
  assert.deepEqual([personal.plan, team.plan], ["Personal", "Team"], "each card reads its own subscription usage");
  await invoke("set_active_account", { provider: "claude", id: other.id }, on("cmp_vm"));
  assert.equal(calls("cmp_vm", "set_active_account").at(-1).args.id, "a2", "Team can be selected independently");

  await invoke("remove_account", { provider: "claude", id: "cmp_mac~m1" }, on("cmp_mac"));
  assert.deepEqual(calls("cmp_mac", "remove_account").map((c) => c.args.id), ["m1"], "signing out is per machine");
  assert.equal(calls("cmp_vm", "remove_account").length, 0);
  await invoke("add_account", { provider: "claude", label: "" }, { headers: { "x-terminus-machine": "cmp_mac" } }).catch(() => {});
  assert.equal(calls("cmp_mac", "add_account").length, 1, "signing in on another machine goes to that machine");
  assert.deepEqual(app.fallos, []);
});

test("one subscription shows both machine chips while Team keeps its own card and actions", async () => {
  const list = (active, accounts) => ({ provider: "codex", env_var: "", shared_credential: null, secret_note: null, active, accounts });
  const status = (id, plan) => ({ id, authenticated: true, detail: `ana@example.com · ${plan}` });
  const { app, calls, doc } = await open("web-account-subscriptions", [VM, MAC], {
    cmp_vm: { table: table("Panel", "VM", {
      list_language_packs: [],
      list_bundled_language_packs: [],
      get_profile: { name: "Fixture" },
      get_project_directory: "/lab",
      list_accounts: list("personal", [account("personal", "ana@example.com"), account("team", "ana@example.com")]),
      account_status: ({ id }) => status(id, id === "personal" ? "Pro" : "Team"),
      account_limits: ({ id }) => ({ mode: "read", plan: id === "personal" ? "Pro" : "Team", windows: [] }),
      set_active_account: null,
      tasks_awaiting_quota: [],
    }) },
    cmp_mac: { table: table("Notas", "Mac", {
      list_accounts: list("copy", [account("copy", "Ana@Example.com")]),
      account_status: ({ id }) => status(id, "Pro"),
      account_limits: { mode: "read", plan: "Pro", windows: [] },
    }) },
  });
  const button = (label) => [...doc.querySelectorAll("button")].find((b) => b.textContent?.trim() === label || b.getAttribute("aria-label") === label);
  button("Configuración").click();
  assert.ok(await until(() => button("Proveedores de IA")));
  button("Proveedores de IA").click();
  assert.ok(await until(() => doc.querySelectorAll('[data-account-machines="cmp_vm~personal"] [data-account-machine]').length === 2));
  assert.equal(doc.querySelectorAll("[data-account-machines]").length, 2, "one Pro card and one Team card");
  const personal = doc.querySelector('[data-account-machines="cmp_vm~personal"]');
  const team = doc.querySelector('[data-account-machines="cmp_vm~team"]');
  assert.deepEqual([...personal.querySelectorAll("[data-account-machine]")].map((m) => m.dataset.accountMachine), ["cmp_vm", "cmp_mac"]);
  assert.deepEqual([...team.querySelectorAll("[data-account-machine]")].map((m) => m.dataset.accountMachine), ["cmp_vm"]);
  const useTeam = [...team.previousElementSibling.querySelectorAll("button")].find((b) => b.textContent.trim() === "Usar esta");
  assert.ok(useTeam);
  useTeam.click();
  assert.ok(await until(() => calls("cmp_vm", "set_active_account").some((c) => c.args.id === "team")));
  const mac = doc.querySelector('[data-account-machines="cmp_vm~personal"] [data-account-machine="cmp_mac"]');
  mac.querySelector("button").click();
  mac.querySelector("[data-sign-out-yes]").click();
  assert.ok(await until(() => calls("cmp_mac", "remove_account").some((c) => c.args.id === "copy")));
  assert.equal(calls("cmp_vm", "remove_account").length, 0, "sign out removes only the selected machine's credential");
  assert.deepEqual(app.fallos, []);
});

test("provider login from settings receives its link and code", async () => {
  let created = false;
  const { app, f, calls, doc } = await open("web-settings-login", [VM, MAC], {
    cmp_vm: { table: table("Panel", "VM", {
      list_language_packs: [],
      list_bundled_language_packs: [],
      get_profile: { name: "Fixture" },
      get_project_directory: "/lab",
      list_accounts: () => ({ provider: "codex", active: null, accounts: created ? [account("new", null)] : [] }),
      add_account: () => { created = true; return account("new", null); },
      login_account: null,
      account_status: { authenticated: false, detail: "" },
      tasks_awaiting_quota: [],
    }) },
    cmp_mac: { table: table("Notas", "Mac", {
      list_accounts: { provider: "codex", active: null, accounts: [] },
      add_account: account("mac-new", null),
      login_account: null,
    }) },
  });
  const button = (label) => [...doc.querySelectorAll("button")].find((b) => b.textContent?.trim() === label || b.getAttribute("aria-label") === label);
  button("Configuración").click();
  assert.ok(await until(() => button("Proveedores de IA")));
  button("Proveedores de IA").click();
  assert.ok(await until(() => button("+ Agregar cuenta")));
  button("+ Agregar cuenta").click();
  assert.ok(await until(() => calls("cmp_vm", "login_account").length));
  app.w.open = () => null;
  f.relays.cmp_vm.push({ type: "events", cursor: 1, runtime: "rt1", gap: false, events: [
    { name: "account", payload: { account: "new", kind: "url", text: "https://auth.example/device" } },
    { name: "account", payload: { account: "new", kind: "confirm", text: "ABCD-1234" } },
  ] });
  assert.ok(await until(() => doc.body.textContent.includes("ABCD-1234")), "the login dialog shows the code");
  assert.ok(button("Abrir navegador"), "the login dialog offers the provider's page");
  f.relays.cmp_vm.push({ type: "events", cursor: 2, runtime: "rt1", gap: false, events: [
    { name: "account", payload: { account: "new", kind: "done", text: "Login failed" } },
  ] });
  assert.ok(await until(() => button("Reintentar")), "a failed login can be retried");
  assert.equal(button("Abrir en la Terminal"), undefined, "web login never offers a terminal on the remote machine");
  assert.ok(await until(() => doc.querySelector("[data-sign-in-elsewhere]")));
  const elsewhere = doc.querySelector("[data-sign-in-elsewhere]");
  elsewhere.dispatchEvent(new app.w.PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }));
  elsewhere.click();
  assert.ok(await until(() => doc.querySelector('[data-sign-in-on="cmp_mac"]')));
  doc.querySelector('[data-sign-in-on="cmp_mac"]').dispatchEvent(new app.w.KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
  assert.ok(await until(() => calls("cmp_mac", "login_account").length), "sign in elsewhere starts the CLI on the chosen machine");
  assert.deepEqual(calls("cmp_mac", "login_account")[0].args, { provider: "codex", id: "mac-new", mode: "tuberia" });
  f.relays.cmp_mac.push({ type: "events", cursor: 1, runtime: "rt1", gap: false, events: [
    { name: "account", payload: { account: "mac-new", kind: "confirm", text: "MAC-1234" } },
  ] });
  assert.ok(await until(() => doc.body.textContent.includes("MAC-1234")), "the chosen machine's login reaches the same dialog");
  assert.deepEqual(app.fallos, []);
});

// Un cambio de contrato nunca deja sin uso máquinas enteras: como el teléfono,
// solo `version_mismatch` del relay o del motor la marca desactualizada.
test("an engine of the previous additive family stays in service", async () => {
  const contract = "3972c281dba1b61f9ad06fc82fbf059af3dbc55770b0a1bcb59ce786ec0a56f1";
  const { app, calls, doc, text } = await open("web-machines-additive-contract", [{ ...VM, contract }], {
    cmp_vm: { table: table("Panel actualizado", "Tarea de la VM"), contract },
  });
  assert.ok(await until(() => text().includes("Panel actualizado")), "its panel is read as usual");
  assert.equal(doc.querySelector('[data-machine-row="cmp_vm"]')?.dataset.state, "online");
  assert.ok(calls("cmp_vm", "list_projects").length > 0);
  assert.deepEqual(app.fallos, []);
});

test("a machine on another contract is not marked outdated by its hash", async () => {
  const own = createHash("sha256").update(readFileSync(new URL("../../src-tauri/crates/engine-protocol/commands.json", import.meta.url))).digest("hex");
  const { app, calls, doc, text } = await open("web-machines-contract", [{ ...VM, contract: own }, { ...MAC, contract: "0".repeat(64) }], {
    cmp_vm: { table: table("Panel", "Tarea de la VM", {}, "pv") },
    cmp_mac: { table: table("Notas", "Tarea del Mac", {}, "pm") },
  });
  assert.ok(await until(() => text().includes("Panel") && text().includes("Notas")), "both panels are read");
  assert.equal(doc.querySelector('[data-machine-row="cmp_vm"]')?.dataset.state, "online");
  assert.equal(doc.querySelector('[data-machine-row="cmp_mac"]')?.dataset.state, "online", "another contract keeps working");
  assert.ok(calls("cmp_mac", "list_projects").length > 0);
  assert.deepEqual(app.fallos, []);
});

test("a computer the relay cannot start answers off at once, never starting", async () => {
  // Without `provider` the list does not say it is the person's own: the relay does.
  const OWN = { computer_id: "cmp_own", name: "Portátil", state: "offline" };
  const { app, invoke, calls, doc } = await open("web-machines-not-startable", [VM, OWN], {
    cmp_vm: { table: table("Panel", "Tarea de la VM") },
    cmp_own: { table: table("Notas", "Tarea del portátil"), state: "offline", notStartable: true },
  });
  await assert.rejects(invoke("send_message", { session: "cmp_own~t1", text: "hola" }, on("cmp_own")), (e) => {
    assert.equal(e.what, "Portátil está sin conexión. Verifica que Terminus esté abierto y tenga acceso a internet.");
    return true;
  });
  assert.equal(calls("cmp_own", "send_message").length, 1, "the relay was asked and refused");
  assert.equal(doc.querySelector('[data-machine-row="cmp_own"]')?.dataset.state, "offline", "it never shows as starting");
  assert.deepEqual(app.fallos, []);
});

test("el composer web sigue las credenciales de la máquina elegida y de la tarea abierta", async () => {
  const { app, doc, calls } = await open("web-composer-machine", [VM, MAC], {
    cmp_vm: { table: table("Panel", "Tarea de la VM") },
    cmp_mac: { table: table("Panel", "Tarea del Mac", {
      list_surfaces: [{ id: "claude", provider: "claude", label: "Claude Code", catalogo: "todo", usable: true, marca: null, porque: null }],
      list_models: ({ provider }) => ({ provider, models: [{ id: "remote-sonnet", label: "Sonnet del Mac", efforts: [], default_effort: null }], fallback: false }),
    }) },
  });
  doc.querySelector('[aria-label="Ejecutar en"]').click();
  assert.ok(await until(() => doc.querySelector('[data-machine-option="cmp_mac"]')));
  doc.querySelector('[data-machine-option="cmp_mac"]').click();
  assert.ok(await until(() => doc.querySelector('[aria-label*="Sonnet del Mac"]')), "el composer sigue ofreciendo solo lo autenticado en la VM");
  assert.ok(calls("cmp_mac", "list_surfaces").length, "no consulta las credenciales del Mac");
  const before = calls("cmp_vm", "list_surfaces").length;
  doc.querySelector('[data-sesion="cmp_vm~t1"]').click();
  assert.ok(await until(() => calls("cmp_vm", "list_surfaces").length > before), "la tarea abierta usa la máquina del borrador");
  assert.ok(await until(() => !doc.querySelector('[aria-label*="Sonnet del Mac"]')), "la tarea de la VM conserva el modelo del Mac");
  assert.ok(await until(() => doc.querySelector("[data-task-location]")));
  assert.equal(doc.querySelector("[data-task-git-actions]"), null);
  await sleep(100);
  assert.deepEqual(app.fallos, []);
  app.w.close();
});
