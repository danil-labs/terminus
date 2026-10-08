/**
 * Que la preparación no se abra con la app ya pintada y que nunca se quede ciega.
 *
 * El servicio falso entrega `bootstrap-run` solo por `service_poll`, con cursor,
 * como el real: un segundo lector recibiría cada evento otra vez. Monta `dist/`.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { arrancar, espera } from "./jsdom-app.mjs";

// Cada caso en su propio proceso: el arnés deja `window` en la última ventana, y los
// temporizadores de una anterior llamarían a los stubs de la siguiente.
const CASOS = new Map();
const caso = (nombre, cuerpo) => CASOS.set(nombre, cuerpo);

const ETAPAS = ["platform", "git", "node", "pnpm", "bun", "agent-browser"];
const ESENCIALES = ["platform", "git", "node"];
const TITULO = "Preparemos tu entorno de trabajo.";

const foto = (estado, running) => ({
  stages: ETAPAS.map((name) => ({ name, essential: ESENCIALES.includes(name), state: estado(name) })),
  running,
});
const enCurso = () => foto(() => "waiting", true);
const terminada = () => foto(() => "succeeded", false);

const reporte = (blocked, bootstrap, items = []) => ({
  ready: !blocked,
  blocked,
  reason: null,
  items,
  bootstrap,
  essential: ["git", "node", "npm"],
  first_run: false,
  runtime_versions: {},
});

function servicio({ setupRequired, entorno, preparar, reset = () => false }) {
  // Cada servicio con su registro. Uno nuevo contesta `reset` y, sin cursor, empieza desde el final.
  let actual = { runtime: "test-service", eventos: [], desdeElFinal: false };
  const llamadas = { prepare_runtime: [] };
  let app;
  const respuestas = {
    window_ready: null,
    window_vitals: null,
    setup_required: setupRequired,
    list_agents: [],
    list_workspaces: { workspaces: [{ id: "w", name: "W", context_root: null }], active: "w" },
    workspaces_startup: { workspaces: [{ id: "w", name: "W", context_root: null }], active: "w" },
    list_projects: [],
    list_sources: [],
    list_live_sessions: [],
    list_live_turns: [],
    list_surfaces: [],
    check_environment: () => entorno,
    prepare_runtime: (args) => {
      llamadas.prepare_runtime.push(args?.joinOnly === true ? "unirse" : "arrancar");
      return preparar(llamadas.prepare_runtime.length);
    },
    // `reset` también puede lanzar: es el servicio muerto que no contesta.
    service_poll: (args) => {
      if (args?.runtime && args.runtime !== actual.runtime) {
        return { cursor: null, gap: false, replay: true, runtime: actual.runtime, reset: true };
      }
      const nuevo = reset();
      const { eventos } = actual;
      const desde = args?.cursor ?? (actual.desdeElFinal ? eventos.length : 0);
      for (const e of eventos.filter((e) => e.id > desde)) app?.emit(e.name, e.payload);
      return { cursor: eventos.length, gap: false, replay: false, runtime: actual.runtime, reset: nuevo };
    },
  };
  return {
    respuestas,
    llamadas,
    publicar: (name, payload) => actual.eventos.push({ id: actual.eventos.length + 1, name, payload }),
    cambiarDeServicio: () => {
      actual = { runtime: `servicio-${Date.now()}`, eventos: [], desdeElFinal: true };
    },
    conectar: (a) => {
      app = a;
    },
  };
}

const enPantalla = (app) => app.w.document.body.textContent.includes(TITULO);
const aviso = (app) => app.w.document.querySelector("[data-setup-repair]");
const lineas = (app) => [...app.w.document.querySelectorAll('main [role="log"] > div')].map((d) => d.textContent.trim());
const acciones = (app) => [...app.w.document.querySelectorAll("main > footer button")].map((b) => b.textContent.trim());

caso("lo esencial que falta con la app pintada se repara detrás, sin abrir la preparación", async () => {
  const s = servicio({ setupRequired: false, entorno: reporte(true, ["node", "npm"]), preparar: enCurso });
  const app = await arrancar("listo", "reparacion-detras", s.respuestas);
  s.conectar(app);
  await espera(400);

  assert.equal(enPantalla(app), false, "la preparación se abrió con la app ya pintada");
  assert.ok(aviso(app), "no hay aviso de la reparación en curso");
  assert.deepEqual(s.llamadas.prepare_runtime, ["arrancar"]);
});

caso("la primera vez la pantalla avanza con la foto aunque no llegue ningún evento", async () => {
  const s = servicio({
    setupRequired: true,
    entorno: reporte(false, []),
    preparar: (n) => (n === 1 ? enCurso() : terminada()),
  });
  const app = await arrancar("listo", "foto-sin-eventos", s.respuestas);
  s.conectar(app);
  await espera(6000);

  assert.ok(s.llamadas.prepare_runtime.length >= 2, "la ventana no volvió a pedir la foto");
  assert.ok(acciones(app).length > 0, "la corrida terminó y la pantalla no ofrece seguir");
});

caso("un servicio nuevo a mitad de la corrida la retoma y la pantalla termina", async () => {
  let polls = 0;
  const s = servicio({
    setupRequired: true,
    entorno: reporte(false, []),
    preparar: (n) => (n === 1 ? enCurso() : terminada()),
    reset: () => ++polls === 3,
  });
  const app = await arrancar("listo", "reset-a-mitad", s.respuestas);
  s.conectar(app);
  await espera(2500);

  assert.ok(s.llamadas.prepare_runtime.length >= 2, "con `reset` nadie volvió a pedir la corrida");
  assert.ok(acciones(app).length > 0, "tras el cambio de servicio la pantalla no ofrece seguir");
});

caso("un corte del servicio a mitad de la corrida no deja error cuando termina bien", async () => {
  let polls = 0;
  const s = servicio({
    setupRequired: true,
    entorno: reporte(false, []),
    preparar: (n) => (n === 1 ? enCurso() : terminada()),
    reset: () => {
      polls += 1;
      if (polls === 2) throw new Error("io");
      return polls === 3;
    },
  });
  const app = await arrancar("listo", "corte-a-mitad", s.respuestas);
  s.conectar(app);
  await espera(2500);

  assert.ok(acciones(app).length > 0, "tras el corte la pantalla no ofrece seguir");
  assert.ok(!app.w.document.body.textContent.includes("No se pudo revisar esta computadora"), "quedó pintado el error del corte");
  assert.ok(!acciones(app).includes("Volver a intentar"), `ofrece reintentar una corrida que terminó bien: ${acciones(app)}`);
});

caso("cada evento de la preparación pinta una sola línea", async () => {
  const s = servicio({ setupRequired: true, entorno: reporte(false, []), preparar: enCurso });
  const app = await arrancar("listo", "un-lector", s.respuestas);
  s.conectar(app);
  s.publicar("bootstrap-run", { type: "note", stage: "platform", kind: "platform", value: "windows x86_64" });
  await espera(1500);

  assert.equal(lineas(app).filter((l) => l.includes("windows x86_64")).length, 1);
});

caso("la corrida que retoma un servicio nuevo empieza con la terminal limpia", async () => {
  const s = servicio({ setupRequired: true, entorno: reporte(false, []), preparar: enCurso });
  const app = await arrancar("listo", "dos-corridas", s.respuestas);
  s.conectar(app);
  const manifiesto = { type: "manifest", stages: ETAPAS.map((name) => ({ name, essential: ESENCIALES.includes(name) })) };
  s.publicar("bootstrap-run", manifiesto);
  s.publicar("bootstrap-run", { type: "note", stage: "platform", kind: "platform", value: "corrida-uno" });
  await espera(800);
  // El servicio nuevo emite su manifiesto antes de que la ventana empiece a leerlo.
  s.cambiarDeServicio();
  s.publicar("bootstrap-run", manifiesto);
  await espera(600);
  s.publicar("bootstrap-run", { type: "note", stage: "platform", kind: "platform", value: "corrida-dos" });
  await espera(800);

  assert.equal(lineas(app).filter((l) => l.includes("corrida-dos")).length, 1);
  assert.deepEqual(lineas(app).filter((l) => l.includes("corrida-uno")), [], "la terminal repite la corrida anterior");
});

caso("una herramienta que no contestó a tiempo no abre la preparación ni avisa", async () => {
  const lento = { id: "node", label: "Node.js", ok: false, required: false, detail: "", timed_out: true };
  const s = servicio({ setupRequired: false, entorno: reporte(false, [], [lento]), preparar: enCurso });
  const app = await arrancar("listo", "node-sin-respuesta", s.respuestas);
  s.conectar(app);
  await espera(400);

  assert.equal(enPantalla(app), false);
  assert.equal(aviso(app), null);
  assert.deepEqual(s.llamadas.prepare_runtime, []);
});

const elegido = process.env.SETUP_REPAIR_CASO;
if (elegido) {
  await CASOS.get(elegido)();
  process.exit(0);
}
const { default: test } = await import("node:test");
for (const nombre of CASOS.keys()) {
  test(nombre, () => {
    const corrida = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
      env: { ...process.env, SETUP_REPAIR_CASO: nombre },
      encoding: "utf8",
    });
    assert.equal(corrida.status, 0, `${corrida.stdout}
${corrida.stderr}`);
  });
}
