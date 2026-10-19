/**
 * Una tarea que corre en otra máquina, apagada: abre con lo último que se leyó, dice que
 * la máquina está apagada y lleva su chip; mandarle un mensaje la enciende, sale una vez y
 * la tarea se vuelve a leer. El proxy (`fleet.rs`) se simula con sus respuestas. Monta `dist/`.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { boot, sleep } from "../helpers/jsdom-app.mjs";

const turn = (n, text) => (n % 2 === 0
  ? { role: "user", id: `u${n}`, at: n, text }
  : { role: "agent", id: `a${n}`, at: n, text });
const row = (id, extra) => ({ id, title: `Tarea ${id}`, last_message: "", provider: "codex", model: "gpt-5.6", refs: [], created_at: 0, updated_at: 0, turns: 2, parent: null, esperando: false, ...extra });
const session = (id, turns, extra) => ({ id, provider: "codex", sources: [], model: "gpt-5.6", effort: null, permission_mode: null, turns, ...extra });

function responses(overrides) {
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
    turn_authors: { person: null, agent: null },
    service_filter: null,
    service_poll: () => sleep(40).then(() => ({ cursor: 1, gap: false, replay: false, runtime: "lab", reset: false })),
    machine_list: [
      { id: "local", local: true, active: true, on: true, linked: true },
      { id: "vm", local: false, active: false, on: false, linked: true },
    ],
    ...overrides,
  };
}

const text = (app) => app.w.document.body.textContent ?? "";
async function openTask(app, id) {
  const el = app.w.document.querySelector(`[data-sesion="${id}"]`);
  assert.ok(el, `no está la fila de ${id}`);
  el.click();
  await sleep(400);
}
async function send(app, message) {
  const field = app.w.document.querySelector("textarea");
  field.value = message;
  field.dispatchEvent(new app.w.Event("input", { bubbles: true }));
  field.closest("form").dispatchEvent(new app.w.Event("submit", { bubbles: true, cancelable: true }));
  await sleep(50);
}

test("una tarea de una máquina apagada abre sin fallo y mandarle algo la enciende una vez", async () => {
  let awake = false;
  const sends = [];
  const reads = [];
  const app = await boot("listo", "machine-task", responses({
    list_live_sessions: ({ project }) => (project === "p1"
      ? [row("t1"), row("r1", { machine: "vm", machine_on: awake })]
      : []),
    load_session: ({ id }) => {
      reads.push({ id, awake });
      if (id !== "r1") return session(id, [turn(0, "Hola local"), turn(1, "Respuesta local")]);
      return awake
        ? session(id, [turn(0, "Pregunta guardada"), turn(1, "Respuesta guardada"), turn(2, "sigue"), turn(3, "Respuesta despierta")])
        : session(id, [turn(0, "Pregunta guardada"), turn(1, "Respuesta guardada")], { offline: { machine: "vm" } });
    },
    send_message: async (args) => {
      sends.push(args);
      await sleep(300);
      awake = true;
      return args.session;
    },
  }));
  await sleep(600);
  const doc = app.w.document;
  assert.ok(doc.querySelector('[data-sesion="r1"] [data-machine="vm"][data-machine-on="false"]'), "la fila no lleva el chip apagado");
  assert.equal(doc.querySelector('[data-sesion="t1"] [data-machine]'), null, "una tarea local no lleva chip");

  await openTask(app, "r1");
  assert.ok(text(app).includes("Respuesta guardada"), "no enseña la copia guardada");
  assert.equal(doc.querySelector("[data-machine-notice]")?.textContent, "vm está apagada: se enciende cuando envíes un mensaje.");
  assert.ok(doc.querySelector('[data-conversacion] [data-machine="vm"]'), "la cabecera no lleva el chip");

  await send(app, "sigue");
  assert.equal(doc.querySelector("[data-machine-notice]")?.textContent, "Encendiendo vm…");
  await sleep(700);
  assert.equal(sends.length, 1, "el mensaje salió más de una vez");
  assert.equal(sends[0].session, "r1");
  assert.equal(doc.querySelector("[data-machine-notice]"), null, "el aviso sigue tras encenderla");
  assert.ok(reads.some((r) => r.id === "r1" && r.awake), "no se volvió a leer la tarea");
  assert.ok(text(app).includes("Respuesta despierta"));
  assert.deepEqual(app.fallos, []);
});
