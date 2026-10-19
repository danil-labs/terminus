/**
 * One panel over every computer of the person: the browser build opens a relay
 * session per computer, joins their projects and tasks (each with its machine
 * and ids that cannot collide), sends each command to the machine it names,
 * fails short and neutral on a computer that is off and cannot be woken, leaves
 * out one that speaks another contract, and groups AI accounts by provider and
 * email. Mounts `dist-web/`.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { engine, fleet } from "../helpers/fake-relay.mjs";
import { boot, sleep } from "../helpers/jsdom-app.mjs";

const SAME = { id: "w", name: "W", context_root: null, provider: "github", remote: "danil/panel" };
const row = (id, title) => ({ id, title, last_message: "", agent: "codex", model: "gpt-5.6", refs: [], updated_at: 0, turns: 0, parent: null, esperando: false });
const account = (id, identity, label = "Cuenta 1") => ({ id, label, created_at: 0, identity, authenticated_at: 1 });

/** The same raw ids on both machines: only the namespace keeps them apart. */
function table(project, task, extra = {}) {
  return {
    ...engine,
    list_workspaces: { workspaces: [SAME], active: "w" },
    workspaces_startup: { workspaces: [SAME], active: "w" },
    list_projects: [{ id: "p1", name: project, working_directory: "/lab/p1", kind: "git", portfolio: null, sources: [] }],
    list_live_sessions: ({ project: p }) => (p === "p1" ? [row("t1", task)] : []),
    send_message: () => "t1",
    create_project: ({ name }) => ({ id: "p9", name, working_directory: "/lab/p9", kind: "folder", sources: [] }),
    remove_account: true,
    ...extra,
  };
}

const VM = { computer_id: "cmp_vm", name: "Danil VM", state: "online", provider: "aws-ec2" };
const MAC = { computer_id: "cmp_mac", name: "Mac de Ana", state: "online", provider: "self", kind: "physical" };

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
    cmp_vm: { table: table("Panel", "Tarea de la VM") },
    cmp_mac: { table: table("Notas", "Tarea del Mac") },
  });

  assert.ok(text().includes("Panel") && text().includes("Notas"), "the projects of both machines are in the sidebar");
  assert.ok(doc.querySelector('[data-sesion="cmp_vm~t1"]'), "the VM task has its namespaced id");
  assert.ok(doc.querySelector('[data-sesion="cmp_mac~t1"]'), "the Mac task with the same raw id does not collide");
  const label = doc.querySelector('[data-machine="cmp_mac"]');
  assert.ok(label?.textContent.includes("Mac de Ana"), "rows carry the machine's name");
  assert.ok(calls("cmp_vm", "list_projects").some((c) => c.workspace === "w"), "the VM gets its own workspace id");
  assert.ok(calls("cmp_mac", "list_projects").some((c) => c.workspace === "w"), "the Mac gets its own workspace id");
  assert.deepEqual([...doc.querySelectorAll("[data-machine-row]")].map((r) => r.dataset.state), ["online", "online"]);

  const task = await invoke("load_session", { project: "cmp_mac~p1", id: "cmp_mac~t1" });
  assert.equal(task.id, "cmp_mac~t1");
  const read = calls("cmp_mac", "load_session").at(-1);
  assert.deepEqual([read.args.project, read.args.id, read.workspace], ["p1", "t1", "w"], "the Mac reads its task with its own ids");
  assert.equal(calls("cmp_vm", "load_session").length, 0, "the VM is not asked for the Mac's task");

  assert.equal(await invoke("send_message", { session: "cmp_mac~t1", text: "hola" }), "cmp_mac~t1");
  assert.equal(calls("cmp_mac", "send_message").length, 1);
  assert.equal(calls("cmp_vm", "send_message").length, 0);

  assert.equal((await invoke("create_project", { name: "Nuevo" })).id, "cmp_vm~p9", "without a choice a project is made on the managed VM");
  const picked = await invoke("create_project", { name: "Otro" }, { headers: { "x-terminus-machine": "cmp_mac" } });
  assert.equal(picked.id, "cmp_mac~p9", "the picked machine makes it");
  assert.equal((await invoke("create_project", { name: "Tercero" })).id, "cmp_mac~p9", "then the last machine used is the default");
  const machines = await invoke("machine_list");
  assert.deepEqual(machines.map((m) => [m.id, m.active]), [["cmp_vm", false], ["cmp_mac", true]]);
  assert.deepEqual(app.fallos, []);
});

test("an action on a computer that is off and cannot be woken fails short and neutral", async () => {
  const { app, invoke, calls, doc, text } = await open("web-machines-off", [VM, MAC], {
    cmp_vm: { table: table("Panel", "Tarea de la VM") },
    cmp_mac: { table: table("Notas", "Tarea del Mac"), state: "offline", cachedAt: "2026-10-18T21:30:00Z" },
  });

  assert.ok(doc.querySelector('[data-sesion="cmp_mac~t1"] [data-machine="cmp_mac"][data-machine-on="false"]'), "the Mac's copy shows, marked off");
  assert.equal(doc.querySelector('[data-machine-row="cmp_mac"]')?.dataset.state, "offline");
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
    cmp_vm: { table: table("Panel", "Tarea de la VM") },
    cmp_mac: { table: table("Notas", "Tarea del Mac") },
    cmp_old: { table: table("Viejo", "Tarea vieja"), outdated: true },
  });

  const old = doc.querySelector('[data-machine-row="cmp_old"]');
  assert.equal(old?.dataset.state, "outdated");
  assert.ok(old.textContent.includes("Necesita actualizarse"));
  assert.ok(text().includes("Panel") && text().includes("Notas"), "the other machines still fill the panel");
  const projects = await invoke("list_projects");
  assert.deepEqual(projects.map((p) => p.id).sort(), ["cmp_mac~p1", "cmp_vm~p1"]);
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
  const vmAccounts = { agent: "claude", env_var: "", shared_credential: null, secret_note: null, active: "a1", accounts: [account("a1", "ana@danil.ai"), account("a2", null, "Cuenta 2")] };
  const macAccounts = { agent: "claude", env_var: "", shared_credential: null, secret_note: null, active: "m1", accounts: [account("m1", "Ana@Danil.ai")] };
  const { app, invoke, calls } = await open("web-machines-accounts", [VM, MAC], {
    cmp_vm: { table: table("Panel", "Tarea de la VM", { list_accounts: vmAccounts }) },
    cmp_mac: { table: table("Notas", "Tarea del Mac", { list_accounts: macAccounts }) },
  });

  const list = await invoke("list_accounts", { agent: "claude" });
  assert.equal(list.accounts.length, 2, "one card per provider and email, plus the one without email");
  const [ana, other] = list.accounts;
  assert.equal(ana.id, "cmp_vm~a1");
  assert.deepEqual(ana.machines.map((m) => [m.machine, m.id, m.on]), [["cmp_vm", "cmp_vm~a1", true], ["cmp_mac", "cmp_mac~m1", true]]);
  assert.equal(list.active, "cmp_vm~a1");
  assert.equal(other.label, "Cuenta 2 · Danil VM", "an account without email stays its own, named with its machine");
  assert.deepEqual(other.machines.map((m) => m.machine), ["cmp_vm"]);

  await invoke("remove_account", { agent: "claude", id: "cmp_mac~m1" });
  assert.deepEqual(calls("cmp_mac", "remove_account").map((c) => c.args.id), ["m1"], "signing out is per machine");
  assert.equal(calls("cmp_vm", "remove_account").length, 0);
  await invoke("add_account", { agent: "claude", label: "" }, { headers: { "x-terminus-machine": "cmp_mac" } }).catch(() => {});
  assert.equal(calls("cmp_mac", "add_account").length, 1, "signing in on another machine goes to that machine");
  assert.deepEqual(app.fallos, []);
});
