#!/usr/bin/env node
/**
 * **Que el front monte.** Arranca `dist/` de verdad y falla si el árbol no llega
 * a pintarse.
 *
 * Es el único guarda que ejecuta el árbol en vez de leerlo, y esa es la clase
 * entera que cubre: **lo que solo se rompe al ejecutar**. Un prop compuesto con
 * `&&` dentro del JSX entrega `false` y no `null` —el compilador de Solid lo
 * booleaniza para memoizarlo—, así que el hijo lanza en el primer render y la
 * app abre en el esqueleto de `Setup`. `tsc` no puede verlo: para TypeScript esa
 * expresión es `T[] | null`, y la reescritura ocurre después, en Babel.
 *
 * **En jsdom y no en un navegador**, porque un guarda no puede abrirle una
 * ventana en la cara a nadie: con varias ramas en QA, una que aparece sola se
 * confunde con la que alguien está mirando. Lo que cuesta: jsdom no es WebKit ni
 * WebView2, así que esto afirma que **el árbol monta**, no que se vea bien.
 *
 * **El IPC va stubeado, y el stub es parte del guarda.** Sin
 * `__TAURI_INTERNALS__` el primer `invoke` rechaza y `Setup` no llega a montar
 * `App`, que es el código que hay que ejercitar. Un comando sin respuesta **no**
 * rompe el guarda: se rechaza igual que rechazaría un backend que falla. Se
 * arranca con la lista de superficies vacía a propósito, que es el instante en
 * que se rompió.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { boot as mount, cause, dist, sleep } from "../../tests/helpers/jsdom-app.mjs";
import { spaceScenarios } from "../../tests/helpers/mount-spaces.mjs";
import { taskNoticeScenarios } from "../../tests/helpers/mount-task-notices.mjs";

/**
 * Lo que el arranque pregunta, contestado con lo mínimo creíble.
 *
 * No pretende ser el backend: es el **primer arranque de un workspace recién
 * creado**, que es el estado más pobre que la app tiene que aguantar —sin
 * proyectos, sin fuentes, sin sesiones—. La primera superficie no sirve y la
 * segunda sí: el arranque tiene que elegir la usable, no la primera fila.
 */
const RESPUESTAS = {
  // La ventana ya tiene motor: el lanzador deja pasar a la app.
  launcher_state: { phase: "ready", blank_0274: false },
  // La medida de arranque: la manda `App` en cuanto monta, en todos los casos.
  window_ready: null,
  // Lo que crece en la ventana: se manda al montar y cada pocos minutos.
  window_vitals: null,
  // Si otra versión quedó instalada sobre la ventana: se mira cada minuto.
  update_pending: false,
  // La compuerta del primer pintado. `false` monta la app sin esperar nada.
  setup_required: false,
  list_providers: [
    { id: "claude", label: "Claude Code", available: true, driver: true },
    { id: "codex", label: "Codex", available: true, driver: true },
  ],
  list_workspaces: { workspaces: [{ id: "w", name: "W", context_root: null }], active: "w" },
  machine_list: [{ id: "local", local: true, active: true, on: true, hosts: true }],
  workspaces_startup: { workspaces: [{ id: "w", name: "W", context_root: null }], active: "w" },
  list_projects: [],
  list_sources: [],
  list_live_sessions: [],
  list_mentions: { fuentes: [], archivos: [] },
  list_models: {
    provider: "codex",
    models: [
      {
        id: "gpt-5.6", label: "GPT-5.6", gratis: null, efforts: [], default_effort: null,
        note: { clave: "chat.model.note.local_loaded", datos: { engine: "Ollama" } },
      },
    ],
    fallback: false,
  },
  // La primera coincide con el agente que trae el estado inicial, pero no se
  // puede usar. Codex sí: el selector y su modelo tienen que arrancar ahí.
  list_surfaces: [
    { id: "claude", provider: "claude", label: "Claude Code", catalogo: "todo", usable: false, marca: "sin conectar", porque: "Falta conectar la cuenta." },
    { id: "codex", provider: "codex", label: "Codex", catalogo: "todo", usable: true, marca: null, porque: null },
  ],
  send_message: "sesion-1",
  session_folder: "/tmp",
  list_task_trees: [],
  watch_task_tree: "watch-test",
  unwatch_task_tree: null,
  preview_file: {
    rel: "informe.md",
    kind: "text",
    text: "# Hola",
    data_url: null,
    bytes: 7,
    truncated: false,
  },
  artifact_history: { current: null, versions: [] },
  publications_of: [],
  list_live_turns: [],
  service_poll: { cursor: 0, gap: false, replay: false, runtime: "test-service", reset: false },
};

/**
 * **Un workspace con una tarea ya hecha**, que es el estado que hace falta para
 * ejercitar la columna derecha y la tira del centro: sin tarea abierta no hay
 * carpeta de trabajo, así que no hay nada que listar ni que abrir.
 *
 * Va aparte y no dentro de `RESPUESTAS` porque aquel describe el **primer**
 * arranque —sin proyectos, sin fuentes, sin sesiones— y es lo que hace que este
 * guarda pruebe el estado más pobre que la app tiene que aguantar.
 */
const CON_TAREA = {
  ...RESPUESTAS,
  list_live_sessions: [
    {
      id: "s1",
      title: "Una tarea",
      last_message: "La última respuesta de esta tarea",
      provider: "codex",
      model: "gpt-5.6",
      refs: [],
      updated_at: 0,
      turns: 1,
      parent: null,
      esperando: false,
    },
  ],
  task_history: { history: { archived: false, events: [], recovery: null }, branch: null, path: "/lab", available: true, owned: false, restorable: false, incomplete: false },
  load_session: {
    id: "s1",
    provider: "codex",
    sources: [],
    model: "gpt-5.6",
    effort: null,
    permission_mode: null,
    // Un turno que entregó algo: la tarjeta de entrega del hilo es por donde
    // se abre un artefacto en la tira del centro (abajo).
    turns: [
      {
        role: "assistant",
        text: "Listo.",
        artifacts: [{ rel: "informe.md", bytes: 7, revision: false }],
      },
    ],
  },
  load_queue: [],
  session_usage: null,
};

const SIN_USABLE = {
  ...RESPUESTAS,
  list_models: { provider: "claude", models: [], fallback: false },
  list_surfaces: [RESPUESTAS.list_surfaces[0]],
};

const boot = (entorno, version, respuestas = RESPUESTAS, userAgent) =>
  mount(entorno, version, respuestas, userAgent);

const keepActiveView = (app) => {
  const header = app.w.document.querySelector('[data-preview-header] [role="button"]');
  header?.dispatchEvent(new app.w.MouseEvent("dblclick", { bubbles: true }));
};

/** El riel agrupado por carpeta, que es su vista por omisión: una carpeta tiene cabecera y se abre su vista. */
const SIN_AGRUPAR = { "harness.layout.sidebar.view.w": JSON.stringify({ group: "none" }) };
const bootPorCarpeta = async (entorno, version, respuestas = RESPUESTAS) => {
  const app = await mount(entorno, version, respuestas);
  // La cabecera de carpeta llega en su propio trozo: se espera a que pinte.
  for (let i = 0; i < 80 && !app.w.document.querySelector("[data-folder-open]"); i++) await sleep(25);
  return app;
};

/** El buscador global, abierto desde la lupa de la franja y con `texto` escrito. */
async function buscarEnLaVentana(app, texto) {
  const doc = app.w.document;
  if (!doc.querySelector("[data-global-search]")) doc.querySelector("[data-title-bar] [data-global-search-open]").click();
  await sleep(80);
  const campo = doc.querySelector('[data-global-search] input[role="combobox"]');
  campo.value = texto;
  campo.dispatchEvent(new app.w.Event("input", { bubbles: true }));
  await sleep(80);
  return campo;
}

/** Abre una tarea desde el buscador global, el mismo gesto que su fila del riel. */
async function abrirDesdeElBuscador(app, texto, id) {
  await buscarEnLaVentana(app, texto);
  app.w.document.querySelector(`[data-global-search] [data-search-key="task:${id}"]`).click();
  await sleep(160);
}

/** Añadir un proyecto se abre desde el selector de la caja de una tarea nueva. */
async function abrirAnadirProyecto(app) {
  const doc = app.w.document;
  doc.querySelector('button[aria-label="Nueva tarea"]').click();
  await sleep(50);
  doc.querySelector('button[aria-label="Proyecto"]').click();
  await sleep(50);
  [...doc.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith("Añadir un proyecto…")).click();
  await sleep(50);
}

/** Abre la vista de la carpeta desde su cabecera y empieza a hablar con uno de sus agentes. */
async function hablarDesdeLaCarpeta(app, carpeta, nombre) {
  const doc = app.w.document;
  for (let i = 0; i < 80 && !doc.querySelector(`[data-folder-group="${carpeta}"] [data-folder-open]`); i++) await sleep(25);
  doc.querySelector(`[data-folder-group="${carpeta}"] [data-folder-open]`).click();
  await sleep(120);
  const agente = [...doc.querySelectorAll("li > button")].find((b) => b.querySelector(".astro-face") && b.textContent.trim().startsWith(nombre));
  assert.ok(agente, `la vista de la carpeta lista a ${nombre}`);
  agente.click();
  await sleep(100);
}

/**
 * **El esqueleto de `Setup` es el síntoma exacto**, no una pantalla más.
 *
 * Cuando el primer render de `App` lanza, la excepción sube por el `setEnv` de
 * `Setup.revisar`, la traga su `try`, y el árbol se queda a medias en el
 * `Skeleton` que ya estaba pintado. Eso es lo que se vio en producción: tres
 * barras grises y ni un error.
 */
const enElEsqueleto = (html) => html.includes("setup-card") && html.includes("aria-busy");

await taskNoticeScenarios({ boot, sleep, responses: CON_TAREA });

const t0 = Date.now();
const normal = await boot("listo", 1);

const roto = normal.fallos.length > 0 || !normal.pintado.trim() || enElEsqueleto(normal.pintado);

if (!roto) {
  await sleep(1600);
  const storage = normal.w.document.querySelector('button[aria-label="Máquinas"]');
  if (normal.storageQueries.length || !storage) {
    console.error("Máquinas debe estar disponible sin barrer el disco con el panel cerrado.");
    process.exit(1);
  }
  normal.emit("harness:turno-cerrado", {});
  normal.emit("harness:turn", 0);
  normal.w.dispatchEvent(new normal.w.Event("focus"));
  await sleep(1800);
  if (normal.storageQueries.length) {
    console.error(
      `Con el panel cerrado no se vuelve a barrer el disco: ${normal.storageQueries.join(",")}.`,
    );
    process.exit(1);
  }
  storage.click();
  await sleep(200);
  assert.deepEqual(normal.storageQueries, [true], "abrir almacenamiento mide sólo el detalle seleccionado");
  assert.ok(normal.w.document.body.textContent.includes("1.0 GB"), "el panel muestra el tamaño lógico medido");
  storage.click();
  await sleep(50);
  const placeholder = normal.w.document.querySelector("textarea")?.getAttribute("placeholder");
  if (!placeholder?.startsWith("Pregunta algo")) {
    console.error(
      `El campo de escribir no invita a escribir: placeholder=${JSON.stringify(placeholder)}.`,
    );
    process.exit(1);
  }
  const selectorSeparado = normal.w.document.querySelector('select[title="Quién responde"]');
  const modelo = normal.w.document.querySelector('button[title="Con qué modelo responde"]');
  modelo?.dispatchEvent(new normal.w.MouseEvent("click", { bubbles: true }));
  await sleep(50);
  const gruposDeModelos = [...normal.w.document.querySelectorAll('[role="group"]')]
    .map((grupo) => grupo.getAttribute("aria-label"));
  const notaDelModelo = normal.w.document.querySelector('[role="option"]')?.getAttribute("title");
  assert.equal(notaDelModelo, "en esta computadora, con Ollama", "a model note from the app goes through the catalogue");
  if (selectorSeparado || modelo?.getAttribute("aria-label") !== "Modelo: GPT-5.6") {
    console.error(
      `El chat no arrancó en el modelo usable del selector único: modelo=${JSON.stringify(modelo?.getAttribute("aria-label"))}, grupos=${JSON.stringify(gruposDeModelos)}.`,
    );
    process.exit(1);
  }

  modelo.click();
  const campo = normal.w.document.querySelector("textarea");
  campo.value = "Empieza la tarea";
  campo.dispatchEvent(new normal.w.InputEvent("input", { bubbles: true }));
  await sleep(10);
  normal.w.document.querySelector('button[aria-label="Preguntar"]')?.click();
  await sleep(100);
  // Mandar el primer mensaje mueve la caja del centro al pie y la remonta: sin
  // recuperar el foco, encolar lo siguiente pide otro clic. Es el único
  // `focus()` automático que el compositor tiene derecho a hacer.
  if (normal.w.document.activeElement !== normal.w.document.querySelector("textarea")) {
    console.error("Tras mandar el primer mensaje el compositor no recuperó el foco.");
    process.exit(1);
  }
  const modeloTrasEmpezar = normal.w.document.querySelector(
    'button[aria-label="Modelo: GPT-5.6"]',
  );
  modeloTrasEmpezar?.dispatchEvent(new normal.w.MouseEvent("click", { bubbles: true }));
  await sleep(50);
  if (modeloTrasEmpezar?.disabled || !normal.w.document.querySelector('[role="group"]')) {
    console.error(
      "El modelo no se puede elegir para el siguiente turno mientras el actual responde.",
    );
    process.exit(1);
  }
  modeloTrasEmpezar?.dispatchEvent(new normal.w.MouseEvent("click", { bubbles: true }));

  /**
   * **La barra de arriba conduce las dos columnas.**
   *
   * Los dos conmutadores viven en la fila de los botones de la ventana y no
   * dentro de las columnas que colapsan: si esa barra no monta, la única forma
   * de recuperar el historial se va con ella y no queda nada en pantalla que lo
   * diga.
   */
  const ocultar = normal.w.document.querySelector(
    'button[aria-label="Ocultar el historial"]',
  );
  ocultar?.click();
  await sleep(50);
  const mostrar = normal.w.document.querySelector(
    'button[aria-label="Mostrar el historial"]',
  );
  if (!ocultar || !mostrar) {
    console.error(
      `La barra de ventana no conduce el historial: ocultar=${!!ocultar}, mostrar=${!!mostrar}.`,
    );
    process.exit(1);
  }
  mostrar.click();
  await sleep(50);

  // Abre el panel de archivos de la tarea para ejecutar también su render.
  const arbol = normal.w.document.querySelector('button[aria-label="Archivos de la tarea"]');
  if (!arbol) {
    console.error("Con una tarea abierta no aparece el botón de sus archivos.");
    process.exit(1);
  }
  arbol.click();
  await sleep(300);
  const tirador = normal.w.document.querySelector('[role="separator"][aria-label="Ancho del panel de archivos"]');
  const panelDeArchivos = normal.w.document.querySelector("[data-task-files]");
  if (!tirador || !panelDeArchivos || normal.fallos.length > 0) {
    console.error(`El panel de archivos de la tarea no montó: tirador=${!!tirador}, tarjeta=${!!panelDeArchivos}.`);
    for (const f of normal.fallos.slice(0, 3)) {
      for (const l of String(f).split("\n").slice(0, 6)) console.error(`      ${l}`);
    }
    process.exit(1);
  }

  /**
   * El semáforo de Windows lo traen dos cabeceras —la del chasis y la del
   * panel derecho—, y solo una de las dos puede estar a la vista. Con la
   * columna abierta se veían los dos juegos, el del chasis a mitad de
   * pantalla. En macOS no se ve: ahí el semáforo es nativo.
   */
  const semaforo = await boot(
    "listo",
    "window-controls",
    CON_TAREA,
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
  );
  // Una columna cerrada mide cero y esconde lo suyo, pero sus nodos siguen en
  // el documento: contar por selector da dos con la columna cerrada. jsdom no
  // calcula geometría, y lo único que queda para filtrarlos es su ancho en
  // línea.
  const semaforos = () =>
    [...semaforo.w.document.querySelectorAll('button[aria-label="Cerrar Danil"]')]
      .filter((boton) => !boton.closest('[style*="width: 0px"]')).length;
  // El tirador es lo único que distingue abierta de cerrada: la cabecera de la
  // columna sigue en el documento colapsada, y su botón de cerrar con ella.
  const columnaAbierta = () =>
    Boolean(semaforo.w.document.querySelector('[role="separator"][aria-label="Ancho del panel de archivos"]'));
  assert.equal(columnaAbierta(), false, "la columna nace cerrada");
  assert.equal(semaforos(), 1, "con la columna cerrada el semáforo es el del chasis");
  semaforo.w.document.querySelector('[data-sesion="s1"]').click();
  await sleep(150);
  semaforo.w.document.querySelector('[aria-label="Archivos de la tarea"]').click();
  await sleep(300);
  assert.equal(columnaAbierta(), true, "el conmutador tiene que abrir el panel de archivos");
  assert.equal(semaforos(), 1, "con la columna abierta el semáforo no se duplica");
  assert.deepEqual(semaforo.fallos, []);
  semaforo.w.close();

  /**
   * **Lo que el hilo anuncia se lee en el centro, como una pestaña más.**
   *
   * Es el corte que juntó las dos tiras de pestañas en una
   * (`lib/tabs.ts`): un artefacto y un archivo dejaron de leerse dentro de
   * la columna —una tira metida en otra, a la mitad del ancho— y pasaron a
   * montarse como hermanos de la conversación. Un visor que lance ahí se lleva
   * **el espacio principal entero**, y eso `tsc` no lo ve: son props que solo
   * existen al abrir la pestaña. La fila es la de la tarjeta de entrega
   * (`chat/Delivery.tsx`), que arma la ruta con `session_folder`.
   */
  const treeReads = [];
  const watchedTrees = new Map();
  let externalPaths = ["src/example.ts"];
  const treeResponses = {
    ...CON_TAREA,
    list_live_sessions: [CON_TAREA.list_live_sessions[0], { ...CON_TAREA.list_live_sessions[0], id: "s2", title: "Segunda tarea" }],
    load_session: ({ id }) => ({ ...CON_TAREA.load_session, id }),
    list_task_trees: [{ key: "work", name: "Workspace", path: "/lab", kind: "git", branch: "dev", missing: false, dirty_before: null }],
    watch_task_tree: ({ session, changes }) => { watchedTrees.set(session, changes); return session; },
    unwatch_task_tree: ({ id }) => { watchedTrees.delete(id); },
    tree_files: ({ session }) => {
      treeReads.push(session);
      return { paths: externalPaths, folders: [{ path: ".venv", repo: false, lazy: true, ignored: true }], truncated: false };
    },
    tree_folder: ({ path, offset }) => {
      const total = path === ".venv" ? 450 : 0;
      const hasta = Math.min(total, offset + 300);
      const paths = Array.from({ length: hasta - offset }, (_, i) => `${path}/m${String(offset + i).padStart(4, "0")}.py`);
      return { paths, folders: [], next: hasta < total ? hasta : null, total };
    },
    tree_git_status: [],
    tree_summary: { base: "HEAD", files: [], added: 0, removed: 0 },
  };
  const treeApp = await boot("listo", "tree-persistence", treeResponses);
  const treeDocument = treeApp.w.document;
  const clickTree = (selector) => {
    const element = treeDocument.querySelector(selector);
    assert.ok(element, selector);
    element.click();
  };
  clickTree('[data-sesion="s1"]');
  await sleep(150);
  const previewDraftField = treeDocument.querySelector("textarea");
  previewDraftField.value = "borrador de la vista temporal";
  previewDraftField.dispatchEvent(new treeApp.w.Event("input", { bubbles: true }));
  clickTree('[data-sesion="s2"]');
  await sleep(150);
  assert.equal(treeDocument.querySelectorAll("[data-preview]").length, 1, "abrir otra tarea sustituye la temporal");
  assert.equal(treeDocument.querySelector('[role="tab"]'), null, "las aperturas sucesivas no acumulan pestañas");
  clickTree('[data-sesion="s1"]');
  await sleep(150);
  assert.equal(treeDocument.querySelector("textarea").value, "borrador de la vista temporal", "sustituir conserva el borrador de la tarea");
  const keepPreview = () => {
    const header = treeDocument.querySelector('[data-preview-header] [role="button"]');
    assert.ok(header, "una vista nueva tiene cabecera temporal fuera de la tira");
    header.dispatchEvent(new treeApp.w.MouseEvent("dblclick", { bubbles: true }));
  };
  assert.equal(treeDocument.querySelector('[role="tablist"] [data-preview]'), null);
  assert.equal(treeDocument.querySelector('[role="tab"]'), null, "abrir no conserva una pestaña");
  keepPreview();

  clickTree('[aria-label="Archivos de la tarea"]');
  await sleep(300);
  const venv = () => [...treeDocument.querySelectorAll('button[aria-expanded]')].find((button) => button.textContent.trim() === ".venv");
  assert.ok(venv(), "a heavy ignored folder shows folded");
  const enVenv = () => [...treeDocument.querySelectorAll("button[data-ruta]")].filter((b) => b.dataset.ruta.startsWith(".venv/")).length;
  assert.equal(enVenv(), 0, "a folded folder lists nothing until it is opened");
  venv().click();
  await sleep(150);
  assert.equal(enVenv(), 300, "opening a folded folder loads its first page");
  const mas = [...treeDocument.querySelectorAll("button")].find((b) => b.textContent.includes("Mostrar más"));
  assert.ok(mas, "a folded folder offers its next page");
  mas.click();
  await sleep(150);
  assert.equal(enVenv(), 450, "the next page is appended");
  assert.equal([...treeDocument.querySelectorAll("button")].some((b) => b.textContent.includes("Mostrar más")), false);
  venv().click();
  await sleep(50);
  assert.equal(venv().getAttribute("aria-expanded"), "false");
  const directory = [...treeDocument.querySelectorAll('button[aria-expanded]')].find((button) => button.textContent.trim() === "src");
  assert.ok(directory);
  directory.click();
  assert.deepEqual(treeReads, ["s1"]);
  clickTree('[data-sesion="s2"]');
  await sleep(150);
  keepPreview();
  clickTree('[aria-label="Archivos de la tarea"]');
  await sleep(300);
  clickTree('[role="tab"][data-pestana="0"]');
  await sleep(150);
  assert.deepEqual(treeReads, ["s1", "s2"], "switching tabs must reuse the loaded tree");
  assert.equal(directory.isConnected, true);
  assert.equal(directory.getAttribute("aria-expanded"), "true");
  clickTree('[aria-label="Archivos de la tarea"]');
  await sleep(50);
  clickTree('[aria-label="Archivos de la tarea"]');
  await sleep(150);
  assert.deepEqual(treeReads, ["s1", "s2"], "reopening the column must reuse the tree");
  treeApp.w.dispatchEvent(new treeApp.w.CustomEvent("harness:arboles", { detail: { session: "s2" } }));
  await sleep(100);
  assert.deepEqual(treeReads, ["s1", "s2"], "hidden trees defer changes");
  clickTree('[role="tab"][data-pestana="1"]');
  await sleep(150);
  assert.deepEqual(treeReads, ["s1", "s2", "s2"], "changed trees refresh when shown");
  treeApp.w.dispatchEvent(new treeApp.w.CustomEvent("harness:copia"));
  await sleep(150);
  assert.deepEqual(treeReads, ["s1", "s2", "s2", "s2"], "saving refreshes only the visible tree once");
  treeDocument.querySelector('[role="tab"][data-pestana="0"]').dispatchEvent(new treeApp.w.KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
  await sleep(100);
  assert.equal(directory.isConnected, false, "closing a task releases its tree");
  assert.equal(watchedTrees.has("s1"), false, "closing the task releases its filesystem watcher");
  externalPaths = ["src/example.ts", "testsync.md"];
  watchedTrees.get("s2").onmessage();
  await sleep(850);
  assert.ok([...treeDocument.querySelectorAll("button")].some((button) => button.textContent.trim() === "testsync.md"));
  externalPaths = ["src/example.ts"];
  watchedTrees.get("s2").onmessage();
  await sleep(850);
  assert.equal([...treeDocument.querySelectorAll("button")].some((button) => button.textContent.trim() === "testsync.md"), false);

  assert.equal(treeApp.fallos.length, 0);
  treeApp.w.close();

  const closeAllViews = await boot("listo", "close-all-retained-views", CON_TAREA);
  const closeAllDoc = closeAllViews.w.document;
  closeAllDoc.querySelector('[data-sesion="s1"]').click();
  await sleep(150);
  keepActiveView(closeAllViews);
  closeAllDoc.querySelector('button[title="informe.md"]').click();
  await sleep(150);
  keepActiveView(closeAllViews);
  closeAllDoc.querySelector('[role="tab"]').dispatchEvent(new closeAllViews.w.MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  await sleep(100);
  const closeAllAction = [...closeAllDoc.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent.trim() === "Cerrar todas");
  assert.ok(closeAllAction);
  closeAllAction.focus();
  closeAllAction.dispatchEvent(new closeAllViews.w.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  await sleep(150);
  assert.equal(closeAllDoc.querySelector('[data-tira] [role="tab"], [data-preview]'), null, "cerrar todas no reabre la tarea propietaria de un documento");
  assert.deepEqual(closeAllViews.fallos, []);
  closeAllViews.w.close();

  const filaDeAgente = {
    provider: "codex", model: "gpt-5.6", refs: [], created_at: 0, updated_at: 0, turns: 1,
    parent: null, subagent: null, esperando: false, stage: null,
    agent: "Holmes", parent_agent: null, last_message: "Listo.",
  };
  const policyCalls = [];
  const bubbleResponses = {
    handler_action: ({ input }) => {
      policyCalls.push(input);
      const action = input.request.action;
      if (action === "list") return { handlers: [{ name: "Watson", memory: { store: { slot: "notes" }, status: "unavailable", reason: "UNAPPROVED_SENTINEL", identity: "watson", entries: 0, synced: false } }] };
      if (action === "requests") return { handler: "Watson", source: "project", key: "watson", digest: "digest", dirty: false, approval: null, stale: null, requests: [{ kind: "memory", slot: "notes", state: "approved", server: "notes-server", granted_access: "read" }] };
      if (action === "release") throw { what: "Pending", detail: { code: "wait_timed_out", detail: { operation: "handler-op" } } };
      if (action === "resume") return { handler: "Watson", identity: "watson", released: true, quarantine: null, digest: "digest" };
      throw new Error("Unexpected handler action");
    },
    ...CON_TAREA,
    list_projects: [{ id: "p", name: "Proyecto", node: null, sources: [] }],
    list_live_sessions: [
      { ...filaDeAgente, id: "s-chat", title: "Holmes", chat_de_agente: true },
      { ...filaDeAgente, id: "s-task", title: "Una tarea", chat_de_agente: false },
      { ...filaDeAgente, id: "s-plain", title: "Tarea suelta", agent: null, chat_de_agente: false },
    ],
    list_agents: {
      agents: [{
        name: "Holmes", description: "", instructions: "", tools: [], model: null,
        origin: ".danil/agents/holmes.md", folder: null, providers: ["codex"], own: false, own_scope: null,
      }],
      rechazados: [],
    },
    list_agent_status: [{ name: "Holmes", status: "awake", minutes_since_last_turn: 1, live_tasks: 0 }],
    list_agent_profiles: {},
    keep_awake_status: { mode: "agent", active: false, supported: true },
    save_agent_profile: (args) => {
      return { display_name: args.displayName, body: args.body, background: null, avatar: null, veil: args.veil, provider: null, model: null, effort: null, hidden: false };
    },
    set_keep_awake: ({ mode }) => {
      return { mode, active: mode === "on", supported: true };
    },
    has_mcp_app: ({ server, tool }) => server === "canvas" && tool === "draw",
    read_mcp_app: ({ tool }) => tool === "draw" ? {
      html: "<p>Canvas de prueba</p>", resource_uri: "ui://canvas/view.html",
      tool: { name: "draw", inputSchema: { type: "object" } }, connection_id: "canvas-test",
    } : null,
    close_mcp_app: null,
    load_session: ({ id }) => ({
      ...CON_TAREA.load_session,
      id,
      turns: [
        { role: "user", text: "¿Cómo vas?" },
        { role: "agent", text: "Voy bien.", duration_ms: 1200, author: { kind: "codex", name: null, verified_by: null, account: null }, model_vendor: "Codex", model: "gpt-5.6", tools: id === "s-chat" ? [
          { name: "mcp__canvas__draw", ok: true, mcp_app: { server: "canvas", tool: "draw", result: { content: [] } } },
          { name: "mcp__canvas__lookup", ok: true, mcp_app: { server: "canvas", tool: "lookup", result: { content: [] } } },
          { name: "atlassian·getConfluencePage", ok: true, mcp_app: { server: "atlassian", tool: "getConfluencePage", result: { content: [] } } },
        ] : [] },
        ...(id === "s-task" ? [
          { role: "user", text: "Continúa con Claude." },
          { role: "agent", text: "Listo tras el traspaso.", author: { kind: "claude", name: null, verified_by: null, account: null }, model_vendor: "Claude Code", model: "claude-sonnet-5" },
        ] : []),
      ],
    }),
  };
  const bubbleApp = await boot("listo", "agent-bubble", {
    ...bubbleResponses,
    list_live_sessions: [
      ...bubbleResponses.list_live_sessions,
      { ...filaDeAgente, id: "s-transfer", title: "Revisar entrega", agent: "Watson", chat_de_agente: false },
    ],
    list_agents: { ...bubbleResponses.list_agents, agents: [
      { ...bubbleResponses.list_agents.agents[0], own: true },
      { ...bubbleResponses.list_agents.agents[0], name: "Watson", own: true },
    ] },
    telegram_status: { token_saved: false, bot_username: null, enabled: false, paired_chats: 0, pairing: null, topics_enabled: false, topics: 0 },
    queue_ready: false,
    load_queue: ({ session }) => session === "s-chat" ? [{
      id: "compact-queue", text: "Mensaje pendiente", provider: "codex", model: null,
      effort: null, permission_mode: null, attachments: [],
    }] : [],
  });
  const bubbleDocument = bubbleApp.w.document;
  await sleep(80);
  // El riel solo lista tareas, de todas las carpetas en una lista: los agentes ya no tienen sección.
  assert.equal(bubbleDocument.querySelector("[data-sidebar-agents]"), null, "el riel no lista agentes");
  const filasDelRiel = () => [...bubbleDocument.querySelectorAll('[data-sidebar-tasks] [data-sesion]')].map((f) => f.dataset.sesion);
  assert.ok(bubbleDocument.querySelector('[data-sidebar-tasks] [data-sesion="s-task"] [data-session-agent]'), "la tarea lleva la pastilla de su agente");
  assert.equal(bubbleDocument.querySelector("[data-sidebar-search]"), null, "el riel ya no lleva buscador: busca la franja");
  const halladas = () => [...bubbleDocument.querySelectorAll('[data-global-search] [data-search-key^="task:"]')].map((f) => f.dataset.searchKey.slice(5));
  const buscador = await buscarEnLaVentana(bubbleApp, "REVISAR");
  assert.deepEqual(halladas(), ["s-transfer"], "busca sin importar mayúsculas");
  await buscarEnLaVentana(bubbleApp, "revisár");
  assert.deepEqual(halladas(), ["s-transfer"], "ni acentos");
  await buscarEnLaVentana(bubbleApp, "watson");
  assert.deepEqual(halladas(), ["s-transfer"], "encuentra la tarea por el nombre de su agente");
  await buscarEnLaVentana(bubbleApp, "");
  const elegida = () => bubbleDocument.querySelector('[data-global-search] [role="option"][aria-selected="true"]')?.dataset.searchKey;
  const primera = elegida();
  assert.ok(primera, "sin texto enseña las recientes con la primera elegida");
  buscador.dispatchEvent(new bubbleApp.w.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  await sleep(30);
  assert.notEqual(elegida(), primera, "↓ baja a la siguiente");
  buscador.dispatchEvent(new bubbleApp.w.KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
  await sleep(30);
  assert.equal(elegida(), primera, "↑ vuelve");
  buscador.dispatchEvent(new bubbleApp.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await sleep(80);
  assert.equal(bubbleDocument.querySelector("[data-global-search]"), null, "Escape cierra el buscador");
  assert.ok(filasDelRiel().includes("s-task") && filasDelRiel().includes("s-plain"), "el riel sigue con la lista entera");

  // Los agentes están en el dock del pie: pulsar uno abre su chat, como su fila
  // de antes; el clic derecho ofrece ver sus tareas, que filtra la lista.
  const dock = () => bubbleDocument.querySelector('[role="group"][aria-label="Agentes"]');
  for (let i = 0; i < 80 && !dock(); i++) await sleep(25);
  const caraDe = (nombre) => [...(dock()?.querySelectorAll("[data-dock-agent]") ?? [])].find((b) => b.getAttribute("aria-label").startsWith(nombre));
  assert.ok(caraDe("Holmes"), "el dock enseña a Holmes");
  assert.match(caraDe("Holmes").getAttribute("aria-label"), /Despierto/, "su cara dice cómo está");
  assert.equal(caraDe("Holmes").getAttribute("title"), null, "el nombre va en un tooltip propio, no en `title`");
  caraDe("Holmes").dispatchEvent(new bubbleApp.w.PointerEvent("pointerenter", { bubbles: false, pointerType: "mouse" }));
  caraDe("Holmes").dispatchEvent(new bubbleApp.w.PointerEvent("pointermove", { bubbles: true, pointerType: "mouse" }));
  await sleep(300);
  assert.match(bubbleDocument.querySelector('[role="tooltip"]')?.textContent ?? "", /Holmes.*Despierto/, "pasar por la cara enseña su nombre y su estado");
  caraDe("Holmes").dispatchEvent(new bubbleApp.w.PointerEvent("pointerleave", { bubbles: false, pointerType: "mouse" }));
  caraDe("Holmes").click();
  await sleep(150);
  assert.match(bubbleDocument.querySelector("h1")?.textContent ?? "", /Holmes/, "pulsar la cara abre el chat con el agente");
  assert.ok(filasDelRiel().includes("s-plain"), "pulsar la cara no filtra la lista");
  caraDe("Holmes").dispatchEvent(new bubbleApp.w.MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  await sleep(120);
  const verSusTareas = [...bubbleDocument.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent.trim() === "Ver sus tareas");
  assert.ok(verSusTareas, "el clic derecho ofrece ver sus tareas");
  assert.ok([...bubbleDocument.querySelectorAll('[role="menuitem"]')].some((el) => el.textContent.trim() === "Configuración del agente"));
  verSusTareas.dispatchEvent(new bubbleApp.w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await sleep(120);
  assert.ok(filasDelRiel().includes("s-task") && !filasDelRiel().includes("s-plain"), "ver sus tareas filtra por el agente");
  assert.equal(bubbleDocument.querySelector("button[data-personalize] span"), null, "Personalizar no lleva contador de filtros");
  bubbleDocument.querySelector("button[data-personalize]").click();
  await sleep(80);
  [...bubbleDocument.querySelectorAll('[role="menu"] [role="group"][aria-label="Agente"] [role="menuitemradio"]')].find((b) => b.textContent.trim() === "Todos").click();
  await sleep(80);
  bubbleDocument.activeElement?.dispatchEvent(new bubbleApp.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await sleep(80);
  assert.ok(filasDelRiel().includes("s-plain"), "«Todos» en el menú de filtro quita el filtro");

  bubbleDocument.querySelector('[data-sidebar-tasks] [data-sesion="s-chat"]').click();
  await sleep(300);
  const globos = () => [...bubbleDocument.querySelectorAll("[data-bubble]")];
  assert.equal(globos().length, 0, "el chat persistente usa respuestas sin globo");
  assert.match(bubbleDocument.querySelector("#root").textContent, /Voy bien/);
  assert.ok(bubbleDocument.querySelector(".bg-chat-user"), "el input de la persona lleva el tinte de marca");
  const appFrame = bubbleDocument.querySelector('iframe[sandbox="allow-scripts"]');
  assert.ok(appFrame, "la MCP App aparece con el registro de herramientas cerrado");
  const workToggle = appFrame.closest("article").querySelector("button[aria-expanded]");
  assert.equal(workToggle?.getAttribute("aria-expanded"), "false");
  const appReadsBeforeToggle = bubbleApp.comandos.filter((c) => c === "read_mcp_app").length;
  assert.equal(appReadsBeforeToggle, 1, "las herramientas sin metadatos de UI no intentan abrir una MCP App");
  assert.equal(bubbleDocument.querySelector("#root").textContent.includes("Abrir vista interactiva"), false,
    "una llamada normal no deja un botón de vista");
  for (const expanded of ["true", "false"]) {
    workToggle.click();
    await sleep(50);
    assert.equal(workToggle.getAttribute("aria-expanded"), expanded);
    assert.equal(bubbleDocument.querySelector('iframe[sandbox="allow-scripts"]'), appFrame,
      "plegar las herramientas no desmonta ni duplica la MCP App");
  }
  assert.equal(bubbleDocument.querySelectorAll('iframe[sandbox="allow-scripts"]').length, 1);
  assert.equal(bubbleApp.comandos.filter((c) => c === "read_mcp_app").length, appReadsBeforeToggle,
    "cambiar el pliegue no vuelve a consultar las herramientas");

  const editQueued = [...bubbleDocument.querySelectorAll("button")].find((button) =>
    button.getAttribute("aria-label")?.startsWith("Editar el mensaje"));
  assert.ok(editQueued, "la cola conserva la edición");
  const queueList = editQueued.closest("ol");
  assert.ok(queueList, "la cola sigue visible");
  editQueued.click();
  await sleep(100);
  const queueEditor = queueList.querySelector("textarea");
  assert.equal(queueEditor?.value, "Mensaje pendiente", "editar conserva el texto completo");
  queueEditor.dispatchEvent(new bubbleApp.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await sleep(50);
  keepActiveView(bubbleApp);
  bubbleDocument
    .querySelector('[role="tab"][data-pestana="0"]')
    .dispatchEvent(new bubbleApp.w.KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
  await sleep(150);
  bubbleDocument.querySelector('[data-sesion="s-task"]').click();
  await sleep(300);
  assert.equal(globos().length, 0, "la tarea con arquetipo conserva las respuestas sin globo");
  const modelos = [...bubbleDocument.querySelectorAll('span[aria-label="Proveedor"]')].map((el) => el.textContent ?? "");
  assert.deepEqual(modelos, ["GPT-5.6", "Claude Sonnet 5"], "cada respuesta lleva el logo del agente y el modelo con su versión, incluido el traspaso");
  assert.equal(
    bubbleDocument.querySelector("[data-answer-author]"),
    null,
    "el nombre del agente ya no firma la respuesta por encima",
  );
  assert.ok(bubbleDocument.querySelector(".bg-chat-user"), "el input de la persona lleva el tinte de marca en la tarea");
  const tabDeLaTarea = [...bubbleDocument.querySelectorAll(':is([role="tab"], [data-preview-header] [role="button"])')].find(tab => tab.textContent.includes("Una tarea"));
  assert.ok(tabDeLaTarea, "el título de la tarea distingue sus pestañas");
  assert.match(tabDeLaTarea.title, /^Una tarea(?: ·|$)/, "el título de la tarea manda también en la descripción de la pestaña");
  const avatarDelTab = tabDeLaTarea.querySelector(".astro-face");
  assert.equal(avatarDelTab?.querySelector("svg")?.dataset.astroStatus, "awake", "el avatar de la pestaña es estático");
  assert.equal(avatarDelTab?.dataset.astroWorking, undefined, "el tab no anima un trabajo ajeno");
  assert.ok(!avatarDelTab?.querySelector("svg")?.classList.contains("opacity-[0.62]"), "el tab no atenúa al agente dormido");
  assert.match(bubbleDocument.querySelector("header.bg-transparent")?.textContent ?? "", /Holmes/, "la cabecera conserva la identidad del agente");
  tabDeLaTarea.dispatchEvent(new bubbleApp.w.KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
  await sleep(150);
  bubbleDocument.querySelector('[data-sesion="s-plain"]').click();
  await sleep(300);
  assert.equal(globos().length, 0, "una tarea sin arquetipo conserva su salida sin globos");
  assert.ok(bubbleDocument.querySelector(".bg-chat-user"), "la tarea sin arquetipo pinta igual el input de la persona");
  bubbleDocument.querySelector('[data-sesion="s-transfer"]').click();
  await sleep(300);
  const tabTransferida = [...bubbleDocument.querySelectorAll(':is([role="tab"], [data-preview-header] [role="button"])')].find(tab => tab.textContent.includes("Revisar entrega"));
  assert.ok(tabTransferida, "la tarea recibida conserva su título al cambiar de responsable");
  assert.match(tabTransferida.title, /^Revisar entrega(?: ·|$)/);
  assert.equal(tabTransferida.querySelector(".astro-face")?.getAttribute("data-astro-working"), null);
  const cabeceraTransferida = bubbleDocument.querySelector("header.bg-transparent");
  assert.equal(bubbleDocument.querySelectorAll("header.bg-transparent").length, 1, "la tarea tiene una sola cabecera");
  assert.match(cabeceraTransferida.textContent, /Watson/, "la cabecera enseña al responsable de la nueva ejecución");
  cabeceraTransferida.querySelector("button").click();
  // El perfil llega en su propio trozo: se espera a que pinte.
  for (let i = 0; i < 120 && !bubbleDocument.querySelector('button[aria-label="Volver a la conversación"]'); i++) await sleep(25);
  assert.match(bubbleDocument.querySelector('button[aria-label="Volver a la conversación"]')?.parentElement.parentElement.textContent ?? "", /Watson/, "la cabecera abre el perfil del responsable actual");
  const perfilCompleto = bubbleDocument.querySelector('button[aria-label="Volver a la conversación"]').parentElement.parentElement;
  for (const seccion of ["Perfil del agente", "Modelo", "Cara", "Fondo de la conversación", "Instrucciones", "Telegram"])
    assert.ok(perfilCompleto.textContent.includes(seccion), `falta ${seccion} en el perfil abierto desde la cabecera`);
  assert.ok(perfilCompleto.querySelector('button[aria-label="La que sale de su nombre"]'), "el perfil conserva la edición de la cara");
  assert.ok([...perfilCompleto.querySelectorAll("button")].some(button => button.textContent.includes("Elegir imagen")), "el perfil conserva la edición del fondo");
  assert.ok(perfilCompleto.querySelector("textarea"), "las instrucciones del agente propio siguen editables");
  assert.ok(perfilCompleto.querySelector('input[aria-label="Token del bot"]'), "Telegram conserva la configuración del bot");
  const policyButton = text => [...bubbleDocument.querySelectorAll("button")].find(b => b.textContent.trim() === text);
  for (let i = 0; i < 80 && !policyButton("Liberar cuarentena"); i++) await sleep(25);
  assert.ok(perfilCompleto.textContent.includes("notes"));
  assert.ok(perfilCompleto.textContent.includes("notes-server"));
  assert.ok(!perfilCompleto.textContent.includes("UNAPPROVED_SENTINEL"), "list's unapproved slot reason is not effective availability");
  policyButton("Liberar cuarentena").click();
  await sleep(50);
  policyButton("Confirmar").click();
  await sleep(100);
  assert.equal(policyButton("Confirmar").disabled, true, "uncertain release cannot be repeated");
  policyButton("Cancelar").click();
  await sleep(50);
  assert.equal(policyButton("Liberar cuarentena").disabled, true, "closing the dialog keeps the pending receipt");
  policyButton("Consultar resultado").click();
  await sleep(150);
  assert.equal(policyCalls.filter(c => c.request.action === "release").length, 1);
  const resumed = policyCalls.find(c => c.request.action === "resume");
  const released = policyCalls.find(c => c.request.action === "release");
  assert.deepEqual(resumed.request, { action: "resume", operation: "handler-op" });
  assert.equal(resumed.workspace, released.workspace);
  assert.equal(resumed.project, released.project);
  assert.equal(policyButton("Liberar cuarentena").disabled, false);
  assert.deepEqual(bubbleApp.fallos, []);
  bubbleApp.w.close();

  const agentSends = [];
  const draftApp = await bootPorCarpeta("listo", "agent-task-draft", {
    ...bubbleResponses,
    list_projects: [{ id: "p", name: "Proyecto", kind: "folder", working_directory: "/lab", sources: [] }],
    list_agents: { ...bubbleResponses.list_agents, agents: [
      { ...bubbleResponses.list_agents.agents[0], description: "Revisa cambios del proyecto." },
      { ...bubbleResponses.list_agents.agents[0], name: "Watson" },
    ] },
    list_agent_status: [{ name: "Holmes", status: "asleep", minutes_since_last_turn: 90, live_tasks: 0 }],
    send_message: args => { agentSends.push(args); return "new-agent-task"; },
  });
  const draftDoc = draftApp.w.document;
  await sleep(80);
  await hablarDesdeLaCarpeta(draftApp, "p", "Holmes");
  assert.match(draftDoc.querySelector("h1")?.textContent ?? "", /Holmes/);
  assert.equal(draftDoc.querySelector("h1")?.closest("header")?.querySelector("[data-astro-status]")?.dataset.astroStatus, "awake", "a new agent task opens with the agent awake and without the pulse");
  assert.match(draftDoc.body.textContent, /Revisa cambios del proyecto/);
  assert.match(draftDoc.querySelector("textarea")?.closest("[data-agent-page]")?.textContent ?? "", /Proyecto/, "the agent draft shows which project it writes in");
  assert.equal(draftDoc.querySelector('button[aria-label="Proyecto"]'), null, "an agent chat does not let the project change");
  assert.equal(draftDoc.querySelector('button[aria-label="Rama base"]'), null, "una carpeta kn no ofrece ramas");
  const draftField = draftDoc.querySelector("textarea");
  draftField.value = "Revisa el cambio de login";
  draftField.dispatchEvent(new draftApp.w.Event("input", { bubbles: true }));
  await hablarDesdeLaCarpeta(draftApp, "p", "Watson");
  assert.equal(draftDoc.querySelector("textarea").value, "", "Watson no recibe el borrador sin enviar de Holmes");
  const watsonField = draftDoc.querySelector("textarea");
  watsonField.value = "Documenta el despliegue";
  watsonField.dispatchEvent(new draftApp.w.Event("input", { bubbles: true }));
  await hablarDesdeLaCarpeta(draftApp, "p", "Holmes");
  assert.equal(draftDoc.querySelector("textarea").value, "Revisa el cambio de login", "volver al agente conserva su encargo");
  draftDoc.querySelector("textarea").dispatchEvent(new draftApp.w.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  await sleep(150);
  assert.equal(agentSends.length, 1);
  assert.equal(agentSends[0].project, "p");
  assert.equal(agentSends[0].agent, "Holmes");
  assert.equal(agentSends[0].taskFromAgent, true);
  assert.equal(agentSends[0].baseRef, null);
  assert.ok(draftDoc.querySelector('[data-sidebar-tasks] [data-sesion="new-agent-task"] [data-session-agent]'), "el primer mensaje crea una tarea visible con la pastilla de su arquetipo");
  const activeDraftRow = draftDoc.querySelector('[data-sidebar-tasks] [data-sesion="new-agent-task"]');
  assert.equal(activeDraftRow.querySelectorAll("[data-session-agent]").length, 1, "la identidad activa se pinta una sola vez");
  assert.ok(activeDraftRow.querySelector('[data-session-status] [data-task-orbit] [data-astro-status="working"]'), "la cara activa va dentro del arco a la derecha del título");
  assert.equal(activeDraftRow.querySelector('[data-session-preview] [data-session-agent]'), null, "la segunda línea no duplica la cara activa");
  assert.deepEqual(draftApp.fallos, []);
  draftApp.w.close();

  // El menú de `@` separa los del repositorio de los tuyos, no enseña a los
  // ocultos y marca al tuyo que el repositorio tapa sin dejar elegirlo.
  const holmes = bubbleResponses.list_agents.agents[0];
  const mentionAgentsApp = await bootPorCarpeta("listo", "agent-mentions", {
    ...bubbleResponses,
    list_projects: [{ id: "p", name: "Proyecto", kind: "folder", working_directory: "/lab", sources: [] }],
    list_agents: { ...bubbleResponses.list_agents, agents: [
      holmes,
      { ...holmes, name: "Hudson", origin: ".danil/agents/hudson.md" },
      { ...holmes, name: "Watson", own: true, own_scope: { kind: "workspace" } },
    ] },
    list_agent_profiles: { Hudson: { display_name: null, body: null, background: null, avatar: null, veil: 0.82, provider: null, model: null, effort: null, hidden: true } },
    list_machine_agents: { own: [{
      agent: { ...holmes, own: true, own_scope: { kind: "workspace" } }, profile: {}, folders: [], all_folders: true,
      blocked: [{ folder: "p", origin: holmes.origin, repository: true }], catalog_taken: null,
    }], repository: [] },
  });
  const mentionAgentsDoc = mentionAgentsApp.w.document;
  await sleep(80);
  await hablarDesdeLaCarpeta(mentionAgentsApp, "p", "Holmes");
  const agentsField = mentionAgentsDoc.querySelector("textarea");
  agentsField.value = "@";
  agentsField.selectionStart = agentsField.selectionEnd = 1;
  agentsField.dispatchEvent(new mentionAgentsApp.w.InputEvent("input", { bubbles: true, inputType: "insertText" }));
  agentsField.dispatchEvent(new mentionAgentsApp.w.KeyboardEvent("keyup", { bubbles: true, key: "@" }));
  await sleep(120);
  const agentsMenu = mentionAgentsDoc.querySelector("button[aria-selected]")?.closest("ul");
  const menuLines = [...agentsMenu.querySelectorAll("li")].map(li => li.textContent.replace(/\s+/g, " ").trim());
  assert.match(menuLines[0], /^Del repositorio Proyecto ?vía PR ?Holmes/, menuLines.join(" | "));
  assert.match(menuLines[1], /^Tuyos ?Watson/, menuLines.join(" | "));
  assert.equal(menuLines.filter(line => line.includes("Holmes")).length, 1, "el tuyo que el repositorio tapa no sale");
  assert.equal(menuLines.some(line => /Tapado|Encargado/.test(line)), false, "las filas dicen «Agente», sin «Tapado»");
  assert.equal(menuLines.some(line => line.includes("Hudson")), false, "un agente oculto no sale en el menú, como en el riel");
  assert.deepEqual(mentionAgentsApp.fallos, []);
  mentionAgentsApp.w.close();

  let threadRows = [
    { ...filaDeAgente, id: "dm", title: "Holmes", chat_de_agente: true, agent_thread: false },
    { ...filaDeAgente, id: "topic", title: "Release planning", chat_de_agente: true, agent_thread: true, pinned: false, updated_at: 100, launcher_name: "Watson" },
    { ...filaDeAgente, id: "new-topic", title: "Independent topic", chat_de_agente: true, agent_thread: true, updated_at: 90 },
    { ...filaDeAgente, id: "archived-work", title: "Old investigation", last_message: "Historical finding", archived: true, chat_de_agente: false, launched_by: "dm", launcher_name: "Holmes" },
    { ...filaDeAgente, id: "dm-work", title: "DM task", chat_de_agente: false, launched_by: "dm", launcher_name: "Holmes" },
    { ...filaDeAgente, id: "topic-work", title: "Topic task", last_message: "Topic task progress", chat_de_agente: false, pinned: true, launched_by: "topic", launcher_name: "Watson" },
    { ...filaDeAgente, id: "topic-work-2", title: "Second topic task", chat_de_agente: false, pinned: false, launched_by: "topic", launcher_name: "Holmes" },
    { ...filaDeAgente, id: "8cnv428n", title: "Revisa seguridad escrituras alfa Inbox y Broadcasts", chat_de_agente: false, pinned: false, launched_by: "n8tc0emm", launcher_available: false, launcher_name: "tech-lead" },
    { ...filaDeAgente, id: "unrelated-work", title: "Other task", agent: null, chat_de_agente: false, launched_by: "other-chat", launcher_name: "Other agent" },
  ];
  const threadLoads = [];
  const pinChanges = [];
  let threadProjects = bubbleResponses.list_projects;
  const threadApp = await bootPorCarpeta("listo", "agent-threads", {
    ...bubbleResponses,
    list_projects: () => threadProjects,
    list_delegated_sessions: ({ id }) => threadRows.filter(row => row.launched_by === id).map(row => ({ ...row, folder: "p" })),
    task_coordinator: ({ id }) => {
      const row = threadRows.find(row => row.id === id);
      const root = threadRows.find(root => root.id === row?.launched_by);
      return root ? { folder: "p", task: root.id, title: root.title, provider: root.provider } : null;
    },
    list_live_sessions: ({ project }) => project === "p" ? threadRows : [],
    set_session_pinned: ({ project, id, pinned }) => {
      pinChanges.push({ project, id, pinned });
      threadRows = threadRows.map(row => row.id === id ? { ...row, pinned } : row);
      return null;
    },
    list_session_git: () => ({ "topic-work": { kind: "branch", branch: "feature/release", alias: "Orion", repository: "/lab", shared_with: null, pull: null } }),
    load_session: ({ id }) => {
      threadLoads.push(id);
      return { ...CON_TAREA.load_session, ...threadRows.find(row => row.id === id), id,
        turns: id === "topic" ? [
          { role: "system", id: "topic-launch", text: "", meta: "task_launched",
            from_task: { folder: "p", task: "topic-work", title: "Topic task", provider: "codex" } },
          { role: "system", id: "topic-launch-2", text: "", meta: "task_launched",
            from_task: { folder: "p", task: "topic-work-2", title: "Second topic task", provider: "codex" } },
        ] : [] };
    },
  });
  threadApp.w.scrollTo = () => {};
  const threadDoc = threadApp.w.document;
  await sleep(100);
  const sidebarTask = id => threadDoc.querySelector(`[data-sidebar-tasks] [data-sesion="${id}"]`);
  assert.equal(sidebarTask("dm")?.dataset.pinned, "true", "el chat anterior nace fijado entre las tareas");
  assert.equal(sidebarTask("new-topic")?.dataset.pinned, "true", "los temas anteriores heredan el pin");
  assert.equal(sidebarTask("topic")?.dataset.pinned, undefined, "un pin explícito del backend prevalece sobre el valor heredado");
  assert.equal(sidebarTask("topic-work")?.dataset.pinned, "true", "una tarea nueva puede venir fijada del backend");
  assert.equal(threadDoc.querySelector('[data-sidebar-tasks] [data-task-author]'), null, "el riel no agrupa por agente");
  assert.equal(sidebarTask("dm-work"), null, "el trabajo delegado se consulta desde su coordinador");
  assert.ok(sidebarTask("topic-work").querySelector("[data-session-agent]"), "la tarea delegada fijada conserva la tarjeta compartida");
  assert.equal(sidebarTask("8cnv428n"), null, "la delegada de un padre archivado ausente no sube al riel");
  assert.equal(sidebarTask("topic").querySelector("[data-session-opener]"), null, "un nombre de lanzador sin relación no inventa un origen");
  assert.equal(sidebarTask("topic-work").querySelector("[data-session-opener]"), null, "la delegada fijada no muestra quién la abrió en el riel");
  const taskOrder = [...threadDoc.querySelectorAll('[data-sidebar-tasks] [data-sesion]')].map(row => row.dataset.sesion);
  assert.ok(taskOrder.indexOf("topic-work") < taskOrder.indexOf("topic"), "las fijadas van antes que las demás sin alterar sus turnos");
  const openPinnedTaskMenu = id => sidebarTask(id).querySelector('[data-session-actions] button[aria-haspopup="menu"]').click();
  const menuItems = () => [...threadDoc.querySelectorAll('[role="menu"] [role="menuitem"]')];
  const pinMenuItem = label => menuItems().find(item => item.textContent.trim() === label);
  const closeMenu = async () => {
    threadDoc.dispatchEvent(new threadApp.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await sleep(50);
  };
  // El menú conserva su propio hueco y no sustituye la identidad de la tarjeta.
  assert.equal(sidebarTask("dm").querySelector("[data-session-pin]"), null, "fijar no tiene botón propio en la tarjeta");
  assert.equal(sidebarTask("dm").querySelector(".bg-linear-to-l"), null, "la tarjeta no lleva el velo degradado de las acciones");
  assert.ok(sidebarTask("dm").querySelector('[data-session-actions] button[aria-haspopup="menu"]'),
    "el menú permanece disponible junto al título");
  assert.equal(sidebarTask("dm").querySelector('[data-session-status] [data-session-actions]'), null,
    "el menú no ocupa la identidad fija");
  // Fijada: el alfiler va en el hueco del borde, no dentro de la tarjeta.
  assert.ok(sidebarTask("dm").querySelector('[role="img"][aria-label="Fijada"] svg.tarjeta-fijada-alfiler'), "la fijada lleva su alfiler en el borde");
  assert.ok(sidebarTask("dm").className.includes("tarjeta-fijada"), "la fijada dibuja su borde con ::after");
  assert.equal(sidebarTask("dm").querySelector('[data-session-preview] [aria-label="Fijada"]'), null);
  openPinnedTaskMenu("dm");
  await sleep(50);
  assert.equal(menuItems()[0]?.textContent.trim(), "Desfijar", "fijar es lo primero del menú");
  assert.equal(pinMenuItem("Etapa"), undefined, "la tarjeta del riel no marca la etapa");
  assert.equal(pinMenuItem("Archivar tarea"), undefined, "una tarea fijada no ofrece archivado");
  pinMenuItem("Desfijar").click();
  await sleep(150);
  assert.deepEqual(pinChanges.at(-1), { project: "p", id: "dm", pinned: false });
  assert.equal(sidebarTask("dm")?.dataset.pinned, undefined);
  assert.equal(sidebarTask("dm").querySelector('[role="img"][aria-label="Fijada"]:has(svg.tarjeta-fijada-alfiler)'), null, "sin fijar no queda alfiler");
  await closeMenu();
  openPinnedTaskMenu("dm");
  await sleep(50);
  assert.equal(menuItems()[0]?.textContent.trim(), "Fijar");
  pinMenuItem("Fijar").click();
  await sleep(150);
  assert.equal(sidebarTask("dm")?.dataset.pinned, "true", "la tarea se vuelve a fijar desde el mismo menú");
  await closeMenu();
  assert.equal(threadDoc.querySelector('[data-agent-conversations]'), null, "los historiales antiguos solo aparecen en Tareas");
  sidebarTask("dm").click();
  await sleep(200);
  assert.equal(threadLoads.at(-1), "dm");
  assert.equal(threadDoc.querySelector("textarea"), null, "el chat anterior solo permite leer el historial");
  keepActiveView(threadApp);
  sidebarTask("topic").click();
  await sleep(200);
  assert.equal(threadLoads.at(-1), "topic");
  const tabText = tab => tab.querySelector(".truncate").textContent;
  const tabOf = text => [...threadDoc.querySelectorAll(':is([role="tab"], [data-preview-header] [role="button"])')].find(tab => tabText(tab) === text);
  assert.ok(tabOf("Release planning"), "el tema histórico conserva su título");
  assert.match(tabOf("Release planning").title, /^Holmes · Release planning/);
  assert.ok(tabOf("Holmes"), "el chat directo antiguo sigue accesible");
  assert.ok(threadDoc.querySelector('[data-delegated-launch="topic-work"] [data-sesion="topic-work"]'), "el lanzamiento reabierto usa la tarjeta de tareas");
  assert.ok(threadDoc.querySelector('[data-delegated-launch="topic-work-2"] [data-sesion="topic-work-2"]'), "el grupo conserva cada tarjeta creada");
  const createdHeadings = [...threadDoc.querySelectorAll("h3")].filter(heading => heading.textContent === "Tareas creadas");
  assert.equal(createdHeadings.length, 1, "un grupo de tareas creadas lleva un solo rótulo");
  assert.ok(createdHeadings[0].compareDocumentPosition(threadDoc.querySelector('[data-delegated-launch="topic-work"]')) & threadApp.w.Node.DOCUMENT_POSITION_FOLLOWING,
    "el rótulo antecede a la primera tarea creada");
  const delegatedToolbar = threadDoc.querySelector('[data-delegated-trigger="toolbar"]');
  assert.ok(delegatedToolbar, "la barra derecha permite consultar subtareas de una conversación existente");
  // En la tarjeta del riel el estado va en su hueco de 16 px, a la derecha del título.
  const previewOfCoordinator = () => sidebarTask("topic").querySelector("[data-session-status]");
  threadApp.emit("chat", { kind: "started", session: "topic-work", workspace: "w" });
  await sleep(100);
  assert.equal(previewOfCoordinator().querySelectorAll('[aria-label$="Está trabajando"]').length, 1,
    "el coordinador conserva un foco de actividad cuando solo trabaja su subtarea");
  threadApp.emit("chat", { kind: "started", session: "topic", workspace: "w" });
  await sleep(100);
  assert.equal(previewOfCoordinator().querySelectorAll('[aria-label$="Está trabajando"]').length, 1,
    "un solo estado ocupa su columna, sin contador de subtareas");
  assert.equal(sidebarTask("topic").querySelectorAll("[data-session-status]").length, 1, "el estado ocupa una sola ranura");
  assert.equal(previewOfCoordinator().querySelectorAll("[data-task-orbit]").length, 1, "la ranura lleva una sola órbita");
  assert.equal(previewOfCoordinator().querySelectorAll("[data-session-agent]").length, 1, "una sola identidad vive dentro de la órbita");
  assert.equal(previewOfCoordinator().textContent.trim(), "", "la ranura no añade un contador de subtareas");
  threadApp.emit("chat", { kind: "done", session: "topic", workspace: "w", ok: true });
  await sleep(200);
  assert.equal(previewOfCoordinator().querySelectorAll('[aria-label$="Está trabajando"]').length, 1,
    "terminar el turno principal conserva la actividad delegada");
  threadApp.emit("chat", { kind: "done", session: "topic-work", workspace: "w", ok: true });
  await sleep(200);
  assert.equal(previewOfCoordinator().querySelectorAll('[aria-label$="Está trabajando"]').length, 0,
    "el foco de actividad se apaga al terminar la última subtarea");
  const toolbarButtons = [...delegatedToolbar.parentElement.querySelectorAll("button")];
  assert.deepEqual(toolbarButtons.map(button => button.getAttribute("aria-label")), [
    "Buscar en esta tarea", delegatedToolbar.getAttribute("aria-label"), "Archivos de la tarea",
  ], "la fila ordena búsqueda y subtareas, y acaba en los archivos de la tarea");
  delegatedToolbar.click();
  await sleep(50);
  assert.equal([...threadDoc.querySelectorAll('button')].find(button => button.textContent === "Activas")?.getAttribute("aria-pressed"), "true",
    "el filtro predeterminado de subtareas se llama Activas");
  [...threadDoc.querySelectorAll('button')].find(button => button.textContent === "Todas").click();
  await sleep(50);
  assert.ok(threadDoc.querySelector('[data-delegated-list] [data-sesion="topic-work"]'), "el desplegable conserva trabajo de turnos anteriores");
  assert.match(threadDoc.querySelector('[data-delegated-list] [data-sesion="topic-work"] [data-session-opener]').getAttribute("aria-label"), /Watson/, "el origen sigue disponible al consultar las delegadas");
  assert.equal(threadDoc.querySelector('[data-delegated-list] [data-folder-chip]'), null, "las delegadas no repiten la carpeta de su madre");
  threadDoc.querySelector('[data-delegated-list] [data-sesion="topic-work"]').click();
  await sleep(200);
  assert.equal(threadLoads.at(-1), "topic-work", "la tarjeta abre la tarea de su carpeta");
  threadDoc.querySelector('[data-task-coordinator]').click();
  await sleep(200);
  assert.equal(threadLoads.at(-1), "topic", "la tarea delegada regresa al coordinador");
  assert.equal(threadDoc.querySelector("textarea"), null, "el tema anterior no abre turnos nuevos");
  await hablarDesdeLaCarpeta(threadApp, "p", "Holmes");
  assert.equal(threadDoc.querySelector('[role="dialog"]'), null, "una conversación nueva abre el borrador del agente");
  assert.match(threadDoc.querySelector("h1")?.textContent ?? "", /Holmes/);
  assert.ok(threadDoc.querySelector("textarea"), "la conversación nueva tiene composer");
  assert.equal(threadApp.comandos.includes("create_agent_thread"), false);
  threadProjects = structuredClone(threadProjects);
  threadApp.emit("cli-changed", { workspace: null, command: "task send" });
  await sleep(350);
  assert.ok(sidebarTask("dm"), "refrescar conserva el historial antiguo entre las tareas");
  assert.deepEqual(threadApp.fallos, []);
  threadApp.w.close();

  // Una Bandeja antigua sigue accesible y cada mensaje conserva su remitente.
  const inboxRows = [...threadRows.filter(row => row.id === "dm" || row.id === "topic"), { ...filaDeAgente, id: "inbox", title: "Bandeja", chat_de_agente: true, agent_thread: true, inbox: true }];
  const inboxLoads = [];
  const inboxTurns = [
    { role: "system", meta: "recibido", text: "Mensaje de @Watson. Salto 1." },
    { role: "user", text: "Revisa el diseño", agent: "Watson", from_task: { folder: "p", task: "watson-chat", title: "Watson", provider: "claude" } },
    { role: "system", meta: "recibido", text: "Mensaje de la tarea «Corregir login». Salto 1." },
    { role: "user", text: "Ya quedó el login", from_task: { folder: "p", task: "login", title: "Corregir login", provider: "codex" } },
    { role: "agent", text: "Recibido." },
  ];
  const inboxApp = await boot("listo", "agent-inbox", {
    ...bubbleResponses,
    list_live_sessions: ({ project }) => project === "p" ? inboxRows : [],
    load_session: ({ id }) => {
      inboxLoads.push(id);
      const row = inboxRows.find(r => r.id === id);
      return { ...CON_TAREA.load_session, ...row, id, turns: id === "inbox" ? inboxTurns : [] };
    },
  });
  inboxApp.w.scrollTo = () => {};
  const inboxDoc = inboxApp.w.document;
  await sleep(100);
  assert.equal(inboxDoc.querySelector('[data-sidebar-tasks] [data-sesion="inbox"]')?.dataset.pinned, "true", "la Bandeja anterior aparece fijada entre las tareas");
  assert.equal(inboxDoc.querySelector('[data-agent-inbox]'), null, "la Bandeja no tiene una sección aparte");
  inboxDoc.querySelector('[data-sidebar-tasks] [data-sesion="inbox"]').click();
  await sleep(300);
  assert.equal(inboxApp.comandos.includes("open_agent_inbox"), false);
  assert.equal(inboxLoads.at(-1), "inbox");
  assert.equal(inboxDoc.querySelector("textarea"), null, "la Bandeja anterior no inicia turnos nuevos");
  assert.equal(inboxDoc.querySelector('[data-agent-thread]'), null, "no quedan temas anidados bajo los agentes");
  assert.ok([...inboxDoc.querySelectorAll(':is([role="tab"], [data-preview-header] [role="button"]) .truncate')].some(label => label.textContent === "Holmes · Bandeja anterior"), "la Bandeja conserva el agente en su pestaña");
  const agentSigned = inboxDoc.querySelector('[data-sender="agent"]');
  assert.ok(agentSigned, "un mensaje de agente lleva su firma");
  assert.match(agentSigned.textContent, /Watson/);
  assert.ok(agentSigned.closest("[class]").parentElement.querySelector('[role="img"], svg, img'), "y su cara");
  const taskSigned = inboxDoc.querySelector('[data-sender="task"] button');
  assert.equal(taskSigned?.textContent, "Corregir login", "un mensaje de tarea lleva su título");
  assert.ok(inboxDoc.querySelectorAll('[data-sender="system"]').length >= 2, "y lo que avisa el sistema se pinta como sistema, no como un mensaje");
  taskSigned.click();
  await sleep(200);
  assert.equal(inboxLoads.at(-1), "login", "el título de la tarea la abre");
  assert.deepEqual(inboxApp.fallos, []);
  inboxApp.w.close();

  const mentionSends = [];
  const target = { kind: "task", projectId: "project", sessionId: "login-task" };
  const secondTarget = { ...target, sessionId: "other-login" };
  const mentionApp = await boot("listo", "task-mentions", {
    ...RESPUESTAS,
    list_projects: [{ id: "scoring", name: "Revamp de scoring", node: null, sources: [], portfolio: "pf", created_at: 1, updated_at: 1, sessions: 0, kind: "folder" }],
    list_task_mentions: [
      { target, title: "Corregir login", projectName: "App", alias: "vega", branch: "fix/login", available: true, archived: false, updatedAt: 10 },
      { target: secondTarget, title: "Corregir login", projectName: "App", alias: "vega-two", branch: "fix/other", available: true, archived: false, updatedAt: 9 },
      { target: { ...target, sessionId: "gone" }, title: "Login anterior", projectName: "App", alias: "old", branch: "", available: false, archived: false, updatedAt: 1 },
      { target: { ...target, sessionId: "archived" }, title: "Login archivado", projectName: "App", alias: "archived", branch: "fix/login", available: true, archived: true, updatedAt: 20 },
    ],
    send_message: args => { mentionSends.push(args); return "mention-session"; },
  });
  const mentionField = mentionApp.w.document.querySelector("textarea");
  const writeMention = (text, inputType = "insertText") => {
    mentionField.value = text;
    mentionField.selectionStart = text.length;
    mentionField.selectionEnd = text.length;
    mentionField.dispatchEvent(new mentionApp.w.InputEvent("input", { bubbles: true, inputType }));
    mentionField.dispatchEvent(new mentionApp.w.KeyboardEvent("keyup", { bubbles: true, key: "n" }));
  };
  writeMention("🦊 revisa @login");
  await sleep(120);
  const taskButton = [...mentionApp.w.document.querySelectorAll("button")].find(b => b.textContent.includes("Corregir login") && b.textContent.includes("fix/login"));
  assert.ok(taskButton, "task search must include session titles and aliases");
  for (let el = taskButton.closest("ul")?.parentElement?.parentElement; el; el = el.parentElement)
    assert.equal(el.classList.contains("overflow-hidden"), false, "The suggestion menu must not live inside a clipping container: it is drawn above the composer and would be cut off");
  assert.equal([...mentionApp.w.document.querySelectorAll("button")].some(b => b.textContent.includes("Login archivado")), false, "Archived tasks must not appear in mention suggestions");
  const unavailable = [...mentionApp.w.document.querySelectorAll("button")].find(b => b.textContent.includes("Login anterior"));
  assert.equal(unavailable?.disabled, false, "A task without a worktree remains addressable");
  taskButton.dispatchEvent(new mentionApp.w.MouseEvent("mousedown", { bubbles: true }));
  await sleep(30);
  assert.equal(mentionField.value, "🦊 revisa @fix/login ");
  assert.equal(mentionApp.w.document.querySelector("[data-kind='mention']")?.textContent, "@fix/login");
  const selected = mentionField.value;
  mentionField.dispatchEvent(new mentionApp.w.KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "z", metaKey: true }));
  assert.equal(mentionField.value, "🦊 revisa @login");
  mentionField.dispatchEvent(new mentionApp.w.KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "z", metaKey: true, shiftKey: true }));
  assert.equal(mentionField.value, selected);
  writeMention(selected.replace("login", "acceso"));
  assert.equal(mentionApp.w.document.querySelector("[data-kind='mention']"), null);
  writeMention(selected, "historyUndo");
  assert.equal(mentionApp.w.document.querySelector("[data-kind='mention']")?.textContent, "@fix/login");
  writeMention(mentionField.value + "@login");
  await sleep(30);
  const otherButton = [...mentionApp.w.document.querySelectorAll("button")].find(b => b.textContent.includes("Corregir login") && b.textContent.includes("fix/other"));
  otherButton.dispatchEvent(new mentionApp.w.MouseEvent("mousedown", { bubbles: true }));
  const beforeDelete = mentionField.value;
  const firstStart = beforeDelete.indexOf("@");
  const firstEnd = firstStart + "@fix/login ".length;
  mentionField.selectionStart = firstStart;
  mentionField.selectionEnd = firstEnd;
  mentionField.dispatchEvent(new mentionApp.w.InputEvent("beforeinput", { bubbles: true, inputType: "deleteContentBackward" }));
  mentionField.value = beforeDelete.slice(0, firstStart) + beforeDelete.slice(firstEnd);
  mentionField.dispatchEvent(new mentionApp.w.InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
  writeMention(mentionField.value + " y elimina @anterior");
  await sleep(100);
  const taskWithoutWorktree = [...mentionApp.w.document.querySelectorAll("button")].find(b => b.textContent.includes("Login anterior"));
  assert.ok(taskWithoutWorktree && !taskWithoutWorktree.disabled);
  taskWithoutWorktree.dispatchEvent(new mentionApp.w.MouseEvent("mousedown", { bubbles: true }));
  writeMention(`${mentionField.value}c`);
  assert.equal(mentionField.selectionStart, mentionField.value.length, "The first key typed after picking a task must leave the cursor after it");
  writeMention(`${mentionField.value} en @revamp`);
  await sleep(60);
  const folderButton = [...mentionApp.w.document.querySelectorAll("button[aria-selected]")].find(b => b.textContent.includes("Revamp de scoring") && b.textContent.includes("Proyecto"));
  assert.ok(folderButton, "Working folders are offered as mentions");
  folderButton.dispatchEvent(new mentionApp.w.MouseEvent("mousedown", { bubbles: true }));
  await sleep(30);
  assert.ok(mentionField.value.endsWith(" @Revamp-de-scoring "), mentionField.value);
  mentionField.closest("form").dispatchEvent(new mentionApp.w.Event("submit", { bubbles: true, cancelable: true }));
  await sleep(100);
  assert.equal(mentionSends.length, 1);
  assert.equal(mentionSends[0].taskMentions.length,  3);
  assert.deepEqual(mentionSends[0].taskMentions[2].target, { kind: "folder", projectId: "scoring" });
  assert.equal(mentionSends[0].taskMentions[1].target.sessionId, "gone");
  assert.deepEqual(mentionSends[0].taskMentions[0].target, secondTarget);
  const sentMention = mentionSends[0].taskMentions[0];
  assert.equal(mentionSends[0].prompt.slice(sentMention.start, sentMention.end), sentMention.text);
  assert.deepEqual(mentionSends[0].sources, []);
  assert.deepEqual(mentionApp.fallos, []);
  mentionApp.w.close();

  const queuedSends = [];
  const inyectados = [];
  const queueFiles = new Map();
  const queuedApp = await boot("listo", "background-queue", {
    ...CON_TAREA,
    list_live_sessions: [
      CON_TAREA.list_live_sessions[0],
      { ...CON_TAREA.list_live_sessions[0], id: "s2", title: "Segunda tarea" },
      { ...CON_TAREA.list_live_sessions[0], id: "s3", title: "Buzón del arquitecto" },
    ],
    load_session: ({ id }) => ({ ...CON_TAREA.load_session, id }),
    load_queue: ({ session }) => queueFiles.get(session) ?? [],
    save_queue: ({ session, queued }) => { queueFiles.set(session, queued); },
    send_message: (args) => { queuedSends.push(args); return args.session; },
    inject_message: (args) => { inyectados.push(args); },
  });
  const queueDocument = queuedApp.w.document;
  const selectQueuedTask = async (id) => {
    queueDocument.querySelector(`[data-sesion="${id}"]`).click();
    await sleep(150);
  };
  const queueText = async (text) => {
    const field = queueDocument.querySelector("textarea");
    field.value = text;
    field.dispatchEvent(new queuedApp.w.Event("input", { bubbles: true }));
    field.closest("form").dispatchEvent(new queuedApp.w.Event("submit", { bubbles: true, cancelable: true }));
    await sleep(50);
  };
  await selectQueuedTask("s1");
  queuedApp.emit("chat", { kind: "started", session: "s1", workspace: "w" });
  await queueText("Primer pendiente");
  await queueText("Segundo pendiente");
  await selectQueuedTask("s2");
  await selectQueuedTask("s1");
  queuedApp.emit("chat", { kind: "done", session: "s1", workspace: "w", ok: true });
  await sleep(200);
  assert.equal(queuedSends.length, 1, "returning to a task must not turn its live queue into a draft");
  assert.equal(queuedSends[0].prompt, "Primer pendiente\n\nSegundo pendiente");
  await queueText("Pendiente en segundo plano");
  await selectQueuedTask("s2");
  queuedApp.emit("chat", { kind: "done", session: "s1", workspace: "w", ok: true });
  await sleep(200);
  assert.equal(queuedSends.length, 2, "finishing a hidden task dispatches its queue automatically");
  assert.equal(queuedSends[1].session, "s1");
  assert.equal(queuedSends[1].prompt, "Pendiente en segundo plano");
  assert.deepEqual(queueFiles.get("s1"), []);
  await selectQueuedTask("s1");
  assert.equal(queuedSends.length, 2, "returning does not resend the consumed queue");

  // Con el turno corriendo, el Enter de más mete lo encolado en él, en orden.
  // Es la flecha de la cola sin soltar el teclado.
  queuedApp.emit("chat", { kind: "started", session: "s1", workspace: "w" });
  await queueText("Cambia de enfoque");
  await queueText("Y mira el log");
  const caja = queueDocument.querySelector("textarea");
  caja.focus();
  caja.dispatchEvent(new queuedApp.w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await sleep(250);
  if (inyectados.length !== 2) {
    console.error(`El Enter de más no manda lo encolado al turno vivo: inject_message=${inyectados.length}.`);
    process.exit(1);
  }
  assert.deepEqual(
    inyectados.map((i) => i.prompt),
    ["Cambia de enfoque", "Y mira el log"],
  );
  // Y sin cola no se toca: Enter con la caja vacía no manda nada.
  caja.dispatchEvent(new queuedApp.w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await sleep(150);
  assert.equal(inyectados.length, 2, "sin nada encolado el Enter de más no inventa un envío");
  assert.equal(queuedSends.length, 2);

  // Una entrega encolada la vacía la ventana, y con ella el sobre. Rust la
  // dejó en el `.cola.json` del buzón con quién la manda y dónde se contesta;
  // sin devolver el remitente aterriza firmada como de la persona (PR #800).
  const entrega = {
    id: "d1", text: "Revisa el acceso", provider: "codex", model: null, effort: null,
    permission_mode: null, attachments: [], agent: "arquitecto",
    reply_to: { folder: "p", task: "t9" }, hops: 2,
  };
  queueFiles.set("s3", [entrega, { ...entrega, id: "d2", agent: null, reply_to: null, hops: null, text: "Y esto lo escribo yo" }]);
  await selectQueuedTask("s3");
  const mandarCola = [...queueDocument.querySelectorAll("button")].find((b) => b.textContent.trim() === "mandar");
  assert.ok(mandarCola, "una cola leída del disco espera a que alguien la suelte");
  mandarCola.click();
  await sleep(200);
  assert.equal(queuedSends.length, 3);
  assert.equal(queuedSends[2].prompt, "Revisa el acceso", "un lote no mezcla remitentes");
  assert.equal(queuedSends[2].fromAgent, "arquitecto", "la entrega encolada conserva quién la manda");
  assert.deepEqual(queueFiles.get("s3"), [{ ...entrega, id: "d2", agent: null, reply_to: null, hops: null, text: "Y esto lo escribo yo" }],
    "lo que no salió sigue en su cola, no se pierde ni se cuela en el lote ajeno");
  assert.equal(queuedApp.fallos.length, 0);
  queuedApp.w.close();

  const cloudIcons = await boot("listo", "cloud-folder-icons", {
    ...RESPUESTAS,
    list_projects: [
      { id: "cloud-folder", name: "Nube", sources: [], kind: "folder", cloud: "google_drive" },
      { id: "cloud-git", name: "Git en nube", sources: [], kind: "git", cloud: "one_drive" },
      { id: "local-folder", name: "Local", sources: [], kind: "folder", cloud: null },
    ],
  });
  // Agrupando por carpeta, que es lo de omisión, una carpeta sin tareas tiene su grupo, su «+» y su estado vacío.
  for (let i = 0; i < 80 && cloudIcons.w.document.querySelectorAll("[data-folder-group]").length < 3; i++) await sleep(25);
  assert.deepEqual([...cloudIcons.w.document.querySelectorAll("[data-folder-group]")].map((el) => el.dataset.folderGroup),
    ["cloud-folder", "cloud-git", "local-folder"], "una carpeta sin tareas aparece en el riel");
  for (const [id, name] of [["cloud-folder", "Nube"], ["cloud-git", "Git en nube"], ["local-folder", "Local"]]) {
    const grupo = cloudIcons.w.document.querySelector(`[data-sidebar-group="${id}"]`);
    assert.equal(grupo.querySelector("[data-folder-open]").textContent.trim(), name, "sin contador junto al nombre");
    assert.equal(grupo.querySelector("[data-folder-empty]")?.textContent, "Sin tareas todavía");
    assert.ok(grupo.querySelector(`button[aria-label="Nueva tarea en ${name}"]`), "su «+» empieza una tarea en ella");
  }
  assert.equal(cloudIcons.w.document.querySelector("[data-sidebar-empty]"), null, "con carpetas a la vista no dice que no hay nada");
  assert.doesNotMatch(cloudIcons.w.document.body.textContent, /google_drive|one_drive/);
  assert.deepEqual(cloudIcons.fallos, []);
  const forkCalls = [];
  let forkSessionActive = false;
  let rejectFork;
  let resolveFork;
  let copied = null;
  const forkResponses = {
    ...CON_TAREA,
    list_active_turns: () => forkSessionActive ? ["s1"] : [],
    load_session: {
      ...CON_TAREA.load_session,
      turns: [
        { role: "user", id: "u1", text: "Primera pregunta" },
        { role: "agent", id: "a1", native_id: "native-a1", text: "Primera respuesta" },
        { role: "user", id: "u2", text: "Pregunta posterior" },
        { role: "agent", id: "a2", native_id: "native-a2", text: "Respuesta posterior" },
      ],
    },
    prepare_session_continuation: (args) => {
      forkCalls.push(args);
      return new Promise((resolve, reject) => { rejectFork = reject; resolveFork = resolve; });
    },
    // Copiar va al portapapeles del sistema y no al del webview, que con un
    // turno en vuelo rechaza por falta de gesto (issue #642).
    "plugin:clipboard-manager|write_text": (args) => {
      copied = args.text;
      return null;
    },
  };
  const forkApp = await boot("listo", 901, forkResponses);
  const forkDoc = forkApp.w.document;
  forkDoc.querySelector('[data-sesion="s1"]').click();
  await sleep(150);
  const [copiarPregunta, copiarRespuesta] = forkDoc.querySelectorAll('button[aria-label="Copiar"]');
  copiarPregunta.click();
  await sleep(20);
  assert.equal(copied, "Primera pregunta", "a sent message copies its own text");
  copiarRespuesta.click();
  await sleep(20);
  assert.equal(copied, "Primera respuesta");
  assert.equal(forkDoc.querySelectorAll('button[aria-label="Copiado"]').length, 1,
    "copying a reply marks only its own button");
  assert.equal(copiarRespuesta.getAttribute("aria-label"), "Copiado");
  forkSessionActive = true;
  forkApp.emit("chat", { kind: "started", session: "s1", workspace: "w" });
  await sleep(30);
  assert.ok(forkDoc.querySelector('button[aria-label="Detener turno"]'));
  assert.equal(forkDoc.querySelectorAll('button[aria-label="Crear tarea desde aquí"]').length, 2,
    "persisted replies, including the latest, remain forkable during an active turn");
  const forkButton = forkDoc.querySelector('button[aria-label="Crear tarea desde aquí"]');
  forkButton.click();
  await sleep(20);
  const fullContext = [...forkDoc.querySelectorAll('[role="dialog"] button')].find(b => b.textContent === "Conversación completa");
  fullContext.click();
  fullContext.click();
  await sleep(20);
  assert.equal(forkCalls.length, 1);
  assert.equal(forkCalls[0].turno, "a1");
  rejectFork(new Error("fork rechazado"));
  await sleep(50);
  const forkAlert = forkDoc.querySelector('[role="alert"]');
  assert.match(forkAlert.textContent, /fork rechazado/);
  forkAlert.querySelector("button").click();
  assert.equal(forkDoc.querySelector('[role="alert"]'), null);
  forkButton.click();
  await sleep(20);
  [...forkDoc.querySelectorAll('[role="dialog"] button')].find(b => b.textContent === "Conversación completa").click();
  await sleep(20);
  assert.equal(forkCalls.length, 2);
  rejectFork(new Error("reintento rechazado"));
  await sleep(30);
  forkButton.click();
  await sleep(20);
  const focusedContext = [...forkDoc.querySelectorAll('[role="dialog"] button')].find(b => b.textContent === "Sesión enfocada");
  focusedContext.click();
  await sleep(20);
  resolveFork({ path: "/private/attachments/context/conversation.md", last_prompt: "Primera pregunta", last_reply: "Primera respuesta", sources: [], excluded_sources: [] });
  await sleep(100);
  assert.equal(forkDoc.querySelector('[role="dialog"]'), null);
  const newDraft = [...forkDoc.querySelectorAll("textarea")].find(el => el.value.includes("Primera pregunta"));
  assert.ok(newDraft);
  assert.match(newDraft.value, /Primera respuesta/);
  assert.doesNotMatch(newDraft.value, /Pregunta posterior/);
  const draftModel = forkDoc.querySelector('button[title="Con qué modelo responde"]');
  assert.ok(draftModel && !draftModel.disabled);
  draftModel.click();
  await sleep(30);
  assert.ok(forkDoc.querySelector('[role="group"]'));
  assert.deepEqual(forkApp.fallos, []);

  const conTarea = await boot("listo", 2, CON_TAREA);
  const sessionPreview = conTarea.w.document.querySelector('[data-sesion="s1"] [data-session-preview]');
  // Sin nada que pedirte, la segunda línea es carpeta, agente y PR: ni el mensaje ni el modelo.
  assert.ok(sessionPreview, "la fila del riel tiene segunda línea");
  assert.doesNotMatch(sessionPreview.textContent, /La última respuesta de esta tarea/);
  assert.doesNotMatch(sessionPreview.textContent, /gpt-5.6/);

  conTarea.w.document.querySelector('[data-sesion="s1"]')?.click();
  await sleep(150);
  const fila = conTarea.w.document.querySelector('button[title="informe.md"]');
  fila?.click();
  await sleep(150);
  const enLaTira = [...conTarea.w.document.querySelectorAll(':is([role="tab"], [data-preview-header] [role="button"])')].some(
    (t) => t.textContent?.trim() === "informe.md",
  );
  // Y que además **se pinte**: una pestaña sin visor detrás deja el centro en
  // blanco, que es lo mismo que no haberla abierto.
  const visor = conTarea.w.document.querySelector(".preview-path");
  if (!fila || !enLaTira || !visor || conTarea.fallos.length > 0) {
    console.error(
      `Abrir un artefacto no lo pone en la tira del centro: fila=${!!fila}, pestaña=${enLaTira}, visor=${!!visor}.`,
    );
    for (const f of conTarea.fallos.slice(0, 3)) {
      for (const l of String(f).split("\n").slice(0, 6)) console.error(`      ${l}`);
    }
    process.exit(1);
  }

  // **Y cerrar esa pestaña devuelve la conversación**, que es la otra mitad: la
  // conversación se esconde en vez de desmontarse, así que si no vuelve, lo que
  // queda es un centro en blanco sin nada que lo diga.
  conTarea.w.document.hasFocus = () => true;
  conTarea.w.dispatchEvent(new conTarea.w.Event("focus"));
  CON_TAREA.load_session.turns.push({ role: "agent", id: "second", text: "Otra respuesta" });
  CON_TAREA.list_live_sessions[0].result_revision = createHash("sha256").update("1:second:Otra respuesta").digest("hex");
  conTarea.emit("session", { project: "", session: "s1", workspace: "w" });
  await sleep(350);
  const chatTab = [...conTarea.w.document.querySelectorAll(':is([role="tab"], [data-preview-header] [role="button"])')].find(el => el.getAttribute("aria-label")?.includes("sin leer"));
  assert.equal(chatTab, undefined);
  const fileTab = [...conTarea.w.document.querySelectorAll(':is([role="tab"], [data-preview-header] [role="button"])')].find(el => el.textContent.includes("informe.md"));
  assert.equal(fileTab.querySelector("svg.lucide-mail"), null);
  assert.equal(fileTab.querySelector("svg.lucide-git-branch"), null);
  conTarea.w.document
    .querySelector('button[aria-label="Cerrar «informe.md»"]')
    ?.click();
  await sleep(100);
  assert.equal(conTarea.w.document.querySelector('[role="tab"][aria-label*="sin leer"]'), null);
  const volvio =
    !conTarea.w.document.querySelector(".preview-path") &&
    !!conTarea.w.document.querySelector("textarea");
  if (!volvio || conTarea.fallos.length > 0) {
    console.error("Cerrar la pestaña del artefacto no devuelve la conversación.");
    for (const f of conTarea.fallos.slice(0, 3)) {
      for (const l of String(f).split("\n").slice(0, 6)) console.error(`      ${l}`);
    }
    process.exit(1);
  }

  const estadoVivo = () => conTarea.w.document.querySelector('[role="status"][aria-label="El agente está trabajando"]');
  conTarea.emit("chat", { kind: "started", session: "s1", workspace: "w" });
  await sleep(100);
  assert.ok(estadoVivo());
  const verboInicial = estadoVivo().querySelector(".min-w-0 > span").textContent;
  conTarea.emit("chat", { kind: "tool", session: "s1", workspace: "w", id: "status-command", text: "Bash", target: "pnpm verify" });
  await sleep(100);
  assert.equal(estadoVivo().querySelector(".min-w-0 > span").textContent, verboInicial);
  // El comando no sale en el rótulo de espera: lo enseña su fila del registro.
  assert.match(estadoVivo().textContent, /Ejecutando/);
  assert.doesNotMatch(estadoVivo().textContent, /pnpm verify/);
  // El verbo lo mueve el tic de un segundo de TurnStatus: en un runner cargado el de los 4 s llega tarde.
  await sleep(4100);
  for (let i = 0; i < 30 && estadoVivo().querySelector(".min-w-0 > span").textContent === verboInicial; i++) {
    await sleep(200);
  }
  assert.notEqual(estadoVivo().querySelector(".min-w-0 > span").textContent, verboInicial);
  assert.match(estadoVivo().textContent, /Ejecutando/);
  assert.doesNotMatch(estadoVivo().textContent, /pnpm verify/);
  conTarea.emit("chat", { kind: "tool_done", session: "s1", workspace: "w", id: "status-command", text: "Bash", ok: true });
  await sleep(100);
  assert.ok(estadoVivo());
  assert.doesNotMatch(estadoVivo().textContent, /Ejecutando/);
  conTarea.emit("chat", { kind: "done", session: "s1", workspace: "w", ok: true });
  await sleep(100);
  assert.equal(estadoVivo(), null);

  const envios = [];
  let rechazarPorOcupada = false;
  let disponible = false;
  CON_TAREA.send_message = args => {
    envios.push(args);
    if (rechazarPorOcupada) throw "history.error.busy";
    return "s1";
  };
  conTarea.emit("chat", { kind: "started", session: "other-task", workspace: "w" });
  CON_TAREA.folder_holder = { project: "", session: "other-task", title: "Other task" };
  CON_TAREA.queue_ready = () => disponible;
  CON_TAREA.save_queue = null;
  const escribirEnCola = async text => {
    const campo = conTarea.w.document.querySelector('textarea');
    assert.ok(campo);
    campo.value = text;
    campo.dispatchEvent(new conTarea.w.Event("input", { bubbles: true }));
    campo.closest("form").dispatchEvent(new conTarea.w.Event("submit", { bubbles: true, cancelable: true }));
    await sleep(100);
    assert.equal(campo.value, "");
  };
  conTarea.emit("chat", { kind: "started", session: "s1", workspace: "w" });
  conTarea.emit("chat", { kind: "tool", session: "s1", workspace: "w", id: "queue-tool", text: "Bash", target: "pnpm verify" });
  await sleep(100);
  conTarea.emit("chat", { kind: "model", session: "s1", workspace: "w", text: "claude-sonnet-5" });
  await sleep(50);
  assert.ok(conTarea.w.document.querySelector('button[aria-label="Modelo: claude-sonnet-5"]'));
  conTarea.emit("chat", { kind: "model", session: "another-session", workspace: "w", text: "other-model" });
  await sleep(50);
  assert.equal(conTarea.w.document.querySelector('button[aria-label="Modelo: other-model"]'), null);
  await escribirEnCola("Haz los símbolos Git");
  // Y la actividad de la tarea no se lo quita a quien escribe en otro campo:
  // editando un mensaje de la cola, cada delta devolvía el foco al compositor y
  // se perdía lo tecleado.
  {
    const doc = conTarea.w.document;
    const editar = [...doc.querySelectorAll("button")].find((b) =>
      (b.getAttribute("aria-label") ?? "").startsWith("Editar el mensaje"),
    );
    if (!editar) {
      console.error("No hay con qué editar un mensaje de la cola: releer esta comprobación.");
      process.exit(1);
    }
    editar.click();
    await sleep(100);
    const enCola = doc.activeElement;
    if (enCola?.tagName !== "TEXTAREA" || enCola.value !== "Haz los símbolos Git") {
      console.error("Abrir el editor de un mensaje en cola ya no enfoca su campo.");
      process.exit(1);
    }
    conTarea.emit("chat", { kind: "delta", session: "s1", workspace: "w", text: "llega actividad" });
    conTarea.emit("chat", { kind: "tool", session: "s1", workspace: "w", id: "foco-tool", text: "Bash", target: "ls" });
    await sleep(150);
    if (doc.activeElement !== enCola) {
      console.error(
        `La actividad de la tarea le quitó el foco a quien escribía: quedó en ${doc.activeElement?.tagName} ${JSON.stringify(doc.activeElement?.value ?? "")}.`,
      );
      process.exit(1);
    }
    enCola.dispatchEvent(new conTarea.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await sleep(100);
  }
  conTarea.emit("chat", { kind: "delta", session: "s1", workspace: "w", text: "Estoy trabajando" });
  await escribirEnCola("Cuando termines manda el PR");
  assert.equal(envios.length, 0);
  conTarea.emit("chat", { kind: "done", session: "s1", workspace: "w", ok: true });
  await sleep(200);
  assert.equal(envios.length, 1, "another live task in the same folder does not block dispatch");
  assert.equal(envios[0].prompt, "Haz los símbolos Git\n\nCuando termines manda el PR");
  assert.equal(envios[0].session, "s1");
  await escribirEnCola("Esto va después del lote");
  assert.equal(envios.length, 1);
  conTarea.emit("chat", { kind: "done", session: "s1", workspace: "w", ok: false });
  await sleep(150);
  assert.equal(envios.length, 1, "un fallo no despacha el lote pendiente");
  for (const button of conTarea.w.document.querySelectorAll('button[aria-label^="Quitar el mensaje "]')) button.click();
  await sleep(50);
  rechazarPorOcupada = true;
  await escribirEnCola("Conserva este mensaje");
  assert.equal(envios.length, 2);
  assert.doesNotMatch(conTarea.w.document.body.textContent, /Hay un turno o una operación en curso/);
  await escribirEnCola("Y este también");
  assert.equal(envios.length, 2);
  await sleep(1100);
  assert.equal(envios.length, 2, "no reintenta mientras siga ocupada");
  rechazarPorOcupada = false;
  disponible = true;
  await sleep(1200);
  assert.equal(envios.length, 3);
  assert.equal(envios[2].prompt, "Conserva este mensaje\n\nY este también");
  conTarea.emit("chat", { kind: "done", session: "s1", workspace: "w", ok: true });
  await sleep(100);

  const sinUsable = await boot("listo", 3, SIN_USABLE);
  const selectorInventado = sinUsable.w.document.querySelector('button[title="Con qué modelo responde"]');
  const salida = [...sinUsable.w.document.querySelectorAll("button")].some(
    (b) => b.textContent?.trim() === "Conectar una cuenta",
  );
  if (sinUsable.fallos.length > 0 || selectorInventado || !salida) {
    console.error(
      "Sin superficies usables, el chat tiene que quedar sin selector de modelos y ofrecer conectar una cuenta.",
    );
    process.exit(1);
  }

  const task = (id, parent, outcome) => ({ id, parent, title: `Tarea ${id}`, outcome,
    provider: "codex", model: null, refs: [], stage: null, esperando: false, updated_at: 1, created_at: 1, turns: 1 });
  for (const [platform, userAgent] of [
    ["macOS", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"],
    ["Windows", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"],
    ["Linux", "Mozilla/5.0 (X11; Linux x86_64)"],
  ]) {
    const attachmentCopies = [];
    const attachmentSends = [];
    const attachmentApp = await boot("listo", `attachment-drop-${platform}`, {
      ...CON_TAREA,
      list_live_sessions: [task("image-a", null, null), task("image-b", null, null), task("image-c", null, null)],
      send_message: (args) => { attachmentSends.push(args); return args.session; },
      prepare_attachments: ({ paths }) => {
        attachmentCopies.push(paths);
        return paths.map(path => `/private/attachments/${attachmentCopies.length}/${path.split("/").pop()}`);
      },
    }, userAgent);
    for (const id of ["image-a", "image-b", "image-c", "image-a"]) {
      attachmentApp.w.document.querySelector(`[data-sesion="${id}"]`).click();
      await sleep(100);
      const beforeDrop = attachmentCopies.length;
      attachmentApp.emit("tauri://drag-drop", { paths: ["/tmp/screenshot.png"], position: { x: 100, y: 100 } });
      await sleep(50);
      assert.equal(attachmentCopies.length, beforeDrop + 1, `${platform}: un arrastre debe preparar una copia en ${id}, aunque haya otras tareas montadas`);
    }
    const attachmentDoc = attachmentApp.w.document;
    const sendAttachment = () => [...attachmentDoc.querySelectorAll('button[aria-label="Preguntar"]')].find(b => !b.disabled);
    assert.ok(sendAttachment(), `${platform}: an image enables sending without text`);
    sendAttachment().click();
    await sleep(100);
    assert.equal(attachmentSends.length, 1);
    assert.equal(attachmentSends[0].prompt, "");
    assert.ok(attachmentSends[0].attachments.some(path => path.endsWith("screenshot.png")));
    attachmentApp.emit("chat", { kind: "started", session: "image-a", workspace: "w" });
    attachmentApp.emit("tauri://drag-drop", { paths: ["/tmp/report.pdf"], position: { x: 100, y: 100 } });
    await sleep(50);
    const textarea = [...attachmentDoc.querySelectorAll("textarea")].find(el => el.placeholder === "Escribe lo siguiente");
    assert.ok(textarea);
    textarea.dispatchEvent(new attachmentApp.w.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await sleep(50);
    assert.equal(attachmentSends.length, 1, "attachment waits while the agent is busy");
    attachmentApp.emit("chat", { kind: "done", session: "image-a", workspace: "w", ok: true });
    await sleep(200);
    assert.equal(attachmentSends.length, 2);
    assert.equal(attachmentSends[1].prompt, "");
    assert.ok(attachmentSends[1].attachments.some(path => path.endsWith("report.pdf")));
    assert.deepEqual(attachmentApp.fallos, []);
    attachmentApp.w.close();
  }
  const gitRow = (branch, overrides = {}) => ({ kind: "branch", branch, head: "abc", shared_with: null,
    pull: null, pull_known: false, checked_at: null, stale: false, has_remote: true, merged_locally: false, ...overrides });
  let gitLocalCalls = 0;
  // Cada árbol montado antes conserva sus relojes y llama a ESTE stub: su
  // `invoke` resuelve `window.__TAURI_INTERNALS__` contra el global de ahora.
  // Se cuenta lo que nace de cada gesto, o sus tics entran en la cuenta.
  let gitDeltaCalls = 0;
  let rejectGit = false;
  let releaseRemote;
  let blockRemote = true;
  let gitRows = {
    p: gitRow("feature/parent", { pull: { number: 12, state: "merged", head_sha: "old" }, pull_known: true }),
    shared: gitRow("feature/parent", { shared_with: "p" }),
    own: gitRow("feature/child", { pull: { number: 13, state: "draft", head_sha: "abc" }, pull_known: true }),
    local: gitRow(null, { kind: "none" }),
    native: gitRow(null, { kind: "unknown" }),
  };
  const vocabulary = (id, prefix) => ({ change: { clave: `providers.${id}.change` }, change_short: { clave: `providers.${id}.change_short` },
    change_prefix: prefix, checks: { clave: `providers.${id}.checks` } });
  const sidebarResponses = { ...CON_TAREA,
    list_git_hosts: [{ id: "github", name: "GitHub", connected: null, summary: { clave: "providers.github.summary" }, vocabulary: vocabulary("github", "#") },
      { id: "gitlab", name: "GitLab", connected: null, summary: { clave: "providers.gitlab.summary" }, vocabulary: vocabulary("gitlab", "!") }],
    list_live_sessions: [task("p", null, "delivered"), task("shared", "p", null), task("own", "p", "failed"), task("local", "p", null), { ...task("native", "p", null), title: "/root/prueba_sidebar", subagent: "native-id" }],
    list_session_git: ({ remote }) => { if (!remote) { gitLocalCalls++; if (cause.getStore() === "delta") gitDeltaCalls++; } if (remote && blockRemote) return new Promise(resolve => { releaseRemote = resolve; }); return rejectGit ? Promise.reject(new Error("offline")) : structuredClone(gitRows); },
  };
  const sidebar = await boot("listo", 4, sidebarResponses);
  const row = id => sidebar.w.document.querySelector(`[data-sesion="${id}"]`);
  // La fila del riel dice el PR; la rama y el resto van en su `title` y en la tarjeta flotante.
  const gitDeFila = id => row(id)?.querySelector("[data-session-pr]")?.getAttribute("title") ?? "";
  assert.match(row("p").textContent, /Tarea p.*#12/s);
  assert.match(gitDeFila("p"), /feature\/parent.*#12/);
  assert.ok(row("p").querySelector('[data-session-pr] svg.lucide-git-branch'));
  assert.equal(row("p").querySelector('[aria-label="Resultado entregado"]'), null,
    "el fallo delegado tiene prioridad sobre la entrega del coordinador en el indicador común");
  assert.equal(row("own"), null, "la delegación no llena el sidebar");
  assert.equal(row("p").querySelectorAll('[aria-label="Fallo o interrupción"]').length, 1,
    "una subtarea fallida ocupa el único indicador del coordinador");
  // El riel no lista las subtareas; el buscador global sí las encuentra.
  await buscarEnLaVentana(sidebar, "Tarea");
  for (const hija of ["own", "shared", "local"]) {
    assert.ok(sidebar.w.document.querySelector(`[data-global-search] [data-search-key="task:${hija}"]`), "la búsqueda conserva acceso a las subtareas");
  }
  sidebar.w.document.querySelector('[data-global-search] input[role="combobox"]').dispatchEvent(new sidebar.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await sleep(80);
  assert.equal(row("own"), null);
  assert.equal(row("p").querySelectorAll('[aria-label="Fallo o interrupción"]').length, 1,
    "buscar conserva el único estado común del coordinador");
  assert.equal(row("p").querySelector('[aria-label="Resultado entregado"]'), null);
  blockRemote = false; releaseRemote(gitRows); await sleep(100);
  gitRows.shared = gitRow("feature/parent", { shared_with: "p", pull_known: true });
  gitRows.p = gitRow("renamed", { pull: { number: 12, state: "merged", head_sha: "abc" }, pull_known: true });
  sidebarResponses.list_live_sessions = sidebarResponses.list_live_sessions.map(s => ({ ...s, updated_at: 2 }));
  sidebar.emit("session", { project: "", session: "p", workspace: "w" });
  await sleep(350);
  assert.match(gitDeFila("p"), /renamed/);
  assert.ok(row("p").querySelector('.text-brand-purple > svg.lucide-git-merge'));
  assert.doesNotMatch(row("p").textContent, /HEAD distinto/);
  rejectGit = true;
  sidebar.w.dispatchEvent(new sidebar.w.Event("focus"));
  await sleep(100);
  assert.match(gitDeFila("p"), /renamed.*#12/);
  assert.doesNotMatch(row("p").textContent, /obsoleta|Integrado/);
  assert.equal(row("p").querySelector('svg.lucide-clock'), null);
  assert.match(row("p").innerHTML, /Último estado conocido/);
  assert.ok(row("p").querySelector(".text-neutral-500 > svg.lucide-git-merge"));
  rejectGit = false;
  gitRows.p = gitRow(null, { kind: "none" });
  sidebar.w.dispatchEvent(new sidebar.w.Event("focus"));
  await sleep(100);
  assert.equal(row("p").querySelector("[data-session-git]"), null);
  const revision = createHash("sha256").update("0:reply:Respuesta nueva").digest("hex");
  sidebarResponses.load_session = ({ id }) => ({ ...CON_TAREA.load_session, id, turns: [{ role: "agent", id: "reply", text: "Respuesta nueva" }] });
  sidebarResponses.list_live_sessions = sidebarResponses.list_live_sessions.map(s => ({ ...s, result_revision: revision }));
  let focused = false;
  sidebar.w.document.hasFocus = () => focused;
  sidebar.emit("session", { project: "", session: "p", workspace: "w" });
  await sleep(350);
  assert.equal(row("p").querySelector('[aria-label="Respuesta nueva sin leer"]'), null);
  assert.ok(row("p").querySelector('[aria-label="Fallo o interrupción"]'),
    "una respuesta del coordinador no oculta el fallo pendiente de su subtarea");
  assert.equal(row("p").querySelector('svg.lucide-mail'), null);
  row("p").click();
  await sleep(160);
  const tab = id => [...sidebar.w.document.querySelectorAll(':is([role="tab"], [data-preview-header] [role="button"])')].find(el => el.textContent.includes(id === "native" ? "prueba sidebar" : `Tarea ${id}`));
  assert.doesNotMatch(tab("p").getAttribute("aria-label"), /sin leer/);
  assert.equal(tab("p").querySelector("svg.lucide-git-branch"), null);
  focused = true;
  sidebar.w.dispatchEvent(new sidebar.w.Event("focus"));
  await sleep(120);
  assert.doesNotMatch(tab("p").getAttribute("aria-label"), /sin leer/);
  assert.ok(row("p").querySelector('[aria-label="Fallo o interrupción"]'),
    "ver el resultado del coordinador conserva la atención delegada");
  sidebar.emit("chat", { kind: "done", project: "", session: "p", workspace: "w", ok: true });
  sidebar.emit("chat", { kind: "done", project: "", session: "p", workspace: "w", ok: true });
  await sleep(150);
  assert.doesNotMatch(tab("p").getAttribute("aria-label"), /sin leer/);
  keepActiveView(sidebar);
  await abrirDesdeElBuscador(sidebar, "Tarea own", "own");
  assert.ok(tab("own").querySelector('[aria-label="Fallo o interrupción"].text-error-strong svg.lucide-circle-alert'));
  assert.ok(tab("own").querySelector("svg.lucide-git-pull-request-draft"));
  assert.equal(tab("own").querySelector("svg.lucide-git-pull-request"), null);
  assert.match(tab("own").title, /feature\/child.*#13/);
  await abrirDesdeElBuscador(sidebar, "Tarea shared", "shared");
  assert.ok(tab("shared").querySelector("svg.lucide-git-branch"));
  assert.match(tab("shared").title, /compartidas con la tarea padre/);
  await abrirDesdeElBuscador(sidebar, "prueba", "native");
  assert.equal(tab("native").querySelector("svg.lucide-git-branch"), null);
  assert.doesNotMatch(tab("native").textContent, /\/root\//);
  assert.doesNotMatch(tab("native").title, /feature\/parent|compartidas/);
  gitRows.p = gitRow("feature/parent", { pull: { number: 12, state: "merged", head_sha: "old" }, pull_known: true });
  sidebar.w.dispatchEvent(new sidebar.w.Event("focus"));
  await sleep(100);
  assert.ok(tab("p").querySelector("svg.lucide-git-branch"));
  assert.match(tab("p").title, /HEAD distinto/);
  rejectGit = true;
  sidebar.w.dispatchEvent(new sidebar.w.Event("focus"));
  await sleep(100);
  assert.ok(tab("p").querySelector("svg.lucide-git-branch"));
  assert.equal(tab("p").querySelector("svg.lucide-git-pull-request"), null);
  assert.doesNotMatch(tab("p").title, /obsoleta|Integrado/);
  rejectGit = false;
  for (const [state, icon, color] of [
    ["open", "git-pull-request", "text-success-strong"],
    ["draft", "git-pull-request-draft", "text-neutral-500"],
    ["closed", "git-pull-request-closed", "text-error-strong"],
    ["merged", "git-merge", "text-brand-purple"],
  ]) {
    gitRows.p = gitRow("feature/parent", { pull: { number: 12, state, head_sha: "abc" }, pull_known: true });
    sidebar.w.dispatchEvent(new sidebar.w.Event("focus"));
    await sleep(100);
    for (const surface of [row("p"), tab("p")]) {
      assert.ok(surface.querySelector(`.${color} > svg.lucide-${icon}`), state);
      assert.equal(surface.querySelectorAll(`svg.lucide-${icon}`).length, 1);
      assert.equal(surface.querySelector("svg.lucide-clock"), null);
    }
    assert.doesNotMatch(row("p").textContent, /PR abierto|Borrador|Cerrado|Integrado/);
  }
  for (const [kn, icon, color, label] of [
    ["clean", "file", "text-neutral-500", /Sin cambios/],
    ["draft", "file-pen-line", "text-neutral-500", /Borrador sin guardar/],
    ["saved", "file-check", "text-brand-purple", /Guardado en la carpeta/],
  ]) {
    gitRows.p = gitRow(null, { kind: "kn", kn, alias: "cone-260911" });
    sidebar.w.dispatchEvent(new sidebar.w.Event("focus"));
    await sleep(100);
    assert.ok(tab("p").querySelector(`.${color} > svg.lucide-${icon}`), kn);
    for (const surface of [row("p"), tab("p")]) assert.equal(surface.querySelector("svg.lucide-git-branch"), null);
    // Git/kn conserva su sección y color; el detalle queda en la etiqueta.
    assert.ok(row("p").querySelector(`[data-session-pr].${color} svg.lucide-${icon}`), kn);
    if (kn === "draft") {
      assert.match(gitDeFila("p"), /Cone/);
      assert.doesNotMatch(row("p").querySelector("[data-session-pr]").textContent, /Cone/);
    }
    assert.match(tab("p").title, label);
  }
  gitRows.p = gitRow(null, { kind: "kn", kn: "draft", alias: "gbsxhmdk" });
  sidebar.w.dispatchEvent(new sidebar.w.Event("focus"));
  await sleep(100);
  assert.match(gitDeFila("p"), /gbsxhmdk/);
  assert.doesNotMatch(row("p").textContent, /desconocido/);
  // La pestaña lleva checks y revisión; la tarjeta del riel, UNA señal por
  // prioridad: cambios pedidos › checks que fallan › en curso › aprobado › en verde.
  for (const [checks, review, visible, overrides, signal] of [
    ["success", "approved", true, {}, "approved"],
    ["pending", "changes_requested", true, {}, "changes_requested"],
    ["failure", "approved", true, {}, "failure"],
    ["pending", "approved", true, {}, "pending"],
    ["success", "unreviewed", true, {}, "success"],
    ["success", "approved", true, { state: "draft" }, null],
    ["unknown", "unknown", false, {}, null],
    ["none", "unreviewed", false, {}, null],
    ["success", "approved", false, { head_sha: "old" }, null],
    ["success", "approved", false, { state: "merged" }, null],
    ["success", "approved", false, { state: "closed" }, null],
    ["success", "approved", true, { stale: true }, "stale"],
  ]) {
    const { stale = false, ...pullOverrides } = overrides;
    gitRows.p = gitRow("feature/parent", { pull: { number: 12, state: "open", head_sha: "abc", checks, review, ...pullOverrides }, pull_known: true, stale });
    sidebar.w.dispatchEvent(new sidebar.w.Event("focus"));
    await sleep(100);
    const surface = tab("p");
    // Sin revisión registrada la pestaña no pinta ícono de revisión.
    const reviewVisible = visible && (review === "approved" || review === "changes_requested");
    assert.equal(!!surface.querySelector("[data-git-checks]"), visible, JSON.stringify(overrides));
    assert.equal(!!surface.querySelector("[data-git-review]"), reviewVisible, JSON.stringify({ review, ...overrides }));
    if (visible) {
      assert.ok(surface.querySelector(`[data-git-checks="${checks}"]`));
      if (reviewVisible) assert.ok(surface.querySelector(`[data-git-review="${review}"]`));
    }
    const signals = [...row("p").querySelectorAll("[data-session-pr] [data-git-signal]")].map((el) => el.dataset.gitSignal);
    assert.deepEqual(signals, signal ? [signal] : [], `${checks}/${review} ${JSON.stringify(overrides)}`);
    assert.equal(row("p").querySelector("[data-git-checks], [data-git-review]"), null, "la tarjeta no repite las dos señales");
    if (signal === "pending") {
      assert.ok(row("p").querySelector('[data-git-signal="pending"] svg.lucide-circle-dashed'), "checks pendientes: el círculo punteado de la flotante");
      assert.equal(row("p").querySelector("[data-session-pr] svg[data-spinner]"), null, "el único loader de la tarjeta es el de «trabajando»");
    }
    if (signal === "stale") {
      assert.ok(row("p").querySelector('[data-git-signal="stale"] svg.lucide-clock'), "desactualizado: solo el reloj");
      assert.ok(row("p").querySelector("[data-session-pr].text-neutral-500"), "desactualizado: el chip entero en gris");
    }
    assert.equal(!!row("p").querySelector("[data-session-pr] [data-pr-number].text-error-strong"), signal === "failure", "el número va en rojo si los checks fallan");
    if (stale) {
      assert.match(tab("p").title, /Último estado conocido/);
      assert.ok(tab("p").querySelector('[data-git-checks].text-neutral-500[data-git-stale]'));
    }
    if (overrides.head_sha) assert.match(tab("p").title, /otro commit/);
    if (checks === "unknown") assert.match(tab("p").title, /Comprobaciones: sin dato/);
    if (overrides.state === "draft") assert.ok(tab("p").querySelector('.text-neutral-500 > svg.lucide-git-pull-request-draft'));
  }
  // GitLab nombra lo suyo: `!12`, «Pipeline» y «MR», dichos por el motor.
  gitRows.p = gitRow("feature/parent", { pull: { git_host: "gitlab", number: 12, state: "merged", head_sha: "abc", checks: "success", review: "approved" }, pull_known: true });
  sidebar.w.dispatchEvent(new sidebar.w.Event("focus"));
  await sleep(100);
  assert.match(tab("p").title, /MR integrado/);
  assert.match(tab("p").title, /!12/);
  assert.doesNotMatch(tab("p").title, /#12/);
  gitRows.p = gitRow("feature/parent", { pull: { number: 12, state: "merged", head_sha: "abc" }, pull_known: true });
  sidebar.w.dispatchEvent(new sidebar.w.Event("focus"));
  await sleep(100);
  sidebar.emit("chat", { kind: "started", session: "p", workspace: "w" });
  await sleep(100);
  const workingDot = tab("p").querySelector('.rounded-full.bg-current');
  assert.ok(workingDot);
  assert.ok([...workingDot.classList].every((name) => !name.includes("animate")), "the working indicator stays visible without blinking");
  assert.equal(row("p").querySelectorAll("[data-task-orbit]").length, 1, "una tarea sin encargado conserva identidad con órbita");
  assert.equal(row("p").querySelector('[data-task-orbit] [data-session-agent]'), null, "sin encargado no hay una cara inventada");
  assert.equal(row("p").querySelectorAll('[data-task-orbit] svg:not([data-spinner])').length, 0, "sin encargado el centro queda vacío");
  assert.equal(row("p").querySelectorAll('[data-session-preview] [data-session-provider]').length, 1, "el proveedor conserva su sección fija debajo");
  assert.equal(tab("p").querySelector("svg[data-spinner]"), null);
  sidebar.emit("question", { session: "p", workspace: "w", turno: "question-turn", preguntas: [{ id: "choose", question: "¿Qué opción?", options: [], free_text: true }] });
  await sleep(100);
  assert.match(tab("p").getAttribute("aria-label"), /Te preguntó algo/);
  assert.ok(row("p").querySelector('[data-session-status] [aria-label="Te preguntó algo"]'));
  assert.ok(tab("p").querySelector("svg.lucide-git-merge"));
  assert.equal(tab("p").querySelector("svg[data-spinner]"), null);
  assert.equal(tab("p").querySelector("svg.lucide-git-branch"), null);
  // Un delta del chat no refresca git. Se cuenta lo que nace del delta y no lo
  // que cae en una ventana de tiempo: el refresco que deja «started» al
  // repriorizar aterriza cuando la máquina puede, y ninguna ventana lo esquiva.
  // La espera previa deja a git sin nada en vuelo: un refresco del delta con
  // una llamada en curso se pegaría a su `pending` y saldría de otra cadena.
  for (let locales = -1; locales !== gitLocalCalls; ) {
    locales = gitLocalCalls;
    await sleep(150);
  }
  cause.run("delta", () => sidebar.emit("chat", { kind: "delta", session: "p", workspace: "w", text: "Sigue trabajando" }));
  await sleep(200);
  assert.equal(gitDeltaCalls, 0, "un delta del chat no refresca git");
  assert.deepEqual(sidebar.fallos, []);
  assert.equal(sidebar.w.document.querySelector("[data-project-sessions]"), null);
  for (const modifier of ["metaKey", "ctrlKey", "native"]) {
    row("p").click();
    await sleep(100);
    keepActiveView(sidebar);
    assert.equal(tab("p").getAttribute("aria-selected"), "true");
    const beforeClose = sidebar.comandos.length;
    if (modifier === "native") sidebar.emit("close-tab", null);
    else {
      const key = new sidebar.w.KeyboardEvent("keydown", { key: "w", [modifier]: true, bubbles: true, cancelable: true });
      sidebar.w.document.querySelector("textarea").dispatchEvent(key);
      assert.equal(key.defaultPrevented, true);
    }
    await sleep(100);
    assert.equal(tab("p"), undefined);
    assert.ok(row("p"));
    assert.equal(sidebar.comandos.slice(beforeClose).some(c => ["request_close", "stop_turn", "delete_session"].includes(c)), false);
  }
  // Cerrar nunca cancela; salir usa el motor conectado y conserva el cliente ante errores.
  {
    let vivos = [];
    let listError = false;
    let stopError = false;
    let stopScope;
    const cierre = await boot("listo", "cierre-con-vivos", {
      ...CON_TAREA,
      list_live_turns: () => listError ? Promise.reject(new Error("list failed")) : vivos,
      pending_requests: () => ({ questions: [], permissions: [{ id: "durable-r", revision: 1, request_id: "r", tool: "Write", target: "hola.txt" }] }),
      stop_turn: (_args, options) => {
        stopScope = options?.headers?.["x-terminus-workspace"];
        return stopError ? Promise.reject(new Error("stop failed")) : null;
      },
      quit_completely: null,
      window_to_background: null,
      tray_update: null,
      tray_notify: null,
    });
    cierre.w.localStorage.setItem("harness.layout.close.live_turns", JSON.stringify("stop"));
    cierre.emit("close-requested", null);
    await sleep(100);
    assert.ok(cierre.comandos.includes("window_to_background"), "cerrar sin agentes conserva el cliente");
    assert.equal(cierre.comandos.includes("quit_completely"), false);
    vivos = [{ session: "p", workspace: "otro", project: "q", started_at: Date.now() }];
    const antes = cierre.comandos.length;
    cierre.emit("close-requested", null);
    await sleep(150);
    assert.equal(cierre.w.document.querySelector("[data-close-guard]"), null);
    assert.ok(cierre.comandos.slice(antes).includes("window_to_background"));
    assert.equal(cierre.comandos.slice(antes).includes("stop_turn"), false, "la preferencia antigua no cancela al cerrar");
    cierre.emit("tray-quit", null);
    cierre.emit("tray-quit", null);
    await sleep(150);
    const dialogo = () => cierre.w.document.querySelector("[data-close-guard]");
    const button = (text) => [...dialogo().querySelectorAll("button")].find(b => b.textContent.includes(text));
    assert.ok(dialogo(), "salir explícitamente pregunta por las tareas del cliente");
    assert.match(dialogo().textContent, /espera tu respuesta/);
    assert.equal(cierre.comandos.includes("quit_completely"), false);
    stopError = true;
    button("Detenerlas y salir").click();
    await sleep(150);
    assert.equal(stopScope, "otro", "la parada conserva el workspace del turno");
    assert.ok(dialogo());
    assert.match(dialogo().textContent, /No se pudo completar la salida/);
    assert.equal(cierre.comandos.includes("quit_completely"), false, "una parada fallida no cierra el cliente");
    button("Cancelar").click();
    listError = true;
    const antesFallo = cierre.comandos.length;
    cierre.emit("tray-quit", null);
    await sleep(150);
    assert.ok(dialogo(), "una consulta fallida se muestra dentro del diálogo");
    assert.equal(cierre.comandos.slice(antesFallo).includes("quit_completely"), false);
    button("Seguir en segundo plano").click();
    await sleep(150);
    assert.equal(dialogo(), null);
    assert.ok(cierre.comandos.slice(antesFallo).includes("window_to_background"));
    listError = false;
    stopError = false;
    cierre.emit("tray-quit", null);
    await sleep(150);
    button("Detenerlas y salir").click();
    await sleep(150);
    assert.equal(cierre.comandos.filter(c => c === "quit_completely").length, 1);
    assert.deepEqual(cierre.fallos, []);
    cierre.w.close();
    const idle = await boot("listo", "salir-sin-turnos", { ...CON_TAREA, tray_update: null, quit_completely: null });
    idle.emit("tray-quit", null);
    idle.emit("tray-quit", null);
    await sleep(150);
    assert.equal(idle.comandos.filter(c => c === "quit_completely").length, 1);
    assert.equal(idle.comandos.includes("stop_turn"), false);
    assert.deepEqual(idle.fallos, []);
    idle.w.close();
  }
  // Abrir una tarea que ya contestaba con una herramienta en curso lanzaba
  // «Stale read from <Match>» en el hilo; Solid abortaba esa actualización
  // y la fila abierta de la barra se quedaba marcada para siempre.
  const seleccion = await boot("listo", "seleccion-viva", {
    ...CON_TAREA,
    list_live_sessions: [task("viva", null, null), task("otra", null, null)],
    list_session_git: {},
    load_session: ({ id }) => ({ ...CON_TAREA.load_session, id, turns: [{ role: "user", text: "Hazlo" }, { role: "agent", text: "Hecho.", duration_ms: 1000 }] }),
  });
  const filaDe = id => seleccion.w.document.querySelector(`[data-sesion="${id}"]`);
  const marcadas = () => [...seleccion.w.document.querySelectorAll('[data-sesion][aria-current="true"]')].map(el => el.dataset.sesion);
  seleccion.emit("chat", { kind: "started", session: "viva", workspace: "w", project: "" });
  seleccion.emit("chat", { kind: "tool", session: "viva", workspace: "w", project: "", text: "Bash", target: "ls", id: "item_1" });
  await sleep(50);
  filaDe("viva").click();
  await sleep(160);
  assert.deepEqual(marcadas(), ["viva"]);
  filaDe("otra").click();
  await sleep(160);
  assert.deepEqual(marcadas(), ["otra"], "la marca de la barra sigue a la tarea abierta");
  filaDe("viva").click();
  await sleep(160);
  assert.deepEqual(marcadas(), ["viva"]);
  assert.deepEqual(seleccion.fallos, []);
  seleccion.w.close();
  const groupedResponses = {
    ...CON_TAREA,
    list_projects: [{ id: "folder", name: "Carpeta", sources: [], portfolio: null }],
    list_live_sessions: ({ project }) => project === "folder" ? sidebarResponses.list_live_sessions : [],
    list_session_git: {},
  };
  const flat = await mount("listo", "5-flat", groupedResponses, undefined, SIN_AGRUPAR);
  assert.equal(flat.w.document.querySelector("[data-folder-group]"), null, "sin agrupar no hay filas de carpeta");
  // `p` falló (por su delegada) y no pide nada: su segunda línea es la normal.
  assert.equal(flat.w.document.querySelector('[data-sesion="p"] [data-session-request]'), null, "una fallida no enseña su último mensaje");
  assert.ok(flat.w.document.querySelector('[data-sesion="p"] [data-folder-chip="folder"]'), "la carpeta va como dato de la fila");
  assert.deepEqual(flat.fallos, []);
  flat.w.close();
  const grouped = await bootPorCarpeta("listo", 5, groupedResponses);
  const guide = grouped.w.document.querySelector('[data-sidebar-group="folder"]');
  assert.ok(guide);
  assert.ok(guide.querySelector('[data-sesion="p"]'));
  assert.equal(guide.querySelector('[data-sesion="shared"]'), null, "la rama nace plegada");
  const folderToggle = grouped.w.document.querySelector('[data-destino="folder"] button[aria-expanded]');
  assert.ok(folderToggle);
  const projectRow = folderToggle.parentElement;
  assert.ok(projectRow.classList.contains("grid-cols-[20px_minmax(0,1fr)_auto_auto]"));
  assert.equal(projectRow.children.length, 4);
  assert.equal(projectRow.lastElementChild.getAttribute("aria-label"), "Nueva tarea en Carpeta");
  folderToggle.click(); await sleep(30);
  assert.equal(grouped.w.document.querySelector('[data-sidebar-group="folder"] [data-sesion]'), null);
  folderToggle.click(); await sleep(30);
  assert.ok(grouped.w.document.querySelector('[data-sidebar-group="folder"] [data-sesion="p"]'));
  assert.deepEqual(grouped.fallos, []);
  const newTaskClick = await boot("listo", "new-task-click", CON_TAREA);
  let newTaskRequests = 0;
  newTaskClick.w.addEventListener("harness:tarea-nueva", () => newTaskRequests++);
  newTaskClick.w.document.querySelector('[data-sesion="s1"]').click();
  await sleep(100);
  keepActiveView(newTaskClick);
  for (const collapsed of [false, true]) {
    const taskTab = newTaskClick.w.document.querySelector('[role="tab"]');
    taskTab.click();
    await sleep(50);
    assert.ok(newTaskClick.w.document.querySelector('[role="tab"][aria-selected="true"]'));
    if (collapsed) newTaskClick.w.document.querySelector('button[aria-label="Ocultar el historial"]').click();
    await sleep(50);
    newTaskClick.w.document.querySelector('button[aria-label="Nueva tarea"]').click();
    await sleep(50);
    assert.equal(newTaskRequests, collapsed ? 2 : 1, "the tooltip must preserve the new-task click exactly once");
    assert.equal(newTaskClick.w.document.querySelector('[role="tab"][aria-selected="true"]'), null);
    assert.ok(newTaskClick.w.document.querySelector("textarea"));
    // La caja flota: sin agente también va centrada mientras el hilo está vacío.
    // Se lee la clase que decide el sitio, no una medida que jsdom no hace.
    const cajaCentrada = (doc) => {
      const capas = [...doc.querySelectorAll("[class*='inset-0']")].filter((el) =>
        /justify-(center|end)/.test(el.className),
      );
      return capas.some((el) => el.className.includes("justify-center"));
    };
    assert.equal(cajaCentrada(newTaskClick.w.document), true, "la tarea nueva en blanco centra la caja");
    const tareaNueva = newTaskClick.w.document.querySelector("[data-borrador]");
    assert.ok(tareaNueva?.textContent.includes("Nueva tarea"), "la tarea nueva sin lanzar se ve en la tira");
    tareaNueva.querySelector("button").click();
    await sleep(50);
    assert.equal(newTaskClick.w.document.querySelector("[data-borrador]"), null, "cerrarla vuelve a la pestaña anterior");
    assert.ok(newTaskClick.w.document.querySelector('[role="tab"][aria-selected="true"]'));
  }
  assert.deepEqual(newTaskClick.fallos, []);
  assert.equal(newTaskClick.comandos.includes("delete_session"), false);
  const folders = [{ id: "p1", name: "Carpeta A", kind: "folder", portfolio: "g1", sources: [] }];
  let recentPreview = "";
  let recentChild = false;
  let recentTitle = "Tarea reciente";
  const taskRenames = [];
  let cloneRequest;
  let finishClone;
  let rejectClone;
  let cloneCancellations = 0;
  let holdRepositoryReply = false;
  let finishRepositoryReply;
  const sidebarControls = await bootPorCarpeta("listo", "sidebar-controls", {
    ...CON_TAREA,
    list_agent_profiles: { Giskard: { display_name: "Giskard PO", body: "moon" } },
    list_projects: () => structuredClone(folders),
    list_live_sessions: ({ project }) => project === "p1" ? [
      { ...CON_TAREA.list_live_sessions[0], launched_by: null, agent: "executor" },
      { ...CON_TAREA.list_live_sessions[0], id: "agent-root", launched_by: "agent-chat", launcher_name: "Giskard", agent: "Giskard" },
      { ...CON_TAREA.list_live_sessions[0], id: "orphan-root", launched_by: "deleted-chat", launcher_name: null },
      { ...CON_TAREA.list_live_sessions[0], id: "old-root" },
      { ...CON_TAREA.list_live_sessions[0], id: "same-author", launched_by: "another-topic", launcher_name: "Giskard", agent: "Giskard" },
    ] : project === "" ? [{ ...CON_TAREA.list_live_sessions[0], id: "recent", title: recentTitle, last_message: recentPreview },
      ...(recentChild ? [{ ...CON_TAREA.list_live_sessions[0], id: "recent-child", parent: "recent" }] : [])] : [],
    rename_session: args => { taskRenames.push(args); recentTitle = args.title; },
    rename_project: ({ id, name }) => { folders[0].name = name; },
    get_project_directory: "/lab",
    list_project_repositories: ({ workspace }) => {
      assert.equal(workspace, "w");
      return [{ name: "acme/app", url: "git@github.com:acme/app.git", git_host: "github", last_used: 2 },
        { name: "legacy/offline", url: "https://git.example.org/legacy/offline.git", git_host: null, last_used: 1 }];
    },
    list_git_hosts: [{ id: "github", name: "GitHub", connected: { identity: { user: "acme" } } },
      { id: "bitbucket", name: "Bitbucket", connected: { identity: { user: "team" } } }],
    git_host_areas: ({ id, scope }) => { assert.equal(scope, "w"); return [{ key: id === "github" ? "acme" : "team", name: id === "github" ? "acme" : "team" }]; },
    git_host_projects: ({ id, scope }) => {
      assert.equal(scope, "w");
      if (id === "bitbucket") throw { what: "Sin red en Bitbucket", detail: "offline" };
      if (holdRepositoryReply) return new Promise(resolve => { finishRepositoryReply = resolve; });
      return [{ name: "app", slug: "app", clone_url: "https://github.com/acme/app.git" },
        { name: "new", slug: "new", clone_url: "https://github.com/acme/new.git" }];
    },
    clone_project: args => {
      cloneRequest = args;
      return new Promise((resolve, reject) => { finishClone = resolve; rejectClone = reject; });
    },
    cancel_project_clone: ({ operation }) => {
      assert.equal(operation, cloneRequest.operation);
      cloneCancellations++;
      rejectClone({ what: "Clonado cancelado.", detail: "cancelled by test" });
    },
    create_project: ({ name }) => { const p = { id: "loose", name, kind: "folder", portfolio: null, sources: [] }; folders.push(p); return p; },
  });
  const controlsDoc = sidebarControls.w.document;
  assert.equal(controlsDoc.querySelector("[data-task-author]"), null, "el riel no agrupa por agente, tampoco «Recientes»");
  assert.equal(controlsDoc.querySelector('[data-tasks-header] button[aria-pressed]'), null, "no hay botón de agrupar");

  assert.equal(controlsDoc.querySelector("[data-session-origin]"), null);
  const savedTaskRow = controlsDoc.querySelector('[data-sesion="recent"]');
  const sidebarViewport = savedTaskRow.closest("[data-arrastre-scroll]");
  // El riel enseña solo lo que abrió la persona: lo que lanzó un agente es de su lanzador, esté o no en la lista.
  assert.equal(controlsDoc.querySelector('[data-sidebar-tasks] [data-sesion="agent-root"]'), null);
  assert.equal(controlsDoc.querySelector('[data-sidebar-tasks] [data-sesion="orphan-root"]'), null);
  assert.ok(controlsDoc.querySelector('[data-destino="p1"]'));
  assert.equal(controlsDoc.querySelector('[data-portfolio]'), null);
  sidebarViewport.scrollTop = 120;
  await sleep(80);
  assert.equal(controlsDoc.querySelector('[data-sesion="recent"]'), savedTaskRow);
  controlsDoc.querySelector('[data-destino="p1"] button[aria-haspopup="menu"]').click();
  await sleep(50);
  [...controlsDoc.querySelectorAll('[role="menuitem"]')].find(item => item.textContent === "Nuevo agente").click();
  await sleep(50);
  assert.match(controlsDoc.querySelector('[role="dialog"]').textContent, /Nuevo agente/);
  [...controlsDoc.querySelectorAll('[role="dialog"] button')].find(button => button.textContent === "Cancelar").click();
  await sleep(50);
  controlsDoc.querySelector('[data-destino="p1"] [data-folder-open]').dispatchEvent(new sidebarControls.w.MouseEvent("dblclick", { bubbles: true }));
  assert.ok(controlsDoc.querySelector('[data-destino="p1"] input'));
  const folderEditor = controlsDoc.querySelector('[data-destino="p1"] input');
  await sleep(30);
  folderEditor.value = "Borrador de carpeta";
  folderEditor.dispatchEvent(new sidebarControls.w.Event("input", { bubbles: true }));
  folderEditor.setSelectionRange(3, 7);
  folders[0].working_directory = "/lab/updated";
  sidebarControls.emit("cli-changed", { workspace: "w", command: "task.send" });
  await sleep(350);
  assert.equal(controlsDoc.querySelector('[data-destino="p1"] input'), folderEditor, "un aviso del agente no remonta la carpeta en edición");
  assert.equal(controlsDoc.activeElement, folderEditor);
  assert.equal(folderEditor.value, "Borrador de carpeta");
  assert.equal(folderEditor.selectionStart, 3);
  assert.equal(folderEditor.selectionEnd, 7);
  controlsDoc.querySelector('[data-destino="p1"] input').dispatchEvent(new sidebarControls.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  controlsDoc.querySelector('[data-sesion="recent"]').dispatchEvent(new sidebarControls.w.MouseEvent("dblclick", { bubbles: true }));
  await sleep(30);
  const taskEditor = controlsDoc.querySelector('[data-sesion="recent"] input');
  assert.ok(taskEditor);
  taskEditor.value = "Borrador de tarea";
  taskEditor.dispatchEvent(new sidebarControls.w.Event("input", { bubbles: true }));
  taskEditor.setSelectionRange(2, 5);
  recentPreview = "El agente sigue trabajando";
  recentChild = true;
  sidebarControls.emit("chat", { kind: "started", workspace: "w", session: "recent" });
  sidebarControls.emit("session", { workspace: "w", project: "", session: "recent" });
  await sleep(350);
  assert.equal(controlsDoc.querySelector('[data-sesion="recent"] input'), taskEditor, "actualizar el mensaje de la tarea no recrea su editor");
  assert.equal(controlsDoc.activeElement, taskEditor);
  assert.equal(taskEditor.value, "Borrador de tarea");
  assert.equal(taskEditor.selectionStart, 2);
  assert.equal(taskEditor.selectionEnd, 5);
  assert.ok(controlsDoc.querySelector('[data-sesion="recent"] [data-session-status] [aria-label$="Está trabajando"]'), "la fila se actualiza sin recrear su editor");
  assert.deepEqual(taskRenames, [], "refrescar no guarda un nombre a medio escribir");
  taskEditor.dispatchEvent(new sidebarControls.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.deepEqual(taskRenames, [], "Escape descarta el borrador aunque el agente esté trabajando");
  controlsDoc.querySelector('[data-sesion="recent"]').dispatchEvent(new sidebarControls.w.MouseEvent("dblclick", { bubbles: true }));
  await sleep(30);
  const confirmedEditor = controlsDoc.querySelector('[data-sesion="recent"] input');
  confirmedEditor.value = "Nombre confirmado";
  confirmedEditor.dispatchEvent(new sidebarControls.w.Event("input", { bubbles: true }));
  confirmedEditor.closest("form").dispatchEvent(new sidebarControls.w.Event("submit", { bubbles: true, cancelable: true }));
  await sleep(50);
  assert.deepEqual(taskRenames, [{ project: "", id: "recent", title: "Nombre confirmado" }], "confirmar guarda una sola vez durante el turno");
  sidebarControls.emit("chat", { kind: "done", workspace: "w", session: "recent", ok: true });
  assert.ok(controlsDoc.querySelector('[data-sesion="recent"]'));
  await abrirAnadirProyecto(sidebarControls);
  const repositorySearch = controlsDoc.querySelector('input[placeholder="Buscar proyecto"]');
  assert.ok(repositorySearch);
  const sourceButtons = [...controlsDoc.querySelectorAll('[role="dialog"] button')];
  assert.ok(sourceButtons[0].textContent.includes("Git URL"));
  assert.ok(sourceButtons[1].textContent.includes("GitHub"));
  assert.ok(sourceButtons[2].textContent.includes("Bitbucket"));
  assert.ok(sourceButtons[3].textContent.includes("Explorar carpeta"));
  assert.ok(sourceButtons[4].textContent.includes("Empezar vacía"));
  assert.equal(sourceButtons.filter(b => b.textContent.includes("acme/app")).length, 1);
  assert.ok(sourceButtons.some(b => b.textContent.includes("legacy/offline")), "un fallo del proveedor no oculta el historial local");
  repositorySearch.value = "ACME";
  repositorySearch.dispatchEvent(new sidebarControls.w.Event("input", { bubbles: true }));
  assert.ok([...controlsDoc.querySelectorAll('[role="dialog"] button')].some(b => b.textContent.includes("acme/new")), "la búsqueda global encuentra un repo accesible aún no cargado");
  [...controlsDoc.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.includes("acme/app")).click();
  await sleep(50);
  controlsDoc.querySelector('[role="dialog"] form').dispatchEvent(new sidebarControls.w.Event("submit", { bubbles: true, cancelable: true }));
  await sleep(50);
  assert.equal(cloneRequest.gitHost, "github");
  assert.equal(cloneRequest.url, "https://github.com/acme/app.git");
  finishClone({ id: "provider-clone", name: "App", kind: "git", sources: [] });
  await sleep(100);
  holdRepositoryReply = true;
  await abrirAnadirProyecto(sidebarControls);
  controlsDoc.dispatchEvent(new sidebarControls.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await sleep(50);
  holdRepositoryReply = false;
  await abrirAnadirProyecto(sidebarControls);
  finishRepositoryReply([{ name: "stale", slug: "stale", clone_url: "https://github.com/acme/stale.git" }]);
  await sleep(50);
  const newRepositorySearch = controlsDoc.querySelector('input[placeholder="Buscar proyecto"]');
  newRepositorySearch.value = "stale";
  newRepositorySearch.dispatchEvent(new sidebarControls.w.Event("input", { bubbles: true }));
  assert.ok(!controlsDoc.querySelector('[role="dialog"]').textContent.includes("acme/stale"), "una respuesta del selector cerrado no entra al nuevo");
  newRepositorySearch.value = "";
  newRepositorySearch.dispatchEvent(new sidebarControls.w.Event("input", { bubbles: true }));
  await sleep(50);
  [...controlsDoc.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.includes("Empezar vacía")).click();
  await sleep(50);
  const folderName = controlsDoc.querySelector('[role="dialog"] input');
  folderName.value = "Carpeta suelta";
  folderName.dispatchEvent(new sidebarControls.w.Event("input", { bubbles: true }));
  folderName.closest("form").dispatchEvent(new sidebarControls.w.Event("submit", { bubbles: true, cancelable: true }));
  await sleep(100);
  // Agrupando por carpeta, la recién creada aparece ya, sin tareas, y se sigue en «Nueva tarea» dentro de ella.
  for (let i = 0; i < 80 && !controlsDoc.querySelector('[data-folder-group="loose"] [data-folder-open]'); i++) await sleep(25);
  const sueltaEnElRiel = controlsDoc.querySelector('[data-sidebar-group="loose"]');
  assert.ok(sueltaEnElRiel, "una carpeta recién creada y sin tareas aparece en el riel");
  assert.equal(sueltaEnElRiel.querySelector("[data-folder-empty]")?.textContent, "Sin tareas todavía");
  assert.ok(sueltaEnElRiel.querySelector('button[aria-label="Nueva tarea en Carpeta suelta"]'), "con su «+»");
  assert.equal(sueltaEnElRiel.querySelector("[data-folder-open]").dataset.active, "true", "y marcada mientras se mira su «Nueva tarea»");
  assert.match(controlsDoc.querySelector('button[aria-label="Proyecto"]')?.textContent ?? "", /Carpeta suelta/, "«Nueva tarea» queda en la carpeta recién creada");
  assert.deepEqual(sidebarControls.fallos, []);
  const openClone = async () => {
    await abrirAnadirProyecto(sidebarControls);
    [...controlsDoc.querySelectorAll('[role="dialog"] button')].find(button => button.textContent.includes("Git URL")).click();
    await sleep(50);
    const input = controlsDoc.querySelector('[role="dialog"] input');
    input.value = "https://example.invalid/repo.git";
    input.dispatchEvent(new sidebarControls.w.Event("input", { bubbles: true }));
    input.closest("form").dispatchEvent(new sidebarControls.w.Event("submit", { bubbles: true, cancelable: true }));
    await sleep(50);
  };
  await openClone();
  assert.equal(cloneRequest.workspace, "w");
  assert.equal(cloneRequest.gitHost, null);
  assert.equal(controlsDoc.querySelector('[role="progressbar"]'), null);
  cloneRequest.progress.onmessage({ phase: "receiving", percent: 42 });
  await sleep(50);
  assert.equal(controlsDoc.querySelector('[role="progressbar"]').getAttribute("aria-valuenow"), "42");
  [...controlsDoc.querySelectorAll('[role="dialog"] button')].find(button => button.textContent === "Continuar en segundo plano").click();
  await sleep(100);
  assert.equal(controlsDoc.querySelector('[role="dialog"]'), null);
  assert.equal(cloneCancellations, 0);
  // El clon escondido vive en el riel, con el nombre que va a tener la carpeta
  // y su avance. Sin `data-destino` ni fila de proyecto: no hay proyecto hasta
  // que git termina, y soltarle una tarea o abrirlo no llevaría a ningún sitio.
  const filaDelClon = [...controlsDoc.querySelectorAll("aside button")].find(button => button.textContent.includes("Clonando…") && button.textContent.includes("Recibiendo"));
  assert.ok(filaDelClon);
  assert.ok(filaDelClon.textContent.includes("repo"));
  assert.ok(filaDelClon.textContent.includes("42 %"));
  assert.equal(filaDelClon.closest("[data-destino]"), null);
  filaDelClon.click();
  await sleep(50);
  [...controlsDoc.querySelectorAll('[role="dialog"] button')].find(button => button.textContent === "Cancelar").click();
  await sleep(100);
  assert.equal(cloneCancellations, 1);
  assert.ok(controlsDoc.querySelector('[role="dialog"]').textContent.includes("Clonado cancelado."));
  // Cancelado y con el diálogo escondido, el riel sigue diciendo que ese clon
  // falló: sin la fila, el intento desaparece de la lista sin dejar rastro.
  assert.ok([...controlsDoc.querySelectorAll("aside button")].some(button => button.textContent.includes("Clonado fallido")));
  [...controlsDoc.querySelectorAll('[role="dialog"] button')].find(button => button.textContent === "Atrás").click();
  await sleep(50);
  assert.equal([...controlsDoc.querySelectorAll("aside button")].some(button => button.textContent.includes("Clonado fallido")), false);
  controlsDoc.dispatchEvent(new sidebarControls.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await sleep(50);
  await openClone();
  finishClone({ id: "clone", name: "Cloned", kind: "git", sources: [] });
  await sleep(100);
  assert.equal(controlsDoc.querySelector('[role="dialog"]'), null);
  assert.deepEqual(sidebarControls.fallos, []);
  const branchSubmissions = [];
  let finishBranchRefresh;
  let finishBranchDetails;
  const localBranches = { selected: "refs/heads/dev", fetched_at: null, branches: [
    { reference: "refs/heads/dev", name: "dev", remote: false, commit: "abc", ahead: 1, behind: 0 },
    { reference: "refs/remotes/origin/dev", name: "origin/dev", remote: true, commit: "def", ahead: null, behind: null },
  ] };
  const branchPicker = await bootPorCarpeta("listo", "task-base-picker", {
    ...RESPUESTAS,
    list_projects: [{ id: "git-project", name: "Laboratorio", kind: "git", working_directory: "/lab", sources: [] }],
    list_live_sessions: CON_TAREA.list_live_sessions,
    load_session: CON_TAREA.load_session,
    load_queue: [],
    list_models: { ...RESPUESTAS.list_models, models: [
      ...RESPUESTAS.list_models.models,
      { id: "gpt-alternate", label: "GPT Alternate", gratis: null, note: null, efforts: ["low", "high"], default_effort: "low" },
    ] },
    project_base_branches: ({ refresh, details }) => details
      ? new Promise(resolve => { finishBranchDetails = () => resolve(localBranches); })
      : refresh
      ? new Promise(resolve => { finishBranchRefresh = () => resolve(localBranches); })
      : localBranches,
    send_message: args => { branchSubmissions.push(args); return "branch-task"; },
  });
  const branchDoc = branchPicker.w.document;
  branchDoc.querySelector('[data-destino="git-project"] [data-folder-open]').click();
  await sleep(100);
  [...branchDoc.querySelectorAll("header button")].find(b => b.textContent.trim() === "Nueva tarea").click();
  await sleep(100);
  await sleep(50);
  const branchButton = branchDoc.querySelector('button[aria-label="Rama base"]');
  const projectButton = branchDoc.querySelector('button[aria-label="Proyecto"]');
  assert.ok(projectButton.parentElement.contains(branchButton), "project and branch share the context row");
  assert.equal(branchButton.closest("form"), null);
  assert.equal(branchButton.textContent.trim(), "dev");
  branchDoc.querySelector('button[aria-label="Rama base"]').click();
  await sleep(100);
  assert.equal(typeof finishBranchDetails, "function");
  assert.equal(branchDoc.querySelector('button[aria-label="Rama base"]').textContent.trim(), "dev");
  assert.ok([...branchDoc.querySelectorAll("button")].some(button => button.textContent === "dev"));
  const mentionReads = branchPicker.comandos.filter(command => command === "list_mentions").length;
  const typingPrompt = branchDoc.querySelector("textarea");
  for (let index = 0; index < 100; index += 1) {
    typingPrompt.value = `Texto ${index}`;
    typingPrompt.dispatchEvent(new branchPicker.w.Event("input", { bubbles: true }));
  }
  await sleep(30);
  assert.equal(branchPicker.comandos.filter(command => command === "list_mentions").length, mentionReads);
  [...branchDoc.querySelectorAll("button")].find(button => button.textContent.includes("Actualizar ramas")).click();
  await sleep(30);
  assert.equal(typeof finishBranchRefresh, "function");
  assert.equal(branchDoc.querySelector('button[aria-label="Rama base"]').disabled, false);
  [...branchDoc.querySelectorAll("button")].find(b => b.textContent === "origin").click();
  await sleep(30);
  [...branchDoc.querySelectorAll("button")].find(b => b.textContent === "origin/dev").click();
  await sleep(50);
  assert.equal(branchDoc.querySelector('button[aria-label="Rama base"]').textContent.trim(), "origin/dev");
  branchDoc.querySelector('button[aria-label^="Modelo: GPT-5.6"]').click();
  await sleep(30);
  [...branchDoc.querySelectorAll('[role="option"]')].find(button => button.textContent.includes("GPT Alternate")).click();
  await sleep(30);
  if (!branchDoc.querySelector('[role="group"][aria-label="Cuánto piensa antes de responder"]')) {
    branchDoc.querySelector('button[aria-label^="Modelo: GPT Alternate"]').click();
    await sleep(30);
  }
  [...branchDoc.querySelectorAll('[role="group"][aria-label="Cuánto piensa antes de responder"] button')].find(button => button.textContent.trim() === "Alto").click();
  await sleep(30);
  branchDoc.querySelector('[data-sesion="s1"]').click();
  await sleep(100);
  assert.ok(branchDoc.querySelector('button[aria-label^="Modelo: GPT-5.6"]'));
  branchDoc.querySelector('[data-destino="git-project"] button[title="Nueva tarea en Laboratorio"]').click();
  await sleep(100);
  assert.equal(branchDoc.querySelector("textarea").value, "Texto 99");
  assert.equal(branchDoc.querySelector('button[aria-label="Rama base"]').textContent.trim(), "origin/dev");
  assert.ok(branchDoc.querySelector('button[aria-label="Modelo: GPT Alternate. Razonamiento: Alto"]'), "el razonamiento elegido sigue en la caja");
  const branchPrompt = branchDoc.querySelector("textarea");
  finishBranchRefresh();
  finishBranchDetails();
  await sleep(30);
  assert.equal(branchDoc.querySelector('button[aria-label="Rama base"]').textContent.trim(), "origin/dev");
  branchPrompt.value = "Comprueba la rama";
  branchPrompt.dispatchEvent(new branchPicker.w.Event("input", { bubbles: true }));
  branchPrompt.closest("form").dispatchEvent(new branchPicker.w.Event("submit", { bubbles: true, cancelable: true }));
  await sleep(100);
  assert.equal(branchSubmissions[0]?.baseRef, "refs/remotes/origin/dev");
  assert.equal(branchSubmissions[0]?.model, "gpt-alternate");
  assert.equal(branchSubmissions[0]?.effort, "high");
  branchDoc.querySelector('[data-destino="git-project"] [data-folder-open]').click();
  await sleep(100);
  [...branchDoc.querySelectorAll("header button")].find(b => b.textContent.trim() === "Nueva tarea").click();
  await sleep(100);
  assert.equal(branchDoc.querySelector('button[aria-label="Rama base"]').textContent.trim(), "dev");
  const defaultPrompt = branchDoc.querySelector("textarea");
  defaultPrompt.value = "Usa la predeterminada del proyecto";
  defaultPrompt.dispatchEvent(new branchPicker.w.Event("input", { bubbles: true }));
  defaultPrompt.closest("form").dispatchEvent(new branchPicker.w.Event("submit", { bubbles: true, cancelable: true }));
  await sleep(100);
  assert.equal(branchSubmissions[1]?.baseRef, null, "automatic default is resolved by the backend, not stored as a task override");
  assert.deepEqual(branchPicker.fallos, []);
  const deadBase = { selected: "refs/heads/borrada", fetched_at: null, branches: [
    { reference: "refs/heads/dev", name: "dev", remote: false, commit: "abc", ahead: null, behind: null },
  ] };
  const missingBase = await bootPorCarpeta("listo", "task-base-missing", {
    ...RESPUESTAS,
    list_live_sessions: CON_TAREA.list_live_sessions,
    list_projects: [{ id: "git-project", name: "Laboratorio", kind: "git", working_directory: "/lab", sources: [] }],
    project_base_branches: () => deadBase,
  });
  const missingDoc = missingBase.w.document;
  missingDoc.querySelector('[data-destino="git-project"] [data-folder-open]').click();
  await sleep(100);
  [...missingDoc.querySelectorAll("header button")].find(b => b.textContent.trim() === "Nueva tarea").click();
  await sleep(100);
  const missingButton = missingDoc.querySelector('button[aria-label="Rama base"]');
  assert.equal(missingButton.textContent.trim(), "borrada");
  assert.ok(missingButton.className.includes("text-error-strong"), "a saved base that no longer exists is painted with the error token");
  assert.ok([...missingDoc.querySelectorAll("span")].some(span => span.textContent === "La rama base ya no existe. Elige otra antes de iniciar la tarea."));
  missingButton.click();
  await sleep(100);
  assert.ok([...missingDoc.querySelectorAll("button")].some(button => button.textContent === "dev"));
  assert.deepEqual(missingBase.fallos, []);
  const fastTurn = await boot("listo", "done-before-ack", {
    ...RESPUESTAS,
    turn_authors: () => new Promise(() => {}),
    list_live_sessions: [{ ...CON_TAREA.list_live_sessions[0], id: "fast-turn", project: null }],
    load_session: { ...CON_TAREA.load_session, id: "fast-turn", turns: [
      { role: "assistant", text: "Respuesta terminada antes del acuse", when: 1, author: { kind: "codex", name: null, verified_by: null, account: null } },
    ] },
    send_message: () => {
      fastTurn.emit("chat", { workspace: "w", session: "fast-turn", kind: "done", text: "", ok: false });
      return "fast-turn";
    },
  });
  const fastPrompt = fastTurn.w.document.querySelector("textarea");
  fastPrompt.value = "Prueba de cierre temprano";
  fastPrompt.dispatchEvent(new fastTurn.w.Event("input", { bubbles: true }));
  fastPrompt.closest("form").dispatchEvent(new fastTurn.w.Event("submit", { bubbles: true, cancelable: true }));
  await sleep(100);
  assert.equal(fastTurn.comandos.includes("send_message"), true);
  assert.equal(fastTurn.w.document.querySelector('button[aria-label="Detener turno"]'), null);
  assert.ok(fastTurn.w.document.body.textContent.includes("Respuesta terminada antes del acuse"));
  assert.deepEqual(fastTurn.fallos, []);

  // Lo que llega con el turno ya cerrado no se pinta bajo «Trabajando», y la
  // fila vieja de que una tarea lanzada terminó ya no se pinta.
  const lateNotice = await boot("listo", "late-notice", {
    ...CON_TAREA,
    load_session: { ...CON_TAREA.load_session, turns: [
      { role: "agent", id: "answer", text: "Revisé todo." },
      { role: "system", text: "Se guardó el árbol.", meta: null },
      { role: "system", text: "La tarea «Revisión» terminó: listo.", meta: "task_completed",
        from_task: { folder: "", task: "child", title: "Revisión", provider: "claude" } },
    ] },
  });
  const lateDoc = lateNotice.w.document;
  lateDoc.querySelector('[data-sesion="s1"]').click();
  await sleep(150);
  assert.ok(lateDoc.body.textContent.includes("Revisé todo."));
  assert.ok(!lateDoc.body.textContent.includes("La tarea «Revisión» terminó: listo."));
  assert.equal(lateDoc.querySelector('button[aria-label="Abrir la tarea «Revisión»"]'), null);
  lateNotice.emit("chat", { kind: "notice", session: "s1", workspace: "w", text: "La tarea «Otra» terminó." });
  await sleep(100);
  assert.doesNotMatch(lateDoc.body.textContent, /Trabajando/);
  assert.deepEqual(lateNotice.fallos, []);

  let activeTurns = [];
  let finishPendingTurn;
  let registeredTurns = [];
  let hiddenTurnOutcome = null;
  const pendingTurnApp = await boot("listo", "reconcile-during-inflight-send", {
    ...CON_TAREA,
    list_live_sessions: () => [{ ...CON_TAREA.list_live_sessions[0], outcome: hiddenTurnOutcome }, { ...CON_TAREA.list_live_sessions[0], id: "s2", title: "Otra tarea" }],
    load_session: ({ id }) => ({ ...CON_TAREA.load_session, id }),
    list_active_turns: () => registeredTurns,
    send_message: () => new Promise(resolve => { finishPendingTurn = resolve; }),
  });
  const pendingDoc = pendingTurnApp.w.document;
  pendingDoc.querySelector('[data-sesion="s1"]').click();
  await sleep(80);
  const pendingInput = pendingDoc.querySelector("textarea");
  pendingInput.value = "Trabaja un rato";
  pendingInput.dispatchEvent(new pendingTurnApp.w.Event("input", { bubbles: true }));
  pendingInput.closest("form").dispatchEvent(new pendingTurnApp.w.Event("submit", { bubbles: true, cancelable: true }));
  await sleep(50);
  assert.equal(typeof finishPendingTurn, "function");
  pendingTurnApp.w.dispatchEvent(new pendingTurnApp.w.Event("focus"));
  await sleep(50);
  assert.ok(pendingDoc.querySelector('button[aria-label="Detener turno"]'), "preparation must not look finished before registration");
  registeredTurns = ["s1", "s2"];
  pendingTurnApp.w.dispatchEvent(new pendingTurnApp.w.Event("focus"));
  await sleep(50);
  pendingDoc.querySelector('[data-sesion="s2"]').click();
  await sleep(80);
  assert.ok(pendingDoc.querySelector('button[aria-label="Detener turno"]'), "recover another live task while send_message remains pending");
  registeredTurns = ["s1"];
  pendingTurnApp.w.dispatchEvent(new pendingTurnApp.w.Event("focus"));
  await sleep(80);
  assert.equal(pendingDoc.querySelector('button[aria-label="Detener turno"]'), null, "recover a missed finish while another send remains pending");
  finishPendingTurn("s1");
  await sleep(80);
  const hiddenRow = () => pendingDoc.querySelector('[data-sesion="s1"]');
  assert.ok(hiddenRow().querySelector('[aria-label$="Está trabajando"]'));
  pendingTurnApp.emit("chat", { kind: "delta", session: "s1", workspace: "w", text: "Respuesta parcial" });
  pendingTurnApp.w.dispatchEvent(new pendingTurnApp.w.Event("focus"));
  await sleep(80);
  assert.ok(hiddenRow().querySelector('[aria-label$="Está trabajando"]'), "streaming and reconciliation preserve activity in a hidden task");
  hiddenTurnOutcome = "delivered";
  registeredTurns = [];
  pendingTurnApp.w.dispatchEvent(new pendingTurnApp.w.Event("focus"));
  await sleep(80);
  // Entregada y vista, la tarea se queda donde estaba, entre las «Tareas».
  assert.equal(pendingDoc.querySelector('[data-sidebar-section="settled"]'), null, "no hay sección «Asentadas»");
  assert.equal(hiddenRow().querySelector('[aria-label$="Está trabajando"]'), null);
  // En la tarjeta del riel una entregada no lleva ícono: vista se apaga, sin ver lleva el punto verde.
  assert.ok(hiddenRow().dataset.apagada === "true" || hiddenRow().querySelector('[aria-label="Terminó y no la has abierto"]'), "recovering a missed done refreshes the hidden task result");
  assert.deepEqual(pendingTurnApp.fallos, []);
  pendingTurnApp.w.close();

  let finishTranscript;
  let finishActiveRead;
  const liveReplies = {
    ...CON_TAREA,
    list_active_turns: () => activeTurns,
    stop_turn: null,
  };
  const liveState = await boot("listo", "authoritative-turn-state", liveReplies);
  const liveDoc = liveState.w.document;
  liveDoc.querySelector('[data-sesion="s1"]').click();
  await sleep(80);
  activeTurns = ["s1"];
  liveState.emit("chat", { kind: "started", session: "s1", workspace: "w" });
  await sleep(30);
  assert.ok(liveDoc.querySelector('button[aria-label="Detener turno"]'));
  liveState.emit("chat", { kind: "tool", session: "s1", workspace: "w", id: "sin-cierre", text: "Bash", target: "pnpm verify" });
  liveState.emit("chat", { kind: "delta", session: "s1", workspace: "w", text: "Respuesta final" });
  await sleep(30);
  assert.match(liveDoc.body.textContent, /Ejecutando 1 comando/);
  liveReplies.load_session = () => new Promise(resolve => { finishTranscript = resolve; });
  activeTurns = [];
  liveState.emit("chat", { kind: "done", session: "s1", workspace: "w", ok: true });
  await sleep(30);
  assert.equal(liveDoc.querySelector('button[aria-label="Detener turno"]'), null, "done stops activity before transcript loads");
  assert.doesNotMatch(liveDoc.body.textContent, /Ejecutando 1 comando/, "a finished turn cannot keep a tool running while its transcript loads");
  assert.match(liveDoc.body.textContent, /Ejecutó 1 comando/);
  finishTranscript(CON_TAREA.load_session);
  await sleep(30);
  liveReplies.load_session = CON_TAREA.load_session;
  activeTurns = ["s1"];
  liveState.emit("chat", { kind: "started", session: "s1", workspace: "w" });
  await sleep(30);
  activeTurns = [];
  liveState.w.dispatchEvent(new liveState.w.Event("focus"));
  await sleep(50);
  assert.equal(liveDoc.querySelector('button[aria-label="Detener turno"]'), null, "authoritative registry recovers a lost done event");
  liveReplies.list_active_turns = () => new Promise(resolve => { finishActiveRead = resolve; });
  liveState.w.dispatchEvent(new liveState.w.Event("focus"));
  await sleep(20);
  activeTurns = ["s1"];
  liveState.emit("chat", { kind: "started", session: "s1", workspace: "w" });
  finishActiveRead([]);
  await sleep(30);
  assert.ok(liveDoc.querySelector('button[aria-label="Detener turno"]'), "an old snapshot cannot stop a newly started turn");
  liveReplies.list_active_turns = () => [];
  liveDoc.querySelector('button[aria-label="Detener turno"]').click();
  await sleep(60);
  assert.equal(liveDoc.querySelector('button[aria-label="Detener turno"]'), null);
  assert.ok(!liveDoc.body.textContent.includes("No se pudo detener"));
  assert.deepEqual(liveState.fallos, []);

  // El registro ve el cierre antes que el done: la cola retenida sin desenlace sale cuando el done llega.
  {
    let activos = [];
    const envios = [];
    const app = await boot("listo", "late-done-releases-queue", {
      ...CON_TAREA,
      list_active_turns: () => activos,
      save_queue: null,
      load_queue: [],
      queue_ready: false,
      send_message: (args) => { envios.push(args.prompt); return "s1"; },
    });
    const doc = app.w.document;
    doc.querySelector('[data-sesion="s1"]').click();
    await sleep(80);
    activos = ["s1"];
    app.emit("chat", { kind: "started", session: "s1", workspace: "w" });
    await sleep(30);
    const campo = doc.querySelector("textarea");
    campo.value = "Pendiente";
    campo.dispatchEvent(new app.w.Event("input", { bubbles: true }));
    campo.closest("form").dispatchEvent(new app.w.Event("submit", { bubbles: true, cancelable: true }));
    await sleep(50);
    activos = [];
    app.w.dispatchEvent(new app.w.Event("focus"));
    await sleep(80);
    assert.equal(envios.length, 0, "a turn closed without its outcome keeps the queue");
    app.emit("chat", { kind: "done", session: "s1", workspace: "w", ok: true });
    await sleep(200);
    assert.deepEqual(envios, ["Pendiente"], "the late done releases the queue");
    assert.deepEqual(app.fallos, []);
    app.w.close();
  }
  // Y si la sesión vuelve a verse viva, el done ok es de otro turno: la cola sigue retenida.
  {
    let activos = [];
    const envios = [];
    const app = await boot("listo", "later-turn-keeps-draft", {
      ...CON_TAREA,
      list_active_turns: () => activos,
      save_queue: null,
      load_queue: [],
      queue_ready: false,
      send_message: (args) => { envios.push(args.prompt); return "s1"; },
    });
    const doc = app.w.document;
    doc.querySelector('[data-sesion="s1"]').click();
    await sleep(80);
    activos = ["s1"];
    app.emit("chat", { kind: "started", session: "s1", workspace: "w" });
    await sleep(30);
    const campo = doc.querySelector("textarea");
    campo.value = "Pendiente";
    campo.dispatchEvent(new app.w.Event("input", { bubbles: true }));
    campo.closest("form").dispatchEvent(new app.w.Event("submit", { bubbles: true, cancelable: true }));
    await sleep(50);
    activos = [];
    app.w.dispatchEvent(new app.w.Event("focus"));
    await sleep(80);
    activos = ["s1"];
    app.w.dispatchEvent(new app.w.Event("focus"));
    await sleep(80);
    activos = [];
    app.emit("chat", { kind: "done", session: "s1", workspace: "w", ok: true });
    await sleep(200);
    assert.deepEqual(envios, [], "a later turn's done does not release the draft of one that closed without outcome");
    assert.deepEqual(app.fallos, []);
    app.w.close();
  }

  {
    for (const child of [false, true]) {
      const stops = [];
      const escapeApp = await boot("listo", `escape-${child}`, {
        ...CON_TAREA,
        load_session: { ...CON_TAREA.load_session, subagent: child ? "native-child" : null, parent: child ? "parent" : null },
        stop_turn: (args) => { stops.push(args); },
        list_active_turns: ["s1"],
      });
      const document = escapeApp.w.document;
      document.querySelector('[data-sesion="s1"]').click();
      await sleep(80);
      escapeApp.emit("chat", { kind: "started", session: "s1", workspace: "w" });
      await sleep(30);
      const input = document.querySelector("textarea");
      input.focus();
      input.dispatchEvent(new escapeApp.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await sleep(50);
      assert.deepEqual(stops, [{ project: "", session: "s1" }], "Escape reaches the viewed task");
      assert.deepEqual(escapeApp.fallos, []);
      escapeApp.w.close();
    }
  }

  for (const attachment of ["/tmp/Captura México.png", "/tmp/notes.pdf"]) {
    let accept;
    let reject;
    const calls = [];
    const queued = { id: "attached", text: "", provider: "codex", model: null, effort: null, attachments: [attachment] };
    const app = await boot("listo", `steer-attachment-${attachment}`, {
      ...CON_TAREA, load_queue: [queued], save_queue: null, queue_ready: false,
      list_active_turns: ["s1"],
      inject_message: (args) => { calls.push(args); return new Promise((resolve, fail) => { accept = resolve; reject = fail; }); },
    });
    const doc = app.w.document;
    doc.querySelector('[data-sesion="s1"]').click();
    await sleep(100);
    app.emit("chat", { kind: "started", session: "s1", workspace: "w" });
    app.emit("chat", { kind: "tool", session: "s1", workspace: "w", id: "build", text: "Bash", target: "build" });
    await sleep(50);
    const button = () => doc.querySelector('button[title="Mandar ahora"]');
    assert.ok(button(), "attachments can steer a running tool");
    button().click();
    await sleep(50);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].attachments, [attachment]);
    assert.equal(calls[0].prompt, "");
    assert.equal(button().disabled, true);
    reject("chat.steer.unconfirmed");
    await sleep(50);
    assert.ok(button(), "failed delivery keeps the attachment queued for retry");
    assert.equal(button().disabled, false);
    button().click();
    await sleep(50);
    accept(null);
    await sleep(80);
    assert.equal(button(), null, "confirmed delivery removes the attachment from the queue");
    assert.equal(calls.length, 2);
    assert.deepEqual(app.fallos, []);
    app.w.close();
  }

  let acknowledgeSteer;
  let injections = 0;
  const steerReplies = { ...CON_TAREA, load_queue: [], save_queue: null, queue_ready: true,
    list_live_sessions: [CON_TAREA.list_live_sessions[0], { ...CON_TAREA.list_live_sessions[0], id: "s2", title: "Segunda tarea" }],
    load_session: ({ id }) => ({ ...CON_TAREA.load_session, id }),
    list_active_turns: ["s1"],
    inject_message: () => { injections++; return new Promise(resolve => { acknowledgeSteer = resolve; }); },
  };
  const steerState = await boot("listo", "pending-steer", steerReplies);
  steerState.w.document.querySelector('[data-sesion="s1"]')?.click();
  await sleep(150);
  steerState.emit("chat", { kind: "started", session: "s1", workspace: "w" });
  steerState.emit("chat", { kind: "tool", session: "s1", workspace: "w", id: "steer-command", text: "Bash", target: "sleep 30" });
  await sleep(50);
  const steerStatus = steerState.w.document.querySelector('[role="status"][aria-label="El agente está trabajando"]');
  assert.match(steerStatus?.textContent ?? "", /Ejecutando/);
  assert.doesNotMatch(steerStatus?.textContent ?? "", /sleep 30/);
  const steerInput = steerState.w.document.querySelector("textarea");
  steerInput.value = "Corrige durante el turno";
  steerInput.dispatchEvent(new steerState.w.Event("input", { bubbles: true }));
  steerInput.closest("form").dispatchEvent(new steerState.w.Event("submit", { bubbles: true, cancelable: true }));
  await sleep(100);
  const sendNow = steerState.w.document.querySelector('button[title="Mandar ahora"]');
  assert.ok(sendNow);
  assert.equal(steerInput.disabled, false, "tool execution keeps the composer editable");
  assert.equal(sendNow.disabled, false, "tool execution allows native steering before the command finishes");
  sendNow.click();
  sendNow.click();
  await sleep(50);
  assert.equal(injections, 1, "double click must not inject the queued message twice");
  assert.equal(sendNow.disabled, true);
  const pendingRow = sendNow.closest("li");
  assert.ok([...pendingRow.querySelectorAll("button")].every(button => button.disabled));
  steerState.w.document.querySelector('[data-sesion="s2"]').click();
  await sleep(100);
  steerReplies.list_active_turns = [];
  steerState.emit("chat", { kind: "done", session: "s1", workspace: "w", ok: true });
  await sleep(150);
  assert.equal(steerState.comandos.filter(command => command === "send_message").length, 0, "done before steering ACK must not dispatch the same message");
  acknowledgeSteer(null);
  await sleep(100);
  steerState.w.document.querySelector('[data-sesion="s1"]').click();
  await sleep(150);
  assert.equal(steerState.w.document.querySelector('button[title="Mandar ahora"]'), null);
  assert.equal(steerState.comandos.filter(command => command === "send_message").length, 0);
  assert.deepEqual(steerState.fallos, []);

  // El menú del proyecto no ofrece un historial de tareas, y nadie pide las
  // archivadas por proyecto.
  const historia = await bootPorCarpeta("listo", 6, {
    ...CON_TAREA,
    list_projects: [{ id: "p1", name: "Laboratorio", node: null, sources: [], working_directory: "/lab", created_at: 1, updated_at: 1, sessions: 1, kind: "folder" }],
  });
  historia.w.document.querySelector('button[aria-label="Acciones del proyecto «Laboratorio»"]')?.click();
  await sleep(50);
  const acciones = [...historia.w.document.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent?.trim());
  assert.ok(acciones.length > 0, "el menú del proyecto se abre");
  assert.equal(acciones.includes("Historial de tareas"), false, "el menú del proyecto ya no ofrece el historial");
  await sleep(150);
  assert.equal(historia.comandos.includes("list_archived"), false, "la ventana no pide las archivadas por proyecto");
  assert.equal(historia.comandos.includes("list_sessions"), false, "la ventana no pide la lista completa");
  assert.deepEqual(historia.fallos, []);
  const pestanaDe = (app, titulo) => [...app.w.document.querySelectorAll(':is([role="tab"], [data-preview-header] [role="button"])')].find((tab) => tab.textContent?.includes(titulo));

  let archivadaEnDisco = false;
  const viva = { ...CON_TAREA.list_live_sessions[0], archived: false };
  const archivar = await boot("listo", "archivar-cierra", {
    ...CON_TAREA,
    list_live_sessions: ({ open }) => [
      ...(!archivadaEnDisco ? [viva] : open?.includes("s1") ? [{ ...viva, archived: true }] : []),
      { ...viva, id: "s2", title: "Segunda tarea" },
    ],
  });
  archivar.w.document.querySelector('[data-sesion="s1"]').click();
  await sleep(150);
  keepActiveView(archivar);
  archivar.w.document.querySelector('[data-sesion="s2"]').click();
  await sleep(150);
  assert.ok(pestanaDe(archivar, "Una tarea"));
  archivadaEnDisco = true;
  archivar.emit("session", { project: "", session: "s1", workspace: "w" });
  await sleep(500);
  assert.equal(pestanaDe(archivar, "Una tarea"), undefined, "archivar una tarea viva cierra su pestaña");
  assert.ok(pestanaDe(archivar, "Segunda tarea"), "la otra pestaña sigue");
  assert.equal(archivar.comandos.includes("list_sessions"), false);
  assert.deepEqual(archivar.fallos, []);
  const removedFromMenu = new Set();
  const menuActions = [];
  const fromAnotherTask = await boot("listo", "actions-from-another-task", {
    ...CON_TAREA,
    list_live_sessions: () => ["s1", "s2", "s3"]
      .filter(id => !removedFromMenu.has(id))
      .map(id => ({ ...viva, id, title: `Tarea ${id}` })),
    task_blockers: () => ({ unsaved: [], not_finished: false }),
    set_task_archived: args => { menuActions.push(["archive", args]); removedFromMenu.add(args.id); },
    machine_list: [{ id: "local", local: true, active: true, on: true, hosts: true, features: ["task_lifecycle_v1"] }],
    task_lifecycle_preview: args => ({ members: [{ project: args.project, id: args.id, title: `Tarea ${args.id}`, working: false, files: [], inspection: { status: "complete" } }], consent: "reviewed-menu-family" }),
    task_lifecycle_apply: args => {
      menuActions.push(["delete", args]);
      removedFromMenu.add(args.id);
      return { status: "complete", applied: [{ project: args.project, id: args.id }], failures: [] };
    },
  });
  const menuDoc = fromAnotherTask.w.document;
  const selectedTask = () => menuDoc.querySelector('[data-sesion][aria-current="true"]')?.getAttribute("data-sesion");
  const menuItem = label => [...menuDoc.querySelectorAll('[role="menuitem"]')].find(el => el.textContent.trim() === label);
  const openTaskMenu = id => menuDoc.querySelector(`[data-sesion="${id}"] [aria-haspopup="menu"]`).click();
  menuDoc.querySelector('[data-sesion="s1"]').click();
  await sleep(100);
  openTaskMenu("s2");
  await sleep(30);
  menuItem("Archivar tarea").click();
  await sleep(100);
  assert.equal(selectedTask(), "s1", "archivar desde el menú no abre la tarea archivada");
  assert.deepEqual(menuActions[0], ["archive", { project: "", id: "s2", archived: true }]);
  openTaskMenu("s3");
  await sleep(30);
  menuItem("Borrar la tarea").click();
  await sleep(30);
  assert.equal(selectedTask(), "s1", "pedir el borrado no abre la tarea elegida");
  menuDoc.querySelector('[role="alertdialog"] button').click();
  await sleep(100);
  assert.equal(selectedTask(), "s1", "confirmar el borrado conserva la tarea abierta");
  assert.equal(menuActions.length, 1, "the first confirmation only opens the family review");
  const deletionReview = menuDoc.querySelector('[role="dialog"]');
  assert.ok(deletionReview);
  deletionReview.querySelector('input[type="checkbox"]').click();
  [...deletionReview.querySelectorAll('button')].find(button => button.textContent.trim() === "Borrar la tarea").click();
  await sleep(100);
  assert.equal(selectedTask(), "s1", "applying the reviewed deletion preserves the open task");
  assert.deepEqual(menuActions[1], ["delete", { project: "", id: "s3", action: "delete", consent: "reviewed-menu-family", discard: true }]);
  assert.deepEqual(fromAnotherTask.fallos, []);
  let recreated = false;
  let rejectRecreation = true;
  const resumeCalls = [];
  const retired = await boot("listo", "retired-worktree", {
    ...CON_TAREA,
    task_history: () => ({ ...CON_TAREA.task_history, available: recreated, recreatable: !recreated }),
    recreate_task_work: (args) => {
      resumeCalls.push(args);
      if (rejectRecreation) return Promise.reject(new Error("repository unavailable"));
      recreated = true;
    },
  });
  retired.w.document.querySelector('[data-sesion="s1"]').click();
  await sleep(100);
  assert.equal(retired.w.document.querySelector("textarea"), null);
  const resumeButton = () => [...retired.w.document.querySelectorAll("button")].find(b => b.textContent === "Volver a escribir");
  assert.ok(resumeButton());
  assert.equal(resumeCalls.length, 0);
  resumeButton().click();
  await sleep(100);
  assert.equal(retired.w.document.querySelector("textarea"), null);
  assert.ok(resumeButton());
  rejectRecreation = false;
  resumeButton().click();
  await sleep(150);
  assert.deepEqual(resumeCalls, [{ project: "", id: "s1" }, { project: "", id: "s1" }]);
  assert.ok(retired.w.document.querySelector("textarea"));
  assert.equal(retired.comandos.includes("send_message"), false);
  assert.deepEqual(retired.fallos, []);
  let providerWorkspace = "ws-a";
  let available = [{ key: "acme", name: "acme" }];
  const selections = new Map([["ws-a", [{ key: "acme", installation_id: 42 }]]]);
  let pendingAreas = null;
  const providerCalls = [];
  let authentications = 0;
  const providerInfo = (scope) => ({
    id: "github", name: "GitHub", fields: [], browser_login: true,
    select_area: true, setup_url: "https://github.com/apps/terminus-app/installations/new",
    token_label: "Token", token_help: "", token_url: "", login_help: "",
    area_label: "organización", areas_label: "organizaciones", area_help: "",
    connected: { data: {}, workspace: "person", identity: { user: "person", name: "Person" },
      selected_area: null, selected_areas: selections.get(scope) ?? [], connected_at: 1 }, unverified: null,
  });
  const providers = await boot("listo", "provider-workspaces", {
    ...RESPUESTAS,
    list_workspaces: () => ({ ...RESPUESTAS.list_workspaces, active: providerWorkspace }),
    list_git_hosts: ({ scope }) => [providerInfo(scope)],
    check_git_host: ({ scope }) => providerInfo(scope),
    git_host_areas: ({ scope }) => (selections.get(scope) ?? []).map(({ key }) => ({ key, name: key })),
    git_host_available_areas: ({ scope }) => { providerCalls.push(scope); return scope === "ws-a" && pendingAreas ? pendingAreas : available; },
    select_git_host_area: ({ scope, area, enabled }) => {
      const next = (selections.get(scope) ?? []).filter(({ key }) => key !== area);
      if (enabled) next.push({ key: area, installation_id: area === "acme" ? 42 : 43 });
      selections.set(scope, next);
      return providerInfo(scope);
    },
    git_host_projects: ({ scope, area }) => {
      assert.ok(selections.get(scope)?.some(({ key }) => key === area));
      return [];
    },
    start_browser_login: () => {
      authentications += 1;
      return { code: "ABCD", url: "https://github.com/login/device", expires_at: 9999999999999 };
    },
    finish_browser_login: ({ scope }) => providerInfo(scope),
    git_host_pending_setup: null,
    open_external: ({ target }) => {
      assert.ok(["https://github.com/login/device", "https://github.com/apps/terminus-app/installations/new"].includes(target));
      if (target.endsWith("/installations/new")) available = [{ key: "acme", name: "acme" }, { key: "other", name: "other" }];
    },
  });
  const providerButton = (text) => [...providers.w.document.querySelectorAll("button")]
    .find((button) => button.textContent?.trim() === text || button.getAttribute("aria-label") === text);
  const providerAction = async (text) => {
    providerButton("Más acciones de GitHub").dispatchEvent(new providers.w.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    await sleep(50);
    const item = [...providers.w.document.querySelectorAll('[role="menuitem"]')].find(el => el.textContent?.trim() === text);
    assert.ok(item, text);
    item.dispatchEvent(new providers.w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  };
  const areaButton = (key) => [...providers.w.document.querySelectorAll("li")]
    .find((li) => li.textContent?.startsWith(key))
    ?.querySelectorAll("button");
  const clickArea = (key, text) => [...(areaButton(key) ?? [])]
    .find((button) => button.textContent?.trim() === text)?.click();
  const selectedKeys = (scope) => (selections.get(scope) ?? []).map(({ key }) => key);
  providers.w.document.querySelector('button[aria-label="Configuración"]')?.click();
  await sleep(100);
  providers.w.document.querySelector("#cfg-tab-projects")?.click();
  await sleep(50);
  providers.w.document.querySelector("#cfg-sub-fuentes")?.click();
  await sleep(100);
  assert.equal(providerButton("Quitar del workspace"), undefined, "la conexión previa muestra solo el resumen");
  assert.ok(providers.w.document.body.textContent.includes("acme"));
  assert.equal(providerButton("Usar en este workspace"), undefined, "agregar requiere abrir el selector");
  await providerAction("Administrar permisos en GitHub");
  await sleep(30);
  providerButton("Actualizar acceso")?.click();
  await sleep(100);
  assert.equal(authentications, 0);
  assert.ok(providerButton("Usar en este workspace"), "GitHub permite elegir las instalaciones disponibles");
  assert.deepEqual(selectedKeys("ws-a"), ["acme"], "ampliar GitHub no cambia la selección");
  clickArea("other", "Usar en este workspace");
  await sleep(100);
  assert.deepEqual(selectedKeys("ws-a"), ["acme", "other"]);
  providerButton("Listo")?.click();
  await sleep(50);
  assert.equal(providerButton("Quitar del workspace"), undefined, "Listo oculta las acciones de selección");
  providerButton("Cambiar acceso")?.click();
  await sleep(50);
  clickArea("acme", "Quitar del workspace");
  await sleep(100);
  assert.deepEqual(selectedKeys("ws-a"), ["other"]);
  providerButton("Listo")?.click();
  await sleep(50);
  assert.equal(providerButton("Usar en este workspace"), undefined, "Listo conserva la selección y oculta las opciones");
  await providerAction("Administrar permisos en GitHub");
  await sleep(30);
  providerButton("Actualizar acceso")?.click();
  await sleep(100);
  let finishOldAreas;
  pendingAreas = new Promise((resolve) => { finishOldAreas = resolve; });
  providerButton("Cambiar acceso")?.click();
  await sleep(50);
  providerWorkspace = "ws-b";
  providers.w.dispatchEvent(new providers.w.CustomEvent("harness:workspace"));
  await sleep(100);
  assert.ok(providers.w.document.body.textContent.includes("Sin acceso seleccionado"));
  await providerAction("Administrar permisos en GitHub");
  await sleep(30);
  providerButton("Actualizar acceso")?.click();
  await sleep(100);
  clickArea("acme", "Usar en este workspace");
  await sleep(100);
  finishOldAreas([{ key: "stale", name: "stale" }]);
  await sleep(50);
  assert.ok(!providers.w.document.body.textContent.includes("stale"), "una respuesta vieja no cruza de workspace");
  assert.deepEqual(selectedKeys("ws-b"), ["acme"]);
  assert.deepEqual(selectedKeys("ws-a"), ["other"]);
  assert.equal(authentications, 0);
  assert.ok(providerCalls.includes("ws-a") && providerCalls.includes("ws-b"));
  assert.deepEqual(providers.fallos, []);
  let integrationStatus = { installed: true, enabled: false };
  let pendingIntegration = null;
  const integration = await boot("listo", 9, {
    ...RESPUESTAS,
    agentsview_status: () => pendingIntegration ?? integrationStatus,
  });
  const integrationButton = () => integration.w.document.querySelector('button[aria-label="Analytics"]');
  const workspaceChanged = () => integration.w.dispatchEvent(new integration.w.CustomEvent("harness:workspace"));
  assert.equal(integrationButton(), null);
  integrationStatus = { installed: true, enabled: true };
  workspaceChanged();
  await sleep(30);
  assert.ok(integrationButton(), "switching to an enabled workspace reveals AgentsView");
  let finishIntegration;
  pendingIntegration = new Promise(resolve => { finishIntegration = resolve; });
  workspaceChanged();
  assert.equal(integrationButton(), null);
  pendingIntegration = null;
  integrationStatus = { installed: true, enabled: false };
  workspaceChanged();
  await sleep(30);
  finishIntegration({ installed: true, enabled: true });
  await sleep(30);
  assert.equal(integrationButton(), null, "a late response cannot enable AgentsView in another workspace");
  integration.emit("agentsview-changed", true);
  await sleep(30);
  assert.equal(integrationButton(), null, "integration events must read the active workspace");
  integrationStatus = { installed: true, enabled: true };
  integration.emit("agentsview-changed", true);
  await sleep(30);
  assert.ok(integrationButton());
  assert.deepEqual(integration.fallos, []);
  let pluginWorkspace = "w";
  let officeInstalled = false;
  let officeEnabled = false;
  let pendingCatalog = null;
  const pluginCalls = [];
  const catalog = () => ({ workspace: pluginWorkspace, plugins: [
    { id: "agentsview", installed: true, enabled: true, version: "0.39.0", bytes: 1000, supported: true },
    { id: "libreoffice", installed: officeInstalled, enabled: officeEnabled, version: officeInstalled ? "26.2.6" : null, bytes: officeInstalled ? 800000000 : null, supported: true },
  ] });
  const plugins = await boot("listo", "plugins", {
    ...RESPUESTAS,
    list_integrations: () => pendingCatalog ?? catalog(),
    install_integration: ({ id }) => { pluginCalls.push(["install", id]); officeInstalled = true; },
    set_integration_enabled: ({ id, workspace, enabled }) => {
      pluginCalls.push(["enable", id, workspace, enabled]); officeEnabled = enabled;
    },
    uninstall_integration: ({ id }) => { pluginCalls.push(["uninstall", id]); officeInstalled = false; officeEnabled = false; },
    list_language_packs: [], list_bundled_language_packs: [],
  });
  plugins.w.document.querySelector('button[aria-label="Configuración"]')?.click();
  await sleep(100);
  plugins.w.document.querySelector('#cfg-tab-connections')?.click();
  await sleep(50);
  plugins.w.document.querySelector('#cfg-sub-operation')?.click();
  await sleep(100);
  const officeCard = () => [...plugins.w.document.querySelectorAll("div")].find(d => d.textContent === "LibreOffice")?.parentElement?.parentElement?.parentElement;
  const officeButton = (text) => [...officeCard().querySelectorAll("button")].find(b => b.textContent?.trim() === text);
  const officeSwitch = () => officeCard().querySelector('button[role="switch"][aria-label="Activar en este espacio"]');
  assert.ok(officeCard(), "Connections offers LibreOffice alongside AgentsView");
  officeButton("Instalar").click();
  await sleep(50);
  assert.deepEqual(pluginCalls, [["install", "libreoffice"]]);
  assert.equal(officeSwitch()?.getAttribute("aria-checked"), "false");
  officeSwitch().click();
  await sleep(50);
  assert.equal(officeSwitch()?.getAttribute("aria-checked"), "true");
  assert.deepEqual(pluginCalls.at(-1), ["enable", "libreoffice", "w", true]);
  officeButton("Desinstalar").click();
  await sleep(30);
  const removalDialog = () => [...plugins.w.document.querySelectorAll('[role="dialog"]')].find(d => d.textContent.includes("Desinstalar") && d.textContent.includes("Cancelar"));
  assert.ok(removalDialog(), "uninstall requires a visible confirmation");
  [...removalDialog().querySelectorAll("button")].find(b => b.textContent?.trim() === "Cancelar").click();
  await sleep(30);
  assert.equal(pluginCalls.length, 2, "cancelling uninstall changes nothing");
  officeButton("Desinstalar").click();
  await sleep(50);
  [...removalDialog().querySelectorAll("button")].find(b => b.textContent?.trim() === "Desinstalar").click();
  await sleep(50);
  assert.deepEqual(pluginCalls.at(-1), ["uninstall", "libreoffice"]);
  assert.ok(officeButton("Instalar"));
  let finishCatalog;
  pendingCatalog = new Promise(resolve => { finishCatalog = resolve; });
  plugins.w.dispatchEvent(new plugins.w.CustomEvent("harness:workspace"));
  assert.equal(officeCard(), undefined);
  pendingCatalog = null;
  pluginWorkspace = "other";
  plugins.w.dispatchEvent(new plugins.w.CustomEvent("harness:workspace"));
  await sleep(30);
  finishCatalog({ workspace: "w", plugins: [{ id: "libreoffice", installed: true, enabled: true, supported: true, version: "stale", bytes: 10 }] });
  await sleep(30);
  assert.ok(officeButton("Instalar"), "an old catalog cannot replace the new workspace");
  assert.deepEqual(plugins.fallos, []);
  /**
   * Configuración › Radiant: Cloud se confirma con un botón, el código del login se
   * ve mientras se espera al navegador, la cuenta sale de `/v1/me`, una URL HTTP no
   * entra y cambiar de workspace de Terminus no deja nada del anterior.
   */
  const CLOUD = "https://radiant.danil.ai";
  const radiantCalls = [];
  const radiant = { server: null, signed_in: false, workspace: null, login: null };
  const radiantCuenta = {
    status: "ok", email: "ana@example.test", organization: "Danil", organizations: [], note: null,
    workspaces: [{ id: "eng", name: "Ingeniería" }, { id: "ops", name: "Operación" }], revocada: false,
  };
  let radiantIdentityPending = null;
  let radiantWorkspacesPending = null;
  const radiantStatus = () => ({ cloud_server: CLOUD, ...radiant });
  const radiantIdentity = () => ({
    status: radiantCuenta.status, email: radiantCuenta.email, name: null,
    organization: radiantCuenta.organization, organizations: radiantCuenta.organizations, note: radiantCuenta.note,
  });
  const SIN_GOBIERNO = { governed: null, stale: false, notice: null, summary: null };
  const GOBERNADO = () => ({
    governed: {
      workspace_id: "eng", workspace_name: "Ingeniería", server: CLOUD, mode: "managed",
      locked: ["context_sources", "mcp_servers", "skills", "agents", "models"],
      policy_revision: "b".repeat(64), expires_at: 1_900_000_300, last_ok: 1_900_000_000,
    },
    stale: false,
    notice: null,
    summary: {
      sources: [{ id: "gov", name: "gobierno", role: "governance_root", files: 1 }],
      skills: ["revisar"],
      agents: ["revisor"],
      mcp: [
        { id: "radiant", name: "Radiant", url: "https://radiant.example.test/mcp", auth: "radiant", tailnet: false, active: true },
        { id: "interno", name: "Interno", url: "https://interno.example.ts.net/mcp", auth: "none", tailnet: true,
          active: false, reason: "radiant.governance.tailscale.missing" },
      ],
      models: { providers: ["Claude"], allowed: [], default: "sonnet" },
      connections: [{ id: "jira", provider: "jira", name: "Jira", owner: "user", purpose: "work_tracking", status: "not_connected" }],
      tailnet: { tailnet: "example.ts.net", required: true, state: { kind: "missing" } },
      issued_at: 1_900_000_000,
    },
  });
  let gobierno = SIN_GOBIERNO;
  const radiantSesiones = [];
  const radiantApp = await boot("listo", "settings-radiant", {
    radiant_governance_status: () => structuredClone(gobierno),
    radiant_govern_enable: () => {
      radiantCalls.push(["govern"]);
      gobierno = GOBERNADO();
      return structuredClone(gobierno);
    },
    radiant_govern_disable: () => {
      radiantCalls.push(["ungovern"]);
      gobierno = SIN_GOBIERNO;
      return structuredClone(gobierno);
    },
    radiant_govern_refresh: () => {
      throw { what: { clave: "radiant.error.unreachable" }, detail: "connection_failed" };
    },
    list_radiant_connections: () => structuredClone(GOBERNADO().summary.connections),
    list_governed_mcp_logins: () =>
      gobierno.governed ? [{ id: "atlassian", name: "Atlassian", sesiones: radiantSesiones.slice() }] : [],
    list_mcp_providers: () => [
      { id: "claude", label: "Claude Code", recibe: true, instalado: true, login: true },
      { id: "grok", label: "Grok", recibe: true, instalado: true, login: false,
        sin_login: { clave: "mcp.session.cli_has_none" } },
      { id: "codex", label: "Codex", recibe: false, instalado: false, login: true },
    ],
    mcp_login: ({ provider: agent, id }) => {
      radiantCalls.push(["mcp_login", agent, id]);
      return { clave: "mcp.login.opened_browser", datos: { service: "Atlassian" } };
    },
    radiant_connect_account: ({ id }) => {
      radiantCalls.push(["connect", id]);
      return null;
    },
    ...RESPUESTAS,
    list_language_packs: [], list_bundled_language_packs: [],
    radiant_status: () => radiantStatus(),
    radiant_set_server: ({ server }) => {
      radiantCalls.push(["server", server]);
      if (server.startsWith("http://")) {
        throw { what: { clave: "radiant.error.http_not_allowed" }, detail: server };
      }
      radiant.server = server;
      return radiantStatus();
    },
    radiant_login: () => {
      radiantCalls.push(["login"]);
      radiant.login = { server: radiant.server, running: true, failure: null,
        prompt: { uri: "https://auth.example.test/activate", code: "WDJB-MJHT" } };
      return radiantStatus();
    },
    get_radiant_identity: () => radiantIdentityPending ?? radiantIdentity(),
    // Objetos nuevos en cada llamada, como por IPC: el `For` del selector recrea sus opciones.
    list_radiant_workspaces: () => radiantWorkspacesPending ?? structuredClone(radiantCuenta.workspaces),
    radiant_select_workspace: ({ id }) => {
      radiantCalls.push(["workspace", id]);
      if (radiantCuenta.revocada) {
        Object.assign(radiant, { signed_in: false, workspace: null });
        throw { what: { clave: "radiant.error.no_session" }, detail: "HTTP 401 session_revoked" };
      }
      radiant.workspace = { id, name: id === "eng" ? "Ingeniería" : "Operación" };
      if (id === "ops") radiantCuenta.organization = "Danil Operación";
      return radiantStatus();
    },
    radiant_select_organization: ({ id }) => {
      radiantCalls.push(["organization", id]);
      Object.assign(radiantCuenta, { status: "ok", organization: id === "org_otra" ? "Otra" : "Danil", note: null });
      return radiantStatus();
    },
    radiant_logout: () => {
      radiantCalls.push(["logout"]);
      Object.assign(radiant, { signed_in: false, workspace: null });
      return radiantStatus();
    },
  });
  const rDoc = radiantApp.w.document;
  const rPanel = () => rDoc.querySelector("#cfg-panel");
  const rBoton = (texto) => [...rPanel().querySelectorAll("button")].find((b) => b.textContent?.trim() === texto);
  const rElegir = async (select, valor) => {
    select.value = valor;
    select.dispatchEvent(new radiantApp.w.Event("change", { bubbles: true }));
    await sleep(120);
  };
  const completarLogin = async () => {
    Object.assign(radiant, { signed_in: true, login: null });
    radiantApp.emit("radiant", null);
    await sleep(120);
  };
  rDoc.querySelector('button[aria-label="Configuración"]')?.click();
  await sleep(100);
  rDoc.querySelector("#cfg-tab-connections")?.click();
  await sleep(50);
  rDoc.querySelector("#cfg-sub-operation")?.click();
  await sleep(100);
  assert.ok(rPanel().textContent.includes(CLOUD), "Radiant Cloud enseña su origen");
  assert.equal(rBoton("Iniciar sesión"), undefined, "sin servidor elegido no hay sesión que iniciar");
  rBoton("Usar este servidor").click();
  await sleep(80);
  assert.deepEqual(radiantCalls.at(-1), ["server", CLOUD]);
  assert.ok(rPanel().textContent.includes(`Sin sesión en ${CLOUD}.`));
  assert.ok(rBoton("Iniciar sesión"), "una instalación sin la CLI de Radiant ofrece iniciar sesión");
  rBoton("Iniciar sesión").click();
  await sleep(80);
  assert.ok(rPanel().textContent.includes("WDJB-MJHT"), "el código se ve mientras se espera al navegador");
  assert.ok(rBoton("Cancelar"));
  assert.ok(rBoton("Servidor propio").disabled, "no se cambia de servidor con un login en vuelo");
  await completarLogin();
  assert.ok(
    rPanel().textContent.includes(`Sesión iniciada como ana@example.test · Danil en ${CLOUD}.`),
    "la cuenta y la organización salen del servidor",
  );
  const rSelect = rPanel().querySelector('select[aria-label="Workspace de Danil Teams"]');
  assert.ok(rSelect, "con sesión se elige workspace remoto");
  await rElegir(rSelect, "ops");
  assert.deepEqual(radiantCalls.at(-1), ["workspace", "ops"]);
  assert.ok(
    rPanel().textContent.includes("ana@example.test · Danil Operación"),
    "elegir workspace cambia de organización y la cuenta se relee",
  );
  const rMostrado = () => {
    const select = rPanel().querySelector('select[aria-label="Workspace de Danil Teams"]');
    return [select.value, select.selectedOptions[0]?.textContent];
  };
  assert.deepEqual(rMostrado(), ["ops", "Operación"], "tras elegir, el selector enseña el workspace elegido");
  rBoton("Actualizar").click();
  await sleep(80);
  assert.deepEqual(rMostrado(), ["ops", "Operación"], "y lo sigue enseñando al actualizar la lista");
  radiantCuenta.organization = "Danil";
  rBoton("Servidor propio").click();
  await sleep(50);
  const rUrl = rPanel().querySelector('input[aria-label="Dirección del servidor"]');
  rUrl.value = "http://radiant.example.com";
  rUrl.dispatchEvent(new radiantApp.w.Event("input", { bubbles: true }));
  rBoton("Usar este servidor").click();
  await sleep(80);
  assert.ok(rPanel().textContent.includes("El servidor necesita HTTPS."), "una URL HTTP se rechaza con su motivo");
  assert.equal(radiant.server, CLOUD, "y el servidor elegido no cambia");
  rBoton("Cerrar sesión").click();
  await sleep(80);
  assert.deepEqual(radiantCalls.at(-1), ["logout"]);
  assert.ok(!rPanel().textContent.includes("ana@example.test"), "cerrar sesión borra la cuenta de la pantalla");
  // Cuenta A, la sesión se revoca en el servidor y entra la cuenta B: nada de A se queda.
  rBoton("Iniciar sesión").click();
  await sleep(80);
  await completarLogin();
  assert.ok(rPanel().textContent.includes("ana@example.test · Danil"));
  radiantCuenta.revocada = true;
  await rElegir(rPanel().querySelector('select[aria-label="Workspace de Danil Teams"]'), "eng");
  assert.ok(rPanel().textContent.includes(`Sin sesión en ${CLOUD}.`), "la revocación se ve como sesión cerrada");
  assert.ok(!rPanel().textContent.includes("ana@example.test"), "sin sesión no se enseña la cuenta anterior");
  Object.assign(radiantCuenta, { email: "bea@example.test", organization: "Otra", workspaces: [{ id: "legal", name: "Legal" }], revocada: false });
  rBoton("Iniciar sesión").click();
  await sleep(80);
  await completarLogin();
  assert.ok(rPanel().textContent.includes("bea@example.test · Otra"), "el login nuevo enseña su propia cuenta");
  assert.ok(!rPanel().textContent.includes("ana@example.test"));
  const opciones = [...rPanel().querySelectorAll('select[aria-label="Workspace de Danil Teams"] option')].map((o) => o.value).filter(Boolean);
  assert.deepEqual(opciones, ["legal"], "y los workspaces de su cuenta, no los de la anterior");
  // Cloud con la cuenta y la lista en camino, y se pasa a un servidor propio que ya tiene sesión de otra cuenta.
  const PROPIO = "https://radiant.example.com";
  const rWorkspaces = () => rPanel().querySelector('select[aria-label="Workspace de Danil Teams"]');
  const rOpciones = () => [...rWorkspaces().querySelectorAll("option")].map((o) => o.value).filter(Boolean);
  const rPedirCuentaYLista = async (id) => {
    const pedidas = {};
    radiantIdentityPending = new Promise((entregar, fallar) => Object.assign(pedidas, { cuenta: { entregar, fallar } }));
    radiantWorkspacesPending = new Promise((entregar, fallar) => Object.assign(pedidas, { lista: { entregar, fallar } }));
    await rElegir(rWorkspaces(), id);
    rBoton("Actualizar").click();
    await sleep(50);
    radiantIdentityPending = null;
    radiantWorkspacesPending = null;
    return pedidas;
  };
  const deCloud = { cuenta: radiantIdentity(), lista: radiantCuenta.workspaces };
  const tardias = await rPedirCuentaYLista("legal");
  radiant.workspace = null;
  Object.assign(radiantCuenta, { email: "dora@example.test", organization: "Propia", workspaces: [{ id: "casa", name: "Casa" }] });
  rBoton("Servidor propio").click();
  await sleep(50);
  const rPropio = rPanel().querySelector('input[aria-label="Dirección del servidor"]');
  rPropio.value = PROPIO;
  rPropio.dispatchEvent(new radiantApp.w.Event("input", { bubbles: true }));
  rBoton("Usar este servidor").click();
  await sleep(120);
  assert.deepEqual(radiantCalls.at(-1), ["server", PROPIO]);
  assert.ok(rPanel().textContent.includes(`Sesión iniciada como dora@example.test · Propia en ${PROPIO}.`));
  tardias.cuenta.entregar(deCloud.cuenta);
  tardias.lista.entregar(deCloud.lista);
  await sleep(80);
  assert.ok(!rPanel().textContent.includes("bea@example.test"), "la cuenta de Cloud que llega tarde no entra en el servidor propio");
  assert.ok(rPanel().textContent.includes("dora@example.test · Propia"));
  assert.deepEqual(rOpciones(), ["casa"], "ni sus workspaces");
  // Cuenta A con sus peticiones en camino, cierra sesión y entra la cuenta B: el fallo tardío de A no borra a B.
  const fallidas = await rPedirCuentaYLista("casa");
  rBoton("Cerrar sesión").click();
  await sleep(80);
  Object.assign(radiantCuenta, { email: "eva@example.test", workspaces: [{ id: "taller", name: "Taller" }] });
  rBoton("Iniciar sesión").click();
  await sleep(80);
  await completarLogin();
  assert.ok(rPanel().textContent.includes("eva@example.test · Propia"));
  const caducada = { what: { clave: "radiant.error.no_session" }, detail: "HTTP 401 session_revoked" };
  fallidas.cuenta.fallar(caducada);
  fallidas.lista.fallar(caducada);
  await sleep(80);
  assert.ok(rPanel().textContent.includes("eva@example.test · Propia"), "el fallo tardío de la cuenta anterior no borra la nueva");
  assert.deepEqual(rOpciones(), ["taller"]);
  assert.ok(!rPanel().textContent.includes("No hay sesión en este servidor"), "ni enseña su error");
  rBoton("Danil Cloud").click();
  await sleep(120);
  assert.deepEqual(radiantCalls.at(-1), ["server", CLOUD]);
  // Una cuenta en varias organizaciones elige una antes de ver workspaces.
  rBoton("Cerrar sesión").click();
  await sleep(80);
  Object.assign(radiantCuenta, {
    status: "organization_selection_required", email: "carla@example.test", organization: null,
    organizations: [{ id: "org_danil", name: "Danil" }, { id: "org_otra", name: "Otra" }],
    note: { clave: "radiant.identity.organization_selection_required" },
  });
  rBoton("Iniciar sesión").click();
  await sleep(80);
  await completarLogin();
  assert.ok(rPanel().textContent.includes("Tu cuenta pertenece a varias organizaciones."), "lo que falta sale del catálogo");
  assert.equal(rPanel().querySelector('select[aria-label="Workspace de Danil Teams"]'), null, "sin organización no se ofrecen workspaces");
  const rOrganizacion = rPanel().querySelector('select[aria-label="Organización"]');
  assert.deepEqual([...rOrganizacion.querySelectorAll("option")].map((o) => o.value).filter(Boolean), ["org_danil", "org_otra"]);
  await rElegir(rOrganizacion, "org_otra");
  assert.deepEqual(radiantCalls.at(-1), ["organization", "org_otra"]);
  assert.ok(rPanel().textContent.includes("carla@example.test · Otra"), "la organización elegida queda en la cuenta");
  assert.equal(rPanel().querySelector('select[aria-label="Organización"]'), null);
  assert.ok(rPanel().querySelector('select[aria-label="Workspace de Danil Teams"]'));
  // Gobernar el workspace con el remoto elegido: lo instalado se resume y lo que falta se dice.
  const rGobierno = () => rPanel().querySelector('button[aria-label="Administrar este workspace con Danil Teams"]');
  assert.ok(rGobierno()?.disabled, "sin workspace remoto elegido no se gobierna");
  radiant.workspace = { id: "eng", name: "Ingeniería" };
  radiantApp.emit("radiant", null);
  await sleep(120);
  assert.ok(rPanel().textContent.includes("Administrar este workspace con Danil Teams (Ingeniería)."));
  rGobierno().click();
  await sleep(120);
  assert.deepEqual(radiantCalls.at(-1), ["govern"]);
  assert.ok(rPanel().textContent.includes("Lo administra Danil Teams · workspace Ingeniería."), "el interruptor queda puesto");
  assert.ok(rPanel().textContent.includes("gobierno (raíz)"), "la raíz de gobierno sale en el resumen");
  assert.ok(rPanel().textContent.includes("revisar") && rPanel().textContent.includes("revisor"));
  assert.ok(rPanel().textContent.includes("Tailscale no está instalado en este equipo."), "un MCP de tailnet dice por qué no se activa");
  assert.ok(rPanel().textContent.includes("No instalado"), "y el estado de Tailscale se ve");
  rBoton("Conectar").click();
  await sleep(80);
  assert.deepEqual(radiantCalls.at(-1), ["connect", "jira"], "Conectar pide la URL de Pipes al backend");
  // El MCP gobernado con OAuth: el login lo hace la CLI de cada agente que recibe servidores.
  assert.ok(rPanel().textContent.includes("Inicio de sesión de los servidores MCP"));
  assert.ok(rPanel().textContent.includes("Esta CLI no inicia sesión en servidores MCP · su CLI no la ofrece"),
    "el agente sin login MCP lo dice con su motivo");
  assert.ok(!rPanel().textContent.includes("Codex"), "un agente que no recibe servidores no sale");
  rBoton("Iniciar sesión con Claude Code").click();
  await sleep(80);
  assert.deepEqual(radiantCalls.at(-1), ["mcp_login", "claude", "atlassian"]);
  assert.ok(rPanel().textContent.includes("Se abrió tu navegador para autorizar Atlassian."));
  radiantSesiones.push("claude");
  radiantApp.emit("mcp", null);
  await sleep(120);
  assert.equal(rBoton("Iniciar sesión con Claude Code"), undefined, "con sesión ya no se ofrece");
  assert.ok(rPanel().textContent.includes("Sesión iniciada"));
  gobierno = { ...GOBERNADO(), stale: true };
  gobierno.governed.last_error = "radiant.error.unreachable";
  rBoton("Renovar").click();
  await sleep(60);
  radiantApp.emit("radiant", null);
  await sleep(120);
  assert.ok(rPanel().textContent.includes("Vencido"), "un gobierno sin renovar se marca vencido");
  assert.ok(rPanel().textContent.includes("No se pudo renovar."), "y se dice que lo instalado sigue");
  rGobierno().click();
  await sleep(120);
  assert.deepEqual(radiantCalls.at(-1), ["ungovern"]);
  assert.ok(!rPanel().textContent.includes("Lo administra Danil Teams"), "desactivar quita el gobierno de la pantalla");
  gobierno = { ...SIN_GOBIERNO, notice: "radiant.governance.notice.denied" };
  radiantApp.emit("radiant", null);
  await sleep(120);
  assert.ok(rPanel().textContent.includes("Danil Teams dejó de conceder este workspace"), "un 403 se avisa");
  gobierno = SIN_GOBIERNO;
  radiant.workspace = null;
  // Cambiar de workspace de Terminus borra lo mostrado, y la respuesta tardía del anterior no entra.
  const cambiarDeWorkspace = () => radiantApp.w.dispatchEvent(new radiantApp.w.CustomEvent("harness:workspace"));
  const carla = radiantIdentity();
  let entregarIdentidad;
  radiantIdentityPending = new Promise((resolve) => { entregarIdentidad = resolve; });
  rBoton("Cerrar sesión").click();
  await sleep(80);
  rBoton("Iniciar sesión").click();
  await sleep(80);
  await completarLogin();
  assert.ok(rPanel().textContent.includes(`Sesión iniciada en ${CLOUD}.`), "la identidad del primer workspace sigue en camino");
  radiantIdentityPending = null;
  Object.assign(radiant, { server: CLOUD, signed_in: true, workspace: null, login: null });
  Object.assign(radiantCuenta, { status: "ok", email: "bea@example.test", organization: "Otra", organizations: [], note: null, workspaces: [{ id: "legal", name: "Legal" }] });
  cambiarDeWorkspace();
  assert.ok(!rPanel().textContent.includes("Sesión iniciada"), "el cambio borra la sesión mostrada sin esperar al servicio");
  await sleep(120);
  assert.ok(rPanel().textContent.includes("bea@example.test · Otra"), "el workspace nuevo enseña su propia cuenta");
  entregarIdentidad(carla);
  await sleep(80);
  assert.ok(!rPanel().textContent.includes("carla@example.test"), "la respuesta tardía del workspace anterior se descarta");
  assert.ok(rPanel().textContent.includes("bea@example.test · Otra"));
  Object.assign(radiant, { server: null, signed_in: false, workspace: null, login: null });
  cambiarDeWorkspace();
  await sleep(80);
  assert.equal(rBoton("Iniciar sesión"), undefined, "un workspace sin servidor elegido no hereda el del anterior");
  assert.equal(rPanel().querySelector("select"), null, "ni su cuenta ni sus workspaces remotos");
  assert.ok(!rPanel().textContent.includes("bea@example.test"));
  assert.deepEqual(radiantApp.fallos, []);
  /**
   * El selector de lengua dice la lengua que se acaba de poner, también
   * mientras el disco no ha terminado de guardarla. Si cambiar de lengua
   * remonta General, el selector nuevo relee la anterior y queda un paso atrás.
   */
  let savedLanguage = null;
  const languageSaves = [];
  const languageApp = await boot("listo", "language-select", {
    ...RESPUESTAS,
    list_workspaces: () => ({ workspaces: [{ id: "w", name: "W", context_root: null, lengua: savedLanguage }], active: "w" }),
    list_language_packs: [], list_bundled_language_packs: [],
    set_workspace_language: ({ lengua }) =>
      new Promise((resolve) => languageSaves.push(() => { savedLanguage = lengua; resolve(null); })),
  });
  const languageDoc = languageApp.w.document;
  languageDoc.querySelector('button[aria-label="Configuración"]')?.click();
  await sleep(100);
  languageDoc.querySelector("#cfg-tab-preferences")?.click();
  await sleep(50);
  const languageSelect = () =>
    [...languageDoc.querySelectorAll("select")].find((s) => s.querySelector('option[value="en"]') && s.querySelector('option[value=""]'));
  const pickLanguage = async (code) => {
    const select = languageSelect();
    select.value = code;
    select.dispatchEvent(new languageApp.w.Event("change", { bubbles: true }));
    await sleep(80);
  };
  assert.ok(languageSelect(), "General shows the language select");
  await pickLanguage("en");
  assert.equal(languageDoc.documentElement.lang, "en");
  assert.equal(languageSelect().value, "en", "the select names the language just applied");
  await pickLanguage("es");
  assert.equal(languageDoc.documentElement.lang, "es");
  assert.equal(languageSelect().value, "es");
  languageSaves.splice(0).forEach((save) => save());
  assert.deepEqual(languageApp.fallos, []);
  /**
   * Configuración › Agentes contra un catálogo con estado: crear en otra
   * carpeta, agregar con mudanza, rechazo dentro del diálogo, quitar de
   * «todas», deshacer, y un deshacer que choca con un cambio hecho desde fuera.
   */
  const carpetasDelCatalogo = [
    { id: "app", name: "Terminus App", kind: "folder", sources: [], portfolio: null },
    { id: "rad", name: "Radiant", kind: "folder", sources: [], portfolio: null },
    { id: "kn", name: "kn", kind: "folder", sources: [], portfolio: null },
  ];
  const idsDelCatalogo = carpetasDelCatalogo.map((p) => p.id);
  const nombreDeCarpeta = (id) => carpetasDelCatalogo.find((p) => p.id === id)?.name ?? id;
  const qaDelRepositorio = "/repo/app/.agents/agents/qa/agent.md";
  const qaDeRadiant = "/repo/rad/.agents/agents/qa/agent.md";
  let radiantDeclaraQa = false;
  const agentesPropios = [
    { name: "giskard-po", scope: { kind: "project", id: "app" }, list: ["app"], display: "Giskard Product Owner", description: "Product Owner de Terminus." },
    { name: "notas-de-version", scope: { kind: "workspace" }, list: null, display: null, description: "Escribe las notas de versión." },
    { name: "qa", scope: { kind: "project", id: "kn" }, list: ["kn"], display: "QA de kn", description: "Prueba los flujos de kn." },
  ];
  const declaracion = (a) => {
    const base = a.scope.kind === "project" ? `/ws/projects/${a.scope.id}/agents/${a.name}` : `/ws/agents/${a.name}`;
    return { name: a.name, description: a.description, instructions: "Trabaja.", tools: [], model: null, origin: `${base}/agent.md`, folder: base, providers: ["claude"], own: true, own_scope: a.scope };
  };
  const perfilDe = (display) => ({ display_name: display, body: null, background: null, veil: 0.82, provider: null, model: null, effort: null, hidden: false });
  const cambiosDeCarpetas = [];
  const creados = [];
  const agentesApp = await boot("listo", "settings-agents", {
    ...RESPUESTAS,
    list_projects: () => structuredClone(carpetasDelCatalogo),
    list_language_packs: [], list_bundled_language_packs: [],
    list_agent_profiles: {},
    // Clonado como lo entrega el IPC: el front reconcilia sobre lo que recibe.
    list_machine_agents: () => structuredClone({
      own: agentesPropios
        .map((a) => ({
          agent: declaracion(a),
          profile: perfilDe(a.display),
          folders: a.list === null ? idsDelCatalogo : idsDelCatalogo.filter((id) => a.list.includes(id)),
          all_folders: a.list === null,
          blocked: a.name === "qa" ? [{ folder: "app", origin: qaDelRepositorio, repository: true }] : [],
          catalog_taken: null,
        }))
        .sort((x, y) => x.agent.name.localeCompare(y.agent.name)),
      repository: [{
        agent: { name: "qa", description: "Verifica que un cambio funcione.", instructions: "", tools: [], model: null, origin: qaDelRepositorio, folder: "/repo/app/.agents/agents/qa", providers: ["claude"], own: false, own_scope: null },
        profile: perfilDe(null),
        folders: ["app"],
      }],
    }),
    change_agent_folders: ({ scope, name, change }) => {
      cambiosDeCarpetas.push([name, scope, change]);
      const a = agentesPropios.find((x) => x.name === name && JSON.stringify(x.scope) === JSON.stringify(scope));
      const niega = (codigo, origin = "") => Promise.reject({
        what: { clave: `settings.agents.error.${codigo}`, datos: { name, folder: change.folder ? nombreDeCarpeta(change.folder) : "", origin } },
        detail: codigo,
      });
      if (!a) return niega("missing");
      const actual = a.list ?? idsDelCatalogo;
      if (change.kind === "add") {
        if (actual.includes(change.folder)) return niega("already_active");
        if (name === "qa" && change.folder === "app") return niega("shadowed_repository", qaDelRepositorio);
        if (name === "qa" && change.folder === "rad" && radiantDeclaraQa) return niega("shadowed_repository", qaDeRadiant);
        a.scope = { kind: "workspace" };
        a.list = [...actual, change.folder];
        return [...a.list];
      }
      if (change.kind === "remove") {
        const quedan = actual.filter((id) => id !== change.folder);
        if (quedan.length === 0) return niega("last_folder");
        a.list = quedan;
        return [...quedan];
      }
      if (JSON.stringify(change.expected) !== JSON.stringify(a.list)) return niega("conflict");
      a.list = change.folders;
      return structuredClone(a.list);
    },
    create_agent: ({ name, description, scope }) => {
      creados.push([name, scope]);
      const a = { name, scope, list: [scope.id], display: null, description };
      agentesPropios.push(a);
      return { agent: declaracion(a), eclipsado_por: null };
    },
    save_agent_profile: ({ name, displayName }) => {
      const a = agentesPropios.find((x) => x.name === name);
      if (a) a.display = displayName;
      return null;
    },
  });
  const agDoc = agentesApp.w.document;
  let avisosAlRiel = 0;
  agentesApp.w.addEventListener("harness:encargados", () => avisosAlRiel++);
  let avisosDePerfiles = 0;
  agentesApp.w.addEventListener("harness:profiles", () => avisosDePerfiles++);
  const tecla = (key) =>
    agDoc.activeElement.dispatchEvent(new agentesApp.w.KeyboardEvent("keydown", { key, bubbles: true }));
  const botonCon = (raiz, texto) => [...raiz.querySelectorAll("button")].find((b) => b.textContent?.trim() === texto);
  const propia = (name) =>
    [...agDoc.querySelectorAll('section[aria-labelledby="agents-own"] [role="list"] > [role="listitem"]')]
      .find((li) => [...li.querySelectorAll("span")].some((s) => s.textContent === name));
  const rotuloDeCarpetas = (name) => propia(name).querySelector('[role="group"] > span').textContent;
  const chips = (name) => [...propia(name).querySelectorAll('[role="group"] > span')].slice(1).map((s) => s.textContent);
  const quitarDe = (name, carpeta) => propia(name).querySelector(`button[aria-label="Quitar ${name} de ${carpeta}"]`);
  const menuDe = (name) => agDoc.querySelector(`[role="menu"][aria-label="Agregar ${name} a un proyecto"]`);
  const abrirMenuDe = async (name) => {
    botonCon(propia(name), "Agregar a proyecto…").click();
    await sleep(60);
    return menuDe(name);
  };
  const renglones = (menu) => [...menu.querySelectorAll('[role="menuitem"]')];
  const renglon = (menu, carpeta) => renglones(menu).find((r) => r.textContent.startsWith(carpeta));
  const dialogoDeMudanza = (name) =>
    [...agDoc.querySelectorAll('[role="dialog"],[role="alertdialog"]')]
      .find((d) => d.textContent.includes(`¿Pasar ${name} al catálogo del workspace?`));
  const panelDeAjustes = () => agDoc.querySelector("#cfg-panel");

  agDoc.querySelector('button[aria-label="Configuración"]')?.click();
  await sleep(100);
  const pestanas = [...agDoc.querySelectorAll('[role="tab"][id^="cfg-tab-"]')].map((b) => b.id);
  const proyectos = pestanas.indexOf("cfg-tab-projects");
  assert.deepEqual(pestanas.slice(proyectos, proyectos + 2), ["cfg-tab-projects", "cfg-tab-agents-skills"]);
  agDoc.querySelector("#cfg-tab-projects").click();
  // La página llega en su propio trozo: se espera a que pinte sus filas.
  for (let i = 0; i < 120 && !agDoc.querySelector("#cfg-panel [data-settings-project]"); i++) await sleep(25);
  const filasDeProyectos = [...agDoc.querySelectorAll("#cfg-panel [data-settings-project]")];
  assert.deepEqual(filasDeProyectos.map((f) => f.getAttribute("data-settings-project")), idsDelCatalogo, "Ajustes › Proyectos lista las carpetas del espacio");
  assert.ok(filasDeProyectos.every((f) => f.textContent.includes("Archivos") && f.textContent.includes("sin tareas")), "cada fila dice su tipo en palabras y que no tiene tareas");
  assert.doesNotMatch(panelDeAjustes().textContent, /\bgit\b/i, "la página no le habla de git a la persona");
  agDoc.querySelector("#cfg-tab-agents-skills").click();
  // Agentes llega en su propio trozo: se espera a que pinte sus filas.
  for (let i = 0; i < 120 && !propia("giskard-po"); i++) await sleep(25);

  assert.ok(propia("giskard-po"), "la sección lista los agentes propios");
  assert.deepEqual(chips("giskard-po"), ["Terminus App"]);
  assert.equal(quitarDe("giskard-po", "Terminus App"), null, "la última carpeta no lleva ×");
  assert.equal(rotuloDeCarpetas("notas-de-version"), "Activo en todos los proyectos:");
  assert.deepEqual(chips("notas-de-version"), ["Terminus App", "Radiant", "kn"]);
  assert.ok(quitarDe("notas-de-version", "kn"), "«todas» se ve carpeta por carpeta, cada una con ×");
  assert.equal(botonCon(propia("notas-de-version"), "Agregar a proyecto…"), undefined);
  const delRepo = agDoc.querySelector('section[aria-labelledby="agents-repository"]');
  assert.ok(delRepo?.textContent.includes("Declarado en:"), "los del repositorio se ven aparte y solo se leen");
  assert.equal(botonCon(delRepo, "Agregar a proyecto…"), undefined);

  // Crear desde Configuración: el formulario del riel, con la carpeta elegible.
  botonCon(panelDeAjustes(), "Agregar nuevo agente").click();
  await sleep(80);
  const nuevo = [...agDoc.querySelectorAll('[role="dialog"]')].find((d) => d.textContent.includes("Nuevo agente"));
  assert.ok(nuevo, "«Agregar nuevo agente» abre el formulario de siempre");
  const carpetaNueva = nuevo.querySelector("select");
  assert.equal(carpetaNueva.value, "app", "sin carpeta abierta, nace en la primera");
  carpetaNueva.value = "rad";
  carpetaNueva.dispatchEvent(new agentesApp.w.Event("change", { bubbles: true }));
  const escribir = (campo, texto) => {
    campo.value = texto;
    campo.dispatchEvent(new agentesApp.w.InputEvent("input", { bubbles: true }));
  };
  const [campoNombre, campoQueHace] = nuevo.querySelectorAll("input");
  escribir(campoNombre, "Revisor");
  escribir(campoQueHace, "Revisa antes de que aterrice.");
  escribir(nuevo.querySelector("textarea"), "Con criterio.");
  botonCon(nuevo, "Crear").click();
  await sleep(150);
  assert.deepEqual(creados, [["revisor", { kind: "project", id: "rad" }]], "nace de proyecto en la carpeta elegida");
  assert.equal([...agDoc.querySelectorAll('[role="dialog"]')].some((d) => d.textContent.includes("Nuevo agente")), false);
  assert.deepEqual(chips("revisor"), ["Radiant"], "aparece en la lista sin reabrir Configuración");

  // Menú: marcadas, deshabilitadas con su razón, flechas, y Esc devuelve el foco.
  let menu = await abrirMenuDe("giskard-po");
  assert.ok(menu, "«Agregar a proyecto…» abre el menú de carpetas");
  assert.equal(renglon(menu, "Terminus App").getAttribute("aria-disabled"), "true");
  assert.ok(renglon(menu, "Terminus App").textContent.includes("Ya está aquí"));
  assert.equal(agDoc.activeElement, renglon(menu, "Radiant"), "el foco entra al primer renglón elegible");
  tecla("ArrowDown");
  assert.equal(agDoc.activeElement, renglon(menu, "kn"));
  tecla("Escape");
  await sleep(60);
  assert.equal(menuDe("giskard-po"), null, "Esc cierra el menú");
  assert.ok(panelDeAjustes(), "y no se lleva Configuración");
  assert.equal(agDoc.activeElement, botonCon(propia("giskard-po"), "Agregar a proyecto…"), "el foco vuelve al botón");

  // Agregar uno de proyecto a otra carpeta pide la mudanza; Cancelar va primero.
  menu = await abrirMenuDe("giskard-po");
  renglon(menu, "Radiant").click();
  await sleep(80);
  assert.ok(dialogoDeMudanza("giskard-po"), "uno de proyecto pide pasar al catálogo");
  assert.equal(agDoc.activeElement?.textContent?.trim(), "Cancelar", "el foco empieza en Cancelar");
  tecla("Escape");
  await sleep(80);
  assert.equal(dialogoDeMudanza("giskard-po"), undefined);
  assert.ok(panelDeAjustes(), "Esc en el diálogo no cierra Configuración");
  assert.deepEqual(cambiosDeCarpetas, [], "cancelar no cambia nada");
  assert.equal(agDoc.activeElement, botonCon(propia("giskard-po"), "Agregar a proyecto…"));
  menu = await abrirMenuDe("giskard-po");
  renglon(menu, "Radiant").click();
  await sleep(80);
  const avisosAntes = avisosAlRiel;
  botonCon(dialogoDeMudanza("giskard-po"), "Pasar al catálogo y agregar").click();
  await sleep(150);
  assert.deepEqual(cambiosDeCarpetas.at(-1), ["giskard-po", { kind: "project", id: "app" }, { kind: "add", folder: "rad" }]);
  assert.equal(dialogoDeMudanza("giskard-po"), undefined);
  assert.deepEqual(chips("giskard-po"), ["Terminus App", "Radiant"]);
  assert.ok(quitarDe("giskard-po", "Radiant"), "ya en el catálogo, cada carpeta se puede quitar");
  assert.ok(panelDeAjustes().textContent.includes("giskard-po pasó al catálogo del workspace."));
  assert.ok(panelDeAjustes().textContent.includes("Ya está activo en Terminus App y en Radiant."));
  assert.ok(avisosAlRiel > avisosAntes, "el riel se entera");

  // Rechazo: en el menú, con la razón; y el que llega del backend, dentro del diálogo.
  menu = await abrirMenuDe("qa");
  assert.equal(renglon(menu, "Terminus App").getAttribute("aria-disabled"), "true");
  assert.ok(renglon(menu, "Terminus App").textContent.includes("Gana el qa del repositorio de Terminus App"));
  const cambiosAntes = cambiosDeCarpetas.length;
  renglon(menu, "Terminus App").click();
  await sleep(40);
  assert.equal(cambiosDeCarpetas.length, cambiosAntes, "un renglón deshabilitado no pide nada");
  tecla("Escape");
  await sleep(60);
  radiantDeclaraQa = true;
  menu = await abrirMenuDe("qa");
  renglon(menu, "Radiant").click();
  await sleep(80);
  botonCon(dialogoDeMudanza("qa"), "Pasar al catálogo y agregar").click();
  await sleep(120);
  const rechazo = dialogoDeMudanza("qa")?.querySelector('[role="alert"]');
  assert.equal(
    rechazo?.textContent,
    `No se agregó qa a Radiant. Ahí gana el qa del repositorio, que se declara en ${qaDeRadiant}.`,
    "el rechazo se lee dentro del diálogo, con quién gana y dónde",
  );
  botonCon(dialogoDeMudanza("qa"), "Cancelar").click();
  await sleep(80);
  assert.deepEqual(chips("qa"), ["kn"]);

  // Quitar de «todas» la vuelve lista fija; Deshacer la devuelve a «todas».
  const perfilesAntes = avisosDePerfiles;
  quitarDe("notas-de-version", "kn").click();
  await sleep(120);
  assert.deepEqual(cambiosDeCarpetas.at(-1), ["notas-de-version", { kind: "workspace" }, { kind: "remove", folder: "kn" }]);
  assert.equal(rotuloDeCarpetas("notas-de-version"), "Activo en:");
  assert.deepEqual(chips("notas-de-version"), ["Terminus App", "Radiant"]);
  assert.ok(botonCon(propia("notas-de-version"), "Agregar a proyecto…"), "vuelve «Agregar a proyecto…»");
  assert.ok(panelDeAjustes().textContent.includes("notas-de-version ya no está en kn."));
  assert.ok(panelDeAjustes().textContent.includes("Ahora está en una lista fija de proyectos: los nuevos no lo tendrán."));
  assert.equal(agDoc.activeElement?.getAttribute("aria-label"), "Quitar notas-de-version de Radiant", "el foco pasa a la vecina");
  botonCon(panelDeAjustes(), "Deshacer").click();
  await sleep(150);
  assert.deepEqual(cambiosDeCarpetas.at(-1)[2], { kind: "restore", expected: ["app", "rad"], folders: null });
  assert.equal(
    avisosDePerfiles - perfilesAntes,
    2,
    "quitar y deshacer releen las caras: el riel las lee por carpeta, y el que vuelve a una se pintaría sin su cara ni su fondo",
  );
  assert.equal(rotuloDeCarpetas("notas-de-version"), "Activo en todos los proyectos:");
  assert.deepEqual(chips("notas-de-version"), ["Terminus App", "Radiant", "kn"]);

  // Un deshacer que choca con un cambio hecho desde fuera no lo pisa.
  quitarDe("giskard-po", "Radiant").click();
  await sleep(120);
  assert.ok(panelDeAjustes().textContent.includes("giskard-po ya no aparece en Radiant."));
  assert.equal(quitarDe("giskard-po", "Terminus App"), null);
  agentesPropios.find((a) => a.name === "giskard-po").list = ["app", "kn"];
  botonCon(panelDeAjustes(), "Deshacer").click();
  await sleep(150);
  assert.deepEqual(cambiosDeCarpetas.at(-1)[2], { kind: "restore", expected: ["app"], folders: ["app", "rad"] });
  assert.deepEqual(agentesPropios.find((a) => a.name === "giskard-po").list, ["app", "kn"], "no pisa el cambio de fuera");
  assert.ok(
    [...panelDeAjustes().querySelectorAll('[role="alert"]')].some((a) =>
      a.textContent.includes("giskard-po cambió mientras tanto. Revisa la lista y vuelve a intentarlo.")),
    "el conflicto se enseña",
  );
  assert.deepEqual(chips("giskard-po"), ["Terminus App", "kn"], "y la lista se relee");

  // Abrir perfil cierra Configuración y lo abre en su primera carpeta.
  botonCon(propia("giskard-po"), "Abrir perfil").click();
  await sleep(100);
  assert.equal(agentesApp.comandos.includes("send_message"), false, "abrir el perfil no crea un chat persistente");
  assert.equal(panelDeAjustes(), null);
  assert.deepEqual(agentesApp.fallos, []);
  /**
   * Renombrar un workspace es un gesto con nombre, vale para el que no está
   * activo, y cancelar cancela: Escape cierra el campo sin guardar y sin
   * llevarse por delante el diálogo de Configuración.
   */
  let espacios = {
    workspaces: [
      { id: "w", name: "Acme", context_root: null, sessions: 0 },
      { id: "w2", name: "Beta", context_root: null, sessions: 0 },
    ],
    active: "w",
  };
  const renombres = [];
  const cambiosDeWorkspace = [];
  const renombrar = await boot("listo", "workspace-rename", {
    ...RESPUESTAS,
    list_workspaces: () => espacios,
    workspaces_startup: () => espacios,
    list_language_packs: [], list_bundled_language_packs: [],
    set_active_workspace: ({ id }) => { cambiosDeWorkspace.push(id); },
    rename_workspace: ({ id, name }) => {
      renombres.push([id, name]);
      espacios = { ...espacios, workspaces: espacios.workspaces.map((w) => (w.id === id ? { ...w, name } : w)) };
      return espacios.workspaces.find((w) => w.id === id);
    },
  });
  await sleep(300);
  renombrar.w.document.querySelector('[data-workspace-column] [data-workspace-tile="w"]')
    ?.dispatchEvent(new renombrar.w.MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  await sleep(80);
  [...renombrar.w.document.querySelectorAll('[role="menuitem"]')]
    .find((b) => b.textContent?.trim() === "Administrar workspaces")?.click();
  await sleep(100);
  const lapiz = (name) =>
    renombrar.w.document.querySelector(`button[aria-label="Cambiarle el nombre a «${name}»"]`);
  const campoDeNombre = (name) =>
    renombrar.w.document.querySelector(`input[aria-label="Nuevo nombre de «${name}»"]`);
  assert.ok(lapiz("Beta"), "renombrar el workspace que no es el activo tiene que ser un gesto visible");
  assert.ok(lapiz("Acme"), "y el activo también");
  lapiz("Beta").click();
  await sleep(50);
  assert.deepEqual(cambiosDeWorkspace, [], "pedir renombrar no cambia de cliente");
  const cancelado = campoDeNombre("Beta");
  assert.ok(cancelado, "el gesto abre el campo del nombre");
  cancelado.value = "Gamma";
  cancelado.dispatchEvent(new renombrar.w.InputEvent("input", { bubbles: true }));
  cancelado.dispatchEvent(new renombrar.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await sleep(50);
  assert.deepEqual(renombres, [], "Escape cancela sin guardar");
  assert.ok(lapiz("Beta"), "y Escape no se lleva por delante Configuración");
  lapiz("Beta").click();
  await sleep(50);
  const escrito = campoDeNombre("Beta");
  escrito.value = "Gamma";
  escrito.dispatchEvent(new renombrar.w.InputEvent("input", { bubbles: true }));
  escrito.dispatchEvent(new renombrar.w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await sleep(150);
  assert.deepEqual(renombres, [["w2", "Gamma"]], "Enter guarda el que no es el activo");
  assert.deepEqual(cambiosDeWorkspace, [], "renombrar no cambia de cliente");
  assert.ok(lapiz("Gamma"), "la lista se relee con el nombre nuevo");
  assert.deepEqual(renombrar.fallos, []);
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
  const columna = await bootPorCarpeta("listo", "workspace-column", { ...CON_TAREA,
    list_workspaces: () => structuredClone(espaciosDeColumna),
    workspaces_startup: () => structuredClone(espaciosDeColumna),
    list_projects: () => [{ id: "pa", name: "Proyecto", kind: "folder", working_directory: "/lab", sources: [] }],
    list_live_sessions: ({ project }) => project === "pa" ? [task("s1", null, "delivered"), task("s2", null, "failed"), task("s3", null, "delivered")] : [],
    load_session: ({ id }) => ({ ...CON_TAREA.load_session, id, turns: [] }),
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
  const solo = await boot("listo", "title-bar-one", { ...CON_TAREA,
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
  const plegado = await boot("listo", "title-bar-collapsed", { ...CON_TAREA,
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
  const enWindows = await boot("listo", "title-bar-windows", { ...CON_TAREA,
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
  const cruce = await boot("listo", 20, { ...CON_TAREA,
    workspaces_startup: () => espaciosDelCruce(),
    list_workspaces: () => espaciosDelCruce(),
    list_projects: () => [{ id: wsActivo === "w" ? "pa" : "pb", name: "Proyecto", kind: "folder", working_directory: "/lab", sources: [] }],
    list_live_sessions: () => [task("s1", null, null)],
    load_session: ({ id }) => ({ ...CON_TAREA.load_session, id, turns: [] }),
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
    ...CON_TAREA,
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
    ...CON_TAREA,
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
    ...CON_TAREA,
    load_session: {
      ...CON_TAREA.load_session,
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
    ...CON_TAREA,
    list_task_trees: [{ key: "work", name: "lab", path: "/lab", kind: "git", branch: "dev", missing: false, dirty_before: null }],
    load_session: {
      ...CON_TAREA.load_session,
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

  // Contestar una pregunta viva después de ir a otra tarea y volver.
  //
  // El `request_id` llega por el evento y vive en `vivo`; cada relectura
  // reconstruye `base` del disco, y a la segunda vuelta no queda de dónde
  // copiarlo. Sin él la respuesta sale por `send_message`, que la rechaza.
  const PREGUNTA = {
    role: "agent",
    id: "t-preg",
    text: "¿Sigo?",
    questions: [
      {
        id: "q1",
        question: "¿Sigo?",
        options: [{ value: "o1", label: "Dale" }, { value: "o2", label: "Para" }],
        multiple: false,
        free_text: false,
      },
    ],
  };
  const hilos = {
    s1: [{ role: "user", id: "u1", text: "Empieza" }],
    s2: [{ role: "user", id: "u2", text: "Otra cosa" }],
  };
  const contestadas = [];
  const enviadas = [];
  const canceladas = [];
  const PREGUNTA_VIVA = {
    ...CON_TAREA,
    list_live_sessions: [
      { ...CON_TAREA.list_live_sessions[0], id: "s1", title: "Con pregunta" },
      { ...CON_TAREA.list_live_sessions[0], id: "s2", title: "La otra" },
    ],
    load_session: ({ id }) => ({ ...CON_TAREA.load_session, id, turns: hilos[id] }),
    pending_requests: ({ session }) =>
      session === "s1"
        ? { questions: [{ id: "durable-req-1", revision: 3, request_id: "req-1", turn: "t-preg" }, { id: "durable-req-dos", revision: 1, request_id: "req-dos", turn: "t-dos" }], permissions: [] }
        : { questions: [], permissions: [] },
    answer_question: (args) => {
      contestadas.push(args);
      return {
        role: "user",
        id: "t-resp",
        text: "Dale",
        answers: [
          { turn: "t-preg", question: "q1", question_text: "¿Sigo?", chosen: ["o1"], text: "Dale", source: "persona", when: 0 },
        ],
        author: null,
      };
    },
    send_message: (args) => {
      enviadas.push(args);
      throw "history.error.busy";
    },
    cancel_question: (args) => {
      canceladas.push(args);
      return {
        role: "user",
        id: "t-cierre",
        text: "",
        answers: [
          { turn: args.turn, question: "q1", question_text: "¿Sigo?", chosen: [], text: "", source: "persona", when: 0 },
        ],
        author: null,
      };
    },
  };
  const conPregunta = await boot("listo", "pregunta-viva", PREGUNTA_VIVA);
  const docP = conPregunta.w.document;
  docP.querySelector('[data-sesion="s1"]')?.click();
  await sleep(150);
  conPregunta.emit("chat", { kind: "started", session: "s1", workspace: "w" });
  conPregunta.emit("question", {
    workspace: "w",
    session: "s1",
    turno: "t-preg",
    preguntas: PREGUNTA.questions,
    request_id: "req-1",
  });
  await sleep(120);
  // Lo que hace el backend al preguntar: persiste el tramo y sigue esperando.
  hilos.s1 = [...hilos.s1, PREGUNTA];
  for (let vuelta = 0; vuelta < 2; vuelta++) {
    docP.querySelector('[data-sesion="s2"]')?.click();
    await sleep(150);
    docP.querySelector('[data-sesion="s1"]')?.click();
    await sleep(150);
  }
  const opcion = [...docP.querySelectorAll("button")].find((b) =>
    b.getAttribute("aria-label")?.endsWith("Dale"),
  );
  if (!opcion) {
    console.error("Al volver a la tarea, la pregunta pendiente no ofrece sus opciones.");
    process.exit(1);
  }
  // El rechazo llega por una promesa que Solid no espera: sin recogerlo, Node
  // mata este guarda antes de decir qué falló.
  const rechazos = [];
  const anota = (e) => rechazos.push(e);
  process.on("unhandledRejection", anota);
  opcion.click();
  await sleep(200);
  process.off("unhandledRejection", anota);
  if (contestadas.length !== 1 || enviadas.length > 0) {
    console.error(
      "Contestar tras ir y volver no usa el canal vivo: " +
        `answer_question=${contestadas.length}, send_message=${enviadas.length}.`,
    );
    process.exit(1);
  }
  assert.equal(contestadas[0].requestId, "durable-req-1");
  assert.equal(contestadas[0].revision, 3);

  // Esc cierra la pregunta sin contestarla y devuelve la caja de escribir.
  // Mientras el agente espere, esa caja no existe.
  conPregunta.emit("question", {
    workspace: "w",
    session: "s1",
    turno: "t-preg2",
    preguntas: PREGUNTA.questions,
    request_id: "req-2",
  });
  await sleep(150);
  if (docP.querySelector("textarea")) {
    console.error("Con una pregunta delante, la caja de escribir sigue ahí.");
    process.exit(1);
  }
  const anclada = [...docP.querySelectorAll("button")].find((b) =>
    b.getAttribute("aria-label")?.endsWith("Dale"),
  );
  anclada?.dispatchEvent(
    new conPregunta.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  await sleep(200);
  if (canceladas.length !== 1 || !docP.querySelector("textarea")) {
    console.error(
      "Esc no cierra la pregunta: " +
        `cancel_question=${canceladas.length}, caja=${!!docP.querySelector("textarea")}.`,
    );
    process.exit(1);
  }
  assert.equal(canceladas[0].turn, "t-preg2");
  // Y el botón hace lo mismo que la tecla.
  conPregunta.emit("question", {
    workspace: "w",
    session: "s1",
    turno: "t-preg3",
    preguntas: PREGUNTA.questions,
    request_id: "req-3",
  });
  await sleep(150);
  [...docP.querySelectorAll("button")]
    .find((b) => b.textContent?.trim().startsWith("Omitir"))
    ?.click();
  await sleep(200);
  if (canceladas.length !== 2 || !docP.querySelector("textarea")) {
    console.error("El botón Omitir no cierra la pregunta.");
    process.exit(1);
  }

  // Dos preguntas: el paginador cuenta, un número elige y pasa a la
  // siguiente, n+1 abre «Otra» y ⌘↵ manda lo escrito.
  const DOS_PREGUNTAS = [
    PREGUNTA.questions[0],
    {
      id: "q2",
      question: "¿Con qué color?",
      header: "Color",
      options: [{ value: "a", label: "Azul" }, { value: "v", label: "Verde" }],
      multiple: false,
      free_text: true,
    },
  ];
  conPregunta.emit("question", {
    workspace: "w",
    session: "s1",
    turno: "t-dos",
    preguntas: DOS_PREGUNTAS,
    request_id: "req-dos",
  });
  await sleep(150);
  const tarjetaDos = docP.querySelector('[data-interruption="question"]');
  const teclaEnDos = (key, extra = {}) =>
    (docP.activeElement && tarjetaDos.contains(docP.activeElement) ? docP.activeElement : tarjetaDos)
      .dispatchEvent(new conPregunta.w.KeyboardEvent("keydown", { key, bubbles: true, ...extra }));
  assert.match(tarjetaDos.textContent, /1 de 2/);
  assert.match(tarjetaDos.textContent, /Respondidas 0\/2/);
  const encabezadoDePregunta = () => tarjetaDos.querySelector("p")?.previousElementSibling?.textContent;
  assert.equal(encabezadoDePregunta(), "El agente pregunta", "sin header va el texto del catálogo");
  teclaEnDos("2");
  await sleep(50);
  assert.match(tarjetaDos.textContent, /¿Con qué color\?/, "un número elige y pasa a la siguiente");
  assert.equal(encabezadoDePregunta(), "Color", "el header de Claude va encima de la pregunta");
  assert.match(tarjetaDos.textContent, /Respondidas 1\/2/);
  teclaEnDos("3");
  await sleep(50);
  const campoOtra = tarjetaDos.querySelector("textarea");
  assert.ok(campoOtra, "n+1 abre el campo de «Otra»");
  campoOtra.value = "Morado";
  campoOtra.dispatchEvent(new conPregunta.w.Event("input", { bubbles: true }));
  await sleep(20);
  const antesDeDos = contestadas.length;
  campoOtra.dispatchEvent(
    new conPregunta.w.KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }),
  );
  await sleep(200);
  assert.equal(contestadas.length, antesDeDos + 1, "⌘↵ en la última manda las respuestas");
  assert.deepEqual(contestadas.at(-1).respuestas, [
    { turn: "t-dos", question: "q1", chosen: ["o2"], free_text: null },
    { turn: "t-dos", question: "q2", chosen: [], free_text: "Morado" },
  ]);
  assert.deepEqual(conPregunta.fallos, []);

  // Solo se monta la pestaña que se ve. Una pregunta de tres páginas contestada
  // a medias vuelve en la misma página, con lo elegido y lo escrito en «Otra»,
  // y lo plegado sigue plegado. Otra tarea con el mismo turno no lo hereda, otro
  // turno empieza vacío y cerrar la pestaña lo suelta todo. La traza se imprime:
  // es lo que se revisa en el log de la cadena.
  const TRES = [
    { id: "q1", question: "¿Sigo?", options: [{ value: "o1", label: "Dale" }, { value: "o2", label: "Para" }], multiple: false, free_text: false },
    {
      id: "q2",
      question: "¿Qué colores?",
      options: [{ value: "a", label: "Azul" }, { value: "v", label: "Verde" }, { value: "r", label: "Rojo" }],
      multiple: true,
      free_text: false,
    },
    { id: "q3", question: "¿Qué nombre?", options: [{ value: "si", label: "El de siempre" }, { value: "no", label: "Otro nuevo" }], multiple: false, free_text: true },
  ];
  const conTres = (id) => [
    { role: "user", id: `u-${id}`, text: "Empieza" },
    { role: "agent", id: `t-antes-${id}`, text: "Revisé la carpeta.", tools: [{ name: "Bash", target: "ls -la", ok: true }] },
    { role: "agent", id: "t-tres", text: "Antes de seguir", questions: TRES },
  ];
  const hilosTres = { p1: conTres("p1"), p2: conTres("p2"), p3: [{ role: "user", id: "u3", text: "Tres" }], p4: [{ role: "user", id: "u4", text: "Cuatro" }] };
  const atadurasTres = { p1: [{ id: "durable-req-p1", revision: 2, request_id: "req-p1", turn: "t-tres" }], p2: [{ id: "durable-req-p2", revision: 2, request_id: "req-p2", turn: "t-tres" }] };
  const contestadasTres = [];
  const titulos = { p1: "Pregunta uno", p2: "Pregunta dos", p3: "Tres", p4: "Cuatro" };
  const A_MEDIAS = {
    ...CON_TAREA,
    list_live_sessions: Object.entries(titulos).map(([id, title]) => ({ ...CON_TAREA.list_live_sessions[0], id, title })),
    load_session: ({ id }) => ({ ...CON_TAREA.load_session, id, turns: hilosTres[id] }),
    pending_requests: ({ session }) => ({ questions: atadurasTres[session] ?? [], permissions: [] }),
    answer_question: (args) => {
      contestadasTres.push(args);
      atadurasTres[args.session] = [];
      return {
        role: "user",
        id: `resp-${args.requestId}`,
        text: "Hecho",
        answers: args.respuestas.map((r) => ({ turn: r.turn, question: r.question, question_text: "", chosen: r.chosen, text: "Hecho", source: "persona", when: 0 })),
        author: null,
      };
    },
  };
  const aMedias = await boot("listo", "preguntas-a-medias", A_MEDIAS);
  const docMedias = aMedias.w.document;
  const traza = [];
  const abrir = async (id) => {
    docMedias.querySelector(`[data-sesion="${id}"]`)?.click();
    await sleep(150);
  };
  // La tarjeta que se ve: las de pestañas montadas y escondidas no cuentan.
  const tarjeta = () =>
    [...docMedias.querySelectorAll('[data-interruption="question"]')].find((el) => !el.closest(".hidden, [hidden]"));
  const teclaEnLaTarjeta = async (key, extra = {}) => {
    tarjeta().dispatchEvent(new aMedias.w.KeyboardEvent("keydown", { key, bubbles: true, ...extra }));
    await sleep(40);
  };
  const opcionM = (label) =>
    [...tarjeta().querySelectorAll("button[data-option]")].find((b) => b.getAttribute("aria-label")?.endsWith(`. ${label}`));
  // La tira de pestañas también lleva `data-ventana`: la celda es la que tiene la conversación.
  const celdaM = () =>
    [...docMedias.querySelectorAll("[data-ventana]")].find(
      (el) => !el.classList.contains("hidden") && el.querySelector('[data-interruption="question"], textarea'),
    );
  const tramo = () =>
    [...celdaM().querySelectorAll("button[aria-expanded]")].find(
      (b) => !b.closest('section[aria-label="Preguntas"]') && b.querySelector("svg.lucide-chevron-right"),
    );
  const botonM = (label) => celdaM().querySelector(`button[aria-label="${label}"]`);
  const foto = (paso) => {
    const el = tarjeta();
    const vista = {
      paso,
      tramo: tramo()?.getAttribute("aria-expanded") ?? null,
      plegada: !!botonM("Mostrar preguntas"),
      pagina: el?.textContent.match(/(\d) de 3/)?.[0] ?? null,
      respondidas: el?.textContent.match(/Respondidas \d\/3/)?.[0] ?? null,
      elegidas: el ? [...el.querySelectorAll('button[aria-pressed="true"]')].map((b) => b.getAttribute("aria-label")) : [],
      otra: el?.querySelector("textarea")?.value ?? null,
    };
    traza.push(vista);
    return vista;
  };

  await abrir("p1");
  assert.deepEqual(foto("p1 al abrir"), { paso: "p1 al abrir", tramo: "false", plegada: false, pagina: "1 de 3", respondidas: "Respondidas 0/3", elegidas: [], otra: null });
  await teclaEnLaTarjeta("1");
  opcionM("Azul").click();
  await sleep(40);
  opcionM("Rojo").click();
  await sleep(40);
  await teclaEnLaTarjeta("ArrowRight");
  await teclaEnLaTarjeta("3");
  const otraM = tarjeta().querySelector("textarea");
  assert.ok(otraM, "n+1 abre «Otra» en la tercera página");
  otraM.value = "Morado";
  otraM.dispatchEvent(new aMedias.w.Event("input", { bubbles: true }));
  await sleep(40);
  assert.deepEqual(foto("p1 a medias"), { paso: "p1 a medias", tramo: "false", plegada: false, pagina: "3 de 3", respondidas: "Respondidas 3/3", elegidas: [], otra: "Morado" });
  const tarjetaDeP1 = tarjeta();
  tramo().click();
  botonM("Plegar preguntas").click();
  await sleep(40);
  assert.deepEqual(foto("p1 plegada").tramo, "true");
  assert.equal(tarjeta(), undefined, "plegar no escondió la tarjeta");

  await abrir("p2");
  assert.equal(tarjetaDeP1.isConnected, false, "la pestaña de p1 sigue montada detrás de p2");
  assert.deepEqual(
    foto("p2, mismo turno y mismos ids"),
    { paso: "p2, mismo turno y mismos ids", tramo: "false", plegada: false, pagina: "1 de 3", respondidas: "Respondidas 0/3", elegidas: [], otra: null },
    "lo elegido o lo plegado en una tarea aparece en otra",
  );
  await teclaEnLaTarjeta("2");
  await abrir("p3");
  await abrir("p4");

  await abrir("p1");
  const vuelta = foto("p1 al volver, plegada");
  assert.equal(vuelta.tramo, "true", "al remontar se plegó el tramo que estaba desplegado");
  assert.equal(vuelta.plegada, true, "al remontar se desplegó la pregunta plegada");
  botonM("Mostrar preguntas").click();
  await sleep(40);
  assert.notEqual(tarjeta(), tarjetaDeP1, "p1 volvió sin remontarse");
  assert.deepEqual(
    foto("p1 al volver"),
    { paso: "p1 al volver", tramo: "true", plegada: false, pagina: "3 de 3", respondidas: "Respondidas 3/3", elegidas: [], otra: "Morado" },
    "al remontar la tarjeta se perdió la página o «Otra»",
  );
  await teclaEnLaTarjeta("ArrowLeft");
  assert.deepEqual(foto("p1, página 2").elegidas, ["1. Azul", "3. Rojo"], "al remontar se perdió lo elegido en la segunda");
  await teclaEnLaTarjeta("ArrowLeft");
  assert.deepEqual(foto("p1, página 1").elegidas, ["1. Dale"], "al remontar se perdió lo elegido en la primera");

  await abrir("p2");
  assert.deepEqual(foto("p2 al volver").respondidas, "Respondidas 1/3");
  await abrir("p1");
  await teclaEnLaTarjeta("Enter", { metaKey: true });
  await teclaEnLaTarjeta("Enter", { metaKey: true });
  await teclaEnLaTarjeta("Enter", { metaKey: true });
  await sleep(200);
  assert.equal(contestadasTres.length, 1, "⌘↵ en la última no mandó las respuestas");
  assert.equal(contestadasTres[0].requestId, "durable-req-p1");
  assert.equal(contestadasTres[0].revision, 2);
  assert.deepEqual(contestadasTres[0].respuestas, [
    { turn: "t-tres", question: "q1", chosen: ["o1"], free_text: null },
    { turn: "t-tres", question: "q2", chosen: ["a", "r"], free_text: null },
    { turn: "t-tres", question: "q3", chosen: [], free_text: "Morado" },
  ]);
  hilosTres.p1 = [...hilosTres.p1, { role: "user", id: "resp-durable-req-p1", text: "Hecho", answers: contestadasTres[0].respuestas.map((r) => ({ ...r, question_text: "", text: "Hecho", source: "persona", when: 0 })) }];
  // El registro de lo contestado se pliega y sigue plegado al volver.
  const registro = () => celdaM().querySelector('section[aria-label="Preguntas"] button[aria-expanded]');
  assert.equal(registro()?.getAttribute("aria-expanded"), "true", "el registro de preguntas no nace abierto");
  registro().click();
  await sleep(40);
  await abrir("p2");
  await abrir("p1");
  assert.equal(registro()?.getAttribute("aria-expanded"), "false", "al remontar se abrió el registro de preguntas plegado");

  // El turno siguiente repite `q1..q3`.
  const OTRA_VEZ = { role: "agent", id: "t-otra", text: "Una más", questions: TRES };
  aMedias.emit("chat", { kind: "started", session: "p1", workspace: "w" });
  aMedias.emit("question", { workspace: "w", session: "p1", turno: "t-otra", preguntas: TRES, request_id: "req-p1b" });
  await sleep(150);
  hilosTres.p1 = [...hilosTres.p1, OTRA_VEZ];
  atadurasTres.p1 = [{ id: "durable-req-p1b", revision: 1, request_id: "req-p1b", turn: "t-otra" }];
  assert.deepEqual(
    foto("p1, turno nuevo"),
    { paso: "p1, turno nuevo", tramo: "true", plegada: false, pagina: "1 de 3", respondidas: "Respondidas 0/3", elegidas: [], otra: null },
    "el turno nuevo heredó lo elegido en el anterior",
  );
  await teclaEnLaTarjeta("2");
  assert.equal(foto("p1, turno nuevo a medias").pagina, "2 de 3");

  // Cerrar la pestaña suelta lo contestado a medias: reabrirla empieza de cero.
  docMedias.querySelector('button[aria-label="Cerrar «Pregunta uno»"]')?.click();
  await sleep(150);
  assert.equal(docMedias.querySelector('button[aria-label="Cerrar «Pregunta uno»"]'), null, "cerrar la pestaña no la cerró");
  await abrir("p1");
  assert.deepEqual(
    foto("p1 reabierta"),
    { paso: "p1 reabierta", tramo: "false", plegada: false, pagina: "1 de 3", respondidas: "Respondidas 0/3", elegidas: [], otra: null },
    "cerrar la pestaña no soltó lo contestado a medias o lo desplegado",
  );
  console.log(`preguntas-a-medias: ${JSON.stringify(traza)}`);
  assert.deepEqual(aMedias.fallos, []);
  aMedias.w.close();

  // Una tarea nueva nace con id provisional y Rust le da el suyo al contestar.
  // Lo desplegado en su primer turno sigue desplegado al dejar de verla y
  // volver, y cerrar su pestaña lo suelta.
  let creada = false;
  const turnosDeLaNueva = [
    { role: "user", id: "u-nueva", text: "Revisa la carpeta" },
    { role: "agent", id: "t-nueva", text: "Listo.", tools: [{ name: "Bash", target: "ls -la", ok: true }] },
  ];
  const NACE = {
    ...CON_TAREA,
    list_live_sessions: () => [
      { ...CON_TAREA.list_live_sessions[0], id: "vieja", title: "Vieja" },
      ...(creada ? [{ ...CON_TAREA.list_live_sessions[0], id: "nueva", title: "Revisa la carpeta" }] : []),
    ],
    load_session: ({ id }) => ({
      ...CON_TAREA.load_session,
      id,
      turns: id === "nueva" ? (creada ? turnosDeLaNueva : []) : [{ role: "user", id: "u-vieja", text: "Vieja" }],
    }),
    send_message: () => {
      creada = true;
      return "nueva";
    },
  };
  const nace = await boot("listo", "tarea-que-nace", NACE);
  const docNace = nace.w.document;
  const celdaNace = () =>
    [...docNace.querySelectorAll("[data-ventana]")].find((el) => !el.classList.contains("hidden") && el.querySelector("textarea"));
  const tramoNace = () =>
    [...(celdaNace()?.querySelectorAll("button[aria-expanded]") ?? [])].find(
      (b) => !b.closest('section[aria-label="Preguntas"]') && b.querySelector("svg.lucide-chevron-right"),
    );
  const encargo = celdaNace().querySelector("textarea");
  encargo.value = "Revisa la carpeta";
  encargo.dispatchEvent(new nace.w.Event("input", { bubbles: true }));
  encargo.closest("form").dispatchEvent(new nace.w.Event("submit", { bubbles: true, cancelable: true }));
  await sleep(150);
  nace.emit("chat", { kind: "started", session: "nueva", workspace: "w" });
  nace.emit("chat", { kind: "tool", session: "nueva", workspace: "w", id: "ls", text: "Bash", target: "ls -la" });
  nace.emit("chat", { kind: "tool_done", session: "nueva", workspace: "w", id: "ls", text: "Bash", ok: true });
  nace.emit("chat", { kind: "delta", session: "nueva", workspace: "w", text: "Listo." });
  nace.emit("chat", { kind: "done", session: "nueva", workspace: "w", ok: true });
  await sleep(300);
  assert.equal(tramoNace()?.getAttribute("aria-expanded"), "false", "el primer turno de la tarea nueva no pinta su tramo");
  tramoNace().click();
  await sleep(40);
  docNace.querySelector('[data-sesion="vieja"]')?.click();
  await sleep(150);
  assert.equal(tramoNace(), undefined, "la tarea vieja no tiene tramo: la celda que se ve sigue siendo la nueva");
  docNace.querySelector('[data-sesion="nueva"]')?.click();
  await sleep(150);
  assert.equal(tramoNace()?.getAttribute("aria-expanded"), "true", "al volver a la tarea recién nacida se plegó su tramo");
  [...docNace.querySelectorAll("button")]
    .find((b) => b.getAttribute("aria-label") === "Cerrar «Revisa la carpeta»")
    ?.click();
  await sleep(150);
  docNace.querySelector('[data-sesion="nueva"]')?.click();
  await sleep(150);
  assert.equal(tramoNace()?.getAttribute("aria-expanded"), "false", "cerrar la pestaña de la tarea nueva no soltó lo desplegado");
  assert.deepEqual(nace.fallos, []);
  nace.w.close();

  // Lo elegido en la caja de una tarea abierta sobrevive a mirar otra, y un
  // gate que esta ventana no vio se repone preguntando por los pendientes.
  //
  // `session.json` guarda con qué corrió el último turno, no con qué va a
  // correr el siguiente; y el evento del permiso viaja una sola vez.
  const modos = [
    { id: "manual", label: { clave: "agents.mode.manual" }, falta: null, por_omision: true },
    { id: "auto", label: { clave: "agents.mode.auto" }, falta: null, por_omision: false },
  ];
  const VENTANA = {
    ...CON_TAREA,
    list_live_sessions: [
      { ...CON_TAREA.list_live_sessions[0], id: "s1", title: "Con modo" },
      { ...CON_TAREA.list_live_sessions[0], id: "s2", title: "La otra" },
    ],
    load_session: ({ id }) => ({
      ...CON_TAREA.load_session,
      id,
      provider: "codex",
      permission_mode: "manual",
      turns: [],
    }),
    list_permission_modes: modos,
    list_active_turns: ["s1"],
    pending_requests: ({ session }) =>
      session === "s1"
        ? { questions: [], permissions: [{ id: "durable-perm-1", revision: 4, request_id: "perm-1", tool: "Bash", target: "rm -rf" }] }
        : { questions: [], permissions: [] },
  };
  const ventana = await boot("listo", "estado-de-ventana", VENTANA);
  const docV = ventana.w.document;
  const modoActual = () =>
    [...docV.querySelectorAll("[aria-label]")]
      .map((el) => el.getAttribute("aria-label"))
      .find((etiqueta) => etiqueta.startsWith("Permisos: "));
  docV.querySelector('[data-sesion="s1"]')?.click();
  await sleep(200);
  assert.equal(modoActual(), "Permisos: Manual");
  const cajaV = docV.querySelector("textarea");
  cajaV.focus();
  cajaV.dispatchEvent(
    new ventana.w.KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }),
  );
  await sleep(120);
  assert.equal(modoActual(), "Permisos: Automático", "shift+Tab cambia el modo");
  docV.querySelector('[data-sesion="s2"]')?.click();
  await sleep(200);
  docV.querySelector('[data-sesion="s1"]')?.click();
  await sleep(250);
  if (modoActual() !== "Permisos: Automático") {
    console.error(`Volver a la tarea revierte lo elegido en su caja: ${modoActual()}.`);
    process.exit(1);
  }
  // Y el gate del permiso pendiente aparece sin que nadie repita su evento.
  ventana.w.dispatchEvent(new ventana.w.Event("focus"));
  await sleep(400);
  if (!docV.body.textContent.includes("Aprobar acción")) {
    console.error("Un permiso pendiente que esta ventana no vio no se repone.");
    process.exit(1);
  }
  assert.deepEqual(ventana.fallos, []);
  ventana.w.close();

  // Pasar a automático con un permiso a la vista lo aprueba, y solo si el
  // turno aceptó el cambio: sin él las peticiones siguientes se seguirían pidiendo.
  for (const cambio of ["acepta", "rechaza"]) {
    const respuestas = [];
    const auto = await boot("listo", `automatico-aprueba-${cambio}`, {
      ...VENTANA,
      set_permission_mode: cambio === "acepta" ? null : new Error("chat.mode.unsupported"),
      respond_permission: (args) => {
        respuestas.push(args);
        return {
          id: "t-decision", role: "user", text: "", author: null,
          permission: { request_id: args.requestId, tool: "Bash", target: "rm -rf", allow: args.allow, when: 1 },
        };
      },
    });
    const docA = auto.w.document;
    docA.querySelector('[data-sesion="s1"]')?.click();
    await sleep(200);
    auto.w.dispatchEvent(new auto.w.Event("focus"));
    await sleep(400);
    assert.ok(docA.body.textContent.includes("Aprobar acción"), "el gate pendiente está a la vista antes de cambiar de modo");
    const cajaA = docA.querySelector("textarea");
    cajaA.focus();
    cajaA.dispatchEvent(new auto.w.KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
    await sleep(300);
    if (cambio === "acepta") {
      assert.deepEqual(
        respuestas.map(({ session, requestId, revision, allow }) => ({ session, requestId, revision, allow })),
        [{ session: "s1", requestId: "durable-perm-1", revision: 4, allow: true }],
        "elegir automático con el turno vivo aprueba el permiso que esperaba",
      );
      assert.ok(!docA.body.textContent.includes("Aprobar acción"), "el gate aprobado deja de pedir respuesta");
    } else {
      assert.deepEqual(respuestas, [], "si el turno no pasó a automático, lo pendiente sigue esperando a la persona");
      assert.ok(docA.body.textContent.includes("Aprobar acción"));
    }
    assert.deepEqual(auto.fallos, []);
    auto.w.close();
  }

  // Un motor anterior a los pendientes durables los lista sin `id` ni
  // `revision`: el gate se contesta igual, por su `request_id`.
  {
    const respuestas = [];
    const viejo = await boot("listo", "permiso-motor-sin-revision", {
      ...VENTANA,
      pending_requests: ({ session }) =>
        session === "s1"
          ? { questions: [], permissions: [{ request_id: "perm-1", tool: "Bash", target: "rm -rf" }] }
          : { questions: [], permissions: [] },
      respond_permission: (args) => {
        respuestas.push(args);
        return {
          id: "t-decision", role: "user", text: "", author: null,
          permission: { request_id: args.requestId, tool: "Bash", target: "rm -rf", allow: args.allow, when: 1 },
        };
      },
    });
    const docO = viejo.w.document;
    docO.querySelector('[data-sesion="s1"]')?.click();
    await sleep(200);
    viejo.w.dispatchEvent(new viejo.w.Event("focus"));
    await sleep(400);
    [...docO.querySelectorAll("button")].find((b) => b.textContent.trim() === "Aprobar y ejecutar")?.click();
    await sleep(300);
    assert.deepEqual(
      respuestas.map(({ session, requestId, revision, allow }) => ({ session, requestId, revision, allow })),
      [{ session: "s1", requestId: "perm-1", revision: undefined, allow: true }],
      "sin revisión el permiso se aprueba por su request_id",
    );
    assert.ok(!docO.body.textContent.includes("Aprobar acción"), "el gate aprobado deja de pedir respuesta");
    assert.ok(!docO.body.textContent.includes("no indicó cómo contestarle"));
    assert.deepEqual(viejo.fallos, []);
    viejo.w.close();
  }

  // Lo nuevo del workspace arranca con su modo por defecto y lo que ya existe
  // conserva el suyo. El ajuste vive en General, antes del contexto.
  const defaultSaves = [];
  const conDefault = { workspaces: [{ id: "w", name: "W", context_root: null, default_permission_mode: "auto" }], active: "w" };
  const porDefecto = await boot("listo", "default-permission-mode", {
    ...VENTANA,
    list_workspaces: conDefault,
    workspaces_startup: conDefault,
    list_language_packs: [], list_bundled_language_packs: [],
    set_workspace_permission_mode: ({ id, mode }) => {
      defaultSaves.push([id, mode]);
      return { ...conDefault.workspaces[0], default_permission_mode: mode };
    },
  });
  const defaultDoc = porDefecto.w.document;
  const defaultModeLabel = () =>
    [...defaultDoc.querySelectorAll("[aria-label]")]
      .map((el) => el.getAttribute("aria-label"))
      .find((etiqueta) => etiqueta.startsWith("Permisos: "));
  await sleep(150);
  assert.equal(defaultModeLabel(), "Permisos: Automático", "a new task starts with the workspace default");
  defaultDoc.querySelector('[data-sesion="s1"]')?.click();
  await sleep(200);
  assert.equal(defaultModeLabel(), "Permisos: Manual", "an existing task keeps its own mode");
  defaultDoc.querySelector('button[aria-label="Nueva tarea"]').click();
  await sleep(150);
  assert.equal(defaultModeLabel(), "Permisos: Automático", "and the next new task starts with the default again");
  defaultDoc.querySelector('button[aria-label="Configuración"]')?.click();
  await sleep(150);
  defaultDoc.querySelector("#cfg-tab-preferences")?.click();
  await sleep(50);
  const defaultSelect = defaultDoc.querySelector('select[aria-label="Permisos por defecto"]');
  assert.ok(defaultSelect, "General shows the default permissions select");
  assert.equal(defaultSelect.value, "auto");
  const contextHeading = [...defaultDoc.querySelectorAll("h3")].find((h) => h.textContent.trim() === "Contexto");
  assert.ok(contextHeading, "General shows the context section");
  assert.ok(
    defaultSelect.compareDocumentPosition(contextHeading) & porDefecto.w.Node.DOCUMENT_POSITION_FOLLOWING,
    "the default permissions setting goes before the context section",
  );
  defaultSelect.value = "manual";
  defaultSelect.dispatchEvent(new porDefecto.w.Event("change", { bubbles: true }));
  await sleep(80);
  assert.deepEqual(defaultSaves, [["w", "manual"]]);
  assert.equal(defaultModeLabel(), "Permisos: Manual", "the blank box follows the new default");
  assert.deepEqual(porDefecto.fallos, []);
  porDefecto.w.close();

  // El CSS compilado debe devolver la forma que el preflight elimina.
  const PROSA = [
    "**Once arreglos: el turno sobrevive al reinicio, y lo que borra pregunta antes**",
    "https://github.com/danil-labs/harness-app/pull/787",
    "",
    "- una viñeta",
    "- otra viñeta",
    "",
    "3. primero",
    "4. segundo",
    "",
    "- [ ] pendiente",
    "- [x] hecha",
    "",
    "#### cuarto nivel",
    "",
    "##### quinto nivel",
    "",
    "###### sexto nivel",
    "",
    "> una cita",
    "",
    "| columna | otra |",
    "| --- | --- |",
    "| 1 | 2 |",
    "",
    "Con `código` dentro, algo en *cursiva* y una regla debajo.",
    "",
    "---",
    "",
    "```ts",
    "const a = 1;",
    "```",
  ].join("\n");

  const prosa = await boot("listo", "markdown-como-se-escribio", {
    ...CON_TAREA,
    load_session: {
      ...CON_TAREA.load_session,
      turns: [{ role: "assistant", text: PROSA, artifacts: [] }],
    },
  });
  const docM = prosa.w.document;
  docM.querySelector('[data-sesion="s1"]')?.click();
  await sleep(250);
  const respuesta = [...docM.querySelectorAll("article")].find((a) =>
    a.textContent.includes("Once arreglos"),
  );
  assert.ok(respuesta, "la respuesta del agente no llegó a pintarse");

  // jsdom no resuelve las capas de Tailwind; se comprueban las utilities compiladas.
  const hojaDeEstilos = readFileSync(
    join(dist, "assets", readdirSync(join(dist, "assets")).find((f) => f.startsWith("index-") && f.endsWith(".css"))),
    "utf8",
  );
  const declara = (el, propiedad) => {
    for (const clase of el?.classList ?? []) {
      const css = hojaDeEstilos.replaceAll("\\", "");
      const selector = `.${clase}`;
      const body = css.split("}").find((rule) =>
        rule.slice(0, rule.indexOf("{")).split(",").includes(selector),
      )?.split("{").at(-1);
      const regla = body?.match(new RegExp(`(?:^|;)${propiedad}:([^;]+)`));
      if (regla) return regla[1];
    }
    return null;
  };

  // El defecto que se reportó: el título y la URL de la línea siguiente,
  // pegados. En HTML ese salto vale un espacio, y el espacio tiene que estar.
  const parrafo = [...respuesta.querySelectorAll("p")].find((el) =>
    el.textContent.includes("Once arreglos"),
  );
  assert.match(
    parrafo?.textContent ?? "",
    /pregunta antes\s+https:\/\/github\.com/,
    "el salto de línea dentro de un párrafo se perdió entero, sin dejar el espacio",
  );

  const viñetas = respuesta.querySelector("ul");
  const numerada = respuesta.querySelector("ol");
  assert.equal(declara(viñetas, "list-style-type"), "disc");
  assert.equal(declara(numerada, "list-style-type"), "decimal");
  assert.equal(numerada.getAttribute("start"), "3");
  assert.equal(respuesta.querySelector("pre code").textContent, "const a = 1;\n");
  // Una lista de tareas ya trae su casilla; la viñeta de al lado sobra.
  const tarea = [...respuesta.querySelectorAll("li")].find((el) =>
    el.querySelector('input[type="checkbox"]'),
  );
  assert.equal(declara(tarea, "list-style-type"), "none");
  assert.equal(tarea?.querySelector("input")?.disabled, true);

  // El preflight iguala los seis encabezados al texto del cuerpo.
  for (const nivel of ["h4", "h5", "h6"]) {
    const titulo = respuesta.querySelector(nivel);
    assert.ok(titulo, `el markdown trae un ${nivel} y no se pintó`);
    assert.ok(declara(titulo, "font-weight"), `un ${nivel} se lee con el peso de un párrafo`);
    assert.ok(declara(titulo, "font-size"), `un ${nivel} mide igual que un párrafo`);
  }

  // Y lo demás que el preflight deja sin forma propia.
  assert.ok(declara(respuesta.querySelector("blockquote"), "border-left-width"));
  assert.ok(declara(respuesta.querySelector("hr"), "border-top-width"));
  assert.ok(declara(respuesta.querySelector("table"), "border-collapse"));
  assert.ok(declara(respuesta.querySelector("strong"), "font-weight"));
  assert.ok(declara(respuesta.querySelector("em"), "font-style"));
  assert.ok(declara(respuesta.querySelector("pre"), "overflow"));
  assert.deepEqual(prosa.fallos, []);
  prosa.w.close();

  // El visor de un diagrama se extiende a toda la ventana y vuelve: con su
  // botón y con Escape, y el foco regresa al botón que lo abrió.
  const diagrama = await boot("listo", "diagrama-en-toda-la-ventana", {
    ...CON_TAREA,
    load_session: {
      ...CON_TAREA.load_session,
      turns: [{ role: "assistant", text: "```mermaid\ngraph TD\n  A --> B\n```", artifacts: [] }],
    },
  });
  const docD = diagrama.w.document;
  docD.querySelector('[data-sesion="s1"]')?.click();
  await sleep(250);
  const extender = docD.querySelector('button[aria-label="Ver diagrama en toda la ventana"]');
  assert.ok(extender, "el diagrama no ofrece extenderse a toda la ventana");
  const capa = () => docD.querySelector('[role="dialog"][aria-modal="true"]');
  for (const cerrar of ["boton", "escape"]) {
    extender.focus();
    extender.click();
    await sleep(50);
    assert.ok(capa(), "extender no abrió la capa");
    assert.ok(capa().classList.contains("fixed") && capa().classList.contains("inset-0"), "la capa no cubre la ventana");
    assert.ok(capa().contains(docD.activeElement), "el foco se quedó detrás de la capa");
    if (cerrar === "boton") {
      capa().querySelector('button[aria-label="Salir de la vista en toda la ventana"]').click();
    } else {
      docD.activeElement.dispatchEvent(new diagrama.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    }
    await sleep(50);
    assert.equal(capa(), null, `cerrar con ${cerrar} dejó la capa puesta`);
    assert.equal(docD.activeElement, extender, `cerrar con ${cerrar} no devolvió el foco`);
  }
  assert.deepEqual(diagrama.fallos, []);
  diagrama.w.close();

  let activos = ["s1"];
  let esperandoHija = true;
  const fondo = await boot("listo", "hija-en-segundo-plano", {
    ...CON_TAREA,
    list_projects: [{ id: "p", name: "Proyecto", kind: "folder", working_directory: "/lab", sources: [] }],
    list_live_sessions: () => [task("s1", null, null)],
    load_session: ({ id }) => ({ ...CON_TAREA.load_session, id, turns: [] }),
    list_live_turns: () => activos.map((session) => ({
      session, workspace: "w", project: "p",
      started_at: Date.now() - 3_640_000, background: esperandoHija,
    })),
    list_active_turns: () => activos,
  });
  const docFondo = fondo.w.document;
  const estadoDelTurno = () => docFondo.querySelector('[role="status"]');
  const rotulo = () => estadoDelTurno()?.getAttribute("aria-label") ?? null;
  const late = () => (estadoDelTurno()?.querySelector('span[aria-hidden="true"]')?.className ?? "").includes("danil-pulse");
  const reconciliar = async () => { fondo.w.dispatchEvent(new fondo.w.Event("focus")); await sleep(400); };
  docFondo.querySelector('[data-sesion="s1"]').click();
  await sleep(350);
  assert.equal(
    rotulo(), "Libre · un subagente sigue en segundo plano",
    "una ventana que no vio el evento `background` da por pensando a un agente parado",
  );
  assert.equal(late(), false, "la espera de una hija no lleva el punto que late");
  assert.doesNotMatch(
    estadoDelTurno().textContent, /60m/,
    "el reloj del turno del padre no mide la espera de su hija",
  );
  // El agente vuelve a escribir: la señal se apaga por donde se encendió.
  esperandoHija = false;
  await reconciliar();
  assert.equal(rotulo(), "El agente está trabajando", "con el agente escribiendo vuelve el rótulo de pensar");
  assert.ok(late(), "y con él su punto");
  assert.match(estadoDelTurno().textContent, /60m/, "y su reloj, que sí es del turno que se mira");
  // Y la señal no sobrevive al turno: el que cierra sin que su `done` llegue a
  // esta ventana —un servicio que se releva— dejaba el rótulo de la hija puesto,
  // y el turno siguiente, sin hija ninguna, decía que el agente estaba libre.
  esperandoHija = true;
  await reconciliar();
  assert.equal(rotulo(), "Libre · un subagente sigue en segundo plano");
  activos = [];
  await reconciliar();
  assert.equal(rotulo(), null, "el turno cerrado no pinta estado");
  activos = ["s1"];
  esperandoHija = false;
  fondo.emit("chat", { kind: "started", session: "s1", workspace: "w" });
  await sleep(250);
  assert.equal(rotulo(), "El agente está trabajando", "el turno nuevo no hereda la espera del anterior");
  assert.deepEqual(fondo.fallos, []);
  fondo.w.close();

  // Un primer turno que Rust niega deja su aviso en el blanco, y solo ahí: la
  // tarea nueva siguiente, de este proyecto o de otro, sale limpia.
  const unstarted = await bootPorCarpeta("listo", "first-turn-rejected", {
    ...RESPUESTAS,
    // Una tarea por carpeta: sin tareas una carpeta no tiene cabecera en el riel.
    list_live_sessions: ({ project }) => project ? [{ ...CON_TAREA.list_live_sessions[0], id: `t-${project}` }] : [],
    list_projects: [
      { id: "vm", name: "VM", kind: "folder", working_directory: "/vm", sources: [] },
      { id: "calc", name: "calc", kind: "folder", working_directory: "/calc", sources: [] },
    ],
    load_queue: [],
    send_message: () => Promise.reject("chat.context.cleanup_failed"),
  });
  const unstartedDoc = unstarted.w.document;
  const ghost = () => unstartedDoc.body.textContent.includes("No se pudo retirar una copia obsoleta");
  const rejectedPrompt = "Crea un archivo hola2.txt que diga hola";
  unstartedDoc.querySelector('button[aria-label="Nueva tarea en VM"]').click();
  await sleep(100);
  const firstPrompt = unstartedDoc.querySelector("textarea");
  firstPrompt.value = rejectedPrompt;
  firstPrompt.dispatchEvent(new unstarted.w.Event("input", { bubbles: true }));
  firstPrompt.closest("form").dispatchEvent(new unstarted.w.Event("submit", { bubbles: true, cancelable: true }));
  await sleep(150);
  assert.ok(ghost(), "the rejection is said where it happened");
  assert.equal(unstartedDoc.querySelector("textarea").value, rejectedPrompt, "the text comes back to retry");
  assert.equal(unstartedDoc.querySelector("[data-sesion]:not([data-sesion^=\"t-\"])"), null, "no row is left for a task that was not created");
  unstarted.w.dispatchEvent(new unstarted.w.KeyboardEvent("keydown", { key: "t", ctrlKey: true, metaKey: true, bubbles: true }));
  await sleep(150);
  assert.equal(ghost(), false, "a new task after a rejected first turn starts clean");
  unstartedDoc.querySelector('button[aria-label="Nueva tarea en calc"]').click();
  await sleep(150);
  assert.equal(ghost(), false, "and so does one in another project");
  assert.equal(unstartedDoc.body.textContent.includes(rejectedPrompt), false);
  assert.deepEqual(unstarted.fallos, []);

  unstarted.w.close();

  for (const settings of [true, false]) {
    for (const available of [true, false]) {
      let latest = { rid: 276, currentVersion: "0.2.76", version: "0.2.77", rawJson: {} };
      const installed = [];
      let checks = 0;
      let finishDownload;
      const updater = await boot("listo", `update-latest-${settings}-${available}`, {
        ...RESPUESTAS,
        "plugin:updater|check": () => { checks++; return latest; },
        // Rust vuelve a preguntar y baja la última; en Windows el plugin cerraría la app.
        update_install: () => {
          installed.push(latest.rid);
          return new Promise(resolve => { finishDownload = resolve; });
        },
        service_prepare_update: null,
        service_cancel_update: null,
        list_language_packs: [],
        list_bundled_language_packs: [],
        "plugin:app|version": "0.2.76",
      });
      const doc = updater.w.document;
      if (settings) {
        [...doc.querySelectorAll("button")].find(b => b.textContent.trim() === "Ahora no").click();
        doc.querySelector('button[aria-label="Configuraci\u00f3n"]').click();
        await sleep(100);
        doc.querySelector("#cfg-tab-machines").click();
        await sleep(50);
        doc.querySelector("#cfg-sub-entorno").click();
        await sleep(100);
      }
      latest = available ? { ...latest, rid: 278, version: "0.2.78" } : null;
      const install = [...doc.querySelectorAll("button")].find(b => b.textContent.trim() === "Actualizar");
      assert.ok(install, `update action is visible (settings=${settings})`);
      install.click();
      await sleep(100);
      if (available) {
        latest = { ...latest, rid: 279, version: "0.2.79" };
        const before = checks;
        const clock = Date.now;
        Date.now = () => clock() + 31 * 60 * 1000;
        try {
          updater.w.dispatchEvent(new updater.w.Event("focus"));
          await sleep(20);
          if (!settings) assert.equal(checks, before, "downloading skips background checks");
          assert.ok(doc.body.textContent.includes("0.2.78"), "downloading keeps the selected release");
        } finally { Date.now = clock; }
        finishDownload();
        await sleep(20);
      }
      assert.deepEqual(installed, available ? [278] : [], `installs the latest release (settings=${settings})`);
      assert.ok(doc.body.textContent.includes(available ? "0.2.78" : "Tienes la versi\u00f3n m\u00e1s reciente."), "shows the latest check result");
      if (available) {
        const before = checks;
        const clock = Date.now;
        Date.now = () => clock() + 31 * 60 * 1000;
        try {
          updater.w.dispatchEvent(new updater.w.Event("focus"));
          doc.dispatchEvent(new updater.w.Event("visibilitychange"));
          await sleep(20);
          if (!settings) assert.equal(checks, before, "ready to restart skips background checks");
          assert.ok(doc.body.textContent.includes("0.2.78"), "ready to restart keeps the installed version");
          assert.deepEqual(installed, [278], "does not chain downloads");
        } finally { Date.now = clock; }
      }
      assert.deepEqual(updater.fallos, []);
      updater.w.close();
    }
  }

  let release = { rid: 277, currentVersion: "0.2.76", version: "0.2.77", rawJson: {} };
  let checks = 0;
  let resolveCheck;
  const notice = await boot("listo", "update-focus", {
    ...RESPUESTAS,
    "plugin:updater|check": () => { checks++; return release; },
  });
  const clock = Date.now;
  let elapsed = 0;
  Date.now = () => clock() + elapsed;
  try {
    const doc = notice.w.document;
    const focus = () => notice.w.dispatchEvent(new notice.w.Event("focus"));
    focus();
    await sleep(20);
    assert.equal(checks, 1, "focus within ten minutes does not check again");
    [...doc.querySelectorAll("button")].find(b => b.textContent.trim() === "Ahora no").click();
    elapsed = 11 * 60 * 1000;
    focus();
    await sleep(20);
    assert.ok(!doc.body.textContent.includes("Hay una versi\u00f3n nueva:"), "dismissed version stays hidden");
    elapsed += 11 * 60 * 1000;
    release = new Promise(resolve => { resolveCheck = resolve; });
    focus();
    doc.dispatchEvent(new notice.w.Event("visibilitychange"));
    await sleep(20);
    assert.equal(checks, 3, "focus and visibility share the pending check");
    resolveCheck({ rid: 278, currentVersion: "0.2.76", version: "0.2.78", rawJson: {} });
    await sleep(20);
    assert.ok(doc.body.textContent.includes("Hay una versi\u00f3n nueva: 0.2.78"), "a newer version is announced");
  } finally {
    Date.now = clock;
    notice.w.close();
  }

  await spaceScenarios({ boot: bootPorCarpeta, sleep, CON_TAREA });

  console.log(`El front monta — ${normal.pintado.length} bytes en #root, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(0);
}

/**
 * Segunda pasada: **hacer que el error salga.**
 *
 * La primera dice que no montó y no puede decir por qué, porque la excepción
 * murió dentro del `try` de `Setup`. Entrando por el botón «Entrar de todos
 * modos» el render ocurre dentro de un manejador de evento, y de ahí la
 * excepción sí llega a `window.onerror` con su mensaje.
 */
const manual = await boot("falta", 3);
const entrar = [...manual.w.document.querySelectorAll(".setup-actions button")].at(-1);
if (entrar) {
  entrar.dispatchEvent(new manual.w.MouseEvent("click", { bubbles: true }));
  await sleep(500);
}

console.error("\n  El front no monta. `App` no llegó a pintarse.\n");
const lanzado = [...manual.fallos, ...normal.fallos];
if (lanzado.length) {
  console.error("  Lo que lanzó al primer render:\n");
  for (const f of lanzado.slice(0, 3)) {
    for (const l of String(f).split("\n").slice(0, 6)) console.error(`      ${l}`);
    console.error("");
  }
} else {
  console.error("  Y nada lanzó a la vista. Corre `pnpm desktop:dev` y mira la consola.\n");
}
console.error(
  "  El empaquetado está minificado, así que el rastro no nombra archivos.\n" +
    "  Para verlo con nombres: `pnpm exec vite build --sourcemap` y repetir.\n",
);
process.exit(1);
