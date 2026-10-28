/**
 * Una respuesta con visual no desaparece del chat. En Windows el motor leía el
 * visual con `session.json` abierto sin compartir el borrado, justo cuando el
 * turno cerraba: el rename del guardado fallaba (os error 32), el `done` decía
 * que no se guardó y la ventana releía un disco sin ese turno. Ahora el `done`
 * marca `unsaved` y la ventana conserva lo que pintó; y un visual que no se
 * puede leer deja el texto, el nombre del archivo y cómo abrirlo fuera.
 * Monta `dist/`.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { boot, sleep } from "../helpers/jsdom-app.mjs";

const FILE = "sidebar-acciones-v2.html";
const ANSWER = `Aquí está otra vez:\n\n::terminus-visual{file="${FILE}" title="Sidebar"}\n\nArriba puedes cambiar entre las dos variantes.`;
const row = (id) => ({ id, title: `Tarea ${id}`, last_message: "", provider: "codex", model: "gpt-5.6", refs: [], updated_at: 0, turns: 2, parent: null, esperando: false });
const session = (id, turns) => ({ id, provider: "codex", sources: [], model: "gpt-5.6", effort: null, permission_mode: null, turns });
const USER = { role: "user", id: "u0", at: 0, text: "muéstrame la simulación" };

function responses(overrides) {
  return {
    window_ready: null,
    window_vitals: null,
    setup_required: false,
    service_poll: { cursor: 0, gap: false, replay: false, runtime: "lab", reset: false },
    list_providers: [{ id: "codex", label: "Codex", available: true, driver: true }],
    list_workspaces: { workspaces: [{ id: "w", name: "W", context_root: null }], active: "w" },
    workspaces_startup: { workspaces: [{ id: "w", name: "W", context_root: null }], active: "w" },
    list_projects: () => [{ id: "p1", name: "P1", working_directory: "/lab/p1", kind: "git", portfolio: null, sources: [] }],
    list_portfolios: [],
    list_sources: [],
    list_live_sessions: ({ project }) => (project === "" || project === "p1" ? [row("t1")] : []),
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

// El del arnés nunca dispara: sin esto el visual no llega a leerse.
const visible = {
  antes: (w) => {
    globalThis.IntersectionObserver = w.IntersectionObserver = class {
      constructor(callback) { this.callback = callback; }
      observe(target) { setTimeout(() => this.callback([{ isIntersecting: true, target }], this), 0); }
      unobserve() {}
      disconnect() {}
      takeRecords() { return []; }
    };
  },
};

const text = (app) => app.w.document.body.textContent ?? "";
async function openTask(app, id) {
  const el = app.w.document.querySelector(`[data-sesion="${id}"]`);
  assert.ok(el, `no está la fila de ${id}`);
  el.click();
  await sleep(400);
}

test("la respuesta que el motor no pudo guardar sigue en el chat, con su aviso", async () => {
  const visual = "<!doctype html><meta name=\"harness-artefacto\" content=\"web\"><p>simulación</p>";
  const app = await boot("listo", "chat-turn-unsaved", responses({
    // El disco nunca recibe la respuesta: es lo que dejaba el rename fallido.
    load_session: ({ id }) => session(id, [USER]),
    tree_show: { kind: "text", text: visual, bytes: new TextEncoder().encode(visual).byteLength, truncated: false },
  }), undefined, {}, visible);
  await sleep(600);
  await openTask(app, "t1");
  app.emit("chat", { kind: "started", session: "t1", workspace: "w" });
  app.emit("chat", { kind: "delta", session: "t1", workspace: "w", text: ANSWER });
  await sleep(300);
  assert.ok(text(app).includes("Arriba puedes cambiar"), "no pintó la respuesta en vivo");
  app.emit("chat", { kind: "done", session: "t1", workspace: "w", ok: false, text: "unsaved", meta: "El turno terminó, pero no se pudo guardar: (os error 32)" });
  await sleep(800);
  assert.ok(text(app).includes("Arriba puedes cambiar"), "la respuesta desapareció al cerrar el turno");
  assert.ok(text(app).includes("Aquí está otra vez"), "se perdió el texto antes del visual");
  assert.ok(app.w.document.querySelector(`[data-chat-visual="${FILE}"]`), "se perdió el visual");
  assert.ok(text(app).includes("no se pudo guardar en disco"), "no avisó que el turno no quedó guardado");
});

test("un visual que no se puede leer deja el texto, el archivo y el botón para abrirlo", async () => {
  const opened = [];
  const app = await boot("listo", "chat-visual-failed", responses({
    load_session: ({ id }) => session(id, [USER, { role: "agent", id: "a1", at: 1, text: ANSWER }]),
    tree_show: () => Promise.reject({ detail: "visual_read_failed" }),
    tree_open_external: (args, options) => {
      opened.push({ args, workspace: options?.headers?.["x-terminus-workspace"] });
      return null;
    },
  }), undefined, {}, visible);
  await sleep(600);
  await openTask(app, "t1");
  await sleep(400);
  const doc = app.w.document;
  assert.ok(text(app).includes("Aquí está otra vez") && text(app).includes("Arriba puedes cambiar"), "el texto del mensaje no se ve");
  const failed = doc.querySelector("[data-chat-visual-failed]");
  assert.ok(failed, "no hay aviso en el lugar del visual");
  assert.ok(failed.textContent.includes(FILE), "el aviso no nombra el archivo");
  const button = failed.querySelector("[data-chat-visual-open]");
  assert.ok(button, "no hay botón para abrirlo en el navegador");
  button.click();
  await sleep(200);
  assert.equal(opened.length, 1, "no pidió abrir el visual");
  assert.equal(opened[0].args.tree, "terminus-chat-visuals");
  assert.equal(opened[0].args.path, FILE);
  assert.equal(opened[0].args.session, "t1");
  assert.equal(opened[0].workspace, "w");
});

test("un rechazo al enviar explica cómo seguir y conserva el error desplegable", async () => {
  const app = await boot("listo", "chat-send-failure", responses({
    load_session: ({ id }) => session(id, [USER]),
    send_message: () => { throw { code: "worker_unavailable", message: "launch failed" }; },
  }));
  try {
    await openTask(app, "t1");
    const field = app.w.document.querySelector("textarea");
    assert.ok(field);
    field.value = "Continúa con el encargo";
    field.dispatchEvent(new app.w.Event("input", { bubbles: true }));
    field.closest("form").dispatchEvent(new app.w.Event("submit", { bubbles: true, cancelable: true }));
    let alert;
    for (let i = 0; i < 20; i++) {
      await sleep(50);
      alert = app.w.document.querySelector('[data-sender="system"][role="alert"]');
      if (alert) break;
    }
    assert.ok(alert, "el rechazo debe mostrarse en el chat");
    assert.match(alert.textContent, /launch failed/);
    assert.match(alert.textContent, /soporte/);
    assert.doesNotMatch(alert.textContent, /\[object Object\]/);
    const detail = alert.querySelector("details");
    assert.ok(detail, "el diagnóstico debe poder desplegarse");
    assert.equal(detail.open, false);
    assert.match(detail.textContent, /worker_unavailable/);
    assert.deepEqual(app.fallos, []);
  } finally {
    app.w.close();
  }
});
