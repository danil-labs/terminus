/**
 * Que una ventana que llega con la preparación ya en curso tenga salida.
 *
 * `service_poll { setup: true }` empieza desde el final: el manifiesto de la
 * corrida en curso no llega por eventos, solo sus etapas siguientes. El estado lo
 * da el servicio al contestar `prepare_runtime`. Monta `dist/`.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { arrancar, espera } from "./jsdom-app.mjs";

const ETAPAS = ["platform", "git", "node", "pnpm", "bun", "agent-browser"];
const ESENCIALES = ["platform", "git", "node"];

const respuestas = (prepare_runtime) => ({
  setup_required: true,
  list_workspaces: { workspaces: [{ id: "w", name: "W", context_root: null }], active: "w" },
  service_poll: { cursor: 7, gap: false, replay: false, runtime: "test-service", reset: false },
  prepare_runtime,
});

const acciones = (app) => [...app.w.document.querySelectorAll("main > footer button")].map((b) => b.textContent.trim());
const estado = (app) => app.w.document.querySelector('main [role="status"]')?.textContent;

test("la ventana que llega con una preparación en curso ofrece cómo seguir cuando esta termina", async () => {
  const hechas = new Set(["platform", "git"]);
  const app = await arrancar("listo", "preparacion-en-curso", respuestas({
    stages: ETAPAS.map((name) => ({
      name,
      essential: ESENCIALES.includes(name),
      state: hechas.has(name) ? "succeeded" : name === "node" ? "running" : "waiting",
    })),
    running: true,
  }));
  assert.ok(app.comandos.includes("prepare_runtime"), "la ventana pidió preparar");
  for (const name of ETAPAS.filter((n) => !hechas.has(n))) {
    if (name !== "node") app.emit("bootstrap-run", { type: "stage", name, state: "running" });
    app.emit("bootstrap-run", { type: "stage", name, state: "succeeded", durationMs: 1 });
  }
  await espera(100);

  assert.ok(acciones(app).length > 0, `la corrida terminó y la pantalla no ofrece seguir ni reintentar; dice «${estado(app)}»`);
  assert.deepEqual(app.fallos, []);
});

// Durante una instalación la ventana nueva puede hablar con el servicio anterior.
test("frente a un servicio que contesta sin estado, la pantalla ofrece reintentar", async () => {
  const app = await arrancar("listo", "servicio-anterior", respuestas(null));
  await espera(100);

  assert.ok(acciones(app).length > 0, `sin estado ni eventos la pantalla no ofrece salida; dice «${estado(app)}»`);
  assert.deepEqual(app.fallos, []);
});
