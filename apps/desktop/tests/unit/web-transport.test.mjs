/**
 * The browser build (`dist-web/`, `pnpm web:build`) against a relay simulated in
 * Node: it mounts, its invokes travel as `call` and come back as `result`, the
 * events of `subscribe` reach the thread and the machine state shows as a notice.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { engine, relay } from "../helpers/fake-relay.mjs";
import { boot, sleep } from "../helpers/jsdom-app.mjs";

test("the web build talks to the relay: calls, events and machine state", async () => {
  const fake = relay();
  const app = await boot("listo", "web-transport", {}, undefined, {}, {
    web: true,
    antes: (w) => {
      globalThis.WebSocket = fake.Socket;
      w.terminusWeb = { endpoint: "https://relay.test", computerId: "cmp_test", getToken: async () => "tok" };
    },
  });
  await sleep(800);
  const text = () => app.w.document.body.textContent ?? "";

  assert.deepEqual(app.fallos, []);
  assert.equal(fake.sockets[0]?.url, "wss://relay.test/v1/computers/cmp_test/session");
  assert.deepEqual(fake.sockets[0]?.protocols, ["danil.computers.v1", "bearer.tok"]);

  const projects = fake.calls.find((c) => c.command === "list_projects");
  assert.ok(projects, "list_projects did not reach the relay");
  assert.match(projects.id, /^[0-9a-f-]{36}$/);
  assert.equal(projects.workspace, "w", "the active workspace travels in the envelope");
  assert.ok(text().includes("Tarea t1"), "the value of a call did not reach the sidebar");
  const local = fake.calls.filter((c) => /^(window_|launcher_|service_poll|tray_)/.test(c.command));
  assert.deepEqual(local.map((c) => c.command), [], "window-only commands stay in the page");
  assert.deepEqual(fake.subscriptions.slice(0, 1), [null]);

  app.w.document.querySelector('[data-sesion="t1"]').click();
  await sleep(400);
  const where = app.w.document.querySelector("[data-task-location]");
  assert.equal(where?.querySelector("[data-task-location-machine]")?.textContent, "cmp_test", "in the browser the task runs on the computer, not on this one");
  fake.push({
    type: "events",
    cursor: 2,
    gap: false,
    replay: false,
    runtime: "rt1",
    events: [
      { name: "chat", payload: { kind: "started", session: "t1", workspace: "w" } },
      { name: "chat", payload: { kind: "delta", session: "t1", workspace: "w", text: "hola desde el relay" } },
    ],
  });
  await sleep(600);
  assert.ok(text().includes("hola desde el relay"), "the events of the subscription did not reach the thread");

  fake.setState("offline");
  await sleep(5500);
  assert.equal(app.w.document.querySelector("[data-web-sync]")?.dataset.state, "offline", "the indicator did not show it off");
  assert.ok(!text().includes("La máquina de este host está apagada"), "machine_off showed as an error");
  fake.setState("online");
  fake.push({ type: "events", cursor: 3, gap: false, replay: false, runtime: "rt1", events: [] });
  await sleep(1200);
  assert.equal(app.w.document.querySelector("[data-web-sync]")?.dataset.state, "online", "the indicator stayed off after the machine came back");
  assert.deepEqual(app.fallos, []);
});

test("the transport leaves out what the account may not see: workspaces, attention and events", async () => {
  const { fleet } = await import("../helpers/fake-relay.mjs");
  const ws = (id, name) => ({ id, name, context_root: null });
  const vmList = { workspaces: [ws("w", "W"), ws("w2", "Dos"), ws("z", "Ajeno")], active: "z" };
  const ask = (session) => ({ session, project: "p1", state: "asked" });
  const f = fleet({
    cmp_vm: { table: { ...engine, list_workspaces: vmList, workspaces_startup: vmList, list_workspace_attention: [{ workspace: "w2", tasks: [ask("t2")] }, { workspace: "z", tasks: [ask("t9")] }] } },
  });
  const computers = [
    { computer_id: "cmp_vm", name: "Danil VM", state: "online", provider: "aws-ec2", workspaces: ["w", "w2"] },
  ];
  const app = await boot("listo", "web-transport-linked", {}, undefined, {}, {
    web: true,
    antes: (w) => {
      globalThis.WebSocket = f.Socket;
      w.terminusWeb = { endpoint: "https://relay.test", computers, getToken: async () => "tok" };
    },
  });
  await sleep(2500);
  const doc = app.w.document;
  const invoke = (command, args, options) => app.w.__TAURI_INTERNALS__.invoke(command, args, options);
  const tile = (id) => doc.querySelector(`[data-workspace-tile="${id}"]`);

  const list = await invoke("list_workspaces");
  assert.deepEqual(list.workspaces.map((w) => w.id), ["w", "w2"], "a workspace not linked on that computer is not listed");
  assert.notEqual(list.active, "z", "nor opened");
  assert.equal(tile("z"), null);
  assert.equal(tile("w2")?.dataset.attention, "asked", "the attention of a linked workspace shows");
  const attention = await invoke("list_workspace_attention");
  assert.ok(!attention.some((e) => e.workspace === "z"), "the attention of one that is not, does not");

  f.relays.cmp_vm.push({
    type: "events",
    cursor: 5,
    gap: false,
    replay: false,
    runtime: "rt",
    events: [
      { name: "attention", workspace: "z", payload: [{ workspace: "z", tasks: [ask("t9")] }] },
      { name: "attention", payload: [{ workspace: "w", tasks: [ask("t1")] }, { workspace: "w2", tasks: [] }, { workspace: "z", tasks: [ask("t8")] }] },
    ],
  });
  await sleep(800);
  assert.equal(tile("w")?.dataset.attention, "asked", "the whole list of the machine arrives, filtered");
  assert.equal(tile("w2")?.dataset.attention, undefined, "and replaces what waited before");
  assert.equal(tile("z"), null);

  assert.deepEqual(app.fallos, []);
});
