#!/usr/bin/env node
/** La columna de workspaces, la barra de título, terminar una tarea, enlaces locales y el alta. */
import assert from "node:assert/strict";
import { sleep } from "../../tests/helpers/jsdom-app.mjs";
import { TASK_AFTER_QUEUE, RESPUESTAS, boot, bootPorCarpeta, gitRow, keepActiveView, mount, task } from "../../tests/helpers/mount-guard.mjs";

/**
 * La columna de workspaces cambia con un clic y cada cuadro dice lo más
 * urgente de su workspace. «Sin ver» se limpia al abrir la tarea, no al entrar.
 */
let atencion = [
  { workspace: "w", tasks: [{ session: "s1", project: "pa", state: "unseen" }, { session: "s2", project: "pa", state: "failed" }] },
  { workspace: "w2", tasks: [{ session: "x", project: "q", state: "unseen" }, { session: "y", project: "q", state: "asked" }, { session: "z", project: "q", state: "approving" }] },
  { workspace: "w3", tasks: [{ session: "k", project: "q", state: "unseen" }, { session: "j", project: "q", state: "asked" }] },
  { workspace: "w4", tasks: [{ session: "n", project: "q", state: "state_from_a_newer_service" }] },
];
const vistos = [];
const cambiosDeColumna = [];
const espaciosDeColumna = { workspaces: [
  { id: "w", name: "Acme Corp", context_root: null },
  { id: "w2", name: "Beta", context_root: null },
  { id: "w3", name: "gamma-labs", context_root: null },
  { id: "w4", name: "Delta", context_root: null },
], active: "w" };
const columna = await bootPorCarpeta("listo", "workspace-column", { ...TASK_AFTER_QUEUE,
  list_workspaces: () => structuredClone(espaciosDeColumna),
  workspaces_startup: () => structuredClone(espaciosDeColumna),
  list_projects: () => [{ id: "pa", name: "Proyecto", kind: "folder", working_directory: "/lab", sources: [] }],
  list_live_sessions: ({ project }) => project === "pa" ? [task("s1", null, "delivered"), task("s2", null, "failed"), task("s3", null, "delivered")] : [],
  load_session: ({ id }) => ({ ...TASK_AFTER_QUEUE.load_session, id, turns: [] }),
  list_workspace_attention: () => structuredClone(atencion),
  mark_task_seen: ({ workspace, session }) => { vistos.push([workspace, session]); },
  set_active_workspace: ({ id }) => { cambiosDeColumna.push(id); espaciosDeColumna.active = id; },
});
await sleep(300);
const doc = columna.w.document;
const cuadro = (id) => doc.querySelector(`[data-workspace-column] [data-workspace-tile="${id}"]`);
assert.deepEqual([...doc.querySelectorAll("[data-workspace-column] [data-workspace-tile]")].map((b) => b.textContent.trim()),
  ["AC", "B", "GL", "D"], "la columna lista cada workspace con sus iniciales");
assert.equal(cuadro("w").getAttribute("aria-current"), "true", "el activo lleva la marca de selección");
assert.equal(cuadro("w2").getAttribute("aria-current"), null);
assert.equal(doc.querySelector("[data-title-bar] [data-workspace-name]"), null, "la franja de la ventana ya no nombra el workspace: se cambia en la columna");
assert.equal(doc.querySelector('button[aria-label^="Workspace: "]'), null, "el menú de workspace del pie del riel se fue");
assert.equal(cuadro("w").dataset.attention, "failed", "fallo sin ver gana a terminada sin ver");
assert.ok(cuadro("w").querySelector('[data-attention-badge="failed"].text-error-strong svg.lucide-circle-alert'));
assert.equal(cuadro("w2").dataset.attention, "approving", "un permiso gana a todo");
assert.ok(cuadro("w2").querySelector("svg.lucide-shield-question-mark"));
assert.equal(cuadro("w2").getAttribute("aria-label"), "Beta: Aquí dentro esperan que apruebes una acción");
assert.equal(cuadro("w3").dataset.attention, "asked", "una pregunta gana a terminada sin ver");
assert.ok(cuadro("w3").querySelector("svg.lucide-circle-question-mark"));
assert.equal(cuadro("w4").dataset.attention, undefined, "un estado que la ventana no conoce no se pinta");
const filaDeColumna = (id) => doc.querySelector(`[data-sesion="${id}"]`);
// La tarjeta del riel: sin ver es un check verde; vista lo deja neutro y se apaga.
assert.ok(filaDeColumna("s1").querySelector('[aria-label="Terminó y no la has abierto"] .text-success-strong svg.lucide-check'), "la fila dice terminada sin ver");
assert.equal(filaDeColumna("s3").dataset.apagada, "true", "una entregada ya vista se apaga, en su sitio");
assert.ok(filaDeColumna("s3").querySelector('[aria-label="Resultado entregado"] svg.lucide-check'), "y conserva el check en su esquina");
assert.equal(filaDeColumna("s3").querySelector('[aria-label="Resultado entregado"] .text-success-strong'), null, "sin el verde de lo no visto");
const pliegue = doc.querySelector('button[aria-label="Plegar «Proyecto»"]');
pliegue.click();
await sleep(50);
const proyecto = [...doc.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith("Proyecto") && b.querySelector('[aria-label="Una subtarea falló o se interrumpió"]'));
assert.ok(proyecto, "el proyecto plegado agrega el fallo sin ver de dentro");
doc.querySelector('button[aria-label="Desplegar «Proyecto»"]').click();
await sleep(50);
assert.deepEqual(vistos, [], "entrar al workspace no marca nada como visto");
filaDeColumna("s1").click();
await sleep(250);
assert.deepEqual(vistos, [["w", "s1"]], "abrir la tarea la marca como vista");
atencion = [{ ...atencion[0], tasks: [atencion[0].tasks[1]] }, ...atencion.slice(1)];
columna.emit("attention", structuredClone(atencion));
await sleep(50);
assert.equal(filaDeColumna("s1").querySelector('[aria-label="Terminó y no la has abierto"]'), null, "y la marca se limpia con el evento");
assert.equal(filaDeColumna("s1").dataset.apagada, "true");
columna.emit("attention", [{ workspace: "w", tasks: [{ session: "s1", project: "pa", state: "unseen" }] }]);
await sleep(80);
assert.deepEqual(vistos, [["w", "s1"], ["w", "s1"]], "un turno que cierra con la tarea delante no queda sin ver");
cuadro("w2").click();
await sleep(300);
assert.deepEqual(cambiosDeColumna, ["w2"], "un clic cambia de workspace");
assert.equal(cuadro("w2").getAttribute("aria-current"), "true");
cuadro("w2").dispatchEvent(new columna.w.MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
await sleep(80);
assert.ok([...doc.querySelectorAll('[role="menuitem"]')].some((b) => b.textContent.trim() === "Administrar workspaces"), "administrar sigue alcanzable desde el cuadro");
assert.ok(doc.querySelector('[data-workspace-column] button[aria-label="Nuevo workspace"]'), "y crear uno, desde la columna");
espaciosDeColumna.workspaces = espaciosDeColumna.workspaces.slice(0, 1);
columna.w.dispatchEvent(new columna.w.CustomEvent("harness:workspace"));
await sleep(300);
assert.ok(doc.querySelector("[data-workspace-column]"), "con uno solo la columna se queda: es el único sitio para cambiar de workspace");
assert.deepEqual(columna.fallos, []);
/**
 * Con un solo workspace la columna sigue a la vista y crea el segundo. En macOS solo la franja
 * de la ventana se aparta del semáforo, y no nombra ninguna build.
 */
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";
const LARGO = "Software y Servicios Danil, Consultoría de Gobierno de Agentes";
const unoSolo = { workspaces: [{ id: "w", name: LARGO, context_root: null }], active: "w" };
const solo = await boot("listo", "title-bar-one", { ...TASK_AFTER_QUEUE,
  list_workspaces: () => structuredClone(unoSolo),
  workspaces_startup: () => structuredClone(unoSolo),
  list_workspace_attention: () => [{ workspace: "w", tasks: [{ session: "s1", project: "", state: "asked" }] }],
  "plugin:window|title": "Terminus · una-rama",
}, MAC);
await sleep(300);
const d1 = solo.w.document;
const barra = d1.querySelector("[data-title-bar]");
assert.ok(d1.querySelector("[data-workspace-column]"), "con un solo workspace la columna sigue");
assert.ok(barra.classList.contains("pl-[84px]"), "en macOS la franja se aparta del semáforo");
assert.equal(d1.querySelectorAll(".pl-\\[84px\\]").length, 1, "y ninguna otra cabecera reserva su hueco");
assert.equal(d1.querySelector("[data-window-branch]"), null, "la franja no nombra la build");
assert.ok(d1.querySelector('[data-workspace-column-foot] button[aria-label="Configuración"]'), "Configuración vive al pie de la columna");
const altas = [];
solo.w.addEventListener("harness:new-workspace", () => altas.push(1));
d1.querySelector('[data-workspace-column] button[aria-label="Nuevo workspace"]').click();
await sleep(150);
assert.equal(altas.length, 1, "Nuevo workspace pide el alta desde la columna");
assert.deepEqual(solo.fallos, []);
/**
 * Ocultar el riel vive a la izquierda de Agentes y Tareas. Oculto, lo trae de vuelta la fila de
 * las pestañas y la fila del título sigue igual. En pantalla completa no hay semáforo que apartar.
 */
const plegado = await boot("listo", "title-bar-collapsed", { ...TASK_AFTER_QUEUE,
  list_workspaces: () => structuredClone(unoSolo),
  workspaces_startup: () => structuredClone(unoSolo),
  "plugin:window|is_fullscreen": true,
}, MAC);
await sleep(300);
const d2 = plegado.w.document;
const ocultarRiel = d2.querySelector('button[aria-label="Ocultar el historial"]');
assert.equal(ocultarRiel.parentElement.querySelector('button[aria-label="Proyectos"]'), null, "el encabezado del riel no repite «Proyectos»: ya lo dice la sección de abajo");
assert.equal(d2.querySelector("[data-sidebar-search]"), null, "el riel no lleva buscador");
const lupa = () => d2.querySelector("[data-title-bar] [data-global-search-open]");
assert.equal(lupa()?.getAttribute("aria-keyshortcuts"), "Meta+K", "la lupa de la franja dice su atajo");
assert.equal(d2.querySelector("[data-title-bar]").classList.contains("pl-[84px]"), false, "en pantalla completa la fila no reserva el semáforo");
ocultarRiel.click();
await sleep(100);
assert.ok(lupa(), "con el riel oculto, la lupa sigue en la franja");
plegado.w.dispatchEvent(new plegado.w.KeyboardEvent("keydown", { key: "k", code: "KeyK", metaKey: true, bubbles: true }));
await sleep(100);
assert.ok(d2.querySelector("[data-global-search]"), "⌘K abre el buscador");
d2.querySelector('[data-global-search] input[role="combobox"]').dispatchEvent(new plegado.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
await sleep(100);
assert.equal(d2.querySelector("[data-global-search]"), null, "Escape lo cierra");
assert.ok(d2.querySelector('[data-title-bar] button[aria-label="Mostrar el historial"]'), "con el riel oculto, el mismo botón de la franja lo trae de vuelta");
assert.equal(d2.querySelector("[data-window-branch]"), null, "sin título de ventana no se nombra ninguna build");
d2.querySelector('button[aria-label="Mostrar el historial"]').click();
await sleep(100);
assert.ok(d2.querySelector('button[aria-label="Ocultar el historial"]'));
assert.deepEqual(plegado.fallos, []);
/**
 * En Windows los tres botones de la ventana cierran la fila del título, una sola vez, con el árbol
 * de trabajo abierto o cerrado. La app de producción no pinta ningún rótulo de build.
 */
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0";
const enWindows = await boot("listo", "title-bar-windows", { ...TASK_AFTER_QUEUE,
  "plugin:window|title": "Terminus",
  check_environment: () => ({ ready: true, blocked: false, reason: null, items: [], bootstrap: [], engineBuild: "0.2.73 b1fed68" }),
  list_dependencies: [],
  list_language_packs: [], list_bundled_language_packs: [],
}, WINDOWS);
await sleep(300);
const d3 = enWindows.w.document;
const minimizar = () => [...d3.querySelectorAll('button[aria-label="Minimizar"]')];
assert.equal(minimizar().length, 1, "un solo juego de botones de ventana");
assert.ok(minimizar()[0].closest("[data-title-bar]"), "y vive en la fila del título");
assert.equal(d3.querySelector("[data-window-branch]"), null, "la app de producción no nombra su build");
assert.equal(d3.querySelector("[data-title-bar]").classList.contains("pl-[84px]"), false, "fuera de macOS no hay semáforo");
d3.querySelector('[data-sesion="s1"]').click();
await sleep(250);
d3.querySelector('button[aria-label="Archivos de la tarea"]')?.click();
await sleep(300);
assert.ok(d3.querySelector("[data-task-files]"), "el panel de archivos abre");
assert.equal(minimizar().length, 1, "con el panel abierto siguen siendo uno");
assert.ok(minimizar()[0].closest("[data-title-bar]"));
d3.querySelector('button[aria-label="Configuración"]')?.click();
await sleep(150);
d3.querySelector("#cfg-tab-machines").click();
await sleep(50);
[...d3.querySelectorAll("button")].find((b) => b.textContent.trim() === "Estado del entorno").click();
await sleep(200);
assert.equal(d3.body.textContent.split("Motor 0.2.73 b1fed68").length, 2, "el build del motor aparece una sola vez en Estado del entorno");
assert.deepEqual(enWindows.fallos, []);
/**
 * Un turno vivo sobrevive al cambio de workspace, y su reloj también.
 *
 * La ventana pierde los hilos en memoria y deja de recibir los eventos del
 * cliente anterior. Sin preguntar quién contesta al volver, el rótulo de
 * espera vuelve a cero y un turno que cerró al otro lado se queda pintado
 * como vivo, con la caja en «Detener».
 */
let wsActivo = "w";
let enVuelo = [];
const espaciosDelCruce = () => ({ workspaces: [
  { id: "w", name: "Cliente A", context_root: null },
  { id: "w2", name: "Cliente B", context_root: null },
], active: wsActivo });
const cruce = await boot("listo", 20, { ...TASK_AFTER_QUEUE,
  workspaces_startup: () => espaciosDelCruce(),
  list_workspaces: () => espaciosDelCruce(),
  list_projects: () => [{ id: wsActivo === "w" ? "pa" : "pb", name: "Proyecto", kind: "folder", working_directory: "/lab", sources: [] }],
  list_live_sessions: () => [task("s1", null, null)],
  load_session: ({ id }) => ({ ...TASK_AFTER_QUEUE.load_session, id, turns: [] }),
  list_live_turns: () => enVuelo,
  list_active_turns: () => enVuelo.filter((turn) => turn.workspace === wsActivo).map((turn) => turn.session),
});
const cuerpoDelCruce = () => cruce.w.document.body.textContent;
const relojDelTurno = () => (cuerpoDelCruce().match(/·\s([\dms ]+?)\s*(?:Fuentes|$)/) ?? [])[1] ?? null;
const rotuloDeEspera = () => !!cruce.w.document.querySelector('[role="status"][aria-label="El agente está trabajando"]');
const mudarA = async (destino) => {
  wsActivo = destino;
  cruce.w.dispatchEvent(new cruce.w.CustomEvent("harness:workspace"));
  await sleep(300);
};
cruce.w.document.querySelector('[data-sesion="s1"]').click();
await sleep(250);
cruce.emit("chat", { kind: "started", session: "s1", workspace: "w" });
cruce.emit("chat", { kind: "delta", session: "s1", workspace: "w", text: "Voy por la mitad" });
await sleep(150);
assert.ok(rotuloDeEspera(), "el turno arranca y el rótulo de espera aparece");
assert.match(cuerpoDelCruce(), /Voy por la mitad/);
// El turno lleva un minuto largo corriendo cuando se vuelve a mirarlo: es lo
// que el registro del backend sabe y la ventana no puede deducir.
enVuelo = [{ session: "s1", workspace: "w", project: "pa", started_at: Date.now() - 95_000 }];
await mudarA("w2");
cruce.w.document.querySelector('[data-sesion="s1"]').click();
await sleep(100);
cruce.emit("chat", { kind: "delta", session: "s1", workspace: "w", text: " y sigo desde el otro workspace" });
assert.doesNotMatch(cuerpoDelCruce(), /Voy por la mitad|sigo desde el otro workspace/, "a matching session ID in another workspace cannot share its live transcript");
assert.equal(rotuloDeEspera(), false, "en el otro cliente no se pinta el turno de este");
await mudarA("w");
cruce.w.document.querySelector('[data-sesion="s1"]').click();
await sleep(300);
assert.ok(rotuloDeEspera(), "al volver, la tarea sigue contestando");
assert.match(cuerpoDelCruce(), /Voy por la mitad y sigo desde el otro workspace/, "lo que llegó por eventos mientras se miraba otro cliente no está en disco todavía");
assert.match(relojDelTurno() ?? "", /1m 3\ds/, "el reloj cuenta desde que arrancó el turno, no desde que se repintó");
// Y el cierre que llega mirando el otro cliente: el filtro por workspace lo
// descarta, y la única forma de enterarse es volver a preguntar.
enVuelo = [];
await mudarA("w2");
cruce.emit("chat", { kind: "done", session: "s1", workspace: "w", ok: true });
await sleep(150);
await mudarA("w");
await sleep(250);
assert.equal(rotuloDeEspera(), false, "un turno que cerró al otro lado deja de decir que trabaja");
assert.deepEqual(cruce.fallos, []);
const finishCalls = [];
const finishedIds = new Set();
let rejectFinish = true;
let settleFinish;
const finishRows = () => [
  { ...task("merged", null, "delivered"), archived: finishedIds.has("merged") },
  { ...task("child", "merged", "delivered"), subagent: "native-child", archived: finishedIds.has("child") },
  task("saved", null, "delivered"), task("pending", null, null),
  task("local", null, "delivered"), task("local-pending", null, null),
];
const finishApp = await boot("listo", "finish-task", {
  ...TASK_AFTER_QUEUE,
  list_projects: [{ id: "finish-project", name: "Finalización", node: null, sources: [], working_directory: "/lab", created_at: 1, updated_at: 1, sessions: 3, kind: "folder" }],
  list_live_sessions: ({ project }) => project === "finish-project" ? finishRows() : [],
  list_session_git: () => ({
    merged: gitRow("feature/done", { pull: { number: 42, state: "merged", head_sha: "abc" }, pull_known: true }),
    child: gitRow(null, { kind: "unknown", shared_with: "merged" }),
    saved: gitRow(null, { kind: "kn", kn: "saved" }),
    pending: gitRow("feature/pending", { pull: { number: 43, state: "open", head_sha: "abc" }, pull_known: true }),
    local: gitRow("feature/local", { has_remote: false, merged_locally: true }),
    "local-pending": gitRow("feature/local-pending", { has_remote: false }),
  }),
  task_blockers: () => ({ unsaved: [], not_finished: false }),
  finish_task: args => {
    finishCalls.push(args);
    return new Promise((resolve, reject) => {
      settleFinish = () => {
        if (rejectFinish) { reject(new Error("Trabajo pendiente")); return; }
        finishedIds.add(args.id);
        if (args.id === "merged") finishedIds.add("child");
        resolve();
      };
    });
  },
});
const finishButton = id => finishApp.w.document.querySelector(`[data-sesion="${id}"] [data-session-finish]`);
assert.ok(finishButton("merged"));
assert.ok(finishButton("saved"));
assert.equal(finishButton("pending"), null);
assert.ok(finishButton("local"), "Sin remoto, la rama integrada en su base local también se finaliza");
assert.equal(finishButton("local-pending"), null);
assert.ok(!finishButton("merged").closest(".opacity-0"));
finishButton("merged").click();
await sleep(100);
// Sale de la barra en el clic, sin esperar al motor; si lo rechaza, vuelve.
assert.equal(finishButton("merged"), null);
assert.equal(finishApp.w.document.querySelector("[data-finish-celebration]"), null);
assert.equal(finishCalls.length, 1);
settleFinish();
await sleep(100);
assert.equal(finishButton("merged").getAttribute("aria-busy"), "false");
assert.equal(finishButton("merged").querySelector(".finish-task-flame"), null);
assert.equal(finishButton("merged").disabled, false);
assert.match(finishApp.w.document.body.textContent, /Trabajo pendiente/);
const finishToast = [...finishApp.w.document.querySelectorAll('[role="alert"]')].find(el => el.textContent.includes("Trabajo pendiente"));
assert.ok(finishToast, "El error de finalizar aparece en un toast");
assert.equal(finishToast.closest('[data-sesion]'), null);
finishToast.querySelector("button").click();
await sleep(50);
assert.doesNotMatch(finishApp.w.document.body.textContent, /Trabajo pendiente/);
assert.ok(finishButton("merged"));
assert.equal(finishApp.w.document.querySelector('[role="alertdialog"]'), null);
rejectFinish = false;
// La hija vive bajo su coordinador: el riel no la lista y su botón no está en él.
assert.equal(finishButton("child"), null);
// La barra ya no guarda un grupo de archivadas: la hija finalizada se va del todo.
assert.equal(finishApp.w.document.querySelector('button[aria-label="Desplegar la tarea archivada"]'), null);
finishButton("merged").click();
await sleep(50);
settleFinish();
await sleep(150);
assert.deepEqual(finishCalls, [{ project: "finish-project", id: "merged" }, { project: "finish-project", id: "merged" }]);
// Finalizada, la madre también sale de la barra; lo archivado vive en el historial.
assert.equal(finishApp.w.document.querySelector('[data-sesion="merged"]'), null);
assert.equal(finishApp.w.document.querySelector('button[aria-label="Desplegar la tarea archivada"]'), null);
assert.deepEqual(finishApp.fallos, []);

// El sondeo del entorno no puede retener el primer pintado. `Setup` decide
// con `setup_required`, que es un stat; lo caro va detrás y aquí no llega.
const mudo = await boot("mudo", "entorno-en-segundo-plano");
// `window_ready` sale del `onMount` de `App`: que se haya pedido ES que
// montó. La compuerta en blanco no llega a pintar ni su primer hijo.
assert.ok(mudo.comandos.includes("window_ready"), "la app monta sin esperar al sondeo");
assert.ok(mudo.w.document.querySelector("#root").children.length > 0);
assert.ok(
  mudo.comandos.includes("setup_required"),
  "y la compuerta es la barata, no el reporte",
);
assert.ok(
  mudo.comandos.includes("check_environment"),
  "el sondeo se sigue pidiendo, solo que nadie lo espera",
);
assert.deepEqual(mudo.fallos, []);

// El primer frame, mientras `setup_required` no contesta. Sin la foto del sidebar
// es «Preparando Terminus»; con ella, a quien ya usa Terminus no le parpadea el alta.
const sinContestar = { ...RESPUESTAS, setup_required: () => new Promise(() => {}) };
const nueva = await mount("listo", "primer-frame-sin-foto", sinContestar);
await sleep(100);
assert.equal(nueva.w.document.querySelector("[data-setup-skeleton]")?.dataset.setupSkeleton, "preparing");
assert.ok(nueva.w.document.body.textContent.includes("Preparando Danil"), "sin foto el primer frame no es la preparación");
const fotoDelSidebar = JSON.stringify({ workspace: "w", projects: [], sessions: {}, spaces: [], desk: null });
const conocida = await mount("listo", "primer-frame-con-foto", sinContestar, undefined, {
  "harness:shell-cache": JSON.stringify({ version: 2, last: "w", workspaces: { w: { saved: Date.now(), snapshot: fotoDelSidebar } } }),
});
await sleep(100);
assert.ok(conocida.w.document.querySelector("#root").children.length > 0, "con foto el primer frame queda en blanco");
assert.ok(!conocida.w.document.body.textContent.includes("Preparando Danil"), "con foto el alta parpadea a quien ya usa Terminus");
assert.notEqual(conocida.w.document.querySelector("[data-setup-skeleton]")?.dataset.setupSkeleton, "preparing");
assert.deepEqual([...nueva.fallos, ...conocida.fallos], []);

const blockerCalls = [];
const discarded = [];
const blockedFinishes = [];
let blockers = { unsaved: [{ session: "blocked", title: "Tarea blocked", files: ["src/a.ts"] }], not_finished: false };
const blockedApp = await boot("listo", "task-blockers", {
  ...TASK_AFTER_QUEUE,
  list_projects: [{ id: "blocked-project", name: "Avisos", node: null, sources: [], working_directory: "/lab", created_at: 1, updated_at: 1, sessions: 1, kind: "folder" }],
  list_live_sessions: ({ project }) => project === "blocked-project" ? [task("blocked", null, "delivered"), task("sin-integrar", null, "delivered")] : [],
  list_session_git: () => ({
    blocked: gitRow("feature/done", { pull: { number: 44, state: "merged", head_sha: "abc" }, pull_known: true }),
    "sin-integrar": gitRow("feature/otra", { pull: { number: 45, state: "merged", head_sha: "abc" }, pull_known: true }),
  }),
  task_blockers: args => { blockerCalls.push(args); return blockers; },
  discard_task_changes: args => {
    discarded.push(args);
    // La primera vez apareció un archivo con el aviso abierto; la segunda ya no queda nada.
    blockers = discarded.length === 1
      ? { unsaved: [{ session: "blocked", title: "Tarea blocked", files: ["llego-despues.txt"] }], not_finished: false }
      : { unsaved: [], not_finished: false };
    return null;
  },
  finish_task: args => { blockedFinishes.push(args); return null; },
});
const blockedFinish = () => blockedApp.w.document.querySelector('[data-sesion="blocked"] [data-session-finish]');
assert.ok(blockedFinish());
blockedFinish().click();
await sleep(100);
assert.deepEqual(blockerCalls, [{ project: "blocked-project", id: "blocked", finish: true }]);
assert.deepEqual(blockedFinishes, [], "no se mata un turno ni se toma un candado antes de que la persona decida");
const avisoDeCambios = blockedApp.w.document.querySelector('[role="dialog"]');
assert.ok(avisoDeCambios, "los cambios sin guardar avisan, no dan error");
assert.match(avisoDeCambios.textContent, /src\/a\.ts/, "el aviso nombra el archivo que estorba");
const descartar = [...avisoDeCambios.querySelectorAll("button")].find(b => b.textContent.trim() === "Descartar y continuar");
assert.ok(descartar, "el aviso lleva la salida, y borrar se pide explícitamente");
descartar.click();
await sleep(150);
assert.deepEqual(discarded, [{ project: "blocked-project", id: "blocked", files: ["src/a.ts"] }], "se descarta solo lo que el aviso enseñó");
assert.deepEqual(blockedFinishes, [], "lo que apareció con el aviso abierto para el gesto");
const avisoOtraVez = blockedApp.w.document.querySelector('[role="dialog"]');
assert.ok(avisoOtraVez, "lo nuevo se enseña en el aviso, no en un error plegado");
assert.match(avisoOtraVez.textContent, /llego-despues\.txt/);
assert.doesNotMatch(avisoOtraVez.textContent, /src\/a\.ts/);
[...avisoOtraVez.querySelectorAll("button")].find(b => b.textContent.trim() === "Descartar y continuar").click();
await sleep(150);
assert.deepEqual(discarded.at(-1), { project: "blocked-project", id: "blocked", files: ["llego-despues.txt"] });
assert.deepEqual(blockedFinishes, [{ project: "blocked-project", id: "blocked" }]);
assert.equal(blockedApp.w.document.querySelector('[role="dialog"]'), null);
// Finalizada, sale de la barra y no vuelve: el siguiente aviso va en otra tarea.
assert.equal(blockedFinish(), null);
blockers = { unsaved: [], not_finished: true };
blockedApp.w.document.querySelector('[data-sesion="sin-integrar"] [data-session-finish]').click();
await sleep(100);
const avisoSinIntegrar = blockedApp.w.document.querySelector('[role="dialog"]');
assert.ok(avisoSinIntegrar);
assert.equal([...avisoSinIntegrar.querySelectorAll("button")].find(b => b.textContent.trim() === "Descartar y continuar"), undefined,
  "una rama sin integrar no la arregla borrar archivos");
assert.ok([...avisoSinIntegrar.querySelectorAll("button")].some(b => b.textContent.trim() === "Archivar tarea"),
  "y la salida que sí conserva el trabajo se ofrece ahí");
assert.deepEqual(blockedFinishes.length, 1);
assert.deepEqual(blockedApp.fallos, []);

const localPath = "/Users/prueba/Library/Application Support/Terminus/exchange/finalizar-tarea.html";
const localPreviews = [];
const localLinks = await boot("listo", "local-file-links", {
  ...TASK_AFTER_QUEUE,
  load_session: {
    ...TASK_AFTER_QUEUE.load_session,
    turns: [{ role: "assistant", text: `[**Abrir mockup HTML**](<${localPath}>)\n\n[No ejecutar](javascript:alert%281%29)` }],
  },
  preview_file: (args) => {
    localPreviews.push(args);
    return { ...RESPUESTAS.preview_file, rel: args.rel };
  },
  artifact_history: () => Promise.reject("artifacts.history.not_in_workspace"),
});
localLinks.w.document.querySelector('[data-sesion="s1"]')?.click();
await sleep(150);
const localButton = [...localLinks.w.document.querySelectorAll("button, a")]
  .find(el => el.textContent.trim() === "Abrir mockup HTML");
assert.ok(localButton, "El enlace local debe conservar un control para abrirlo");
assert.equal(localButton.tagName, "BUTTON", "El menú nativo no debe navegar a una ruta local");
assert.equal(localPreviews.length, 0, "El archivo no se lee antes del clic");
assert.ok(![...localLinks.w.document.querySelectorAll("button, a")]
  .some(el => el.textContent.trim() === "No ejecutar"));
localButton.click();
await sleep(150);
assert.deepEqual(localPreviews, [{ path: localPath, rel: localPath }]);
assert.ok([...localLinks.w.document.querySelectorAll(':is([role="tab"], [data-preview-header] [role="button"])')]
  .some(el => el.textContent.trim() === "finalizar-tarea.html"));
assert.ok(localLinks.w.document.querySelector(".preview-path"));
assert.ok(!localLinks.comandos.includes("open_external"));
assert.ok(!localLinks.comandos.includes("site_open"));
assert.deepEqual(localLinks.fallos, []);
assert.ok(!localLinks.comandos.includes("artifact_history"),
  "un archivo fuera de la carpeta de la tarea no tiene cadena de versiones que leer");
assert.doesNotMatch(localLinks.w.document.body.textContent, /historial de este documento/);

const codeLinks = await boot("listo", "local-file-links-code", {
  ...TASK_AFTER_QUEUE,
  list_task_trees: [{ key: "work", name: "lab", path: "/lab", kind: "git", branch: "dev", missing: false, dirty_before: null }],
  load_session: {
    ...TASK_AFTER_QUEUE.load_session,
    turns: [{ role: "assistant", text: `[Afuera](<${localPath}>) · [Adentro](</lab/public/landing.html>)` }],
  },
  preview_file: (args) => ({ ...RESPUESTAS.preview_file, kind: "html", text: "<h1>Hola</h1>", rel: args.rel }),
  tree_show: { kind: "text", text: "<h1>Hola</h1>\n", data_url: null, bytes: 15, truncated: false },
  tree_patch: "",
  artifact_history: () => Promise.reject("artifacts.history.not_in_workspace"),
});
codeLinks.w.document.querySelector('[data-sesion="s1"]')?.click();
await sleep(150);
const boton = (texto) => [...codeLinks.w.document.querySelectorAll("button")].find(el => el.textContent.trim() === texto);
keepActiveView(codeLinks);
boton("Afuera").click();
await sleep(200);
const vistaDeCodigo = () => codeLinks.w.document.querySelector('[role="group"][aria-label="Cómo se ve el archivo"]');
assert.ok(vistaDeCodigo(), "en una tarea de código, un archivo de fuera abre en la vista de código");
assert.equal(codeLinks.w.document.querySelector(".preview-path"), null);
// La conversación solo está montada mientras se ve. Se vuelve a su pestaña para pulsar el otro enlace.
[...codeLinks.w.document.querySelectorAll(':is([role="tab"], [data-preview-header] [role="button"])')].find((el) => el.textContent.includes("Una tarea"))?.click();
await sleep(150);
boton("Adentro").click();
await sleep(200);
assert.ok(codeLinks.comandos.includes("tree_show"), "un archivo dentro del repositorio abre en su árbol, donde se escribe");
assert.ok(!codeLinks.comandos.includes("artifact_history"));
assert.doesNotMatch(codeLinks.w.document.body.textContent, /historial de este documento/);
assert.deepEqual(codeLinks.fallos, []);

/**
 * El primer arranque sin workspace: nace «Personal», se conecta una IA por los
 * eventos de su login, una de clave abre su panel y «Personaliza» renombra en
 * su sitio antes de entrar a la app.
 */
let altaActiva = null;
const altaCreados = [];
const altaRenombres = [];
const altaClaves = [];
let altaSesion = false;
const altaEspacios = () => ({
  workspaces: altaActiva ? [{ id: "n", name: "Personal", context_root: null }] : [],
  active: altaActiva,
  migrations: [],
});
const alta = await boot("listo", "alta", {
  ...RESPUESTAS,
  list_workspaces: altaEspacios,
  workspaces_startup: altaEspacios,
  list_language_packs: [], list_bundled_language_packs: [],
  list_providers: [
    { id: "codex", label: "Codex", available: true, sin_cuenta: false, source: "del sistema", system_broken: false, api_key: null, inferencia: "con_cuenta" },
    { id: "grok", label: "Grok", available: true, sin_cuenta: false, source: null, system_broken: false, api_key: "https://console.x.ai", inferencia: "con_cuenta" },
  ],
  list_surfaces: [],
  add_workspace: ({ name }) => { altaCreados.push(name); return { id: "n", name }; },
  set_active_workspace: ({ id }) => { altaActiva = id; },
  set_workspace_language: null,
  rename_workspace: ({ id, name }) => { altaRenombres.push(name); return { id, name }; },
  list_accounts: ({ provider: agent }) => ({
    provider: agent, env_var: "", shared_credential: null, secret_note: null, active: null,
    accounts: agent === "codex" && altaSesion
      ? [{ id: "a1", label: "", created_at: 1, identity: "yo@norte.mx", authenticated_at: 2 }]
      : [],
  }),
  add_account: ({ provider: agent }) => ({ id: agent === "codex" ? "a1" : "k1", label: "", created_at: 1, identity: null, authenticated_at: null }),
  login_account: null,
  set_api_key: ({ key }) => { altaClaves.push(key); },
  connect_api_key: ({ provider, key }) => { altaClaves.push(key); return { id: `k-${provider}`, label: "", created_at: 1, identity: null, authenticated_at: 1 }; },
  account_status: ({ id }) => ({ id, authenticated: id === "a1", detail: "" }),
  set_active_account: () => { altaSesion = true; },
  discard_account: true,
  list_git_hosts: [],
  list_known_mcp: [],
  list_mcp_providers: [],
  list_integrations: { workspace: "n", plugins: [] },
});
const altaDoc = alta.w.document;
const altaTitulo = () => altaDoc.querySelector("h1")?.textContent?.trim();
const altaBoton = (texto) => [...altaDoc.querySelectorAll("button")].find((b) => b.textContent?.trim() === texto);
await sleep(500);
assert.equal(altaTitulo(), "Conecta tu IA.", "sin workspace el alta empieza conectando la IA");
assert.deepEqual(altaCreados, ["Personal"], "el workspace por omisión se llama Personal");
assert.ok(altaDoc.body.textContent.includes("Encontramos en tu computadora"), "lo instalado en el sistema va arriba");
assert.ok(altaBoton("Continuar")?.disabled, "sin una IA conectada no se avanza");
altaBoton("Conectar").click();
await sleep(80);
alta.emit("account", { account: "a1", kind: "done", text: "" });
await sleep(150);
assert.ok(altaDoc.body.textContent.includes("yo@norte.mx"), altaDoc.body.textContent.slice(0, 800));
assert.ok(!altaBoton("Continuar")?.disabled, "con Codex conectado se puede seguir");
altaBoton("Conectar").click();
await sleep(80);
const altaClave = altaDoc.querySelector('input[type="password"]');
assert.ok(altaClave, "una IA de clave abre su panel en la tarjeta");
altaClave.value = "xai-123456789012";
altaClave.dispatchEvent(new alta.w.InputEvent("input", { bubbles: true }));
await sleep(20);
[...altaDoc.querySelectorAll("button")].filter((b) => b.textContent?.trim() === "Conectar").at(-1).click();
await sleep(150);
assert.deepEqual(altaClaves, ["xai-123456789012"]);
altaBoton("Continuar").click();
await sleep(150);
assert.equal(altaTitulo(), "Personaliza Danil.");
const altaNombre = altaDoc.querySelector('input[aria-label="Workspace"]');
altaNombre.value = "Norte";
altaNombre.dispatchEvent(new alta.w.InputEvent("input", { bubbles: true }));
altaNombre.dispatchEvent(new alta.w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
await sleep(80);
assert.deepEqual(altaRenombres, ["Norte"], "el nombre se cambia en su sitio");
altaBoton("Empezar").click();
await sleep(200);
assert.ok(!altaDoc.body.textContent.includes("Personaliza Danil."), "empezar entra a la app");
assert.deepEqual(altaCreados, ["Personal"], "el alta no crea otro workspace");
assert.deepEqual(alta.fallos, []);

// Los árboles montados conservan sus relojes: el proceso no termina solo.
process.exit(0);
