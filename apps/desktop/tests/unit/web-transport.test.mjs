/**
 * The browser build (`dist-web/`, `pnpm web:build`) against a relay simulated in
 * Node: it mounts, its invokes travel as `call` and come back as `result`, the
 * events of `subscribe` reach the thread and the machine state shows as a notice.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { boot, sleep } from "../helpers/jsdom-app.mjs";

const row = (id) => ({ id, title: `Tarea ${id}`, last_message: "", agent: "codex", model: "gpt-5.6", refs: [], updated_at: 0, turns: 0, parent: null, esperando: false });

const engine = {
  setup_required: false,
  check_environment: { ready: true, blocked: false, reason: null, items: [] },
  list_agents: [{ id: "codex", label: "Codex", available: true, driver: true }],
  list_workspaces: { workspaces: [{ id: "w", name: "W", context_root: null }], active: "w" },
  workspaces_startup: { workspaces: [{ id: "w", name: "W", context_root: null }], active: "w" },
  list_projects: [{ id: "p1", name: "P1", working_directory: "/lab/p1", kind: "git", portfolio: null, sources: [] }],
  list_portfolios: [],
  list_sources: [],
  list_live_sessions: ({ project }) => (project === "" || project === "p1" ? ["t1"].map(row) : []),
  list_encargados: { encargados: [], rechazados: [] },
  list_encargado_status: [],
  list_mentions: { fuentes: [], archivos: [] },
  list_models: { agent: "codex", models: [{ id: "gpt-5.6", label: "GPT-5.6", gratis: null, note: null, efforts: [], default_effort: null }], fallback: false },
  list_surfaces: [{ id: "codex", agent: "codex", label: "Codex", catalogo: "todo", usable: true, marca: null, porque: null }],
  session_folder: "/tmp",
  list_task_trees: [],
  task_history: { history: { archived: false, events: [], recovery: null }, branch: null, path: "/lab", available: true, owned: false, restorable: false, recreatable: false, incomplete: false },
  list_live_turns: [],
  list_active_turns: [],
  load_queue: [],
  save_queue: null,
  session_usage: null,
  list_session_git: {},
  load_session: ({ id }) => ({ id, agent: "codex", sources: [], model: "gpt-5.6", effort: null, permission_mode: null, turns: [] }),
};

/** One relay session socket per connection, speaking protocol v1 to the page. */
function relay() {
  const sockets = [];
  const calls = [];
  const subscriptions = [];
  let state = "online";
  const push = (message) => {
    for (const s of sockets) if (s.readyState === 1) s.onmessage?.({ data: JSON.stringify(message) });
  };
  class Socket {
    constructor(url, protocols) {
      Object.assign(this, { url, protocols, readyState: 0, onopen: null, onmessage: null, onclose: null, onerror: null });
      sockets.push(this);
      setTimeout(() => {
        this.readyState = 1;
        this.onopen?.({});
        push({ type: "state", state });
      }, 0);
    }
    send(data) {
      const m = JSON.parse(data);
      if (m.type === "subscribe") subscriptions.push(m.after);
      if (m.type !== "call") return;
      calls.push(m);
      const answer = engine[m.command];
      const reply = answer === undefined
        ? { type: "result", id: m.id, error: { code: "command" } }
        : { type: "result", id: m.id, value: typeof answer === "function" ? answer(m.args) : answer };
      setTimeout(() => this.readyState === 1 && this.onmessage?.({ data: JSON.stringify(reply) }), 0);
    }
    close(code = 1000) {
      this.readyState = 3;
      setTimeout(() => this.onclose?.({ code }), 0);
    }
  }
  return { Socket, sockets, calls, subscriptions, push, setState: (next) => { state = next; push({ type: "state", state }); } };
}

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
  assert.ok(text().includes("La máquina de este host está apagada"), "the machine_off notice did not show");
  fake.setState("online");
  fake.push({ type: "events", cursor: 3, gap: false, replay: false, runtime: "rt1", events: [] });
  await sleep(1200);
  assert.ok(!text().includes("La máquina de este host está apagada"), "the notice stayed after the machine came back");
  assert.deepEqual(app.fallos, []);
});
