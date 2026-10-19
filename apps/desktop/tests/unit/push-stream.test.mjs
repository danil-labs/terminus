/**
 * Que la ventana consuma el stream empujado cuando `service_poll` lo anuncia: los lotes
 * llegan a los mismos oyentes, el filtro sigue a las tareas que se ven, una tarea abre con
 * `load_history` y lo anterior llega al subir. Monta `dist/`.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { boot, sleep } from "../helpers/jsdom-app.mjs";

const turn = (n) => (n % 2 === 0
  ? { role: "user", id: `u${n}`, at: n, text: `Pregunta ${n}` }
  : { role: "agent", id: `a${n}`, at: n, text: `Respuesta ${n}` });
const turns = (from, to) => Array.from({ length: to - from }, (_, i) => turn(from + i));
const row = (id) => ({ id, title: `Tarea ${id}`, last_message: "", agent: "codex", model: "gpt-5.6", refs: [], updated_at: 0, turns: 4, parent: null, esperando: false });
const session = (id, list, history) => ({ id, agent: "codex", sources: [], model: "gpt-5.6", effort: null, permission_mode: null, turns: list, ...(history ? { history } : {}) });

function responses(overrides) {
  return {
    window_ready: null,
    window_vitals: null,
    setup_required: false,
    list_agents: [{ id: "codex", label: "Codex", available: true, driver: true }],
    list_workspaces: { workspaces: [{ id: "w", name: "W", context_root: null }], active: "w" },
    workspaces_startup: { workspaces: [{ id: "w", name: "W", context_root: null }], active: "w" },
    list_projects: () => [{ id: "p1", name: "P1", working_directory: "/lab/p1", kind: "git", portfolio: null, sources: [] }],
    list_portfolios: [],
    list_sources: [],
    list_live_sessions: ({ project }) => (project === "" || project === "p1" ? ["t1", "t2"].map(row) : []),
    list_encargados: { encargados: [], rechazados: [] },
    list_encargado_status: [],
    list_mentions: { fuentes: [], archivos: [] },
    list_models: { agent: "codex", models: [{ id: "gpt-5.6", label: "GPT-5.6", gratis: null, note: null, efforts: [], default_effort: null }], fallback: false },
    list_surfaces: [{ id: "codex", agent: "codex", label: "Codex", catalogo: "todo", usable: true, marca: null, porque: null }],
    session_folder: "/tmp",
    list_task_trees: [],
    watch_task_tree: "watch",
    unwatch_task_tree: null,
    task_history: { history: { archived: false, events: [], recovery: null }, branch: null, path: "/lab", available: true, owned: false, restorable: false, recreatable: false, incomplete: false },
    list_live_turns: [],
    list_active_turns: [],
    load_queue: [],
    save_queue: null,
    session_usage: null,
    list_session_git: {},
    ...overrides,
  };
}

/** Un `service_poll` empujado: entrega lo encolado o, como Rust, espera un poco y contesta vacío. */
function pushedPoll() {
  const queue = [];
  const calls = [];
  let cursor = 10;
  const poll = (args) => {
    calls.push(args);
    const batches = queue.shift();
    if (batches) cursor += 1;
    const page = { cursor, gap: false, replay: false, runtime: "lab", reset: false, push: true, batches: batches ?? [] };
    return batches ? page : sleep(40).then(() => page);
  };
  return { poll, calls, push: (...batches) => queue.push(batches) };
}

const text = (app) => app.w.document.body.textContent ?? "";
async function openTask(app, id) {
  const el = app.w.document.querySelector(`[data-sesion="${id}"]`);
  assert.ok(el, `no está la fila de ${id}`);
  el.click();
  await sleep(400);
}
const chat = (kind, extra) => ({ name: "chat", payload: { kind, session: "t1", workspace: "w", ...extra } });

test("con push los lotes llegan a los oyentes, el filtro sigue a la tarea y la tarea abre por load_history", async () => {
  const stream = pushedPoll();
  const filters = [];
  const app = await boot("listo", "push-stream", responses({
    service_poll: stream.poll,
    service_filter: ({ sessions }) => {
      filters.push(sessions);
      return null;
    },
    load_history: ({ id }) => session(id, turns(0, 4), { total: 4, start: 0, end: 4, limit: 150, has_more: false }),
  }));
  await sleep(600);
  await openTask(app, "t1");
  assert.ok(app.comandos.includes("load_history"), "abrir no pidió load_history");
  assert.ok(!app.comandos.includes("load_session"), "con push no debe leer la transcripción entera");
  assert.ok(text(app).includes("Respuesta 3"));
  assert.ok(filters.some((sessions) => sessions.includes("t1")), `el filtro no incluye la tarea abierta: ${JSON.stringify(filters)}`);

  stream.push({ events: [chat("started"), chat("delta", { text: "hola empujado" })] });
  await sleep(300);
  assert.ok(text(app).includes("hola empujado"), "el delta empujado no llegó al hilo");

  // El turno en curso se reemplaza con lo que trae el `catchup`.
  stream.push({ catchup: "t1", events: [chat("started"), chat("delta", { text: "lo que no se vio" })] });
  await sleep(300);
  assert.ok(text(app).includes("lo que no se vio"));
  assert.ok(!text(app).includes("hola empujado"), "el catchup se sumó en vez de reemplazar");

  // Sin nada que entregar, Rust espera: la ventana no sondea cada 250 ms.
  const before = stream.calls.length;
  await sleep(500);
  assert.ok(stream.calls.length - before <= 15, `${stream.calls.length - before} llamadas en 500 ms`);
  assert.deepEqual(app.fallos, []);
});

test("subir hasta arriba pide la página anterior y la antepone sin remontar lo que había", async () => {
  const stream = pushedPoll();
  const pages = [];
  const app = await boot("listo", "push-older", responses({
    service_poll: stream.poll,
    service_filter: null,
    load_history: ({ id, before }) => {
      pages.push(before);
      return before === 30
        ? session(id, turns(0, 30), { total: 60, start: 0, end: 30, limit: 150, has_more: false })
        : session(id, turns(30, 60), { total: 60, start: 30, end: 60, limit: 150, has_more: true });
    },
  }));
  // El borde de arriba del hilo: se le avisa a mano que entró en la vista.
  const edges = [];
  globalThis.IntersectionObserver = app.w.IntersectionObserver = class {
    constructor(callback, options) {
      if (options?.rootMargin === "1200px 0px 0px 0px") edges.push(callback);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  };
  await sleep(600);
  await openTask(app, "t1");
  assert.deepEqual(pages, [null]);
  assert.ok(text(app).includes("Respuesta 59"));
  assert.ok(!text(app).includes("Pregunta 30"), "abrir montó más que los dos últimos tramos");
  const last = [...app.w.document.querySelectorAll("*")].find((el) => el.children.length === 0 && el.textContent === "Respuesta 59");
  assert.ok(last);
  for (let i = 0; i < 12 && !text(app).includes("Pregunta 0"); i++) {
    for (const edge of edges) edge([{ isIntersecting: true }]);
    await sleep(150);
  }
  assert.equal(pages.filter((before) => before === 30).length, 1, `páginas pedidas: ${JSON.stringify(pages)}`);
  assert.ok(pages.every((before) => before === null || before === 30));
  assert.ok(text(app).includes("Pregunta 0"), "la página anterior no llegó al hilo");
  assert.ok(last.isConnected, "anteponer remontó lo que ya estaba pintado");
  assert.deepEqual(app.fallos, []);
});
