/**
 * The browser build (`dist-web/`, `pnpm web:build`) against a relay simulated in
 * Node: it mounts, its invokes travel as `call` and come back as `result`, the
 * events of `subscribe` reach the thread and the machine state shows as a notice.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { relay } from "../helpers/fake-relay.mjs";
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
