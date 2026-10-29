import assert from "node:assert/strict";
import { sleep } from "./jsdom-app.mjs";

const turn = (n) => (n % 2 === 0
  ? { role: "user", id: `u${n}`, at: n, text: `Pregunta ${n}` }
  : { role: "agent", id: `a${n}`, at: n, text: `Respuesta ${n}` });
export const turns = (from, to) => Array.from({ length: to - from }, (_, i) => turn(from + i));
const row = (id) => ({ id, title: `Tarea ${id}`, last_message: "", provider: "codex", model: "gpt-5.6", refs: [], updated_at: 0, turns: 4, parent: null, esperando: false });
export const session = (id, list, history) => ({ id, provider: "codex", sources: [], model: "gpt-5.6", effort: null, permission_mode: null, turns: list, ...(history ? { history } : {}) });

export function responses(overrides) {
  return {
    window_ready: null,
    window_vitals: null,
    setup_required: false,
    list_providers: [{ id: "codex", label: "Codex", available: true, driver: true }],
    list_workspaces: { workspaces: [{ id: "w", name: "W", context_root: null }], active: "w" },
    workspaces_startup: { workspaces: [{ id: "w", name: "W", context_root: null }], active: "w" },
    list_projects: () => [{ id: "p1", name: "P1", working_directory: "/lab/p1", kind: "git", portfolio: null, sources: [] }],
    list_portfolios: [],
    list_sources: [],
    list_live_sessions: ({ project }) => (project === "" || project === "p1" ? ["t1", "t2"].map(row) : []),
    list_agents: { agents: [], rechazados: [] },
    list_agent_status: [],
    list_mentions: { fuentes: [], archivos: [] },
    list_models: { provider: "codex", models: [{ id: "gpt-5.6", label: "GPT-5.6", gratis: null, note: null, efforts: [], default_effort: null }], fallback: false },
    list_surfaces: [{ id: "codex", provider: "codex", label: "Codex", catalogo: "todo", usable: true, marca: null, porque: null }],
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
export function pushedPoll() {
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

export const text = (app) => app.w.document.body.textContent ?? "";
export async function openTask(app, id) {
  const el = app.w.document.querySelector(`[data-sesion="${id}"]`);
  assert.ok(el, `no está la fila de ${id}`);
  el.click();
  await sleep(400);
}
export const chat = (kind, extra) => ({ name: "chat", payload: { kind, session: "t1", workspace: "w", ...extra } });
