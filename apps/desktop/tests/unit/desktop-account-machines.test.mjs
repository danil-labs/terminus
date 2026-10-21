/**
 * The desktop signed in to the Danil account shows the tasks of every computer
 * of the person, as the web does: its own engine stays on the native IPC with
 * its ids, each other computer is a relay session, and workspaces and projects
 * have the same id on all of them. Signed out, nothing changes.
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

async function open(name, { status = SIGNED_IN, token = TOKEN, computers = [HOME, VM, MAC], relays = {}, extra = {}, registry = null } = {}) {
  const f = fleet(relays);
  const calls = [];
  const listed = [];
  const registered = [];
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
  return { app, f, invoke, relayCalls, native, listed, registered, doc: app.w.document, text: () => app.w.document.body.textContent ?? "" };
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

test("signed in, the tasks of every machine show together, each with its machine", async () => {
  const { app, doc, text, invoke, listed, relayCalls, native } = await open("desktop-account-machines", {
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
  assert.equal(doc.querySelector("[data-sesion] [data-machine]"), null, "a sidebar row leaves its machine to the task card");
  assert.ok(relayCalls("cmp_vm", "list_projects").some((c) => c.workspace === "w"), "the VM reads its own workspace");
  assert.equal(native("list_projects").length > 0, true, "the local engine still answers through the window");

  const machines = await invoke("machine_list");
  assert.deepEqual(machines.map((m) => [m.id, m.local, m.active]), [["cmp_home", true, true], ["cmp_vm", false, false], ["cmp_mac", false, false]], "«Ejecutar en» starts on this computer");

  // Local actions stay native; the VM's go through its relay session with its own ids.
  assert.equal(await invoke("send_message", { session: "t1", text: "hola" }), "t1");
  assert.equal(native("send_message").length, 1);
  assert.equal(await invoke("send_message", { session: "cmp_vm~t1", text: "hola" }), "cmp_vm~t1");
  assert.deepEqual(relayCalls("cmp_vm", "send_message").map((c) => c.args.session), ["t1"]);
  assert.equal(native("send_message").length, 1, "the VM's message never reaches the local engine");
  assert.equal(relayCalls("cmp_mac", "send_message").length, 0);

  const made = await invoke("create_project", { name: "Nuevo" }, { headers: { "x-terminus-machine": "cmp_vm" } });
  assert.equal(made.id, "p9", "the picked machine makes it, and its id is the same everywhere");
  assert.equal(relayCalls("cmp_vm", "create_project").length, 1);
  assert.equal(native("create_project").length, 0);
  assert.equal((await invoke("machine_list")).find((m) => m.active)?.id, "cmp_vm", "then the last machine used is the default");
  assert.deepEqual(app.fallos, []);
});

test("a task of a project of this computer, with the VM chosen in «Ejecutar en», is born on the VM", async () => {
  const { app, invoke, relayCalls, native } = await open("desktop-account-run-on", {
    relays: {
      cmp_vm: { table: remote("Panel", "Tarea de la VM", { send_message: () => "r7" }), state: "online" },
      cmp_mac: { table: remote("Notas", "Tarea del Mac"), state: "online" },
    },
  });
  const projects = await invoke("list_projects");
  assert.deepEqual(projects.map((p) => [p.id, p.machines]), [["p1", ["cmp_home", "cmp_vm", "cmp_mac"]]], "one project, the same id on every machine");
  const sent = native("send_message").length;
  const id = await invoke("send_message", { project: "p1", session: null, prompt: "hola" }, { headers: { "x-terminus-machine": "cmp_vm" } });
  assert.equal(id, "cmp_vm~r7", "the task is the VM's");
  assert.deepEqual(relayCalls("cmp_vm", "send_message").map((c) => [c.args.project, c.workspace]), [["p1", "w"]], "with the same project and workspace ids");
  assert.equal(native("send_message").length, sent, "nothing is born on this computer");
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
  assert.deepEqual(app.fallos, []);
});

test("an action wakes the VM; a physical machine that is off says so, neutral", async () => {
  const { app, doc, invoke, relayCalls } = await open("desktop-account-off", {
    relays: {
      cmp_vm: { table: remote("Panel", "Tarea de la VM"), state: "stopped", cachedAt: "2026-10-18T21:30:00Z" },
      cmp_mac: { table: remote("Notas", "Tarea del Mac"), state: "offline", cachedAt: "2026-10-18T21:30:00Z", notStartable: true },
    },
  });
  assert.ok(doc.querySelector('[data-sesion="cmp_vm~t1"]'), "the VM's copy shows");
  assert.equal(relayCalls("cmp_vm", "send_message").length, 0, "opening the app never starts it");

  await assert.rejects(invoke("send_message", { session: "cmp_mac~t1", text: "hola" }), (e) => {
    assert.equal(e.what, "Mac de Ana está apagada. Enciéndela para seguir.");
    return true;
  });
  assert.equal(relayCalls("cmp_mac", "send_message").length, 0, "nothing tries to start the person's own machine");

  assert.equal(await invoke("send_message", { session: "cmp_vm~t1", text: "hola" }), "cmp_vm~t1", "the action wakes the VM and is delivered");
  assert.equal(relayCalls("cmp_vm", "send_message").length, 1);
  await sleep(100);
  const toasts = [...doc.querySelectorAll("[data-machine-toast]")].map((n) => n.textContent);
  assert.ok(toasts.some((x) => x.includes("Danil VM se encendió")), `a toast says it turned on: ${toasts}`);
  assert.ok(!doc.body.textContent.includes("Algo se rompió"), "no generic failure");
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

test("signed in, a workspace of the account whose machine is asleep lists with the window's own", async () => {
  const registry = [
    { id: "w2", name: "Producto", projects: [{ id: "p5", name: "Aplicación", remote_url: "https://github.com/ana/app", home_computer_id: "cmp_vm" }], computers: ["cmp_vm"] },
  ];
  const { app, invoke, registered, relayCalls } = await open("desktop-account-registry", {
    computers: [HOME, VM],
    registry,
    relays: { cmp_vm: { table: remote("Panel", "Tarea de la VM"), state: "offline" } },
  });
  const startup = await invoke("list_workspaces");
  assert.deepEqual(startup.workspaces.map((w) => [w.id, w.machines]), [["w", ["cmp_home"]], ["w2", ["cmp_vm"]]], "the account's workspace joins the local ones");
  assert.equal(startup.active, "w", "the window stays in its own");
  assert.ok(registered.includes("Bearer client-tok"), "the registry is read with the client token");
  assert.equal(relayCalls("cmp_vm", "send_message").length, 0, "reading wakes nothing");
  assert.deepEqual(app.fallos, []);
});
