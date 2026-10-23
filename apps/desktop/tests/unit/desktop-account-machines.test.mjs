/**
 * The desktop signed in to the Danil account adds the tasks of the other
 * computers of the person to its own (`features/machines/router.ts`): its own
 * engine stays on the native IPC, paints first and keeps its ids; each other
 * computer is a relay session that only adds its slice. A call goes to another
 * machine only by its envelope (the `x-terminus-machine` header), never by an
 * id in its arguments. Signed out, nothing changes.
 * Mounts `dist/` with a simulated IPC (the local engine) and a fake relay.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { engine, fleet } from "../helpers/fake-relay.mjs";
import { boot, sleep } from "../helpers/jsdom-app.mjs";

const SAME = { id: "w", name: "W", context_root: null, provider: "github", remote: "danil/panel" };
const row = (id, title) => ({ id, title, last_message: "", provider: "codex", model: "gpt-5.6", refs: [], created_at: 0, updated_at: 0, turns: 0, parent: null, esperando: false });
const project = (name) => ({ id: "p1", name, working_directory: "/lab/p1", kind: "git", portfolio: null, sources: [] });

/** The same workspace and project on every machine; task ids collide and only the namespace of the others keeps them apart. */
function remote(name, task, extra = {}) {
  return {
    ...engine,
    list_workspaces: { workspaces: [SAME], active: "w" },
    workspaces_startup: { workspaces: [SAME], active: "w" },
    list_projects: [project(name)],
    list_live_sessions: ({ project: p }) => (p === "p1" || p === "" ? [row("t1", task)] : []),
    send_message: () => "t1",
    create_project: ({ name: n }) => ({ id: "p9", name: n, working_directory: "/lab/p9", kind: "folder", sources: [] }),
    ...extra,
  };
}

/** The window's own engine, through the simulated IPC. */
function local(calls, extra = {}) {
  const answer = (command, value) => (args) => {
    calls.push({ command, args });
    return typeof value === "function" ? value(args) : value;
  };
  const table = {
    window_ready: null,
    window_vitals: null,
    setup_required: false,
    list_providers: [{ id: "codex", label: "Codex", available: true, driver: true }],
    list_workspaces: { workspaces: [SAME], active: "w" },
    workspaces_startup: { workspaces: [SAME], active: "w" },
    list_projects: [project("Local")],
    list_portfolios: [],
    list_sources: [],
    list_agents: { agents: [], rechazados: [] },
    list_agent_status: [],
    list_mentions: { fuentes: [], archivos: [] },
    list_models: engine.list_models,
    list_surfaces: engine.list_surfaces,
    session_folder: "/tmp",
    list_task_trees: [],
    preview_tree_files: { paths: [], folders: [], truncated: false },
    task_history: engine.task_history,
    list_live_turns: [],
    list_active_turns: [],
    list_live_sessions: ({ project: p }) => (p === "p1" || p === "" ? [row("t1", "Tarea local")] : []),
    load_queue: [],
    save_queue: null,
    session_usage: null,
    list_session_git: {},
    turn_authors: { person: null, agent: null },
    service_filter: null,
    service_poll: () => sleep(40).then(() => ({ cursor: 1, gap: false, replay: false, runtime: "lab", reset: false })),
    machine_list: [{ id: "local", local: true, active: true, on: true, hosts: true }],
    set_active_workspace: null,
    send_message: () => "t1",
    create_project: ({ name }) => ({ id: "p8", name, working_directory: "/lab/p8", kind: "folder", sources: [] }),
    ...extra,
  };
  return Object.fromEntries(Object.entries(table).map(([k, v]) => [k, answer(k, v)]));
}

const SIGNED_IN = { state: "connected", computer_id: "cmp_home", name: "Mi Mac", online: true };
const TOKEN = () => ({ token: "client-tok", expires_at: Date.now() + 600_000, endpoint: "https://relay.test", computer_id: "cmp_home" });
const HOME = { computer_id: "cmp_home", name: "Mi Mac", state: "online", provider: "self", kind: "physical" };
const VM = { computer_id: "cmp_vm", name: "Danil VM", state: "stopped", provider: "aws-ec2" };
const MAC = { computer_id: "cmp_mac", name: "Mac de Ana", state: "offline", provider: "self", kind: "physical" };

async function open(name, { status = SIGNED_IN, token = TOKEN, computers = [HOME, VM, MAC], relays = {}, extra = {}, registry = null, onRename = null } = {}) {
  const f = fleet(relays);
  const calls = [];
  const listed = [];
  const registered = [];
  const renamed = [];
  const responses = local(calls, {
    danil_connect_status: status,
    ...(token ? { account_relay_token: token } : {}),
    ...extra,
  });
  const app = await boot("listo", name, responses, undefined, {}, {
    antes: () => {
      globalThis.WebSocket = f.Socket;
      const previous = globalThis.fetch;
      const fake = (url, init) => {
        if (String(url) === "https://relay.test/v1/workspaces") {
          registered.push(init?.headers?.authorization);
          return Promise.resolve(registry ? Response.json({ workspaces: registry }) : new Response("{}", { status: 404 }));
        }
        if (String(url).startsWith("https://relay.test/v1/computers/") && init?.method === "PATCH") {
          const id = decodeURIComponent(String(url).split("/").pop());
          const { name: given } = JSON.parse(init.body);
          renamed.push({ id, name: given, authorization: init.headers?.authorization, type: init.headers?.["content-type"] });
          const refused = onRename?.(id, given);
          if (refused) return Promise.resolve(Response.json({ error: { code: refused.code } }, { status: refused.status }));
          const at = computers.findIndex((c) => c.computer_id === id);
          if (at < 0) return Promise.resolve(Response.json({ error: { code: "not_found" } }, { status: 404 }));
          computers[at] = { ...computers[at], name: given.trim() };
          return Promise.resolve(Response.json({ computer_id: id, name: given.trim() }));
        }
        if (String(url).startsWith("https://relay.test/v1/computers")) {
          listed.push(init?.headers?.authorization);
          return Promise.resolve(new Response(JSON.stringify({ computers }), { status: 200, headers: { "content-type": "application/json" } }));
        }
        return previous(url, init);
      };
      fake.__jsdomApp = true;
      globalThis.fetch = fake;
    },
  });
  await sleep(2000);
  const invoke = (command, args, options) => app.w.__TAURI_INTERNALS__.invoke(command, args, options);
  const relayCalls = (id, command) => (f.relays[id]?.calls ?? []).filter((c) => c.command === command);
  const native = (command) => calls.filter((c) => c.command === command);
  return { app, f, invoke, relayCalls, native, listed, registered, renamed, doc: app.w.document, text: () => app.w.document.body.textContent ?? "" };
}

test("signed out, the desktop is the local window as before", async () => {
  const { app, f, doc, listed, invoke } = await open("desktop-account-signed-out", {
    status: { state: "disconnected", online: false },
    relays: { cmp_vm: { table: remote("Panel", "Tarea de la VM") } },
  });
  assert.ok(doc.querySelector('[data-sesion="t1"]'), "the local task is in the sidebar");
  assert.equal(doc.querySelector("[data-machine]"), null, "one machine: no badge");
  assert.equal(listed.length, 0, "the computers are never listed");
  assert.equal(f.relays.cmp_vm.sockets.length, 0, "no relay session opens");
  assert.ok(!app.comandos.includes("account_relay_token"), "no token is asked for");
  assert.deepEqual(await invoke("machine_list"), [{ id: "local", local: true, active: true, on: true, hosts: true }], "the window's own machine list");
  assert.deepEqual(app.fallos, []);
});

test("an engine without client tokens leaves the window local", async () => {
  const { app, f, doc, listed } = await open("desktop-account-old-engine", {
    token: null,
    relays: { cmp_vm: { table: remote("Panel", "Tarea de la VM") } },
  });
  assert.ok(doc.querySelector('[data-sesion="t1"]'));
  assert.equal(doc.querySelector("[data-machine]"), null);
  assert.equal(listed.length, 0);
  assert.equal(f.relays.cmp_vm.sockets.length, 0);
  assert.deepEqual(app.fallos, []);
});

const until = async (check, ms = 4000) => {
  for (let waited = 0; waited < ms; waited += 50) {
    if (check()) return true;
    await sleep(50);
  }
  return false;
};

async function write(app, message) {
  const field = app.w.document.querySelector("textarea");
  field.value = message;
  field.dispatchEvent(new app.w.Event("input", { bubbles: true }));
  field.closest("form").dispatchEvent(new app.w.Event("submit", { bubbles: true, cancelable: true }));
  await sleep(50);
}

async function openTask(app, id) {
  const row = app.w.document.querySelector(`[data-sesion="${id}"]`);
  assert.ok(row, `no row for ${id}`);
  row.click();
  await sleep(400);
}

/** A new task in folder P1, from the composer. */
/**
 * The «+» of this computer's «Local» group. Since f86188a a folder with tasks on
 * several machines is one group per machine («Local · Esta computadora»); this
 * one is `data-folder-machine=""`, or the only group when the folder is not split.
 */
function localNewTask(doc) {
  const group = doc.querySelector('[data-folder-machine=""]') ?? doc.querySelector("[data-folder-group]:not([data-folder-machine])");
  return group?.querySelector('[aria-label^="Nueva tarea en Local"]');
}

async function newTask(app) {
  const doc = app.w.document;
  [...doc.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith("Nueva tarea"))?.click();
  await sleep(300);
  doc.querySelector('button[aria-label="Proyecto"]').click();
  // Inside the picker: the sidebar has its own «P1» button too (the folder's group).
  const option = () => [...doc.querySelectorAll("[role=dialog] button")].find((b) => b.textContent?.trim().startsWith("Local") || b.textContent?.trim().startsWith("P1"));
  assert.ok(await until(() => option()), "the folder picker opens");
  option().click();
  await sleep(300);
}

const reread = async (app) => {
  app.w.dispatchEvent(new app.w.CustomEvent("harness:tasks-changed"));
  await sleep(700);
};

test("signed in, the tasks of every machine show together; a VM task's actions go to the VM by its envelope", async () => {
  const { app, doc, text, listed, relayCalls, native } = await open("desktop-account-machines", {
    relays: {
      cmp_vm: { table: remote("Panel", "Tarea de la VM"), state: "online" },
      cmp_mac: { table: remote("Notas", "Tarea del Mac"), state: "online" },
    },
  });
  assert.deepEqual(listed, ["Bearer client-tok"], "the computers are listed with the engine's client token");
  assert.equal(doc.querySelectorAll("[data-machine-toast]").length, 0, "a machine found on says nothing");
  assert.ok(text().includes("Tarea local") && text().includes("Tarea de la VM") && text().includes("Tarea del Mac"));
  assert.ok(doc.querySelector('[data-sesion="t1"]'), "the local task keeps its id");
  assert.ok(doc.querySelector('[data-sesion="cmp_vm~t1"]'), "the VM task has its namespaced id");
  assert.ok(doc.querySelector('[data-sesion="cmp_mac~t1"]'));
  // Since #294 a row says its machine only when the task runs on another one.
  assert.equal(doc.querySelector('[data-sesion="t1"] [data-machine]'), null, "a local task's row names no machine");
  assert.equal(doc.querySelector('[data-sesion="cmp_vm~t1"] [data-machine]')?.getAttribute("data-machine"), "cmp_vm", "the VM task's row names the VM");
  assert.equal(doc.querySelector('[data-sesion="cmp_mac~t1"] [data-machine]')?.getAttribute("data-machine"), "cmp_mac");
  assert.ok(relayCalls("cmp_vm", "list_projects").some((c) => c.workspace === "w"), "the VM reads its own workspace");
  assert.ok(native("list_projects").length > 0, "the local engine still answers through the window");

  await openTask(app, "cmp_vm~t1");
  assert.deepEqual(relayCalls("cmp_vm", "load_session").map((c) => c.args.id), ["t1"], "the VM's task opens from the VM, with its own id");
  await write(app, "hola VM");
  assert.ok(await until(() => relayCalls("cmp_vm", "send_message").length === 1), "the message reaches the VM");
  assert.equal(relayCalls("cmp_vm", "send_message")[0].args.session, "t1");
  assert.equal(native("send_message").length, 0, "the VM's message never reaches the local engine");
  assert.equal(relayCalls("cmp_mac", "send_message").length, 0);

  await openTask(app, "t1");
  await write(app, "hola aquí");
  assert.ok(await until(() => native("send_message").length === 1), "a local task stays native");
  assert.equal(native("send_message")[0].args.session, "t1");
  assert.equal(relayCalls("cmp_vm", "send_message").length, 1);
  assert.deepEqual(app.fallos, []);
});

test("the account and danil_* stay on this computer, and whoAmI asks for the window's workspace by name", async () => {
  const { app, relayCalls, native } = await open("desktop-account-own-commands", {
    relays: { cmp_vm: { table: remote("Panel", "Tarea de la VM", { list_accounts: { accounts: [], active: null } }), state: "online" } },
    extra: {
      danil_sessions: [{ account: "4", email: "ana@danil.ai", name: "Ana", photo: null, computer_id: "cmp_home", default: true, workspaces: ["w"], status: "connected", online: true }],
      danil_workspace_account: { account: "4", email: "ana@danil.ai", signed_in: true, linked: true },
      list_accounts: { accounts: [], active: null },
    },
  });
  assert.ok(native("danil_workspace_account").some((c) => c.args?.workspace === "w"), "the account is the one of the window's workspace, asked by name");
  for (const command of ["list_accounts", "danil_sessions", "danil_workspace_account", "account_relay_token"]) assert.equal(relayCalls("cmp_vm", command).length, 0, `${command} never leaves this computer`);
  assert.deepEqual(app.fallos, []);
});

test("a new task is born on this computer unless «Ejecutar en» picks another for the workspace", async () => {
  const { app, relayCalls, native } = await open("desktop-account-run-on", {
    relays: {
      cmp_vm: { table: remote("Panel", "Tarea de la VM", { send_message: () => "r7" }), state: "online" },
      cmp_mac: { table: remote("Notas", "Tarea del Mac"), state: "online" },
    },
    extra: { work_status: { ahead: 0, dirty: false, files: [], large: [], submodules: [] } },
  });
  await newTask(app);
  await write(app, "aquí");
  assert.ok(await until(() => native("send_message").length === 1), "without a pick, the task is born on the window's machine");
  assert.equal(relayCalls("cmp_vm", "send_message").length, 0);

  const doc = app.w.document;
  localNewTask(doc).click();
  assert.ok(await until(() => doc.querySelector('[aria-label="Ejecutar en"]')), "the composer offers «Ejecutar en»");
  doc.querySelector('[aria-label="Ejecutar en"]').click();
  assert.ok(await until(() => doc.querySelector('[data-machine-option="cmp_vm"]')), "the picker lists the account's machines");
  doc.querySelector('[data-machine-option="cmp_vm"]').click();
  await sleep(200);
  await write(app, "en la VM");
  assert.ok(await until(() => relayCalls("cmp_vm", "send_message").length === 1), "the picked machine gets it");
  assert.deepEqual(relayCalls("cmp_vm", "send_message").map((c) => [c.args.project, c.args.session, c.workspace]), [["p1", null, "w"]], "with the same project and workspace ids");
  assert.equal(native("send_message").length, 1, "nothing more is born on this computer");
  assert.equal(JSON.parse(app.w.localStorage.getItem("harness.layout.machines.run_on")).w, "cmp_vm", "«Ejecutar en» is remembered for this workspace");
  assert.equal(app.w.localStorage.getItem("terminus-web:computer"), null, "no global last machine decides for another workspace");
  assert.deepEqual(app.fallos, []);
});

test("the task card says its machine, and the folder chip adds no native tooltip", async () => {
  const { app, doc } = await open("desktop-account-hover", {
    relays: {
      cmp_vm: { table: remote("Panel", "Tarea de la VM"), state: "online" },
      cmp_mac: { table: remote("Notas", "Tarea del Mac"), state: "offline", cachedAt: "2026-10-18T21:30:00Z" },
    },
  });
  const fila = doc.querySelector('[data-sesion="cmp_mac~t1"]');
  assert.ok(fila);
  assert.equal(fila.querySelector("[data-folder-chip]")?.getAttribute("title") ?? null, null, "no native title over the card");
  fila.closest("[data-sesion]").parentElement.dispatchEvent(new app.w.PointerEvent("pointerenter", { pointerType: "mouse" }));
  await sleep(900);
  const machine = doc.querySelector('[data-hover-machine="cmp_mac"]');
  assert.ok(machine, "the card has a machine row");
  assert.ok(machine.parentElement.parentElement.textContent.includes("Máquina"));
  assert.ok(machine.parentElement.textContent.includes("Mac de Ana"));
  assert.equal(machine.getAttribute("aria-label"), "apagada");
  // Una tarea de esta computadora también dice su máquina: con varias, no se adivina.
  const local = [...doc.querySelectorAll("[data-sesion]")].find((el) => !el.getAttribute("data-sesion").includes("~"));
  assert.ok(local, "there is a task of this computer");
  local.parentElement.dispatchEvent(new app.w.PointerEvent("pointerenter", { pointerType: "mouse" }));
  await sleep(900);
  const aqui = [...doc.querySelectorAll("[data-hover-machine]")].find((el) => !el.getAttribute("data-hover-machine").startsWith("cmp_vm") && el.getAttribute("data-hover-machine") !== "cmp_mac");
  assert.ok(aqui, "the card of a local task has a machine row");
  assert.ok(aqui.parentElement.textContent.includes("Mi Mac"), "its name in the account, not «Esta Mac»");
  assert.equal(aqui.getAttribute("aria-label"), "encendida");
  assert.deepEqual(app.fallos, []);
});

test("an action wakes the VM; a physical machine that is off is never started", async () => {
  const { app, doc, relayCalls, text } = await open("desktop-account-off", {
    relays: {
      cmp_vm: { table: remote("Panel", "Tarea de la VM"), state: "stopped", cachedAt: "2026-10-18T21:30:00Z" },
      cmp_mac: { table: remote("Notas", "Tarea del Mac"), state: "offline", cachedAt: "2026-10-18T21:30:00Z", notStartable: true },
    },
  });
  assert.ok(doc.querySelector('[data-sesion="cmp_vm~t1"]'), "the VM's copy shows");
  assert.equal(relayCalls("cmp_vm", "send_message").length, 0, "opening the app never starts it");

  await openTask(app, "cmp_mac~t1");
  await write(app, "hola Mac");
  await sleep(500);
  // The sentence it fails with is checked in `machine-router.test.ts`.
  assert.equal(relayCalls("cmp_mac", "send_message").length, 0, "nothing tries to start the person's own machine");

  await openTask(app, "cmp_vm~t1");
  await write(app, "hola VM");
  assert.ok(await until(() => relayCalls("cmp_vm", "send_message").length === 1, 3000), "the action wakes the VM and is delivered");
  await sleep(300);
  assert.equal(relayCalls("cmp_vm", "send_message").length, 1, "once");
  const toasts = [...doc.querySelectorAll("[data-machine-toast]")].map((n) => n.textContent);
  assert.ok(toasts.some((x) => x.includes("Danil VM se encendió")), `a toast says it turned on: ${toasts}`);
  assert.ok(!text().includes("Algo se rompió"), "no generic failure");
  assert.deepEqual(app.fallos, []);
});

test("with another machine in «Ejecutar en», a clone runs there with start_project_clone", async () => {
  const status = new Map();
  const panel = { id: "p7", name: "panel", working_directory: "/home/danil/code/panel", kind: "git", portfolio: null, sources: [] };
  const { app, f, doc, text, relayCalls, native } = await open("desktop-account-clone", {
    computers: [HOME, { ...VM, state: "online" }],
    relays: {
      cmp_vm: {
        table: remote("Panel", "Tarea de la VM", {
          get_project_directory: "/home/danil/code",
          start_project_clone: ({ operation }) => {
            status.set(operation, { workspace: "w", operation, phase: "waiting", percent: null, done: false });
            return { operation };
          },
          project_clone_status: ({ operation }) => status.get(operation) ?? null,
        }),
      },
    },
    extra: { list_project_repositories: [], list_git_hosts: [], get_project_directory: "/Users/ana/Documents" },
  });
  app.w.localStorage.setItem("harness.layout.machines.run_on", JSON.stringify({ w: "cmp_vm" }));
  const button = (label) => [...doc.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith(label));
  doc.querySelector('button[aria-label="Proyecto"]').click();
  await sleep(300);
  button("Añadir un proyecto").click();
  await sleep(400);
  assert.ok(!text().includes("Explorar carpeta"), "no native folder dialog for another machine");
  button("Git URL").click();
  await sleep(400);
  assert.ok(text().includes("/home/danil/code") && !text().includes("/Users/ana/Documents"), "the destination is the VM's projects folder");
  const input = doc.querySelector('input[placeholder="https://github.com/organizacion/repo"]');
  Object.getOwnPropertyDescriptor(app.w.HTMLInputElement.prototype, "value").set.call(input, "https://github.com/danil/panel.git");
  input.dispatchEvent(new app.w.Event("input", { bubbles: true }));
  await sleep(50);
  button("Clonar").click();
  await sleep(500);
  const started = relayCalls("cmp_vm", "start_project_clone").at(-1);
  assert.ok(started, "the clone goes to the VM");
  assert.equal(native("clone_project").length + native("start_project_clone").length, 0, "this Mac does not clone it");
  const operation = started.args.operation;
  const report = (event) => {
    status.set(operation, { workspace: "w", operation, percent: null, done: false, ...event });
    f.relays.cmp_vm.push({ type: "events", cursor: Date.now(), gap: false, replay: false, runtime: "rt1", events: [{ name: "project_clone", payload: status.get(operation) }] });
  };
  report({ phase: "receiving", percent: 55 });
  await sleep(400);
  assert.ok(text().includes("Recibiendo objetos") && text().includes("55 %"), "the VM's progress shows in the window");
  report({ phase: "done", done: true, project: panel });
  await sleep(600);
  assert.ok(!text().includes("Recibiendo objetos"), "the clone ended");
  assert.equal(app.w.localStorage.getItem("harness.layout.projects.remote_clones"), null);
  assert.deepEqual(app.fallos, []);
});

test("a workspace of the account that only another machine has lists with the window's own", async () => {
  const registry = [
    { id: "w2", name: "Producto", projects: [{ id: "p5", name: "Aplicación", remote_url: "https://github.com/ana/app", home_computer_id: "cmp_vm" }], computers: ["cmp_vm"] },
  ];
  const { app, doc, registered, relayCalls } = await open("desktop-account-registry", {
    computers: [HOME, VM],
    registry,
    relays: { cmp_vm: { table: remote("Panel", "Tarea de la VM"), state: "offline" } },
  });
  assert.ok(registered.includes("Bearer client-tok"), "the registry is read with the client token");
  const menu = doc.querySelector("[data-workspace-name]");
  menu?.dispatchEvent(new app.w.PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }));
  menu?.click();
  assert.ok(await until(() => doc.querySelector('[data-workspace-option="w2"]')), "the account's workspace is in the switcher");
  assert.ok(doc.querySelector('[data-workspace-option="w"]'), "next to the window's own");
  assert.ok(doc.querySelector('[data-sesion="t1"]'), "and the window stays in its own");
  assert.equal(relayCalls("cmp_vm", "send_message").length, 0, "reading wakes nothing");
  assert.deepEqual(app.fallos, []);
});

test("a tab of another machine's task never moves this computer's reads, and an off machine without a copy never holds them", async () => {
  const VM2 = { computer_id: "cmp_vm2", name: "VM 2", state: "offline", provider: "aws-ec2" };
  const { app, doc, relayCalls, native } = await open("desktop-account-open-tabs", {
    computers: [HOME, { ...VM, state: "online" }, VM2],
    relays: {
      cmp_vm: { table: remote("Panel", "Tarea de la VM"), state: "online" },
      // Off and never read: neither the relay nor the window has a copy of it.
      cmp_vm2: { table: remote("Panel", "Tarea de la VM 2"), state: "offline" },
    },
  });
  await openTask(app, "cmp_vm~t1");
  await reread(app);
  const opens = native("list_live_sessions").map((c) => c.args.open ?? []);
  assert.ok(opens.length > 0);
  assert.ok(opens.every((open) => open.every((id) => !id.includes("~"))), `this computer only gets its own open tasks: ${JSON.stringify(opens.at(-1))}`);
  assert.ok(relayCalls("cmp_vm", "list_live_sessions").some((c) => (c.args.open ?? []).includes("t1")), "the VM gets its own, with its ids");
  assert.ok(doc.querySelector('[data-sesion="t1"]') && doc.querySelector('[data-sesion="cmp_vm~t1"]'), "both lists stay");
  assert.equal(relayCalls("cmp_vm2", "list_live_sessions").every((c) => !(c.args.open ?? []).length), true, "the off VM gets no other machine's tab");
  assert.deepEqual(relayCalls("cmp_vm2", "send_message"), [], "reading wakes nothing");
  assert.deepEqual(app.fallos, []);
});

test("this computer's tasks paint without waiting for a VM that does not answer", async () => {
  const started = Date.now();
  const { app, doc, f, relayCalls } = await open("desktop-account-slow", {
    computers: [HOME, { ...VM, state: "online" }],
    relays: { cmp_vm: { table: remote("Panel", "Tarea de la VM"), state: "online", delay: 600_000 } },
  });
  assert.ok(doc.querySelector('[data-sesion="t1"]'), "the local task is in the sidebar");
  assert.equal(doc.querySelector('[data-sesion="cmp_vm~t1"]'), null, "the silent VM adds nothing");
  assert.ok(Date.now() - started < 8_000, "nothing waited on the VM");
  assert.ok(relayCalls("cmp_vm", "list_live_sessions").length > 0, "the VM was asked");
  assert.equal(f.relays.cmp_vm.sockets.length, 1);
  assert.deepEqual(app.fallos, []);
});

test("a VM that stops answering, or turns off without a copy, keeps its last slice: never an invented empty list", async () => {
  const { app, doc, f } = await open("desktop-account-no-answer", {
    computers: [HOME, { ...VM, state: "online" }],
    relays: { cmp_vm: { table: remote("Panel", "Tarea de la VM"), state: "online" } },
  });
  assert.ok(doc.querySelector('[data-sesion="cmp_vm~t1"]'), "the VM's task shows");
  f.relays.cmp_vm.setDelay(600_000);
  await reread(app);
  // Longer than any wait of the window: the old fan-out dropped the VM after 6 s and the list lost its rows.
  await sleep(7_000);
  await reread(app);
  assert.ok(doc.querySelector('[data-sesion="cmp_vm~t1"]'), "a VM that does not answer keeps its rows");
  f.relays.cmp_vm.setDelay(0);
  f.relays.cmp_vm.setState("offline");
  await reread(app);
  await sleep(1_600);
  await reread(app);
  assert.ok(doc.querySelector('[data-sesion="cmp_vm~t1"]'), "off with no relay copy, the window's own copy stays");
  assert.ok(doc.querySelector('[data-sesion="t1"]'));
  const cache = JSON.parse(app.w.localStorage.getItem("harness:shell-cache") ?? "null");
  const rows = cache ? Object.values(JSON.parse(cache.workspaces.w.snapshot).sessions).flat() : [];
  assert.ok(!cache || rows.some((r) => r.id === "cmp_vm~t1"), "the sidebar photo keeps the VM's rows too");
  assert.deepEqual(app.fallos, []);
});

test("a machine renamed in the account changes live, without reconnecting the others", async () => {
  const computers = [HOME, { ...VM, state: "online" }, { ...MAC, state: "online" }];
  const { app, doc, f } = await open("desktop-account-rename", {
    computers,
    relays: {
      cmp_vm: { table: remote("Panel", "Tarea de la VM"), state: "online" },
      cmp_mac: { table: remote("Notas", "Tarea del Mac"), state: "online" },
    },
  });
  computers[1] = { ...computers[1], name: "VM de trabajo" };
  app.w.dispatchEvent(new app.w.CustomEvent("harness:workspace"));
  await sleep(1_200);
  const fila = doc.querySelector('[data-sesion="cmp_vm~t1"]');
  assert.ok(fila, "the VM's tasks are still there");
  fila.closest("[data-sesion]").parentElement.dispatchEvent(new app.w.PointerEvent("pointerenter", { pointerType: "mouse" }));
  await sleep(900);
  assert.ok(doc.querySelector('[data-hover-machine="cmp_vm"]')?.parentElement.textContent.includes("VM de trabajo"), "the new name shows");
  assert.equal(f.relays.cmp_vm.sockets.length, 1, "the renamed machine was not reconnected");
  assert.equal(f.relays.cmp_mac.sockets.length, 1, "nor the others");
  assert.deepEqual(app.fallos, []);
});

const SESSION_A = { account: "u_alberto", email: "alberto@danil.ai", name: "Alberto", photo: null, computer_id: "cmp_home", computer_name: "Mi Mac", default: true, workspaces: [], status: "connected", online: true };
const SESSION_B = { ...SESSION_A, account: "u_fdb", email: "alberto@dondebanco.org", computer_id: "cmp_home_fdb", default: false, workspaces: ["w"] };

test("with one session per account, the open workspace talks as its own account", async () => {
  const asked = [];
  const { app, native, listed, relayCalls } = await open("desktop-account-per-workspace", {
    computers: [{ ...HOME, computer_id: "cmp_home_fdb" }, { ...VM, state: "online" }],
    relays: { cmp_vm: { table: remote("Panel", "Tarea de la VM"), state: "online" } },
    token: null,
    extra: {
      danil_sessions: [SESSION_A, SESSION_B],
      danil_workspace_account: { account: "u_fdb", email: "alberto@dondebanco.org", signed_in: true, linked: true },
      account_relay_token: (args) => {
        asked.push(args?.account ?? null);
        return { ...TOKEN(), token: `tok-${args?.account ?? "default"}`, computer_id: "cmp_home_fdb" };
      },
    },
  });
  assert.ok(asked.length > 0 && asked.every((a) => a === "u_fdb"), `the client token is the workspace's account: ${asked}`);
  assert.deepEqual(listed, ["Bearer tok-u_fdb"], "its computers, not the default account's");
  assert.equal(native("danil_connect_status").length, 0, "the sessions say who this computer is");
  assert.ok(relayCalls("cmp_vm", "list_projects").length > 0, "the account's VM is in the window");
  assert.deepEqual(app.fallos, []);
});

test("a workspace whose account is signed out here keeps the window local", async () => {
  const { app, f, listed } = await open("desktop-account-signed-out-workspace", {
    relays: { cmp_vm: { table: remote("Panel", "Tarea de la VM"), state: "online" } },
    extra: {
      danil_sessions: [SESSION_A],
      danil_workspace_account: { account: "u_ytw", email: "alberto@yucatantechweek.mx", signed_in: false, linked: false },
    },
  });
  assert.equal(listed.length, 0, "no other account's computers");
  assert.equal(f.relays.cmp_vm.sockets.length, 0);
  assert.ok(!app.comandos.includes("account_relay_token"), "no token of another account is asked for");
  assert.deepEqual(app.fallos, []);
});

test("the session says which contract this window speaks; a VM on another one is outdated until its engine says hello with this one", async () => {
  const { app, doc, f, relayCalls } = await open("desktop-account-contract", {
    computers: [HOME, { ...VM, state: "online" }],
    relays: { cmp_vm: { table: remote("Panel", "Tarea de la VM"), state: "online", contract: "otro-contrato" } },
  });
  const spoken = new URL(f.relays.cmp_vm.sockets[0].url.replace(/^ws/, "http")).searchParams.get("contracts");
  assert.ok(spoken, "the session URL carries the window's contract");
  assert.ok(doc.querySelector('[data-sesion="t1"]'), "this computer's tasks are there");
  assert.equal(doc.querySelector('[data-sesion="cmp_vm~t1"]'), null, "an engine on another contract adds nothing");
  assert.ok(relayCalls("cmp_vm", "send_message").length === 0);
  f.relays.cmp_vm.hello(spoken.split(",")[0]);
  await reread(app);
  await sleep(1_600);
  await reread(app);
  assert.ok(doc.querySelector('[data-sesion="cmp_vm~t1"]'), "with this contract it is back without reconnecting");
  assert.equal(f.relays.cmp_vm.sockets.length, 1);
  assert.deepEqual(app.fallos, []);
});

test("when the relay stops the sessions for lack of a Terminus license, the VM keeps its rows and nothing reconnects in a loop", async () => {
  const { app, doc, f } = await open("desktop-account-license", {
    computers: [HOME, { ...VM, state: "online" }],
    relays: { cmp_vm: { table: remote("Panel", "Tarea de la VM"), state: "online" } },
  });
  assert.ok(doc.querySelector('[data-sesion="cmp_vm~t1"]'));
  const asked = f.relays.cmp_vm.calls.length;
  f.relays.cmp_vm.drop(4003, "license_required");
  await sleep(300);
  await reread(app);
  await sleep(2_500);
  assert.equal(f.relays.cmp_vm.sockets.length, 1, "no reconnection loop");
  assert.equal(f.relays.cmp_vm.calls.length, asked, "nothing more is asked of the VM");
  assert.ok(doc.querySelector('[data-sesion="cmp_vm~t1"]'), "its rows stay");
  assert.ok(doc.querySelector('[data-sesion="t1"]'), "this computer is untouched");
  assert.deepEqual(app.fallos, []);
});

test("a machine just connected to the account adds its slice live, without reconnecting the others", async () => {
  const computers = [HOME, { ...VM, state: "online" }];
  const { app, doc, f } = await open("desktop-account-connected", {
    computers,
    relays: {
      cmp_vm: { table: remote("Panel", "Tarea de la VM"), state: "online" },
      cmp_mac: { table: remote("Notas", "Tarea del Mac"), state: "online" },
    },
  });
  assert.equal(doc.querySelector('[data-sesion="cmp_mac~t1"]'), null);
  computers.push({ ...MAC, state: "online" });
  app.w.dispatchEvent(new app.w.CustomEvent("harness:account-computers"));
  await sleep(1_200);
  await reread(app);
  assert.ok(doc.querySelector('[data-sesion="cmp_mac~t1"]'), "the new machine's tasks join");
  assert.equal(f.relays.cmp_vm.sockets.length, 1, "the VM was not reconnected");
  assert.deepEqual(app.fallos, []);
});

test("Cuenta de Danil lists the account's computers; a name edited in place reaches «Ejecutar en» without restarting", async () => {
  const seen = new Date(Date.now() - 60_000).toISOString();
  const computers = [HOME, { ...VM, state: "online" }, { ...MAC, state: "offline", last_seen: seen }];
  const { app, doc, f, renamed } = await open("desktop-account-computers", {
    computers,
    relays: {
      cmp_vm: { table: remote("Panel", "Tarea de la VM"), state: "online" },
      cmp_mac: { table: remote("Notas", "Tarea del Mac"), state: "online" },
    },
    onRename: (_, name) => (name.includes("!") ? { status: 400, code: "invalid_name" } : null),
    extra: { work_status: { ahead: 0, dirty: false, files: [], large: [], submodules: [] } },
  });
  const w = app.w;
  w.dispatchEvent(new w.CustomEvent("harness:open-settings", { detail: "cuenta-danil" }));
  assert.ok(await until(() => doc.querySelectorAll("[data-account-computer]").length === 3), "the three computers of the account");
  const rowOf = (id) => doc.querySelector(`[data-account-computer="${id}"]`);
  const home = rowOf("cmp_home");
  assert.ok(home.hasAttribute("data-self"));
  assert.ok(home.textContent.includes("Mi Mac(esta computadora)"), home.textContent);
  assert.match(home.querySelector("[data-computer-kind]").textContent, /^Esta (Mac|PC)$/);
  assert.equal(rowOf("cmp_vm").querySelector("[data-computer-kind]").textContent, "VM de Danil");
  assert.equal(rowOf("cmp_vm").querySelector("[data-computer-state]").textContent, "en línea");
  assert.equal(rowOf("cmp_mac").querySelector("[data-computer-kind]").textContent, "Máquina propia");
  assert.match(rowOf("cmp_mac").querySelector("[data-computer-state]").textContent, /^apagada · visto \d{1,2}:\d{2}/);

  const edit = async (id, value, key = null) => {
    rowOf(id).querySelector("[data-computer-name]")?.click();
    assert.ok(await until(() => rowOf(id).querySelector("[data-computer-name-input]")), "the name turns into a field");
    const input = rowOf(id).querySelector("[data-computer-name-input]");
    input.value = value;
    input.dispatchEvent(new w.Event("input", { bubbles: true }));
    if (key) input.dispatchEvent(new w.KeyboardEvent("keydown", { key, bubbles: true }));
    else input.form.requestSubmit();
    await sleep(300);
  };

  // Esc cancels without asking the control plane, and Configuración stays open.
  await edit("cmp_vm", "Otra cosa", "Escape");
  assert.equal(rowOf("cmp_vm").querySelector("[data-computer-name-input]"), null);
  assert.ok(rowOf("cmp_vm").textContent.includes("Danil VM"));
  assert.equal(renamed.length, 0);

  // A refused name says why and keeps the field.
  await edit("cmp_vm", "VM!");
  assert.equal(renamed.length, 1);
  assert.equal(rowOf("cmp_vm").querySelector("[data-rename-error]")?.textContent, "El nombre debe tener de 1 a 60 caracteres, sin saltos de línea.");
  assert.ok(rowOf("cmp_vm").querySelector("[data-computer-name-input]"), "the field stays to fix it");

  await edit("cmp_vm", "  VM de trabajo ");
  assert.deepEqual(renamed.at(-1), { id: "cmp_vm", name: "VM de trabajo", authorization: "Bearer client-tok", type: "application/json" });
  assert.ok(await until(() => rowOf("cmp_vm").querySelector("[data-computer-name]")?.textContent.startsWith("VM de trabajo")), "the row shows the new name");
  assert.equal(rowOf("cmp_vm").querySelector("[data-rename-error]"), null);

  // The window's own name, also in «Esta computadora: …».
  await edit("cmp_home", "Mac del estudio");
  assert.ok(await until(() => doc.body.textContent.includes("Esta computadora: Mac del estudio")));

  await sleep(1_200);
  doc.querySelector('[aria-label="Cerrar configuración (Esc)"]').click();
  assert.ok(await until(() => !doc.querySelector("[data-danil-account]")), "Configuración closes");
  localNewTask(doc).click();
  assert.ok(await until(() => doc.querySelector('[aria-label="Ejecutar en"]')), "the composer offers «Ejecutar en»");
  doc.querySelector('[aria-label="Ejecutar en"]').click();
  assert.ok(
    await until(() => doc.querySelector('[data-machine-option="cmp_vm"]')?.textContent.includes("VM de trabajo")),
    doc.querySelector('[data-machine-option="cmp_vm"]')?.textContent ?? "no option",
  );
  assert.equal(f.relays.cmp_vm.sockets.length, 1, "renaming does not reconnect the machine");
  assert.deepEqual(app.fallos, []);
});
