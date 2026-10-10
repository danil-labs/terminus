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
import { arrancar as montar, causa, dist, espera } from "./jsdom-app.mjs";
import { spaceScenarios } from "./mount-spaces.mjs";

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
  // La compuerta del primer pintado. `false` monta la app sin esperar nada.
  setup_required: false,
  list_agents: [
    { id: "claude", label: "Claude Code", available: true, driver: true },
    { id: "codex", label: "Codex", available: true, driver: true },
  ],
  list_workspaces: { workspaces: [{ id: "w", name: "W", context_root: null }], active: "w" },
  workspaces_startup: { workspaces: [{ id: "w", name: "W", context_root: null }], active: "w" },
  list_projects: [],
  list_sources: [],
  list_live_sessions: [],
  list_mentions: { fuentes: [], archivos: [] },
  list_models: {
    agent: "codex",
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
    { id: "claude", agent: "claude", label: "Claude Code", catalogo: "todo", usable: false, marca: "sin conectar", porque: "Falta conectar la cuenta." },
    { id: "codex", agent: "codex", label: "Codex", catalogo: "todo", usable: true, marca: null, porque: null },
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
      agent: "codex",
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
    agent: "codex",
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
  list_models: { agent: "claude", models: [], fallback: false },
  list_surfaces: [RESPUESTAS.list_surfaces[0]],
};

const arrancar = (entorno, version, respuestas = RESPUESTAS, userAgent) =>
  montar(entorno, version, respuestas, userAgent);

/**
 * **El esqueleto de `Setup` es el síntoma exacto**, no una pantalla más.
 *
 * Cuando el primer render de `App` lanza, la excepción sube por el `setEnv` de
 * `Setup.revisar`, la traga su `try`, y el árbol se queda a medias en el
 * `Skeleton` que ya estaba pintado. Eso es lo que se vio en producción: tres
 * barras grises y ni un error.
 */
const enElEsqueleto = (html) => html.includes("setup-card") && html.includes("aria-busy");

const t0 = Date.now();
const normal = await arrancar("listo", 1);

const roto = normal.fallos.length > 0 || !normal.pintado.trim() || enElEsqueleto(normal.pintado);

if (!roto) {
  await espera(1600);
  const storage = normal.w.document.querySelector('button[aria-label^="Archivos del espacio:"]');
  if (normal.storageQueries.join(",") !== "false,true" || !storage?.textContent?.includes("1.0 GB")) {
    console.error("El contador de almacenamiento debe sustituir la caché antigua sin abrir el panel.");
    process.exit(1);
  }
  // Y una sola vez. El barrido recorre `node_modules` y `target` de cada tarea:
  // repetirlo con el panel cerrado costó 2 h 43 de disco en un log de 4 h 43.
  normal.emit("harness:turno-cerrado", {});
  normal.emit("harness:turn", 0);
  normal.w.dispatchEvent(new normal.w.Event("focus"));
  await espera(1800);
  if (normal.storageQueries.join(",") !== "false,true") {
    console.error(
      `Con el panel cerrado no se vuelve a barrer el disco: ${normal.storageQueries.join(",")}.`,
    );
    process.exit(1);
  }
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
  await espera(50);
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
  await espera(10);
  normal.w.document.querySelector('button[aria-label="Preguntar"]')?.click();
  await espera(100);
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
  await espera(50);
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
  await espera(50);
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
  await espera(50);

  /**
   * Abre la tercera columna para ejecutar también su render. Con la tarea ya
   * empezada el conmutador debe estar habilitado; sin tarea no hay carpeta de
   * trabajo que enseñar.
   */
  const arbol = normal.w.document.querySelector(
    'button[aria-label="Ver el árbol de trabajo"]',
  );
  if (!arbol || arbol.hasAttribute("disabled")) {
    console.error(
      `Con una tarea abierta no se puede abrir la columna del árbol de trabajo: presente=${!!arbol}, deshabilitado=${arbol?.hasAttribute("disabled")}.`,
    );
    process.exit(1);
  }
  arbol.click();
  await espera(100);
  const tirador = normal.w.document.querySelector(
    '[role="separator"][aria-label="Ancho del árbol de trabajo"]',
  );
  const cerrar = normal.w.document.querySelector(
    'button[aria-label="Cerrar el árbol de trabajo"]',
  );
  if (!tirador || !cerrar || normal.fallos.length > 0) {
    console.error(
      `La columna del árbol de trabajo no montó: tirador=${!!tirador}, conmutador=${!!cerrar}.`,
    );
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
  const semaforo = await arrancar(
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
    [...semaforo.w.document.querySelectorAll('button[aria-label="Cerrar Terminus"]')]
      .filter((boton) => !boton.closest('[style*="width: 0px"]')).length;
  // El tirador es lo único que distingue abierta de cerrada: la cabecera de la
  // columna sigue en el documento colapsada, y su botón de cerrar con ella.
  const columnaAbierta = () =>
    Boolean(
      semaforo.w.document.querySelector(
        '[role="separator"][aria-label="Ancho del árbol de trabajo"]',
      ),
    );
  assert.equal(columnaAbierta(), false, "la columna nace cerrada");
  assert.equal(semaforos(), 1, "con la columna cerrada el semáforo es el del chasis");
  semaforo.w.document.querySelector('[data-sesion="s1"]').click();
  await espera(150);
  semaforo.w.document.querySelector('[aria-label="Ver el árbol de trabajo"]').click();
  await espera(150);
  assert.equal(columnaAbierta(), true, "el conmutador tiene que abrir la columna");
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
      return { paths: externalPaths, folders: [], truncated: false };
    },
    tree_git_status: [],
    tree_summary: { base: "HEAD", files: [], added: 0, removed: 0 },
  };
  const treeApp = await arrancar("listo", "tree-persistence", treeResponses);
  const treeDocument = treeApp.w.document;
  const clickTree = (selector) => {
    const element = treeDocument.querySelector(selector);
    assert.ok(element, selector);
    element.click();
  };
  clickTree('[data-sesion="s1"]');
  await espera(150);
  clickTree('[aria-label="Ver el árbol de trabajo"]');
  await espera(150);
  const directory = [...treeDocument.querySelectorAll('button[aria-expanded]')].find((button) => button.textContent.trim() === "src");
  assert.ok(directory);
  directory.click();
  assert.deepEqual(treeReads, ["s1"]);
  clickTree('[data-sesion="s2"]');
  await espera(150);
  clickTree('[role="tab"][data-pestana="0"]');
  await espera(150);
  assert.deepEqual(treeReads, ["s1", "s2"], "switching tabs must reuse the loaded tree");
  assert.equal(directory.isConnected, true);
  assert.equal(directory.getAttribute("aria-expanded"), "true");
  clickTree('[aria-label="Cerrar el árbol de trabajo"]');
  clickTree('[aria-label="Ver el árbol de trabajo"]');
  await espera(150);
  assert.deepEqual(treeReads, ["s1", "s2"], "reopening the column must reuse the tree");
  treeApp.w.dispatchEvent(new treeApp.w.CustomEvent("harness:arboles", { detail: { session: "s2" } }));
  await espera(100);
  assert.deepEqual(treeReads, ["s1", "s2"], "hidden trees defer changes");
  clickTree('[role="tab"][data-pestana="1"]');
  await espera(150);
  assert.deepEqual(treeReads, ["s1", "s2", "s2"], "changed trees refresh when shown");
  treeApp.w.dispatchEvent(new treeApp.w.CustomEvent("harness:copia"));
  await espera(150);
  assert.deepEqual(treeReads, ["s1", "s2", "s2", "s2"], "saving refreshes only the visible tree once");
  treeDocument.querySelector('[role="tab"][data-pestana="0"]').dispatchEvent(new treeApp.w.KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
  await espera(100);
  assert.equal(directory.isConnected, false, "closing a task releases its tree");
  assert.equal(watchedTrees.has("s1"), false, "closing the task releases its filesystem watcher");
  externalPaths = ["src/example.ts", "testsync.md"];
  watchedTrees.get("s2").onmessage();
  await espera(850);
  assert.ok([...treeDocument.querySelectorAll("button")].some((button) => button.textContent.trim() === "testsync.md"));
  externalPaths = ["src/example.ts"];
  watchedTrees.get("s2").onmessage();
  await espera(850);
  assert.equal([...treeDocument.querySelectorAll("button")].some((button) => button.textContent.trim() === "testsync.md"), false);

  assert.equal(treeApp.fallos.length, 0);
  treeApp.w.close();

  const filaDeAgente = {
    agent: "codex", model: "gpt-5.6", refs: [], created_at: 0, updated_at: 0, turns: 1,
    parent: null, subagent: null, esperando: false, stage: null,
    encargado: "Holmes", encargado_del_padre: null, last_message: "Listo.",
  };
  const awakeModes = [];
  const profileSaves = [];
  const bubbleResponses = {
    ...CON_TAREA,
    list_projects: [{ id: "p", name: "Proyecto", node: null, sources: [] }],
    list_live_sessions: [
      { ...filaDeAgente, id: "s-chat", title: "Holmes", chat_de_agente: true },
      { ...filaDeAgente, id: "s-task", title: "Una tarea", chat_de_agente: false },
      { ...filaDeAgente, id: "s-plain", title: "Tarea suelta", encargado: null, chat_de_agente: false },
    ],
    list_encargados: {
      encargados: [{
        name: "Holmes", description: "", instructions: "", tools: [], model: null,
        origin: ".danil/agents/holmes.md", folder: null, agents: ["codex"], own: false, own_scope: null,
      }],
      rechazados: [],
    },
    list_encargado_status: [{ name: "Holmes", status: "awake", minutes_since_last_turn: 1, live_tasks: 0 }],
    list_agent_profiles: {},
    keep_awake_status: { mode: "agent", active: false, supported: true },
    save_agent_profile: (args) => {
      profileSaves.push(args);
      return { display_name: args.displayName, body: args.body, background: null, avatar: null, veil: args.veil, agent: null, model: null, effort: null, hidden: false };
    },
    set_keep_awake: ({ mode }) => {
      awakeModes.push(mode);
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
        { role: "agent", text: "Voy bien.", duration_ms: 1200, author: { kind: "codex", name: null, verified_by: null, account: null }, provider: "Codex", model: "gpt-5.6", tools: id === "s-chat" ? [
          { name: "mcp__canvas__draw", ok: true, mcp_app: { server: "canvas", tool: "draw", result: { content: [] } } },
          { name: "mcp__canvas__lookup", ok: true, mcp_app: { server: "canvas", tool: "lookup", result: { content: [] } } },
          { name: "atlassian·getConfluencePage", ok: true, mcp_app: { server: "atlassian", tool: "getConfluencePage", result: { content: [] } } },
        ] : [] },
        ...(id === "s-task" ? [
          { role: "user", text: "Continúa con Claude." },
          { role: "agent", text: "Listo tras el traspaso.", author: { kind: "claude", name: null, verified_by: null, account: null }, provider: "Claude Code", model: "claude-sonnet-5" },
        ] : []),
      ],
    }),
  };
  const bubbleApp = await arrancar("listo", "agent-bubble", {
    ...bubbleResponses,
    list_live_sessions: [
      ...bubbleResponses.list_live_sessions,
      { ...filaDeAgente, id: "s-transfer", title: "Revisar entrega", encargado: "Watson", chat_de_agente: false },
    ],
    list_encargados: { ...bubbleResponses.list_encargados, encargados: [
      { ...bubbleResponses.list_encargados.encargados[0], own: true },
      { ...bubbleResponses.list_encargados.encargados[0], name: "Watson", own: true },
    ] },
    telegram_status: { token_saved: false, bot_username: null, enabled: false, paired_chats: 0, pairing: null, topics_enabled: false, topics: 0 },
    queue_ready: false,
    load_queue: ({ session }) => session === "s-chat" ? [{
      id: "compact-queue", text: "Mensaje pendiente", agent: "codex", model: null,
      effort: null, permission_mode: null, attachments: [],
    }] : [],
  });
  const bubbleDocument = bubbleApp.w.document;
  await espera(80);
  let filaDelAgente = [...bubbleDocument.querySelectorAll("li > div[aria-label]")].find((fila) =>
    fila.getAttribute("aria-label").startsWith("Holmes"),
  );
  assert.ok(filaDelAgente, "el riel no lista al encargado: sin su fila no hay chat que abrir");
  const controlDelAvatar = filaDelAgente.querySelector("button");
  assert.ok(controlDelAvatar.className.includes("size-6"), "el avatar conserva un área de clic de 24 px, el mínimo");
  assert.equal(controlDelAvatar.querySelector(".astro-face svg, .astro-face img")?.getAttribute("width"), "20", "solo el avatar del riel baja a 20 px");

  // Doble clic en el nombre lo cambia en la fila; Escape deja el que había.
  const nombreEnElRiel = () => [...filaDelAgente.querySelectorAll("button")].find((b) => b.textContent.trim() === "Holmes");
  const campoDelAgente = () => filaDelAgente.querySelector("[data-agent-rename] input");
  nombreEnElRiel().dispatchEvent(new bubbleApp.w.MouseEvent("dblclick", { bubbles: true }));
  await espera(50);
  assert.ok(campoDelAgente(), "doble clic en el agente abre su nombre para editarlo");
  campoDelAgente().dispatchEvent(new bubbleApp.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await espera(50);
  assert.equal(campoDelAgente(), null);
  assert.equal(profileSaves.length, 0, "Escape no guarda nada");
  nombreEnElRiel().dispatchEvent(new bubbleApp.w.MouseEvent("dblclick", { bubbles: true }));
  await espera(50);
  campoDelAgente().value = "Sherlock";
  campoDelAgente().dispatchEvent(new bubbleApp.w.Event("input", { bubbles: true }));
  campoDelAgente().closest("form").dispatchEvent(new bubbleApp.w.Event("submit", { bubbles: true, cancelable: true }));
  await espera(80);
  assert.deepEqual(profileSaves.map((p) => [p.name, p.displayName]), [["Holmes", "Sherlock"]], "Enter guarda el nombre visible y no toca la clave del agente");

  // La búsqueda del sidebar también encuentra tareas por agente.
  const filasDelRiel = () => [...bubbleDocument.querySelectorAll('[data-project-sessions="p"] [data-sidebar-tasks] [data-sesion]')].map((f) => f.dataset.sesion);
  assert.ok(bubbleDocument.querySelector('[data-sidebar-tasks] [data-sesion="s-task"] [data-session-agent]'), "sin agrupar, la tarea lleva la pastilla de su agente");
  bubbleDocument.querySelector('button[aria-label="Buscar tareas o agentes"]').click();
  await espera(50);
  const buscadorDelRiel = bubbleDocument.querySelector('[data-sidebar-search] input[role="searchbox"]');
  assert.ok(buscadorDelRiel, "la lupa abre el buscador bajo los controles del sidebar");
  buscadorDelRiel.value = "REVISAR";
  buscadorDelRiel.dispatchEvent(new bubbleApp.w.Event("input", { bubbles: true }));
  await espera(80);
  assert.deepEqual(filasDelRiel(), ["s-transfer"], "busca sin importar mayúsculas");
  assert.match(bubbleDocument.querySelector('[data-project-sessions="p"] [data-search-results]').textContent, /1 resultado/);
  buscadorDelRiel.value = "watson";
  buscadorDelRiel.dispatchEvent(new bubbleApp.w.Event("input", { bubbles: true }));
  await espera(80);
  assert.deepEqual(filasDelRiel(), ["s-transfer"], "encuentra la tarea por el nombre de su agente");
  buscadorDelRiel.value = "Holmes";
  buscadorDelRiel.dispatchEvent(new bubbleApp.w.Event("input", { bubbles: true }));
  await espera(80);
  assert.ok([...bubbleDocument.querySelectorAll('[data-sidebar-agents] li > div[aria-label]')].some(fila => fila.getAttribute("aria-label").startsWith("Holmes")), "la búsqueda incluye los agentes");
  const folderToggleForSearch = bubbleDocument.querySelector('[data-destino="p"] button[aria-expanded]');
  folderToggleForSearch.click();
  buscadorDelRiel.value = "";
  buscadorDelRiel.dispatchEvent(new bubbleApp.w.Event("input", { bubbles: true }));
  await espera(80);
  assert.equal(bubbleDocument.querySelector('[data-project-sessions="p"]'), null, "la carpeta conserva su plegado fuera de la búsqueda");
  buscadorDelRiel.value = "REVISAR";
  buscadorDelRiel.dispatchEvent(new bubbleApp.w.Event("input", { bubbles: true }));
  await espera(80);
  assert.deepEqual(filasDelRiel(), ["s-transfer"], "buscar alcanza las tareas de una carpeta plegada");
  buscadorDelRiel.dispatchEvent(new bubbleApp.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await espera(80);
  assert.equal(bubbleDocument.querySelector('[data-sidebar-search] input[role="searchbox"]'), null, "Escape cierra el buscador");
  assert.equal(bubbleDocument.querySelector('[data-project-sessions="p"]'), null, "cerrar la búsqueda restaura la carpeta plegada");
  folderToggleForSearch.click();
  await espera(80);
  assert.ok(filasDelRiel().includes("s-task") && filasDelRiel().includes("s-plain"), "cerrar la búsqueda devuelve la lista entera");

  filaDelAgente = [...bubbleDocument.querySelectorAll("li > div[aria-label]")].find(fila => fila.getAttribute("aria-label").startsWith("Holmes"));

  // ⋮ abre un menú, no el perfil ni el chat, y el reposo se cambia y se deshace.
  const itemDeMenu = (texto) => [...bubbleDocument.querySelectorAll('[role="menu"] [role^="menuitem"]')]
    .find((item) => item.textContent.includes(texto));
  filaDelAgente.querySelector('[aria-label="Opciones de Holmes"]').click();
  await espera(80);
  assert.ok(itemDeMenu("Configuración del agente"), "⋮ abre el menú con la configuración");
  assert.equal(bubbleApp.comandos.includes("send_message"), false, "⋮ no abre el chat del agente");
  const reposo = itemDeMenu("Mantener despierta la computadora");
  assert.match(reposo.textContent, /Con agentes/, "el menú enseña el modo de ahora");
  reposo.click();
  await espera(80);
  itemDeMenu("Siempre").click();
  await espera(80);
  assert.deepEqual(awakeModes, ["on"]);
  assert.equal(bubbleDocument.querySelector('[role="menu"]'), null, "elegir un modo cierra el menú");
  filaDelAgente.querySelector('[aria-label="Opciones de Holmes"]').click();
  await espera(80);
  assert.match(itemDeMenu("Mantener despierta la computadora").textContent, /Siempre/);
  itemDeMenu("Mantener despierta la computadora").click();
  await espera(80);
  itemDeMenu("Con agentes").click();
  await espera(80);
  assert.deepEqual(awakeModes, ["on", "agent"], "el modo se puede quitar desde el mismo menú");
  filaDelAgente.querySelector('[aria-label="Opciones de Holmes"]').click();
  await espera(80);
  itemDeMenu("Configuración del agente").click();
  await espera(150);
  assert.equal(bubbleApp.comandos.filter((c) => c === "send_message").length, 0, "Configuración abre el perfil sin crear chat");
  assert.equal(bubbleDocument.querySelector('[role="menu"]'), null);
  const volverDelPerfil = bubbleDocument.querySelector('button[aria-label="Volver a la conversación"]');
  assert.ok(volverDelPerfil, "la configuración del riel abre AgentProfile, no un perfil reducido");
  const perfilCompleto = volverDelPerfil.parentElement.parentElement;
  for (const seccion of ["Perfil del agente", "Modelo", "Cara", "Fondo de la conversación", "Instrucciones", "Telegram"])
    assert.ok(perfilCompleto.textContent.includes(seccion), `falta ${seccion} en el perfil abierto desde el riel`);
  assert.ok(perfilCompleto.querySelector('button[aria-label="La que sale de su nombre"]'), "el perfil conserva la edición de la cara");
  assert.ok([...perfilCompleto.querySelectorAll("button")].some(button => button.textContent.includes("Elegir imagen")), "el perfil conserva la edición del fondo");
  assert.ok(perfilCompleto.querySelector("textarea"), "las instrucciones del agente propio siguen editables");
  assert.ok(perfilCompleto.querySelector('input[aria-label="Token del bot"]'), "Telegram conserva la configuración del bot");
  volverDelPerfil.click();
  await espera(80);

  bubbleDocument.querySelector('[data-sidebar-tasks] [data-sesion="s-chat"]').click();
  await espera(300);
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
    await espera(50);
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
  await espera(100);
  const queueEditor = queueList.querySelector("textarea");
  assert.equal(queueEditor?.value, "Mensaje pendiente", "editar conserva el texto completo");
  queueEditor.dispatchEvent(new bubbleApp.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await espera(50);
  bubbleDocument
    .querySelector('[role="tab"][data-pestana="0"]')
    .dispatchEvent(new bubbleApp.w.KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
  await espera(150);
  bubbleDocument.querySelector('[data-sesion="s-task"]').click();
  await espera(300);
  assert.equal(globos().length, 0, "la tarea con arquetipo conserva las respuestas sin globo");
  const modelos = [...bubbleDocument.querySelectorAll('span[aria-label="Proveedor"]')].map((el) => el.textContent ?? "");
  assert.deepEqual(modelos, ["GPT-5.6", "Claude Sonnet 5"], "cada respuesta lleva el logo del agente y el modelo con su versión, incluido el traspaso");
  assert.equal(
    bubbleDocument.querySelector("[data-answer-author]"),
    null,
    "el nombre del agente ya no firma la respuesta por encima",
  );
  assert.ok(bubbleDocument.querySelector(".bg-chat-user"), "el input de la persona lleva el tinte de marca en la tarea");
  const tabDeLaTarea = [...bubbleDocument.querySelectorAll('[role="tab"]')].find(tab => tab.textContent.includes("Una tarea"));
  assert.ok(tabDeLaTarea, "el título de la tarea distingue sus pestañas");
  assert.match(tabDeLaTarea.title, /^Una tarea(?: ·|$)/, "el título de la tarea manda también en la descripción de la pestaña");
  const avatarDelTab = tabDeLaTarea.querySelector(".astro-face");
  assert.equal(avatarDelTab?.querySelector("svg")?.dataset.astroStatus, "awake", "el avatar de la pestaña es estático");
  assert.equal(avatarDelTab?.dataset.astroWorking, undefined, "el tab no anima un trabajo ajeno");
  assert.ok(!avatarDelTab?.querySelector("svg")?.classList.contains("opacity-[0.62]"), "el tab no atenúa al agente dormido");
  assert.match(bubbleDocument.querySelector("header.bg-transparent")?.textContent ?? "", /Holmes/, "la cabecera conserva la identidad del agente");
  tabDeLaTarea.dispatchEvent(new bubbleApp.w.KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
  await espera(150);
  bubbleDocument.querySelector('[data-sesion="s-plain"]').click();
  await espera(300);
  assert.equal(globos().length, 0, "una tarea sin arquetipo conserva su salida sin globos");
  assert.ok(bubbleDocument.querySelector(".bg-chat-user"), "la tarea sin arquetipo pinta igual el input de la persona");
  bubbleDocument.querySelector('[data-sesion="s-transfer"]').click();
  await espera(300);
  const tabTransferida = [...bubbleDocument.querySelectorAll('[role="tab"]')].find(tab => tab.textContent.includes("Revisar entrega"));
  assert.ok(tabTransferida, "la tarea recibida conserva su título al cambiar de responsable");
  assert.match(tabTransferida.title, /^Revisar entrega(?: ·|$)/);
  assert.equal(tabTransferida.querySelector(".astro-face")?.getAttribute("data-astro-working"), null);
  const cabeceraTransferida = bubbleDocument.querySelector("header.bg-transparent");
  assert.equal(bubbleDocument.querySelectorAll("header.bg-transparent").length, 1, "la tarea tiene una sola cabecera");
  assert.match(cabeceraTransferida.textContent, /Watson/, "la cabecera enseña al responsable de la nueva ejecución");
  cabeceraTransferida.querySelector("button").click();
  await espera(150);
  assert.match(bubbleDocument.querySelector('button[aria-label="Volver a la conversación"]')?.parentElement.parentElement.textContent ?? "", /Watson/, "la cabecera abre el perfil del responsable actual");
  assert.deepEqual(bubbleApp.fallos, []);
  bubbleApp.w.close();

  const agentSends = [];
  const draftApp = await arrancar("listo", "agent-task-draft", {
    ...bubbleResponses,
    list_projects: [{ id: "p", name: "Proyecto", kind: "folder", working_directory: "/lab", sources: [] }],
    list_encargados: { ...bubbleResponses.list_encargados, encargados: [
      { ...bubbleResponses.list_encargados.encargados[0], description: "Revisa cambios del proyecto." },
      { ...bubbleResponses.list_encargados.encargados[0], name: "Watson" },
    ] },
    list_encargado_status: [{ name: "Holmes", status: "asleep", minutes_since_last_turn: 90, live_tasks: 0 }],
    send_message: args => { agentSends.push(args); return "new-agent-task"; },
  });
  const draftDoc = draftApp.w.document;
  await espera(80);
  [...draftDoc.querySelectorAll('[data-sidebar-agents] button')].find(button => button.textContent.trim() === "Holmes").click();
  await espera(100);
  assert.match(draftDoc.querySelector("h1")?.textContent ?? "", /Holmes/);
  assert.equal(draftDoc.querySelector("h1")?.closest("header")?.querySelector("[data-astro-status]")?.dataset.astroStatus, "awake", "a new agent task opens with the agent awake and without the pulse");
  assert.match(draftDoc.body.textContent, /Revisa cambios del proyecto/);
  assert.match(draftDoc.querySelector("textarea")?.closest("[data-agent-page]")?.textContent ?? "", /Proyecto/, "the agent draft shows which project it writes in");
  assert.equal(draftDoc.querySelector('button[aria-label="Proyecto"]'), null, "an agent chat does not let the project change");
  assert.equal(draftDoc.querySelector('button[aria-label="Rama base"]'), null, "una carpeta kn no ofrece ramas");
  const draftField = draftDoc.querySelector("textarea");
  draftField.value = "Revisa el cambio de login";
  draftField.dispatchEvent(new draftApp.w.Event("input", { bubbles: true }));
  [...draftDoc.querySelectorAll('[data-sidebar-agents] button')].find(button => button.textContent.trim() === "Watson").click();
  await espera(100);
  assert.equal(draftDoc.querySelector("textarea").value, "", "Watson no recibe el borrador sin enviar de Holmes");
  const watsonField = draftDoc.querySelector("textarea");
  watsonField.value = "Documenta el despliegue";
  watsonField.dispatchEvent(new draftApp.w.Event("input", { bubbles: true }));
  [...draftDoc.querySelectorAll('[data-sidebar-agents] button')].find(button => button.textContent.trim() === "Holmes").click();
  await espera(100);
  assert.equal(draftDoc.querySelector("textarea").value, "Revisa el cambio de login", "volver al agente conserva su encargo");
  draftDoc.querySelector("textarea").dispatchEvent(new draftApp.w.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  await espera(150);
  assert.equal(agentSends.length, 1);
  assert.equal(agentSends[0].project, "p");
  assert.equal(agentSends[0].encargado, "Holmes");
  assert.equal(agentSends[0].taskFromAgent, true);
  assert.equal(agentSends[0].baseRef, null);
  assert.ok(draftDoc.querySelector('[data-sidebar-tasks] [data-sesion="new-agent-task"] [data-session-agent]'), "el primer mensaje crea una tarea visible con la pastilla de su arquetipo");
  assert.deepEqual(draftApp.fallos, []);
  draftApp.w.close();

  let threadRows = [
    { ...filaDeAgente, id: "dm", title: "Holmes", chat_de_agente: true, agent_thread: false },
    { ...filaDeAgente, id: "topic", title: "Release planning", chat_de_agente: true, agent_thread: true, pinned: false, updated_at: 100 },
    { ...filaDeAgente, id: "new-topic", title: "Independent topic", chat_de_agente: true, agent_thread: true, updated_at: 90 },
    { ...filaDeAgente, id: "archived-work", title: "Old investigation", last_message: "Historical finding", archived: true, chat_de_agente: false, launched_by: "dm", launcher_name: "Holmes" },
    { ...filaDeAgente, id: "dm-work", title: "DM task", chat_de_agente: false, launched_by: "dm", launcher_name: "Holmes" },
    { ...filaDeAgente, id: "topic-work", title: "Topic task", last_message: "Topic task progress", chat_de_agente: false, pinned: true, launched_by: "topic", launcher_name: "Holmes" },
    { ...filaDeAgente, id: "topic-work-2", title: "Second topic task", chat_de_agente: false, pinned: false, launched_by: "topic", launcher_name: "Holmes" },
    { ...filaDeAgente, id: "unrelated-work", title: "Other task", encargado: null, chat_de_agente: false, launched_by: "other-chat", launcher_name: "Other agent" },
  ];
  const threadLoads = [];
  const pinChanges = [];
  let threadProjects = bubbleResponses.list_projects;
  const threadApp = await arrancar("listo", "agent-threads", {
    ...bubbleResponses,
    list_projects: () => threadProjects,
    list_delegated_sessions: ({ id }) => threadRows.filter(row => row.launched_by === id).map(row => ({ ...row, folder: "p" })),
    task_coordinator: ({ id }) => {
      const row = threadRows.find(row => row.id === id);
      const root = threadRows.find(root => root.id === row?.launched_by);
      return root ? { folder: "p", task: root.id, title: root.title, agent: root.agent } : null;
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
            from_task: { folder: "p", task: "topic-work", title: "Topic task", agent: "codex" } },
          { role: "system", id: "topic-launch-2", text: "", meta: "task_launched",
            from_task: { folder: "p", task: "topic-work-2", title: "Second topic task", agent: "codex" } },
        ] : [] };
    },
  });
  threadApp.w.scrollTo = () => {};
  const threadDoc = threadApp.w.document;
  await espera(100);
  const sidebarTask = id => threadDoc.querySelector(`[data-sidebar-tasks] [data-sesion="${id}"]`);
  assert.equal(sidebarTask("dm")?.dataset.pinned, "true", "el chat anterior nace fijado entre las tareas");
  assert.equal(sidebarTask("new-topic")?.dataset.pinned, "true", "los temas anteriores heredan el pin");
  assert.equal(sidebarTask("topic")?.dataset.pinned, undefined, "un pin explícito del backend prevalece sobre el valor heredado");
  assert.equal(sidebarTask("topic-work")?.dataset.pinned, "true", "una tarea nueva puede venir fijada del backend");
  assert.equal(threadDoc.querySelector('[data-sidebar-tasks] [data-task-author]'), null, "el riel no agrupa por agente");
  assert.equal(sidebarTask("dm-work"), null, "el trabajo delegado se consulta desde su coordinador");
  assert.ok(sidebarTask("topic-work").querySelector("[data-session-agent]"), "la tarea delegada fijada conserva la tarjeta compartida");
  const taskOrder = [...threadDoc.querySelectorAll('[data-project-sessions="p"] [data-sidebar-tasks] [data-sesion]')].map(row => row.dataset.sesion);
  assert.ok(taskOrder.indexOf("topic-work") < taskOrder.indexOf("topic"), "las fijadas van antes que las demás sin alterar sus turnos");
  const openPinnedTaskMenu = id => sidebarTask(id).querySelector('[data-session-actions] button[aria-haspopup="menu"]').click();
  const pinMenuItem = label => [...threadDoc.querySelectorAll('[role="menu"] [role="menuitem"]')].find(item => item.textContent.trim() === label);
  const pinButton = id => sidebarTask(id).querySelector("[data-session-pin]");
  openPinnedTaskMenu("dm");
  await espera(50);
  assert.equal(pinMenuItem("Desfijar"), undefined, "fijar ya no está en el menú: es el botón de debajo");
  assert.equal(pinMenuItem("Archivar tarea"), undefined, "una tarea fijada no ofrece archivado");
  threadDoc.dispatchEvent(new threadApp.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await espera(50);
  const accionesDeFila = pinButton("dm").closest("[data-session-actions]");
  assert.ok(accionesDeFila.className.includes("flex-col"), "el menú y fijar van en una columna");
  const botonDelMenu = accionesDeFila.querySelector('button[aria-haspopup="menu"]');
  assert.ok(botonDelMenu.compareDocumentPosition(pinButton("dm")) & threadApp.w.Node.DOCUMENT_POSITION_FOLLOWING, "el menú va arriba y fijar abajo");
  assert.equal(pinButton("dm").getAttribute("aria-pressed"), "true", "el botón dice que la tarea está fijada");
  pinButton("dm").click();
  await espera(150);
  assert.deepEqual(pinChanges.at(-1), { project: "p", id: "dm", pinned: false });
  assert.equal(sidebarTask("dm")?.dataset.pinned, undefined);
  assert.equal(pinButton("dm").getAttribute("aria-pressed"), "false");
  pinButton("dm").click();
  await espera(150);
  assert.equal(sidebarTask("dm")?.dataset.pinned, "true", "la tarea se vuelve a fijar con el mismo botón");
  assert.equal(threadDoc.querySelector('[data-agent-conversations]'), null, "los historiales antiguos solo aparecen en Tareas");
  sidebarTask("dm").click();
  await espera(200);
  assert.equal(threadLoads.at(-1), "dm");
  assert.equal(threadDoc.querySelector("textarea"), null, "el chat anterior solo permite leer el historial");
  sidebarTask("topic").click();
  await espera(200);
  assert.equal(threadLoads.at(-1), "topic");
  const tabText = tab => tab.querySelector(".truncate").textContent;
  const tabOf = text => [...threadDoc.querySelectorAll('[role="tab"]')].find(tab => tabText(tab) === text);
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
  const previewOfCoordinator = () => sidebarTask("topic").querySelector("[data-session-preview]");
  threadApp.emit("chat", { kind: "started", session: "topic-work", workspace: "w" });
  await espera(100);
  assert.equal(previewOfCoordinator().querySelectorAll('[aria-label="Está trabajando"]').length, 1,
    "el coordinador conserva un foco de actividad cuando solo trabaja su subtarea");
  threadApp.emit("chat", { kind: "started", session: "topic", workspace: "w" });
  await espera(100);
  assert.equal(previewOfCoordinator().querySelectorAll("[aria-label]").length, 2,
    "el proveedor y un solo estado ocupan la vista previa, sin contador de subtareas");
  threadApp.emit("chat", { kind: "done", session: "topic", workspace: "w", ok: true });
  await espera(200);
  assert.equal(previewOfCoordinator().querySelectorAll('[aria-label="Está trabajando"]').length, 1,
    "terminar el turno principal conserva la actividad delegada");
  threadApp.emit("chat", { kind: "done", session: "topic-work", workspace: "w", ok: true });
  await espera(200);
  assert.equal(previewOfCoordinator().querySelectorAll('[aria-label="Está trabajando"]').length, 0,
    "el foco de actividad se apaga al terminar la última subtarea");
  const toolbarButtons = [...delegatedToolbar.parentElement.querySelectorAll("button")];
  assert.deepEqual(toolbarButtons.map(button => button.getAttribute("aria-label")), [
    "Dividir vista", "Buscar en esta tarea", delegatedToolbar.getAttribute("aria-label"),
  ], "la columna ordena dividir pantalla, búsqueda y subtareas debajo del sidebar");
  delegatedToolbar.click();
  await espera(50);
  assert.equal([...threadDoc.querySelectorAll('button')].find(button => button.textContent === "Activas")?.getAttribute("aria-pressed"), "true",
    "el filtro predeterminado de subtareas se llama Activas");
  [...threadDoc.querySelectorAll('button')].find(button => button.textContent === "Todas").click();
  await espera(50);
  assert.ok(threadDoc.querySelector('[data-delegated-list] [data-sesion="topic-work"]'), "el desplegable conserva trabajo de turnos anteriores");
  threadDoc.querySelector('[data-delegated-list] [data-sesion="topic-work"]').click();
  await espera(200);
  assert.equal(threadLoads.at(-1), "topic-work", "la tarjeta abre la tarea de su carpeta");
  threadDoc.querySelector('[data-task-coordinator]').click();
  await espera(200);
  assert.equal(threadLoads.at(-1), "topic", "la tarea delegada regresa al coordinador");
  assert.equal(threadDoc.querySelector("textarea"), null, "el tema anterior no abre turnos nuevos");
  [...threadDoc.querySelectorAll('[data-sidebar-agents] button')].find(button => button.textContent.trim() === "Holmes").click();
  await espera(50);
  assert.equal(threadDoc.querySelector('[role="dialog"]'), null, "una conversación nueva abre el borrador del agente");
  assert.match(threadDoc.querySelector("h1")?.textContent ?? "", /Holmes/);
  assert.ok(threadDoc.querySelector("textarea"), "la conversación nueva tiene composer");
  assert.equal(threadApp.comandos.includes("create_agent_thread"), false);
  threadProjects = structuredClone(threadProjects);
  threadApp.emit("cli-changed", { workspace: null, command: "task send" });
  await espera(350);
  assert.ok(sidebarTask("dm"), "refrescar conserva el historial antiguo entre las tareas");
  assert.deepEqual(threadApp.fallos, []);
  threadApp.w.close();

  // Una Bandeja antigua sigue accesible y cada mensaje conserva su remitente.
  const inboxRows = [...threadRows.filter(row => row.id === "dm" || row.id === "topic"), { ...filaDeAgente, id: "inbox", title: "Bandeja", chat_de_agente: true, agent_thread: true, inbox: true }];
  const inboxLoads = [];
  const inboxTurns = [
    { role: "system", meta: "recibido", text: "Mensaje de @Watson. Salto 1." },
    { role: "user", text: "Revisa el diseño", encargado: "Watson", from_task: { folder: "p", task: "watson-chat", title: "Watson", agent: "claude" } },
    { role: "system", meta: "recibido", text: "Mensaje de la tarea «Corregir login». Salto 1." },
    { role: "user", text: "Ya quedó el login", from_task: { folder: "p", task: "login", title: "Corregir login", agent: "codex" } },
    { role: "agent", text: "Recibido." },
  ];
  const inboxApp = await arrancar("listo", "agent-inbox", {
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
  await espera(100);
  assert.equal(inboxDoc.querySelector('[data-sidebar-tasks] [data-sesion="inbox"]')?.dataset.pinned, "true", "la Bandeja anterior aparece fijada entre las tareas");
  assert.equal(inboxDoc.querySelector('[data-agent-inbox]'), null, "la Bandeja no tiene una sección aparte");
  inboxDoc.querySelector('[data-sidebar-tasks] [data-sesion="inbox"]').click();
  await espera(300);
  assert.equal(inboxApp.comandos.includes("open_agent_inbox"), false);
  assert.equal(inboxLoads.at(-1), "inbox");
  assert.equal(inboxDoc.querySelector("textarea"), null, "la Bandeja anterior no inicia turnos nuevos");
  assert.equal(inboxDoc.querySelector('[data-agent-thread]'), null, "no quedan temas anidados bajo los agentes");
  assert.ok([...inboxDoc.querySelectorAll('[role="tab"] .truncate')].some(label => label.textContent === "Holmes · Bandeja anterior"), "la Bandeja conserva el agente en su pestaña");
  const agentSigned = inboxDoc.querySelector('[data-sender="agent"]');
  assert.ok(agentSigned, "un mensaje de agente lleva su firma");
  assert.match(agentSigned.textContent, /Watson/);
  assert.ok(agentSigned.closest("[class]").parentElement.querySelector('[role="img"], svg, img'), "y su cara");
  const taskSigned = inboxDoc.querySelector('[data-sender="task"] button');
  assert.equal(taskSigned?.textContent, "Corregir login", "un mensaje de tarea lleva su título");
  assert.ok(inboxDoc.querySelectorAll('[data-sender="system"]').length >= 2, "y lo que avisa el sistema se pinta como sistema, no como un mensaje");
  taskSigned.click();
  await espera(200);
  assert.equal(inboxLoads.at(-1), "login", "el título de la tarea la abre");
  assert.deepEqual(inboxApp.fallos, []);
  inboxApp.w.close();

  const mentionSends = [];
  const target = { kind: "task", projectId: "project", sessionId: "login-task" };
  const secondTarget = { ...target, sessionId: "other-login" };
  const mentionApp = await arrancar("listo", "task-mentions", {
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
  await espera(120);
  const taskButton = [...mentionApp.w.document.querySelectorAll("button")].find(b => b.textContent.includes("Corregir login") && b.textContent.includes("fix/login"));
  assert.ok(taskButton, "task search must include session titles and aliases");
  for (let el = taskButton.closest("ul")?.parentElement?.parentElement; el; el = el.parentElement)
    assert.equal(el.classList.contains("overflow-hidden"), false, "The suggestion menu must not live inside a clipping container: it is drawn above the composer and would be cut off");
  assert.equal([...mentionApp.w.document.querySelectorAll("button")].some(b => b.textContent.includes("Login archivado")), false, "Archived tasks must not appear in mention suggestions");
  const unavailable = [...mentionApp.w.document.querySelectorAll("button")].find(b => b.textContent.includes("Login anterior"));
  assert.equal(unavailable?.disabled, false, "A task without a worktree remains addressable");
  taskButton.dispatchEvent(new mentionApp.w.MouseEvent("mousedown", { bubbles: true }));
  await espera(30);
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
  await espera(30);
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
  await espera(100);
  const taskWithoutWorktree = [...mentionApp.w.document.querySelectorAll("button")].find(b => b.textContent.includes("Login anterior"));
  assert.ok(taskWithoutWorktree && !taskWithoutWorktree.disabled);
  taskWithoutWorktree.dispatchEvent(new mentionApp.w.MouseEvent("mousedown", { bubbles: true }));
  writeMention(`${mentionField.value}c`);
  assert.equal(mentionField.selectionStart, mentionField.value.length, "The first key typed after picking a task must leave the cursor after it");
  writeMention(`${mentionField.value} en @revamp`);
  await espera(60);
  const folderButton = [...mentionApp.w.document.querySelectorAll("button[aria-selected]")].find(b => b.textContent.includes("Revamp de scoring") && b.textContent.includes("Proyecto"));
  assert.ok(folderButton, "Working folders are offered as mentions");
  folderButton.dispatchEvent(new mentionApp.w.MouseEvent("mousedown", { bubbles: true }));
  await espera(30);
  assert.ok(mentionField.value.endsWith(" @Revamp-de-scoring "), mentionField.value);
  mentionField.closest("form").dispatchEvent(new mentionApp.w.Event("submit", { bubbles: true, cancelable: true }));
  await espera(100);
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
  const queuedApp = await arrancar("listo", "background-queue", {
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
    await espera(150);
  };
  const queueText = async (text) => {
    const field = queueDocument.querySelector("textarea");
    field.value = text;
    field.dispatchEvent(new queuedApp.w.Event("input", { bubbles: true }));
    field.closest("form").dispatchEvent(new queuedApp.w.Event("submit", { bubbles: true, cancelable: true }));
    await espera(50);
  };
  await selectQueuedTask("s1");
  queuedApp.emit("chat", { kind: "started", session: "s1", workspace: "w" });
  await queueText("Primer pendiente");
  await queueText("Segundo pendiente");
  await selectQueuedTask("s2");
  await selectQueuedTask("s1");
  queuedApp.emit("chat", { kind: "done", session: "s1", workspace: "w", ok: true });
  await espera(200);
  assert.equal(queuedSends.length, 1, "returning to a task must not turn its live queue into a draft");
  assert.equal(queuedSends[0].prompt, "Primer pendiente\n\nSegundo pendiente");
  await queueText("Pendiente en segundo plano");
  await selectQueuedTask("s2");
  queuedApp.emit("chat", { kind: "done", session: "s1", workspace: "w", ok: true });
  await espera(200);
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
  await espera(250);
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
  await espera(150);
  assert.equal(inyectados.length, 2, "sin nada encolado el Enter de más no inventa un envío");
  assert.equal(queuedSends.length, 2);

  // Una entrega encolada la vacía la ventana, y con ella el sobre. Rust la
  // dejó en el `.cola.json` del buzón con quién la manda y dónde se contesta;
  // sin devolver el remitente aterriza firmada como de la persona (PR #800).
  const entrega = {
    id: "d1", text: "Revisa el acceso", agent: "codex", model: null, effort: null,
    permission_mode: null, attachments: [], encargado: "arquitecto",
    reply_to: { folder: "p", task: "t9" }, hops: 2,
  };
  queueFiles.set("s3", [entrega, { ...entrega, id: "d2", encargado: null, reply_to: null, hops: null, text: "Y esto lo escribo yo" }]);
  await selectQueuedTask("s3");
  const mandarCola = [...queueDocument.querySelectorAll("button")].find((b) => b.textContent.trim() === "mandar");
  assert.ok(mandarCola, "una cola leída del disco espera a que alguien la suelte");
  mandarCola.click();
  await espera(200);
  assert.equal(queuedSends.length, 3);
  assert.equal(queuedSends[2].prompt, "Revisa el acceso", "un lote no mezcla remitentes");
  assert.equal(queuedSends[2].fromEncargado, "arquitecto", "la entrega encolada conserva quién la manda");
  assert.deepEqual(queueFiles.get("s3"), [{ ...entrega, id: "d2", encargado: null, reply_to: null, hops: null, text: "Y esto lo escribo yo" }],
    "lo que no salió sigue en su cola, no se pierde ni se cuela en el lote ajeno");
  assert.equal(queuedApp.fallos.length, 0);
  queuedApp.w.close();

  const cloudIcons = await arrancar("listo", "cloud-folder-icons", {
    ...RESPUESTAS,
    list_projects: [
      { id: "cloud-folder", name: "Nube", sources: [], kind: "folder", cloud: "google_drive" },
      { id: "cloud-git", name: "Git en nube", sources: [], kind: "git", cloud: "one_drive" },
      { id: "local-folder", name: "Local", sources: [], kind: "folder", cloud: null },
    ],
  });
  const projectIconRow = name => [...cloudIcons.w.document.querySelectorAll("button")].find(b => b.textContent.trim() === name)?.closest("[data-destino]");
  assert.ok(projectIconRow("Nube")?.querySelector("svg.lucide-folder-cloud"));
  assert.ok(projectIconRow("Git en nube")?.querySelector("svg.lucide-folder-git-2"));
  assert.equal(projectIconRow("Git en nube")?.querySelector("svg.lucide-folder-cloud"), null);
  assert.equal(projectIconRow("Local")?.querySelector("svg.lucide-folder-cloud"), null);
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
  const forkApp = await arrancar("listo", 901, forkResponses);
  const forkDoc = forkApp.w.document;
  forkDoc.querySelector('[data-sesion="s1"]').click();
  await espera(150);
  const [copiarPregunta, copiarRespuesta] = forkDoc.querySelectorAll('button[aria-label="Copiar"]');
  copiarPregunta.click();
  await espera(20);
  assert.equal(copied, "Primera pregunta", "a sent message copies its own text");
  copiarRespuesta.click();
  await espera(20);
  assert.equal(copied, "Primera respuesta");
  assert.equal(forkDoc.querySelectorAll('button[aria-label="Copiado"]').length, 1,
    "copying a reply marks only its own button");
  assert.equal(copiarRespuesta.getAttribute("aria-label"), "Copiado");
  forkSessionActive = true;
  forkApp.emit("chat", { kind: "started", session: "s1", workspace: "w" });
  await espera(30);
  assert.ok(forkDoc.querySelector('button[aria-label="Detener turno"]'));
  assert.equal(forkDoc.querySelectorAll('button[aria-label="Crear tarea desde aquí"]').length, 2,
    "persisted replies, including the latest, remain forkable during an active turn");
  const forkButton = forkDoc.querySelector('button[aria-label="Crear tarea desde aquí"]');
  forkButton.click();
  await espera(20);
  const fullContext = [...forkDoc.querySelectorAll('[role="dialog"] button')].find(b => b.textContent === "Conversación completa");
  fullContext.click();
  fullContext.click();
  await espera(20);
  assert.equal(forkCalls.length, 1);
  assert.equal(forkCalls[0].turno, "a1");
  rejectFork(new Error("fork rechazado"));
  await espera(50);
  const forkAlert = forkDoc.querySelector('[role="alert"]');
  assert.match(forkAlert.textContent, /fork rechazado/);
  forkAlert.querySelector("button").click();
  assert.equal(forkDoc.querySelector('[role="alert"]'), null);
  forkButton.click();
  await espera(20);
  [...forkDoc.querySelectorAll('[role="dialog"] button')].find(b => b.textContent === "Conversación completa").click();
  await espera(20);
  assert.equal(forkCalls.length, 2);
  rejectFork(new Error("reintento rechazado"));
  await espera(30);
  forkButton.click();
  await espera(20);
  const focusedContext = [...forkDoc.querySelectorAll('[role="dialog"] button')].find(b => b.textContent === "Sesión enfocada");
  focusedContext.click();
  await espera(20);
  resolveFork({ path: "/private/attachments/context/conversation.md", last_prompt: "Primera pregunta", last_reply: "Primera respuesta", sources: [], excluded_sources: [] });
  await espera(100);
  assert.equal(forkDoc.querySelector('[role="dialog"]'), null);
  const newDraft = [...forkDoc.querySelectorAll("textarea")].find(el => el.value.includes("Primera pregunta"));
  assert.ok(newDraft);
  assert.match(newDraft.value, /Primera respuesta/);
  assert.doesNotMatch(newDraft.value, /Pregunta posterior/);
  const draftModel = forkDoc.querySelector('button[title="Con qué modelo responde"]');
  assert.ok(draftModel && !draftModel.disabled);
  draftModel.click();
  await espera(30);
  assert.ok(forkDoc.querySelector('[role="group"]'));
  assert.deepEqual(forkApp.fallos, []);

  const conTarea = await arrancar("listo", 2, CON_TAREA);
  const sessionPreview = conTarea.w.document.querySelector('[data-sesion="s1"] [data-session-preview]');
  assert.ok(sessionPreview?.querySelector('svg'));
  assert.match(sessionPreview.textContent, /La última respuesta de esta tarea/);
  assert.doesNotMatch(sessionPreview.textContent, /gpt-5.6/);

  conTarea.w.document.querySelector('[data-sesion="s1"]')?.click();
  await espera(150);
  const fila = conTarea.w.document.querySelector('button[title="informe.md"]');
  fila?.click();
  await espera(150);
  const enLaTira = [...conTarea.w.document.querySelectorAll('[role="tab"]')].some(
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
  await espera(350);
  const chatTab = [...conTarea.w.document.querySelectorAll('[role="tab"]')].find(el => el.getAttribute("aria-label")?.includes("sin leer"));
  assert.equal(chatTab, undefined);
  const fileTab = [...conTarea.w.document.querySelectorAll('[role="tab"]')].find(el => el.textContent.includes("informe.md"));
  assert.equal(fileTab.querySelector("svg.lucide-mail"), null);
  assert.equal(fileTab.querySelector("svg.lucide-git-branch"), null);
  conTarea.w.document
    .querySelector('button[aria-label="Cerrar «informe.md»"]')
    ?.click();
  await espera(100);
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
  await espera(100);
  assert.ok(estadoVivo());
  const verboInicial = estadoVivo().querySelector(".min-w-0 > span").textContent;
  conTarea.emit("chat", { kind: "tool", session: "s1", workspace: "w", id: "status-command", text: "Bash", target: "pnpm verificar" });
  await espera(100);
  assert.equal(estadoVivo().querySelector(".min-w-0 > span").textContent, verboInicial);
  // El comando no sale en el rótulo de espera: lo enseña su fila del registro.
  assert.match(estadoVivo().textContent, /Ejecutando/);
  assert.doesNotMatch(estadoVivo().textContent, /pnpm verificar/);
  // El verbo lo mueve el tic de un segundo de TurnStatus: en un runner cargado el de los 4 s llega tarde.
  await espera(4100);
  for (let i = 0; i < 30 && estadoVivo().querySelector(".min-w-0 > span").textContent === verboInicial; i++) {
    await espera(200);
  }
  assert.notEqual(estadoVivo().querySelector(".min-w-0 > span").textContent, verboInicial);
  assert.match(estadoVivo().textContent, /Ejecutando/);
  assert.doesNotMatch(estadoVivo().textContent, /pnpm verificar/);
  conTarea.emit("chat", { kind: "tool_done", session: "s1", workspace: "w", id: "status-command", text: "Bash", ok: true });
  await espera(100);
  assert.ok(estadoVivo());
  assert.doesNotMatch(estadoVivo().textContent, /Ejecutando/);
  conTarea.emit("chat", { kind: "done", session: "s1", workspace: "w", ok: true });
  await espera(100);
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
    await espera(100);
    assert.equal(campo.value, "");
  };
  conTarea.emit("chat", { kind: "started", session: "s1", workspace: "w" });
  conTarea.emit("chat", { kind: "tool", session: "s1", workspace: "w", id: "queue-tool", text: "Bash", target: "pnpm verificar" });
  await espera(100);
  conTarea.emit("chat", { kind: "model", session: "s1", workspace: "w", text: "claude-sonnet-5" });
  await espera(50);
  assert.ok(conTarea.w.document.querySelector('button[aria-label="Modelo: claude-sonnet-5"]'));
  conTarea.emit("chat", { kind: "model", session: "another-session", workspace: "w", text: "other-model" });
  await espera(50);
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
    await espera(100);
    const enCola = doc.activeElement;
    if (enCola?.tagName !== "TEXTAREA" || enCola.value !== "Haz los símbolos Git") {
      console.error("Abrir el editor de un mensaje en cola ya no enfoca su campo.");
      process.exit(1);
    }
    conTarea.emit("chat", { kind: "delta", session: "s1", workspace: "w", text: "llega actividad" });
    conTarea.emit("chat", { kind: "tool", session: "s1", workspace: "w", id: "foco-tool", text: "Bash", target: "ls" });
    await espera(150);
    if (doc.activeElement !== enCola) {
      console.error(
        `La actividad de la tarea le quitó el foco a quien escribía: quedó en ${doc.activeElement?.tagName} ${JSON.stringify(doc.activeElement?.value ?? "")}.`,
      );
      process.exit(1);
    }
    enCola.dispatchEvent(new conTarea.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await espera(100);
  }
  conTarea.emit("chat", { kind: "delta", session: "s1", workspace: "w", text: "Estoy trabajando" });
  await escribirEnCola("Cuando termines manda el PR");
  assert.equal(envios.length, 0);
  conTarea.emit("chat", { kind: "done", session: "s1", workspace: "w", ok: true });
  await espera(200);
  assert.equal(envios.length, 1, "another live task in the same folder does not block dispatch");
  assert.equal(envios[0].prompt, "Haz los símbolos Git\n\nCuando termines manda el PR");
  assert.equal(envios[0].session, "s1");
  await escribirEnCola("Esto va después del lote");
  assert.equal(envios.length, 1);
  conTarea.emit("chat", { kind: "done", session: "s1", workspace: "w", ok: false });
  await espera(150);
  assert.equal(envios.length, 1, "un fallo no despacha el lote pendiente");
  for (const button of conTarea.w.document.querySelectorAll('button[aria-label^="Quitar el mensaje "]')) button.click();
  await espera(50);
  rechazarPorOcupada = true;
  await escribirEnCola("Conserva este mensaje");
  assert.equal(envios.length, 2);
  assert.doesNotMatch(conTarea.w.document.body.textContent, /Hay un turno o una operación en curso/);
  await escribirEnCola("Y este también");
  assert.equal(envios.length, 2);
  await espera(1100);
  assert.equal(envios.length, 2, "no reintenta mientras siga ocupada");
  rechazarPorOcupada = false;
  disponible = true;
  await espera(1200);
  assert.equal(envios.length, 3);
  assert.equal(envios[2].prompt, "Conserva este mensaje\n\nY este también");
  conTarea.emit("chat", { kind: "done", session: "s1", workspace: "w", ok: true });
  await espera(100);

  const sinUsable = await arrancar("listo", 3, SIN_USABLE);
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
    agent: "codex", model: null, refs: [], stage: null, esperando: false, updated_at: 1, created_at: 1, turns: 1 });
  for (const [platform, userAgent] of [
    ["macOS", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"],
    ["Windows", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"],
    ["Linux", "Mozilla/5.0 (X11; Linux x86_64)"],
  ]) {
    const attachmentCopies = [];
    const attachmentSends = [];
    const attachmentApp = await arrancar("listo", `attachment-drop-${platform}`, {
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
      await espera(100);
      const beforeDrop = attachmentCopies.length;
      attachmentApp.emit("tauri://drag-drop", { paths: ["/tmp/screenshot.png"], position: { x: 100, y: 100 } });
      await espera(50);
      assert.equal(attachmentCopies.length, beforeDrop + 1, `${platform}: un arrastre debe preparar una copia en ${id}, aunque haya otras tareas montadas`);
    }
    const attachmentDoc = attachmentApp.w.document;
    const sendAttachment = () => [...attachmentDoc.querySelectorAll('button[aria-label="Preguntar"]')].find(b => !b.disabled);
    assert.ok(sendAttachment(), `${platform}: an image enables sending without text`);
    sendAttachment().click();
    await espera(100);
    assert.equal(attachmentSends.length, 1);
    assert.equal(attachmentSends[0].prompt, "");
    assert.ok(attachmentSends[0].attachments.some(path => path.endsWith("screenshot.png")));
    attachmentApp.emit("chat", { kind: "started", session: "image-a", workspace: "w" });
    attachmentApp.emit("tauri://drag-drop", { paths: ["/tmp/report.pdf"], position: { x: 100, y: 100 } });
    await espera(50);
    const textarea = [...attachmentDoc.querySelectorAll("textarea")].find(el => el.placeholder === "Escribe lo siguiente");
    assert.ok(textarea);
    textarea.dispatchEvent(new attachmentApp.w.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await espera(50);
    assert.equal(attachmentSends.length, 1, "attachment waits while the agent is busy");
    attachmentApp.emit("chat", { kind: "done", session: "image-a", workspace: "w", ok: true });
    await espera(200);
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
  const sidebarResponses = { ...CON_TAREA,
    list_live_sessions: [task("p", null, "delivered"), task("shared", "p", null), task("own", "p", "failed"), task("local", "p", null), { ...task("native", "p", null), title: "/root/prueba_sidebar", subagent: "native-id" }],
    list_session_git: ({ remote }) => { if (!remote) { gitLocalCalls++; if (causa.getStore() === "delta") gitDeltaCalls++; } if (remote && blockRemote) return new Promise(resolve => { releaseRemote = resolve; }); return rejectGit ? Promise.reject(new Error("offline")) : structuredClone(gitRows); },
  };
  const sidebar = await arrancar("listo", 4, sidebarResponses);
  const row = id => sidebar.w.document.querySelector(`[data-sesion="${id}"]`);
  assert.match(row("p").textContent, /Tarea p.*feature\/parent.*#12/s);
  assert.ok(row("p").querySelector('[data-session-git] svg.lucide-git-branch'));
  assert.equal(row("p").querySelector('[aria-label="Resultado entregado"]'), null,
    "el fallo delegado tiene prioridad sobre la entrega del coordinador en el indicador común");
  assert.equal(row("own"), null, "la delegación no llena el sidebar");
  assert.equal(row("p").querySelectorAll('[aria-label="Fallo o interrupción"]').length, 1,
    "una subtarea fallida ocupa el único indicador del coordinador");
  sidebar.w.document.querySelector('button[aria-label="Buscar tareas o agentes"]').click();
  await espera(50);
  const taskSearch = sidebar.w.document.querySelector('[data-sidebar-search] input[role="searchbox"]');
  const searchTasks = async value => {
    taskSearch.value = value;
    taskSearch.dispatchEvent(new sidebar.w.Event("input", { bubbles: true }));
    await espera(80);
  };
  await searchTasks("a");
  assert.doesNotMatch(row("shared").textContent, /desconocido|Sin PR/);
  assert.match(row("native").textContent, /prueba sidebar/);
  assert.doesNotMatch(row("native").textContent, /\/root\//);
  // Compartir carpeta y rama con la tarea padre no dice nada propio: no se pinta nada.
  assert.equal(row("shared").querySelector("[data-session-git]"), null);
  assert.equal(row("native").querySelector("[data-session-git]"), null);
  assert.match(row("own").textContent, /feature\/child.*#13/s);
  assert.ok(row("own").querySelector('.text-neutral-500 > svg.lucide-git-pull-request-draft'));
  assert.ok(row("own").querySelector('[aria-label="Fallo o interrupción"]'));
  assert.equal(row("local").querySelector("[data-session-git]"), null);
  // La rama de `p` se dice una vez, en la fila de `p`: repetirla en quien usa su
  // árbol no dice dónde trabaja esa subtarea.
  for (const prestada of ["shared", "native"]) {
    assert.doesNotMatch(row(prestada).textContent, /feature\/parent|#12/);
    assert.equal(row(prestada).querySelector("[data-session-git] svg.lucide-git-branch"), null);
  }
  await searchTasks("");
  assert.equal(row("own"), null);
  assert.equal(row("p").querySelectorAll('[aria-label="Fallo o interrupción"]').length, 1,
    "cerrar la búsqueda conserva el único estado común del coordinador");
  assert.equal(row("p").querySelector('[aria-label="Resultado entregado"]'), null);
  await searchTasks("a");
  assert.ok(row("own"), "la búsqueda conserva acceso a las subtareas");
  blockRemote = false; releaseRemote(gitRows); await espera(100);
  gitRows.shared = gitRow("feature/parent", { shared_with: "p", pull_known: true });
  gitRows.p = gitRow("renamed", { pull: { number: 12, state: "merged", head_sha: "abc" }, pull_known: true });
  sidebarResponses.list_live_sessions = sidebarResponses.list_live_sessions.map(s => ({ ...s, updated_at: 2 }));
  sidebar.emit("session", { project: "", session: "p", workspace: "w" });
  await espera(350);
  assert.match(row("p").textContent, /renamed/);
  assert.ok(row("p").querySelector('.text-brand-purple > svg.lucide-git-merge'));
  assert.doesNotMatch(row("p").textContent, /HEAD distinto/);
  assert.doesNotMatch(row("shared").textContent, /Sin PR|desconocido|obsoleta/);
  rejectGit = true;
  sidebar.w.dispatchEvent(new sidebar.w.Event("focus"));
  await espera(100);
  assert.match(row("p").textContent, /renamed.*#12/s);
  assert.doesNotMatch(row("p").textContent, /obsoleta|Integrado/);
  assert.equal(row("p").querySelector('svg.lucide-clock'), null);
  assert.match(row("p").innerHTML, /Último estado conocido/);
  assert.ok(row("p").querySelector(".text-neutral-500 > svg.lucide-git-merge"));
  rejectGit = false;
  gitRows.p = gitRow(null, { kind: "none" });
  sidebar.w.dispatchEvent(new sidebar.w.Event("focus"));
  await espera(100);
  assert.equal(row("p").querySelector("[data-session-git]"), null);
  const revision = createHash("sha256").update("0:reply:Respuesta nueva").digest("hex");
  sidebarResponses.load_session = ({ id }) => ({ ...CON_TAREA.load_session, id, turns: [{ role: "agent", id: "reply", text: "Respuesta nueva" }] });
  sidebarResponses.list_live_sessions = sidebarResponses.list_live_sessions.map(s => ({ ...s, result_revision: revision }));
  let focused = false;
  sidebar.w.document.hasFocus = () => focused;
  sidebar.emit("session", { project: "", session: "p", workspace: "w" });
  await espera(350);
  assert.equal(row("p").querySelector('[aria-label="Respuesta nueva sin leer"]'), null);
  assert.ok(row("p").querySelector('[aria-label="Fallo o interrupción"]'),
    "una respuesta del coordinador no oculta el fallo pendiente de su subtarea");
  assert.equal(row("p").querySelector('svg.lucide-mail'), null);
  row("p").click();
  await espera(160);
  const tab = id => [...sidebar.w.document.querySelectorAll('[role="tab"]')].find(el => el.textContent.includes(id === "native" ? "prueba sidebar" : `Tarea ${id}`));
  assert.doesNotMatch(tab("p").getAttribute("aria-label"), /sin leer/);
  assert.equal(tab("p").querySelector("svg.lucide-git-branch"), null);
  focused = true;
  sidebar.w.dispatchEvent(new sidebar.w.Event("focus"));
  await espera(120);
  assert.doesNotMatch(tab("p").getAttribute("aria-label"), /sin leer/);
  assert.ok(row("p").querySelector('[aria-label="Fallo o interrupción"]'),
    "ver el resultado del coordinador conserva la atención delegada");
  assert.equal(row("shared").querySelector('[aria-label="Respuesta nueva sin leer"]'), null);
  sidebar.emit("chat", { kind: "done", project: "", session: "p", workspace: "w", ok: true });
  sidebar.emit("chat", { kind: "done", project: "", session: "p", workspace: "w", ok: true });
  await espera(150);
  assert.doesNotMatch(tab("p").getAttribute("aria-label"), /sin leer/);
  row("own").click();
  await espera(160);
  assert.ok(tab("own").querySelector('[aria-label="Fallo o interrupción"].text-error-strong svg.lucide-circle-alert'));
  assert.ok(row("own").querySelector('[aria-label="Fallo o interrupción"].text-error-strong svg.lucide-circle-alert'));
  assert.ok(tab("own").querySelector("svg.lucide-git-pull-request-draft"));
  assert.equal(tab("own").querySelector("svg.lucide-git-pull-request"), null);
  assert.match(tab("own").title, /feature\/child.*#13/);
  row("shared").click();
  await espera(160);
  assert.ok(tab("shared").querySelector("svg.lucide-git-branch"));
  assert.match(tab("shared").title, /compartidas con la tarea padre/);
  row("native").click();
  await espera(160);
  assert.equal(tab("native").querySelector("svg.lucide-git-branch"), null);
  assert.doesNotMatch(tab("native").textContent, /\/root\//);
  assert.doesNotMatch(tab("native").title, /feature\/parent|compartidas/);
  gitRows.p = gitRow("feature/parent", { pull: { number: 12, state: "merged", head_sha: "old" }, pull_known: true });
  sidebar.w.dispatchEvent(new sidebar.w.Event("focus"));
  await espera(100);
  assert.ok(tab("p").querySelector("svg.lucide-git-branch"));
  assert.match(tab("p").title, /HEAD distinto/);
  rejectGit = true;
  sidebar.w.dispatchEvent(new sidebar.w.Event("focus"));
  await espera(100);
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
    await espera(100);
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
    await espera(100);
    for (const surface of [row("p"), tab("p")]) {
      assert.ok(surface.querySelector(`.${color} > svg.lucide-${icon}`), kn);
      assert.equal(surface.querySelector("svg.lucide-git-branch"), null);
    }
    assert.match(row("p").textContent, /Cone/);
    assert.match(tab("p").title, label);
  }
  gitRows.p = gitRow(null, { kind: "kn", kn: "saved", alias: "gbsxhmdk" });
  sidebar.w.dispatchEvent(new sidebar.w.Event("focus"));
  await espera(100);
  assert.match(row("p").textContent, /gbsxhmdk/);
  assert.doesNotMatch(row("p").textContent, /desconocido/);
  for (const [checks, review, visible, overrides] of [
    ["success", "approved", true, {}],
    ["pending", "changes_requested", true, {}],
    ["failure", "approved", true, {}],
    ["success", "approved", true, { state: "draft" }],
    ["unknown", "unknown", false, {}],
    ["none", "unreviewed", false, {}],
    ["success", "approved", false, { head_sha: "old" }],
    ["success", "approved", false, { state: "merged" }],
    ["success", "approved", false, { state: "closed" }],
    ["success", "approved", true, { stale: true }],
  ]) {
    const { stale = false, ...pullOverrides } = overrides;
    gitRows.p = gitRow("feature/parent", { pull: { number: 12, state: "open", head_sha: "abc", checks, review, ...pullOverrides }, pull_known: true, stale });
    sidebar.w.dispatchEvent(new sidebar.w.Event("focus"));
    await espera(100);
    for (const surface of [row("p"), tab("p")]) {
      assert.equal(!!surface.querySelector("[data-git-checks]"), visible, JSON.stringify(overrides));
      assert.equal(!!surface.querySelector("[data-git-review]"), visible, JSON.stringify(overrides));
      if (visible) {
        assert.ok(surface.querySelector(`[data-git-checks="${checks}"]`));
        assert.ok(surface.querySelector(`[data-git-review="${review}"]`));
      }
    }
    if (stale) {
      assert.match(tab("p").title, /Último estado conocido/);
      assert.ok(tab("p").querySelector('[data-git-checks].text-neutral-500[data-git-stale]'));
    }
    if (overrides.head_sha) assert.match(tab("p").title, /otro commit/);
    if (checks === "unknown") assert.match(tab("p").title, /Comprobaciones desconocidas/);
    if (overrides.state === "draft") assert.ok(tab("p").querySelector('.text-neutral-500 > svg.lucide-git-pull-request-draft'));
  }
  gitRows.p = gitRow("feature/parent", { pull: { number: 12, state: "merged", head_sha: "abc" }, pull_known: true });
  sidebar.w.dispatchEvent(new sidebar.w.Event("focus"));
  await espera(100);
  sidebar.emit("chat", { kind: "started", session: "p", workspace: "w" });
  await espera(100);
  const workingDot = tab("p").querySelector('.rounded-full.bg-current');
  assert.ok(workingDot);
  assert.ok([...workingDot.classList].every((name) => !name.includes("animate")), "the working indicator stays visible without blinking");
  assert.equal(tab("p").querySelector("svg.lucide-loader-circle"), null);
  sidebar.emit("question", { session: "p", workspace: "w", turno: "question-turn", preguntas: [{ id: "choose", question: "¿Qué opción?", options: [], free_text: true }] });
  await espera(100);
  assert.match(tab("p").getAttribute("aria-label"), /Te preguntó algo/);
  assert.ok(row("p").querySelector('[data-session-preview] [aria-label="Te preguntó algo"]'));
  assert.ok(tab("p").querySelector("svg.lucide-git-merge"));
  assert.equal(tab("p").querySelector("svg.lucide-loader-circle"), null);
  assert.equal(tab("p").querySelector("svg.lucide-git-branch"), null);
  // Un delta del chat no refresca git. Se cuenta lo que nace del delta y no lo
  // que cae en una ventana de tiempo: el refresco que deja «started» al
  // repriorizar aterriza cuando la máquina puede, y ninguna ventana lo esquiva.
  // La espera previa deja a git sin nada en vuelo: un refresco del delta con
  // una llamada en curso se pegaría a su `pending` y saldría de otra cadena.
  for (let locales = -1; locales !== gitLocalCalls; ) {
    locales = gitLocalCalls;
    await espera(150);
  }
  causa.run("delta", () => sidebar.emit("chat", { kind: "delta", session: "p", workspace: "w", text: "Sigue trabajando" }));
  await espera(200);
  assert.equal(gitDeltaCalls, 0, "un delta del chat no refresca git");
  assert.deepEqual(sidebar.fallos, []);
  assert.equal(sidebar.w.document.querySelector("[data-project-sessions]"), null);
  for (const modifier of ["metaKey", "ctrlKey", "native"]) {
    row("p").click();
    await espera(100);
    assert.equal(tab("p").getAttribute("aria-selected"), "true");
    const beforeClose = sidebar.comandos.length;
    if (modifier === "native") sidebar.emit("close-tab", null);
    else {
      const key = new sidebar.w.KeyboardEvent("keydown", { key: "w", [modifier]: true, bubbles: true, cancelable: true });
      sidebar.w.document.querySelector("textarea").dispatchEvent(key);
      assert.equal(key.defaultPrevented, true);
    }
    await espera(100);
    assert.equal(tab("p"), undefined);
    assert.ok(row("p"));
    assert.equal(sidebar.comandos.slice(beforeClose).some(c => ["request_close", "stop_turn", "delete_session"].includes(c)), false);
  }
  // Abrir una tarea que ya contestaba con una herramienta en curso lanzaba
  // «Stale read from <Match>» en el hilo; Solid abortaba esa actualización
  // y la fila abierta de la barra se quedaba marcada para siempre.
  const seleccion = await arrancar("listo", "seleccion-viva", {
    ...CON_TAREA,
    list_live_sessions: [task("viva", null, null), task("otra", null, null)],
    list_session_git: {},
    load_session: ({ id }) => ({ ...CON_TAREA.load_session, id, turns: [{ role: "user", text: "Hazlo" }, { role: "agent", text: "Hecho.", duration_ms: 1000 }] }),
  });
  const filaDe = id => seleccion.w.document.querySelector(`[data-sesion="${id}"]`);
  const marcadas = () => [...seleccion.w.document.querySelectorAll('[data-sesion][aria-current="true"]')].map(el => el.dataset.sesion);
  seleccion.emit("chat", { kind: "started", session: "viva", workspace: "w", project: "" });
  seleccion.emit("chat", { kind: "tool", session: "viva", workspace: "w", project: "", text: "Bash", target: "ls", id: "item_1" });
  await espera(50);
  filaDe("viva").click();
  await espera(160);
  assert.deepEqual(marcadas(), ["viva"]);
  filaDe("otra").click();
  await espera(160);
  assert.deepEqual(marcadas(), ["otra"], "la marca de la barra sigue a la tarea abierta");
  filaDe("viva").click();
  await espera(160);
  assert.deepEqual(marcadas(), ["viva"]);
  assert.deepEqual(seleccion.fallos, []);
  seleccion.w.close();
  const grouped = await arrancar("listo", 5, {
    ...CON_TAREA,
    list_projects: [{ id: "folder", name: "Carpeta", sources: [], portfolio: null }],
    list_live_sessions: ({ project }) => project === "folder" ? sidebarResponses.list_live_sessions : [],
    list_session_git: {},
  });
  const guide = grouped.w.document.querySelector('[data-project-sessions="folder"]');
  assert.ok(guide);
  assert.equal(guide.classList.contains("border-l"), true);
  assert.ok(guide.querySelector('[data-sesion="p"]'));
  assert.equal(guide.querySelector('[data-sesion="shared"]'), null, "la rama nace plegada");
  const folderToggle = grouped.w.document.querySelector('[data-destino="folder"] button[aria-expanded]');
  assert.ok(folderToggle);
  const projectRow = folderToggle.parentElement;
  assert.ok(projectRow.classList.contains("grid-cols-[20px_minmax(0,1fr)_auto_auto]"));
  assert.equal(projectRow.children.length, 4);
  assert.equal(projectRow.lastElementChild.getAttribute("aria-label"), "Nueva tarea en Carpeta");
  folderToggle.click(); await espera(30);
  assert.equal(grouped.w.document.querySelector('[data-project-sessions="folder"]'), null);
  folderToggle.click(); await espera(30);
  assert.ok(grouped.w.document.querySelector('[data-project-sessions="folder"] [data-sesion="p"]'));
  assert.deepEqual(grouped.fallos, []);
  const newTaskClick = await arrancar("listo", "new-task-click", CON_TAREA);
  let newTaskRequests = 0;
  newTaskClick.w.addEventListener("harness:tarea-nueva", () => newTaskRequests++);
  newTaskClick.w.document.querySelector('[data-sesion="s1"]').click();
  await espera(100);
  for (const collapsed of [false, true]) {
    const taskTab = newTaskClick.w.document.querySelector('[role="tab"]');
    taskTab.click();
    await espera(50);
    assert.ok(newTaskClick.w.document.querySelector('[role="tab"][aria-selected="true"]'));
    if (collapsed) newTaskClick.w.document.querySelector('button[aria-label="Ocultar el historial"]').click();
    await espera(50);
    newTaskClick.w.document.querySelector('button[aria-label="Nueva tarea"]').click();
    await espera(50);
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
  const sidebarControls = await arrancar("listo", "sidebar-controls", {
    ...CON_TAREA,
    list_agent_profiles: { Giskard: { display_name: "Giskard PO", body: "moon" } },
    list_projects: () => structuredClone(folders),
    list_live_sessions: ({ project }) => project === "p1" ? [
      { ...CON_TAREA.list_live_sessions[0], launched_by: null, encargado: "executor" },
      { ...CON_TAREA.list_live_sessions[0], id: "agent-root", launched_by: "agent-chat", launcher_name: "Giskard", encargado: "Giskard" },
      { ...CON_TAREA.list_live_sessions[0], id: "orphan-root", launched_by: "deleted-chat", launcher_name: null },
      { ...CON_TAREA.list_live_sessions[0], id: "old-root" },
      { ...CON_TAREA.list_live_sessions[0], id: "same-author", launched_by: "another-topic", launcher_name: "Giskard", encargado: "Giskard" },
    ] : project === "" ? [{ ...CON_TAREA.list_live_sessions[0], id: "recent", title: recentTitle, last_message: recentPreview },
      ...(recentChild ? [{ ...CON_TAREA.list_live_sessions[0], id: "recent-child", parent: "recent" }] : [])] : [],
    rename_session: args => { taskRenames.push(args); recentTitle = args.title; },
    rename_project: ({ id, name }) => { folders[0].name = name; },
    get_project_directory: "/lab",
    list_project_repositories: ({ workspace }) => {
      assert.equal(workspace, "w");
      return [{ name: "acme/app", url: "git@github.com:acme/app.git", provider: "github", last_used: 2 },
        { name: "legacy/offline", url: "https://git.example.org/legacy/offline.git", provider: null, last_used: 1 }];
    },
    list_providers: [{ id: "github", name: "GitHub", connected: { identity: { user: "acme" } } },
      { id: "bitbucket", name: "Bitbucket", connected: { identity: { user: "team" } } }],
    provider_areas: ({ id, scope }) => { assert.equal(scope, "w"); return [{ key: id === "github" ? "acme" : "team", name: id === "github" ? "acme" : "team" }]; },
    provider_projects: ({ id, scope }) => {
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

  const agentSection = controlsDoc.querySelector('[data-sidebar-agents]');
  const agentSectionToggle = agentSection.querySelector("button");
  assert.equal(agentSectionToggle.getAttribute("aria-expanded"), "true");
  agentSectionToggle.click();
  await espera(20);
  assert.ok(!controlsDoc.querySelector('[data-sidebar-agents] ul'), "plegar la sección de agentes esconde sus filas");
  assert.equal(controlsDoc.querySelector("[data-sidebar-agents] button").getAttribute("aria-expanded"), "false");
  controlsDoc.querySelector("[data-sidebar-agents] button").click();
  await espera(20);
  assert.ok(controlsDoc.querySelector('[data-sidebar-agents] ul'));

  assert.equal(controlsDoc.querySelector("[data-session-origin]"), null);
  const savedTaskRow = controlsDoc.querySelector('[data-sesion="recent"]');
  const sidebarViewport = savedTaskRow.closest("[data-arrastre-scroll]");
  const savedAgentList = controlsDoc.querySelector('[data-sidebar-agents]');
  assert.ok(savedAgentList, "los agentes están en el mismo riel que las tareas");
  assert.ok(controlsDoc.querySelector('[data-sidebar-tasks] [data-sesion="agent-root"]'));
  assert.ok(controlsDoc.querySelector('[data-destino="p1"]'));
  assert.equal(controlsDoc.querySelector('[data-portfolio]'), null);
  assert.match(savedAgentList.textContent, /Nuevo agente/);
  const agentLoads = sidebarControls.comandos.filter(c => c === "list_encargados").length;
  sidebarViewport.scrollTop = 120;
  await espera(80);
  assert.equal(controlsDoc.querySelector('[data-sesion="recent"]'), savedTaskRow);
  assert.equal(controlsDoc.querySelector('[data-sidebar-agents]'), savedAgentList);
  assert.equal(sidebarControls.comandos.filter(c => c === "list_encargados").length, agentLoads);
  controlsDoc.querySelector('[data-destino="p1"] button[aria-haspopup="menu"]').click();
  await espera(50);
  [...controlsDoc.querySelectorAll('[role="menuitem"]')].find(item => item.textContent === "Nuevo agente").click();
  await espera(50);
  assert.match(controlsDoc.querySelector('[role="dialog"]').textContent, /Nuevo agente/);
  [...controlsDoc.querySelectorAll('[role="dialog"] button')].find(button => button.textContent === "Cancelar").click();
  await espera(50);
  [...controlsDoc.querySelectorAll('[data-destino="p1"] button')].find(b => b.textContent === "Carpeta A").dispatchEvent(new sidebarControls.w.MouseEvent("dblclick", { bubbles: true }));
  assert.ok(controlsDoc.querySelector('[data-destino="p1"] input'));
  const folderEditor = controlsDoc.querySelector('[data-destino="p1"] input');
  await espera(30);
  folderEditor.value = "Borrador de carpeta";
  folderEditor.dispatchEvent(new sidebarControls.w.Event("input", { bubbles: true }));
  folderEditor.setSelectionRange(3, 7);
  folders[0].working_directory = "/lab/updated";
  sidebarControls.emit("cli-changed", { workspace: "w", command: "task.send" });
  await espera(350);
  assert.equal(controlsDoc.querySelector('[data-destino="p1"] input'), folderEditor, "un aviso del agente no remonta la carpeta en edición");
  assert.equal(controlsDoc.activeElement, folderEditor);
  assert.equal(folderEditor.value, "Borrador de carpeta");
  assert.equal(folderEditor.selectionStart, 3);
  assert.equal(folderEditor.selectionEnd, 7);
  controlsDoc.querySelector('[data-destino="p1"] input').dispatchEvent(new sidebarControls.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  controlsDoc.querySelector('[data-sesion="recent"]').dispatchEvent(new sidebarControls.w.MouseEvent("dblclick", { bubbles: true }));
  await espera(30);
  const taskEditor = controlsDoc.querySelector('[data-sesion="recent"] input');
  assert.ok(taskEditor);
  taskEditor.value = "Borrador de tarea";
  taskEditor.dispatchEvent(new sidebarControls.w.Event("input", { bubbles: true }));
  taskEditor.setSelectionRange(2, 5);
  recentPreview = "El agente sigue trabajando";
  recentChild = true;
  sidebarControls.emit("chat", { kind: "started", workspace: "w", session: "recent" });
  sidebarControls.emit("session", { workspace: "w", project: "", session: "recent" });
  await espera(350);
  assert.equal(controlsDoc.querySelector('[data-sesion="recent"] input'), taskEditor, "actualizar el mensaje de la tarea no recrea su editor");
  assert.equal(controlsDoc.activeElement, taskEditor);
  assert.equal(taskEditor.value, "Borrador de tarea");
  assert.equal(taskEditor.selectionStart, 2);
  assert.equal(taskEditor.selectionEnd, 5);
  assert.match(controlsDoc.querySelector('[data-sesion="recent"] [data-session-preview]').textContent, /El agente sigue trabajando/);
  assert.deepEqual(taskRenames, [], "refrescar no guarda un nombre a medio escribir");
  taskEditor.dispatchEvent(new sidebarControls.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.deepEqual(taskRenames, [], "Escape descarta el borrador aunque el agente esté trabajando");
  controlsDoc.querySelector('[data-sesion="recent"]').dispatchEvent(new sidebarControls.w.MouseEvent("dblclick", { bubbles: true }));
  await espera(30);
  const confirmedEditor = controlsDoc.querySelector('[data-sesion="recent"] input');
  confirmedEditor.value = "Nombre confirmado";
  confirmedEditor.dispatchEvent(new sidebarControls.w.Event("input", { bubbles: true }));
  confirmedEditor.closest("form").dispatchEvent(new sidebarControls.w.Event("submit", { bubbles: true, cancelable: true }));
  await espera(50);
  assert.deepEqual(taskRenames, [{ project: "", id: "recent", title: "Nombre confirmado" }], "confirmar guarda una sola vez durante el turno");
  sidebarControls.emit("chat", { kind: "done", workspace: "w", session: "recent", ok: true });
  const recentArrow = () => controlsDoc.querySelector('[data-destino=""] button svg.lucide-chevron-right');
  assert.ok(controlsDoc.querySelector('[data-sesion="recent"]'));
  recentArrow().dispatchEvent(new sidebarControls.w.MouseEvent("click", { bubbles: true }));
  await espera(50);
  assert.equal(controlsDoc.querySelector('[data-sesion="recent"]'), null);
  recentArrow().dispatchEvent(new sidebarControls.w.MouseEvent("click", { bubbles: true }));
  await espera(50);
  assert.ok(controlsDoc.querySelector('[data-sesion="recent"]'));
  controlsDoc.querySelector('button[aria-label="Añadir un proyecto"]').click();
  await espera(50);
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
  await espera(50);
  controlsDoc.querySelector('[role="dialog"] form').dispatchEvent(new sidebarControls.w.Event("submit", { bubbles: true, cancelable: true }));
  await espera(50);
  assert.equal(cloneRequest.provider, "github");
  assert.equal(cloneRequest.url, "https://github.com/acme/app.git");
  finishClone({ id: "provider-clone", name: "App", kind: "git", sources: [] });
  await espera(100);
  holdRepositoryReply = true;
  controlsDoc.querySelector('button[aria-label="Añadir un proyecto"]').click();
  await espera(50);
  controlsDoc.dispatchEvent(new sidebarControls.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await espera(50);
  holdRepositoryReply = false;
  controlsDoc.querySelector('button[aria-label="Añadir un proyecto"]').click();
  await espera(50);
  finishRepositoryReply([{ name: "stale", slug: "stale", clone_url: "https://github.com/acme/stale.git" }]);
  await espera(50);
  const newRepositorySearch = controlsDoc.querySelector('input[placeholder="Buscar proyecto"]');
  newRepositorySearch.value = "stale";
  newRepositorySearch.dispatchEvent(new sidebarControls.w.Event("input", { bubbles: true }));
  assert.ok(!controlsDoc.querySelector('[role="dialog"]').textContent.includes("acme/stale"), "una respuesta del selector cerrado no entra al nuevo");
  newRepositorySearch.value = "";
  newRepositorySearch.dispatchEvent(new sidebarControls.w.Event("input", { bubbles: true }));
  await espera(50);
  [...controlsDoc.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.includes("Empezar vacía")).click();
  await espera(50);
  const folderName = controlsDoc.querySelector('[role="dialog"] input');
  folderName.value = "Carpeta suelta";
  folderName.dispatchEvent(new sidebarControls.w.Event("input", { bubbles: true }));
  folderName.closest("form").dispatchEvent(new sidebarControls.w.Event("submit", { bubbles: true, cancelable: true }));
  await espera(100);
  assert.ok(controlsDoc.querySelector('[data-destino="loose"]'));
  assert.deepEqual(sidebarControls.fallos, []);
  const openClone = async () => {
    controlsDoc.querySelector('button[aria-label="Añadir un proyecto"]').click();
    await espera(50);
    [...controlsDoc.querySelectorAll('[role="dialog"] button')].find(button => button.textContent.includes("Git URL")).click();
    await espera(50);
    const input = controlsDoc.querySelector('[role="dialog"] input');
    input.value = "https://example.invalid/repo.git";
    input.dispatchEvent(new sidebarControls.w.Event("input", { bubbles: true }));
    input.closest("form").dispatchEvent(new sidebarControls.w.Event("submit", { bubbles: true, cancelable: true }));
    await espera(50);
  };
  await openClone();
  assert.equal(cloneRequest.workspace, "w");
  assert.equal(cloneRequest.provider, null);
  assert.equal(controlsDoc.querySelector('[role="progressbar"]'), null);
  cloneRequest.progress.onmessage({ phase: "receiving", percent: 42 });
  await espera(50);
  assert.equal(controlsDoc.querySelector('[role="progressbar"]').getAttribute("aria-valuenow"), "42");
  [...controlsDoc.querySelectorAll('[role="dialog"] button')].find(button => button.textContent === "Continuar en segundo plano").click();
  await espera(100);
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
  await espera(50);
  [...controlsDoc.querySelectorAll('[role="dialog"] button')].find(button => button.textContent === "Cancelar").click();
  await espera(100);
  assert.equal(cloneCancellations, 1);
  assert.ok(controlsDoc.querySelector('[role="dialog"]').textContent.includes("Clonado cancelado."));
  // Cancelado y con el diálogo escondido, el riel sigue diciendo que ese clon
  // falló: sin la fila, el intento desaparece de la lista sin dejar rastro.
  assert.ok([...controlsDoc.querySelectorAll("aside button")].some(button => button.textContent.includes("Clonado fallido")));
  [...controlsDoc.querySelectorAll('[role="dialog"] button')].find(button => button.textContent === "Atrás").click();
  await espera(50);
  assert.equal([...controlsDoc.querySelectorAll("aside button")].some(button => button.textContent.includes("Clonado fallido")), false);
  controlsDoc.dispatchEvent(new sidebarControls.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await espera(50);
  await openClone();
  finishClone({ id: "clone", name: "Cloned", kind: "git", sources: [] });
  await espera(100);
  assert.equal(controlsDoc.querySelector('[role="dialog"]'), null);
  assert.deepEqual(sidebarControls.fallos, []);
  const branchSubmissions = [];
  let finishBranchRefresh;
  let finishBranchDetails;
  const localBranches = { selected: "refs/heads/dev", fetched_at: null, branches: [
    { reference: "refs/heads/dev", name: "dev", remote: false, commit: "abc", ahead: 1, behind: 0 },
    { reference: "refs/remotes/origin/dev", name: "origin/dev", remote: true, commit: "def", ahead: null, behind: null },
  ] };
  const branchPicker = await arrancar("listo", "task-base-picker", {
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
  [...branchDoc.querySelectorAll('[data-destino="git-project"] button')].find(b => b.textContent.trim() === "Laboratorio").click();
  await espera(100);
  [...branchDoc.querySelectorAll("header button")].find(b => b.textContent.trim() === "Nueva tarea").click();
  await espera(100);
  await espera(50);
  const branchButton = branchDoc.querySelector('button[aria-label="Rama base"]');
  const projectButton = branchDoc.querySelector('button[aria-label="Proyecto"]');
  assert.ok(projectButton.parentElement.contains(branchButton), "project and branch share the context row");
  assert.equal(branchButton.closest("form"), null);
  assert.equal(branchButton.textContent.trim(), "dev");
  branchDoc.querySelector('button[aria-label="Rama base"]').click();
  await espera(100);
  assert.equal(typeof finishBranchDetails, "function");
  assert.equal(branchDoc.querySelector('button[aria-label="Rama base"]').textContent.trim(), "dev");
  assert.ok([...branchDoc.querySelectorAll("button")].some(button => button.textContent === "dev"));
  const mentionReads = branchPicker.comandos.filter(command => command === "list_mentions").length;
  const typingPrompt = branchDoc.querySelector("textarea");
  for (let index = 0; index < 100; index += 1) {
    typingPrompt.value = `Texto ${index}`;
    typingPrompt.dispatchEvent(new branchPicker.w.Event("input", { bubbles: true }));
  }
  await espera(30);
  assert.equal(branchPicker.comandos.filter(command => command === "list_mentions").length, mentionReads);
  [...branchDoc.querySelectorAll("button")].find(button => button.textContent.includes("Actualizar ramas")).click();
  await espera(30);
  assert.equal(typeof finishBranchRefresh, "function");
  assert.equal(branchDoc.querySelector('button[aria-label="Rama base"]').disabled, false);
  [...branchDoc.querySelectorAll("button")].find(b => b.textContent === "origin").click();
  await espera(30);
  [...branchDoc.querySelectorAll("button")].find(b => b.textContent === "origin/dev").click();
  await espera(50);
  assert.equal(branchDoc.querySelector('button[aria-label="Rama base"]').textContent.trim(), "origin/dev");
  branchDoc.querySelector('button[aria-label^="Modelo: GPT-5.6"]').click();
  await espera(30);
  [...branchDoc.querySelectorAll('[role="option"]')].find(button => button.textContent.includes("GPT Alternate")).click();
  await espera(30);
  if (!branchDoc.querySelector('[role="group"][aria-label="Cuánto piensa antes de responder"]')) {
    branchDoc.querySelector('button[aria-label^="Modelo: GPT Alternate"]').click();
    await espera(30);
  }
  [...branchDoc.querySelectorAll('[role="group"][aria-label="Cuánto piensa antes de responder"] button')].find(button => button.textContent.trim() === "Alto").click();
  await espera(30);
  branchDoc.querySelector('[data-sesion="s1"]').click();
  await espera(100);
  assert.ok(branchDoc.querySelector('button[aria-label^="Modelo: GPT-5.6"]'));
  branchDoc.querySelector('[data-destino="git-project"] button[title="Nueva tarea en Laboratorio"]').click();
  await espera(100);
  assert.equal(branchDoc.querySelector("textarea").value, "Texto 99");
  assert.equal(branchDoc.querySelector('button[aria-label="Rama base"]').textContent.trim(), "origin/dev");
  assert.ok(branchDoc.querySelector('button[aria-label="Modelo: GPT Alternate. Razonamiento: Alto"]'), "el razonamiento elegido sigue en la caja");
  const branchPrompt = branchDoc.querySelector("textarea");
  finishBranchRefresh();
  finishBranchDetails();
  await espera(30);
  assert.equal(branchDoc.querySelector('button[aria-label="Rama base"]').textContent.trim(), "origin/dev");
  branchPrompt.value = "Comprueba la rama";
  branchPrompt.dispatchEvent(new branchPicker.w.Event("input", { bubbles: true }));
  branchPrompt.closest("form").dispatchEvent(new branchPicker.w.Event("submit", { bubbles: true, cancelable: true }));
  await espera(100);
  assert.equal(branchSubmissions[0]?.baseRef, "refs/remotes/origin/dev");
  assert.equal(branchSubmissions[0]?.model, "gpt-alternate");
  assert.equal(branchSubmissions[0]?.effort, "high");
  [...branchDoc.querySelectorAll('[data-destino="git-project"] button')].find(b => b.textContent.trim() === "Laboratorio").click();
  await espera(100);
  [...branchDoc.querySelectorAll("header button")].find(b => b.textContent.trim() === "Nueva tarea").click();
  await espera(100);
  assert.equal(branchDoc.querySelector('button[aria-label="Rama base"]').textContent.trim(), "dev");
  const defaultPrompt = branchDoc.querySelector("textarea");
  defaultPrompt.value = "Usa la predeterminada del proyecto";
  defaultPrompt.dispatchEvent(new branchPicker.w.Event("input", { bubbles: true }));
  defaultPrompt.closest("form").dispatchEvent(new branchPicker.w.Event("submit", { bubbles: true, cancelable: true }));
  await espera(100);
  assert.equal(branchSubmissions[1]?.baseRef, null, "automatic default is resolved by the backend, not stored as a task override");
  assert.deepEqual(branchPicker.fallos, []);
  const deadBase = { selected: "refs/heads/borrada", fetched_at: null, branches: [
    { reference: "refs/heads/dev", name: "dev", remote: false, commit: "abc", ahead: null, behind: null },
  ] };
  const missingBase = await arrancar("listo", "task-base-missing", {
    ...RESPUESTAS,
    list_projects: [{ id: "git-project", name: "Laboratorio", kind: "git", working_directory: "/lab", sources: [] }],
    project_base_branches: () => deadBase,
  });
  const missingDoc = missingBase.w.document;
  [...missingDoc.querySelectorAll('[data-destino="git-project"] button')].find(b => b.textContent.trim() === "Laboratorio").click();
  await espera(100);
  [...missingDoc.querySelectorAll("header button")].find(b => b.textContent.trim() === "Nueva tarea").click();
  await espera(100);
  const missingButton = missingDoc.querySelector('button[aria-label="Rama base"]');
  assert.equal(missingButton.textContent.trim(), "borrada");
  assert.ok(missingButton.className.includes("text-error-strong"), "a saved base that no longer exists is painted with the error token");
  assert.ok([...missingDoc.querySelectorAll("span")].some(span => span.textContent === "La rama base ya no existe. Elige otra antes de iniciar la tarea."));
  missingButton.click();
  await espera(100);
  assert.ok([...missingDoc.querySelectorAll("button")].some(button => button.textContent === "dev"));
  assert.deepEqual(missingBase.fallos, []);
  const fastTurn = await arrancar("listo", "done-before-ack", {
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
  await espera(100);
  assert.equal(fastTurn.comandos.includes("send_message"), true);
  assert.equal(fastTurn.w.document.querySelector('button[aria-label="Detener turno"]'), null);
  assert.ok(fastTurn.w.document.body.textContent.includes("Respuesta terminada antes del acuse"));
  assert.deepEqual(fastTurn.fallos, []);

  // Lo que llega con el turno ya cerrado no se pinta bajo «Trabajando», y la
  // fila vieja de que una tarea lanzada terminó ya no se pinta.
  const lateNotice = await arrancar("listo", "late-notice", {
    ...CON_TAREA,
    load_session: { ...CON_TAREA.load_session, turns: [
      { role: "agent", id: "answer", text: "Revisé todo." },
      { role: "system", text: "Se guardó el árbol.", meta: null },
      { role: "system", text: "La tarea «Revisión» terminó: listo.", meta: "task_completed",
        from_task: { folder: "", task: "child", title: "Revisión", agent: "claude" } },
    ] },
  });
  const lateDoc = lateNotice.w.document;
  lateDoc.querySelector('[data-sesion="s1"]').click();
  await espera(150);
  assert.ok(lateDoc.body.textContent.includes("Revisé todo."));
  assert.ok(!lateDoc.body.textContent.includes("La tarea «Revisión» terminó: listo."));
  assert.equal(lateDoc.querySelector('button[aria-label="Abrir la tarea «Revisión»"]'), null);
  lateNotice.emit("chat", { kind: "notice", session: "s1", workspace: "w", text: "La tarea «Otra» terminó." });
  await espera(100);
  assert.doesNotMatch(lateDoc.body.textContent, /Trabajando/);
  assert.deepEqual(lateNotice.fallos, []);

  let activeTurns = [];
  let finishPendingTurn;
  let registeredTurns = [];
  let hiddenTurnOutcome = null;
  const pendingTurnApp = await arrancar("listo", "reconcile-during-inflight-send", {
    ...CON_TAREA,
    list_live_sessions: () => [{ ...CON_TAREA.list_live_sessions[0], outcome: hiddenTurnOutcome }, { ...CON_TAREA.list_live_sessions[0], id: "s2", title: "Otra tarea" }],
    load_session: ({ id }) => ({ ...CON_TAREA.load_session, id }),
    list_active_turns: () => registeredTurns,
    send_message: () => new Promise(resolve => { finishPendingTurn = resolve; }),
  });
  const pendingDoc = pendingTurnApp.w.document;
  pendingDoc.querySelector('[data-sesion="s1"]').click();
  await espera(80);
  const pendingInput = pendingDoc.querySelector("textarea");
  pendingInput.value = "Trabaja un rato";
  pendingInput.dispatchEvent(new pendingTurnApp.w.Event("input", { bubbles: true }));
  pendingInput.closest("form").dispatchEvent(new pendingTurnApp.w.Event("submit", { bubbles: true, cancelable: true }));
  await espera(50);
  assert.equal(typeof finishPendingTurn, "function");
  pendingTurnApp.w.dispatchEvent(new pendingTurnApp.w.Event("focus"));
  await espera(50);
  assert.ok(pendingDoc.querySelector('button[aria-label="Detener turno"]'), "preparation must not look finished before registration");
  registeredTurns = ["s1", "s2"];
  pendingTurnApp.w.dispatchEvent(new pendingTurnApp.w.Event("focus"));
  await espera(50);
  pendingDoc.querySelector('[data-sesion="s2"]').click();
  await espera(80);
  assert.ok(pendingDoc.querySelector('button[aria-label="Detener turno"]'), "recover another live task while send_message remains pending");
  registeredTurns = ["s1"];
  pendingTurnApp.w.dispatchEvent(new pendingTurnApp.w.Event("focus"));
  await espera(80);
  assert.equal(pendingDoc.querySelector('button[aria-label="Detener turno"]'), null, "recover a missed finish while another send remains pending");
  finishPendingTurn("s1");
  await espera(80);
  const hiddenRow = () => pendingDoc.querySelector('[data-sesion="s1"]');
  assert.ok(hiddenRow().querySelector('[aria-label="Está trabajando"]'));
  pendingTurnApp.emit("chat", { kind: "delta", session: "s1", workspace: "w", text: "Respuesta parcial" });
  pendingTurnApp.w.dispatchEvent(new pendingTurnApp.w.Event("focus"));
  await espera(80);
  assert.ok(hiddenRow().querySelector('[aria-label="Está trabajando"]'), "streaming and reconciliation preserve activity in a hidden task");
  hiddenTurnOutcome = "delivered";
  registeredTurns = [];
  pendingTurnApp.w.dispatchEvent(new pendingTurnApp.w.Event("focus"));
  await espera(80);
  assert.equal(hiddenRow().querySelector('[aria-label="Está trabajando"]'), null);
  assert.ok(hiddenRow().querySelector('[aria-label="Resultado entregado"]'), "recovering a missed done refreshes the hidden task result");
  assert.deepEqual(pendingTurnApp.fallos, []);
  pendingTurnApp.w.close();

  let finishTranscript;
  let finishActiveRead;
  const liveReplies = {
    ...CON_TAREA,
    list_active_turns: () => activeTurns,
    stop_turn: null,
  };
  const liveState = await arrancar("listo", "authoritative-turn-state", liveReplies);
  const liveDoc = liveState.w.document;
  liveDoc.querySelector('[data-sesion="s1"]').click();
  await espera(80);
  activeTurns = ["s1"];
  liveState.emit("chat", { kind: "started", session: "s1", workspace: "w" });
  await espera(30);
  assert.ok(liveDoc.querySelector('button[aria-label="Detener turno"]'));
  liveState.emit("chat", { kind: "tool", session: "s1", workspace: "w", id: "sin-cierre", text: "Bash", target: "pnpm verificar" });
  liveState.emit("chat", { kind: "delta", session: "s1", workspace: "w", text: "Respuesta final" });
  await espera(30);
  assert.match(liveDoc.body.textContent, /Ejecutando 1 comando/);
  liveReplies.load_session = () => new Promise(resolve => { finishTranscript = resolve; });
  activeTurns = [];
  liveState.emit("chat", { kind: "done", session: "s1", workspace: "w", ok: true });
  await espera(30);
  assert.equal(liveDoc.querySelector('button[aria-label="Detener turno"]'), null, "done stops activity before transcript loads");
  assert.doesNotMatch(liveDoc.body.textContent, /Ejecutando 1 comando/, "a finished turn cannot keep a tool running while its transcript loads");
  assert.match(liveDoc.body.textContent, /Ejecutó 1 comando/);
  finishTranscript(CON_TAREA.load_session);
  await espera(30);
  liveReplies.load_session = CON_TAREA.load_session;
  activeTurns = ["s1"];
  liveState.emit("chat", { kind: "started", session: "s1", workspace: "w" });
  await espera(30);
  activeTurns = [];
  liveState.w.dispatchEvent(new liveState.w.Event("focus"));
  await espera(50);
  assert.equal(liveDoc.querySelector('button[aria-label="Detener turno"]'), null, "authoritative registry recovers a lost done event");
  liveReplies.list_active_turns = () => new Promise(resolve => { finishActiveRead = resolve; });
  liveState.w.dispatchEvent(new liveState.w.Event("focus"));
  await espera(20);
  activeTurns = ["s1"];
  liveState.emit("chat", { kind: "started", session: "s1", workspace: "w" });
  finishActiveRead([]);
  await espera(30);
  assert.ok(liveDoc.querySelector('button[aria-label="Detener turno"]'), "an old snapshot cannot stop a newly started turn");
  liveReplies.list_active_turns = () => [];
  liveDoc.querySelector('button[aria-label="Detener turno"]').click();
  await espera(60);
  assert.equal(liveDoc.querySelector('button[aria-label="Detener turno"]'), null);
  assert.ok(!liveDoc.body.textContent.includes("No se pudo detener"));
  assert.deepEqual(liveState.fallos, []);

  // El registro ve el cierre antes que el done: la cola retenida sin desenlace sale cuando el done llega.
  {
    let activos = [];
    const envios = [];
    const app = await arrancar("listo", "late-done-releases-queue", {
      ...CON_TAREA,
      list_active_turns: () => activos,
      save_queue: null,
      load_queue: [],
      queue_ready: false,
      send_message: (args) => { envios.push(args.prompt); return "s1"; },
    });
    const doc = app.w.document;
    doc.querySelector('[data-sesion="s1"]').click();
    await espera(80);
    activos = ["s1"];
    app.emit("chat", { kind: "started", session: "s1", workspace: "w" });
    await espera(30);
    const campo = doc.querySelector("textarea");
    campo.value = "Pendiente";
    campo.dispatchEvent(new app.w.Event("input", { bubbles: true }));
    campo.closest("form").dispatchEvent(new app.w.Event("submit", { bubbles: true, cancelable: true }));
    await espera(50);
    activos = [];
    app.w.dispatchEvent(new app.w.Event("focus"));
    await espera(80);
    assert.equal(envios.length, 0, "a turn closed without its outcome keeps the queue");
    app.emit("chat", { kind: "done", session: "s1", workspace: "w", ok: true });
    await espera(200);
    assert.deepEqual(envios, ["Pendiente"], "the late done releases the queue");
    assert.deepEqual(app.fallos, []);
    app.w.close();
  }
  // Y si la sesión vuelve a verse viva, el done ok es de otro turno: la cola sigue retenida.
  {
    let activos = [];
    const envios = [];
    const app = await arrancar("listo", "later-turn-keeps-draft", {
      ...CON_TAREA,
      list_active_turns: () => activos,
      save_queue: null,
      load_queue: [],
      queue_ready: false,
      send_message: (args) => { envios.push(args.prompt); return "s1"; },
    });
    const doc = app.w.document;
    doc.querySelector('[data-sesion="s1"]').click();
    await espera(80);
    activos = ["s1"];
    app.emit("chat", { kind: "started", session: "s1", workspace: "w" });
    await espera(30);
    const campo = doc.querySelector("textarea");
    campo.value = "Pendiente";
    campo.dispatchEvent(new app.w.Event("input", { bubbles: true }));
    campo.closest("form").dispatchEvent(new app.w.Event("submit", { bubbles: true, cancelable: true }));
    await espera(50);
    activos = [];
    app.w.dispatchEvent(new app.w.Event("focus"));
    await espera(80);
    activos = ["s1"];
    app.w.dispatchEvent(new app.w.Event("focus"));
    await espera(80);
    activos = [];
    app.emit("chat", { kind: "done", session: "s1", workspace: "w", ok: true });
    await espera(200);
    assert.deepEqual(envios, [], "a later turn's done does not release the draft of one that closed without outcome");
    assert.deepEqual(app.fallos, []);
    app.w.close();
  }

  {
    for (const child of [false, true]) {
      const stops = [];
      const escapeApp = await arrancar("listo", `escape-${child}`, {
        ...CON_TAREA,
        load_session: { ...CON_TAREA.load_session, subagent: child ? "native-child" : null, parent: child ? "parent" : null },
        stop_turn: (args) => { stops.push(args); },
        list_active_turns: ["s1"],
      });
      const document = escapeApp.w.document;
      document.querySelector('[data-sesion="s1"]').click();
      await espera(80);
      escapeApp.emit("chat", { kind: "started", session: "s1", workspace: "w" });
      await espera(30);
      const input = document.querySelector("textarea");
      input.focus();
      input.dispatchEvent(new escapeApp.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await espera(50);
      assert.deepEqual(stops, [{ project: "", session: "s1" }], "Escape reaches the viewed task");
      assert.deepEqual(escapeApp.fallos, []);
      escapeApp.w.close();
    }
  }

  for (const attachment of ["/tmp/Captura México.png", "/tmp/notes.pdf"]) {
    let accept;
    let reject;
    const calls = [];
    const queued = { id: "attached", text: "", agent: "codex", model: null, effort: null, attachments: [attachment] };
    const app = await arrancar("listo", `steer-attachment-${attachment}`, {
      ...CON_TAREA, load_queue: [queued], save_queue: null, queue_ready: false,
      list_active_turns: ["s1"],
      inject_message: (args) => { calls.push(args); return new Promise((resolve, fail) => { accept = resolve; reject = fail; }); },
    });
    const doc = app.w.document;
    doc.querySelector('[data-sesion="s1"]').click();
    await espera(100);
    app.emit("chat", { kind: "started", session: "s1", workspace: "w" });
    app.emit("chat", { kind: "tool", session: "s1", workspace: "w", id: "build", text: "Bash", target: "build" });
    await espera(50);
    const button = () => doc.querySelector('button[title="Mandar ahora"]');
    assert.ok(button(), "attachments can steer a running tool");
    button().click();
    await espera(50);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].attachments, [attachment]);
    assert.equal(calls[0].prompt, "");
    assert.equal(button().disabled, true);
    reject("chat.steer.unconfirmed");
    await espera(50);
    assert.ok(button(), "failed delivery keeps the attachment queued for retry");
    assert.equal(button().disabled, false);
    button().click();
    await espera(50);
    accept(null);
    await espera(80);
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
  const steerState = await arrancar("listo", "pending-steer", steerReplies);
  steerState.w.document.querySelector('[data-sesion="s1"]')?.click();
  await espera(150);
  steerState.emit("chat", { kind: "started", session: "s1", workspace: "w" });
  steerState.emit("chat", { kind: "tool", session: "s1", workspace: "w", id: "steer-command", text: "Bash", target: "sleep 30" });
  await espera(50);
  const steerStatus = steerState.w.document.querySelector('[role="status"][aria-label="El agente está trabajando"]');
  assert.match(steerStatus?.textContent ?? "", /Ejecutando/);
  assert.doesNotMatch(steerStatus?.textContent ?? "", /sleep 30/);
  const steerInput = steerState.w.document.querySelector("textarea");
  steerInput.value = "Corrige durante el turno";
  steerInput.dispatchEvent(new steerState.w.Event("input", { bubbles: true }));
  steerInput.closest("form").dispatchEvent(new steerState.w.Event("submit", { bubbles: true, cancelable: true }));
  await espera(100);
  const sendNow = steerState.w.document.querySelector('button[title="Mandar ahora"]');
  assert.ok(sendNow);
  assert.equal(steerInput.disabled, false, "tool execution keeps the composer editable");
  assert.equal(sendNow.disabled, false, "tool execution allows native steering before the command finishes");
  sendNow.click();
  sendNow.click();
  await espera(50);
  assert.equal(injections, 1, "double click must not inject the queued message twice");
  assert.equal(sendNow.disabled, true);
  const pendingRow = sendNow.closest("li");
  assert.ok([...pendingRow.querySelectorAll("button")].every(button => button.disabled));
  steerState.w.document.querySelector('[data-sesion="s2"]').click();
  await espera(100);
  steerReplies.list_active_turns = [];
  steerState.emit("chat", { kind: "done", session: "s1", workspace: "w", ok: true });
  await espera(150);
  assert.equal(steerState.comandos.filter(command => command === "send_message").length, 0, "done before steering ACK must not dispatch the same message");
  acknowledgeSteer(null);
  await espera(100);
  steerState.w.document.querySelector('[data-sesion="s1"]').click();
  await espera(150);
  assert.equal(steerState.w.document.querySelector('button[title="Mandar ahora"]'), null);
  assert.equal(steerState.comandos.filter(command => command === "send_message").length, 0);
  assert.deepEqual(steerState.fallos, []);

  // El menú del proyecto no ofrece un historial de tareas, y nadie pide las
  // archivadas por proyecto.
  const historia = await arrancar("listo", 6, {
    ...CON_TAREA,
    list_projects: [{ id: "p1", name: "Laboratorio", node: null, sources: [], working_directory: "/lab", created_at: 1, updated_at: 1, sessions: 1, kind: "folder" }],
  });
  historia.w.document.querySelector('button[aria-label="Acciones del proyecto «Laboratorio»"]')?.click();
  await espera(50);
  const acciones = [...historia.w.document.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent?.trim());
  assert.ok(acciones.length > 0, "el menú del proyecto se abre");
  assert.equal(acciones.includes("Historial de tareas"), false, "el menú del proyecto ya no ofrece el historial");
  await espera(150);
  assert.equal(historia.comandos.includes("list_archived"), false, "la ventana no pide las archivadas por proyecto");
  assert.equal(historia.comandos.includes("list_sessions"), false, "la ventana no pide la lista completa");
  assert.deepEqual(historia.fallos, []);
  const pestanaDe = (app, titulo) => [...app.w.document.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent?.includes(titulo));

  let archivadaEnDisco = false;
  const viva = { ...CON_TAREA.list_live_sessions[0], archived: false };
  const archivar = await arrancar("listo", "archivar-cierra", {
    ...CON_TAREA,
    list_live_sessions: ({ open }) => [
      ...(!archivadaEnDisco ? [viva] : open?.includes("s1") ? [{ ...viva, archived: true }] : []),
      { ...viva, id: "s2", title: "Segunda tarea" },
    ],
  });
  archivar.w.document.querySelector('[data-sesion="s1"]').click();
  await espera(150);
  archivar.w.document.querySelector('[data-sesion="s2"]').click();
  await espera(150);
  assert.ok(pestanaDe(archivar, "Una tarea"));
  archivadaEnDisco = true;
  archivar.emit("session", { project: "", session: "s1", workspace: "w" });
  await espera(500);
  assert.equal(pestanaDe(archivar, "Una tarea"), undefined, "archivar una tarea viva cierra su pestaña");
  assert.ok(pestanaDe(archivar, "Segunda tarea"), "la otra pestaña sigue");
  assert.equal(archivar.comandos.includes("list_sessions"), false);
  assert.deepEqual(archivar.fallos, []);
  const removedFromMenu = new Set();
  const menuActions = [];
  const fromAnotherTask = await arrancar("listo", "actions-from-another-task", {
    ...CON_TAREA,
    list_live_sessions: () => ["s1", "s2", "s3"]
      .filter(id => !removedFromMenu.has(id))
      .map(id => ({ ...viva, id, title: `Tarea ${id}` })),
    task_blockers: () => ({ unsaved: [], not_finished: false }),
    set_task_archived: args => { menuActions.push(["archive", args]); removedFromMenu.add(args.id); },
    delete_session: args => { menuActions.push(["delete", args]); removedFromMenu.add(args.id); },
  });
  const menuDoc = fromAnotherTask.w.document;
  const selectedTask = () => menuDoc.querySelector('[data-sesion][aria-current="true"]')?.getAttribute("data-sesion");
  const menuItem = label => [...menuDoc.querySelectorAll('[role="menuitem"]')].find(el => el.textContent.trim() === label);
  const openTaskMenu = id => menuDoc.querySelector(`[data-sesion="${id}"] [aria-haspopup="menu"]`).click();
  menuDoc.querySelector('[data-sesion="s1"]').click();
  await espera(100);
  openTaskMenu("s2");
  await espera(30);
  menuItem("Archivar tarea").click();
  await espera(100);
  assert.equal(selectedTask(), "s1", "archivar desde el menú no abre la tarea archivada");
  assert.deepEqual(menuActions[0], ["archive", { project: "", id: "s2", archived: true }]);
  openTaskMenu("s3");
  await espera(30);
  menuItem("Borrar la tarea").click();
  await espera(30);
  assert.equal(selectedTask(), "s1", "pedir el borrado no abre la tarea elegida");
  menuDoc.querySelector('[role="alertdialog"] button').click();
  await espera(100);
  assert.equal(selectedTask(), "s1", "confirmar el borrado conserva la tarea abierta");
  assert.deepEqual(menuActions[1], ["delete", { project: "", id: "s3", force: false }]);
  assert.deepEqual(fromAnotherTask.fallos, []);
  let recreated = false;
  let rejectRecreation = true;
  const resumeCalls = [];
  const retired = await arrancar("listo", "retired-worktree", {
    ...CON_TAREA,
    task_history: () => ({ ...CON_TAREA.task_history, available: recreated, recreatable: !recreated }),
    recreate_task_work: (args) => {
      resumeCalls.push(args);
      if (rejectRecreation) return Promise.reject(new Error("repository unavailable"));
      recreated = true;
    },
  });
  retired.w.document.querySelector('[data-sesion="s1"]').click();
  await espera(100);
  assert.equal(retired.w.document.querySelector("textarea"), null);
  const resumeButton = () => [...retired.w.document.querySelectorAll("button")].find(b => b.textContent === "Volver a escribir");
  assert.ok(resumeButton());
  assert.equal(resumeCalls.length, 0);
  resumeButton().click();
  await espera(100);
  assert.equal(retired.w.document.querySelector("textarea"), null);
  assert.ok(resumeButton());
  rejectRecreation = false;
  resumeButton().click();
  await espera(150);
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
  const providers = await arrancar("listo", "provider-workspaces", {
    ...RESPUESTAS,
    list_workspaces: () => ({ ...RESPUESTAS.list_workspaces, active: providerWorkspace }),
    list_providers: ({ scope }) => [providerInfo(scope)],
    check_provider: ({ scope }) => providerInfo(scope),
    provider_areas: ({ scope }) => (selections.get(scope) ?? []).map(({ key }) => ({ key, name: key })),
    provider_available_areas: ({ scope }) => { providerCalls.push(scope); return scope === "ws-a" && pendingAreas ? pendingAreas : available; },
    select_provider_area: ({ scope, area, enabled }) => {
      const next = (selections.get(scope) ?? []).filter(({ key }) => key !== area);
      if (enabled) next.push({ key: area, installation_id: area === "acme" ? 42 : 43 });
      selections.set(scope, next);
      return providerInfo(scope);
    },
    provider_projects: ({ scope, area }) => {
      assert.ok(selections.get(scope)?.some(({ key }) => key === area));
      return [];
    },
    start_browser_login: () => {
      authentications += 1;
      return { code: "ABCD", url: "https://github.com/login/device", expires_at: 9999999999999 };
    },
    finish_browser_login: ({ scope }) => providerInfo(scope),
    provider_pending_setup: null,
    open_external: ({ target }) => {
      assert.ok(["https://github.com/login/device", "https://github.com/apps/terminus-app/installations/new"].includes(target));
      if (target.endsWith("/installations/new")) available = [{ key: "acme", name: "acme" }, { key: "other", name: "other" }];
    },
  });
  const providerButton = (text) => [...providers.w.document.querySelectorAll("button")]
    .find((button) => button.textContent?.trim() === text || button.getAttribute("aria-label") === text);
  const areaButton = (key) => [...providers.w.document.querySelectorAll("li")]
    .find((li) => li.textContent?.startsWith(key))
    ?.querySelectorAll("button");
  const clickArea = (key, text) => [...(areaButton(key) ?? [])]
    .find((button) => button.textContent?.trim() === text)?.click();
  const selectedKeys = (scope) => (selections.get(scope) ?? []).map(({ key }) => key);
  providers.w.document.querySelector('button[aria-label="Configuración"]')?.click();
  await espera(100);
  providerButton("Control de Fuentes")?.click();
  await espera(100);
  assert.ok(providerButton("Quitar del workspace"), "la conexión previa permite retirar su organización");
  assert.equal(providerButton("Usar en este workspace"), undefined, "agregar requiere autenticación");
  providerButton("Agregar desde GitHub")?.click();
  await espera(100);
  assert.equal(authentications, 1);
  assert.ok(providerButton("Usar en este workspace"), "GitHub permite elegir las instalaciones disponibles");
  assert.deepEqual(selectedKeys("ws-a"), ["acme"], "ampliar GitHub no cambia la selección");
  clickArea("other", "Usar en este workspace");
  await espera(100);
  assert.deepEqual(selectedKeys("ws-a"), ["acme", "other"]);
  providerButton("Listo")?.click();
  await espera(50);
  clickArea("acme", "Quitar del workspace");
  await espera(100);
  assert.deepEqual(selectedKeys("ws-a"), ["other"]);
  assert.equal(providerButton("Usar en este workspace"), undefined, "quitar no vuelve a ofrecer la organización");
  providerButton("Agregar desde GitHub")?.click();
  await espera(100);
  let finishOldAreas;
  pendingAreas = new Promise((resolve) => { finishOldAreas = resolve; });
  providerButton("ver qué alcanza")?.click();
  await espera(50);
  providerWorkspace = "ws-b";
  providers.w.dispatchEvent(new providers.w.CustomEvent("harness:workspace"));
  await espera(100);
  assert.ok(providers.w.document.body.textContent.includes("Sin organizaciones en este workspace"));
  providerButton("Agregar desde GitHub")?.click();
  await espera(100);
  clickArea("acme", "Usar en este workspace");
  await espera(100);
  finishOldAreas([{ key: "stale", name: "stale" }]);
  await espera(50);
  assert.ok(!providers.w.document.body.textContent.includes("stale"), "una respuesta vieja no cruza de workspace");
  assert.deepEqual(selectedKeys("ws-b"), ["acme"]);
  assert.deepEqual(selectedKeys("ws-a"), ["other"]);
  assert.equal(authentications, 3);
  assert.ok(providerCalls.includes("ws-a") && providerCalls.includes("ws-b"));
  assert.deepEqual(providers.fallos, []);
  let integrationStatus = { installed: true, enabled: false };
  let pendingIntegration = null;
  const integration = await arrancar("listo", 9, {
    ...RESPUESTAS,
    agentsview_status: () => pendingIntegration ?? integrationStatus,
  });
  const integrationButton = () => integration.w.document.querySelector('button[aria-label="Analytics"]');
  const workspaceChanged = () => integration.w.dispatchEvent(new integration.w.CustomEvent("harness:workspace"));
  assert.equal(integrationButton(), null);
  integrationStatus = { installed: true, enabled: true };
  workspaceChanged();
  await espera(30);
  assert.ok(integrationButton(), "switching to an enabled workspace reveals AgentsView");
  let finishIntegration;
  pendingIntegration = new Promise(resolve => { finishIntegration = resolve; });
  workspaceChanged();
  assert.equal(integrationButton(), null);
  pendingIntegration = null;
  integrationStatus = { installed: true, enabled: false };
  workspaceChanged();
  await espera(30);
  finishIntegration({ installed: true, enabled: true });
  await espera(30);
  assert.equal(integrationButton(), null, "a late response cannot enable AgentsView in another workspace");
  integration.emit("agentsview-changed", true);
  await espera(30);
  assert.equal(integrationButton(), null, "integration events must read the active workspace");
  integrationStatus = { installed: true, enabled: true };
  integration.emit("agentsview-changed", true);
  await espera(30);
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
  const plugins = await arrancar("listo", "plugins", {
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
  await espera(100);
  plugins.w.document.querySelector('#cfg-tab-plugins')?.click();
  await espera(100);
  const officeCard = () => [...plugins.w.document.querySelectorAll("div")].find(d => d.textContent === "LibreOffice")?.parentElement?.parentElement?.parentElement;
  const officeButton = (text) => [...officeCard().querySelectorAll("button")].find(b => b.textContent?.trim() === text);
  const officeSwitch = () => officeCard().querySelector('button[role="switch"][aria-label="Activar en este espacio"]');
  assert.ok(officeCard(), "Plugins offers LibreOffice alongside AgentsView");
  officeButton("Instalar").click();
  await espera(50);
  assert.deepEqual(pluginCalls, [["install", "libreoffice"]]);
  assert.equal(officeSwitch()?.getAttribute("aria-checked"), "false");
  officeSwitch().click();
  await espera(50);
  assert.equal(officeSwitch()?.getAttribute("aria-checked"), "true");
  assert.deepEqual(pluginCalls.at(-1), ["enable", "libreoffice", "w", true]);
  officeButton("Desinstalar").click();
  await espera(30);
  const removalDialog = () => [...plugins.w.document.querySelectorAll('[role="dialog"]')].find(d => d.textContent.includes("Desinstalar") && d.textContent.includes("Cancelar"));
  assert.ok(removalDialog(), "uninstall requires a visible confirmation");
  [...removalDialog().querySelectorAll("button")].find(b => b.textContent?.trim() === "Cancelar").click();
  await espera(30);
  assert.equal(pluginCalls.length, 2, "cancelling uninstall changes nothing");
  officeButton("Desinstalar").click();
  await espera(50);
  [...removalDialog().querySelectorAll("button")].find(b => b.textContent?.trim() === "Desinstalar").click();
  await espera(50);
  assert.deepEqual(pluginCalls.at(-1), ["uninstall", "libreoffice"]);
  assert.ok(officeButton("Instalar"));
  let finishCatalog;
  pendingCatalog = new Promise(resolve => { finishCatalog = resolve; });
  plugins.w.dispatchEvent(new plugins.w.CustomEvent("harness:workspace"));
  assert.equal(officeCard(), undefined);
  pendingCatalog = null;
  pluginWorkspace = "other";
  plugins.w.dispatchEvent(new plugins.w.CustomEvent("harness:workspace"));
  await espera(30);
  finishCatalog({ workspace: "w", plugins: [{ id: "libreoffice", installed: true, enabled: true, supported: true, version: "stale", bytes: 10 }] });
  await espera(30);
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
  const radiantApp = await arrancar("listo", "settings-radiant", {
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
    list_mcp_agents: () => [
      { id: "claude", label: "Claude Code", recibe: true, instalado: true, login: true },
      { id: "grok", label: "Grok", recibe: true, instalado: true, login: false,
        sin_login: { clave: "mcp.session.cli_has_none" } },
      { id: "codex", label: "Codex", recibe: false, instalado: false, login: true },
    ],
    mcp_login: ({ agent, id }) => {
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
    await espera(120);
  };
  const completarLogin = async () => {
    Object.assign(radiant, { signed_in: true, login: null });
    radiantApp.emit("radiant", null);
    await espera(120);
  };
  rDoc.querySelector('button[aria-label="Configuración"]')?.click();
  await espera(100);
  rDoc.querySelector("#cfg-tab-radiant")?.click();
  await espera(100);
  assert.ok(rPanel().textContent.includes(CLOUD), "Radiant Cloud enseña su origen");
  assert.equal(rBoton("Iniciar sesión"), undefined, "sin servidor elegido no hay sesión que iniciar");
  rBoton("Usar este servidor").click();
  await espera(80);
  assert.deepEqual(radiantCalls.at(-1), ["server", CLOUD]);
  assert.ok(rPanel().textContent.includes(`Sin sesión en ${CLOUD}.`));
  assert.ok(rBoton("Iniciar sesión"), "una instalación sin la CLI de Radiant ofrece iniciar sesión");
  rBoton("Iniciar sesión").click();
  await espera(80);
  assert.ok(rPanel().textContent.includes("WDJB-MJHT"), "el código se ve mientras se espera al navegador");
  assert.ok(rBoton("Cancelar"));
  assert.ok(rBoton("Servidor propio").disabled, "no se cambia de servidor con un login en vuelo");
  await completarLogin();
  assert.ok(
    rPanel().textContent.includes(`Sesión iniciada como ana@example.test · Danil en ${CLOUD}.`),
    "la cuenta y la organización salen del servidor",
  );
  const rSelect = rPanel().querySelector('select[aria-label="Workspace de Radiant"]');
  assert.ok(rSelect, "con sesión se elige workspace remoto");
  await rElegir(rSelect, "ops");
  assert.deepEqual(radiantCalls.at(-1), ["workspace", "ops"]);
  assert.ok(
    rPanel().textContent.includes("ana@example.test · Danil Operación"),
    "elegir workspace cambia de organización y la cuenta se relee",
  );
  const rMostrado = () => {
    const select = rPanel().querySelector('select[aria-label="Workspace de Radiant"]');
    return [select.value, select.selectedOptions[0]?.textContent];
  };
  assert.deepEqual(rMostrado(), ["ops", "Operación"], "tras elegir, el selector enseña el workspace elegido");
  rBoton("Actualizar").click();
  await espera(80);
  assert.deepEqual(rMostrado(), ["ops", "Operación"], "y lo sigue enseñando al actualizar la lista");
  radiantCuenta.organization = "Danil";
  rBoton("Servidor propio").click();
  await espera(50);
  const rUrl = rPanel().querySelector('input[aria-label="Dirección del servidor"]');
  rUrl.value = "http://radiant.example.com";
  rUrl.dispatchEvent(new radiantApp.w.Event("input", { bubbles: true }));
  rBoton("Usar este servidor").click();
  await espera(80);
  assert.ok(rPanel().textContent.includes("El servidor necesita HTTPS."), "una URL HTTP se rechaza con su motivo");
  assert.equal(radiant.server, CLOUD, "y el servidor elegido no cambia");
  rBoton("Cerrar sesión").click();
  await espera(80);
  assert.deepEqual(radiantCalls.at(-1), ["logout"]);
  assert.ok(!rPanel().textContent.includes("ana@example.test"), "cerrar sesión borra la cuenta de la pantalla");
  // Cuenta A, la sesión se revoca en el servidor y entra la cuenta B: nada de A se queda.
  rBoton("Iniciar sesión").click();
  await espera(80);
  await completarLogin();
  assert.ok(rPanel().textContent.includes("ana@example.test · Danil"));
  radiantCuenta.revocada = true;
  await rElegir(rPanel().querySelector('select[aria-label="Workspace de Radiant"]'), "eng");
  assert.ok(rPanel().textContent.includes(`Sin sesión en ${CLOUD}.`), "la revocación se ve como sesión cerrada");
  assert.ok(!rPanel().textContent.includes("ana@example.test"), "sin sesión no se enseña la cuenta anterior");
  Object.assign(radiantCuenta, { email: "bea@example.test", organization: "Otra", workspaces: [{ id: "legal", name: "Legal" }], revocada: false });
  rBoton("Iniciar sesión").click();
  await espera(80);
  await completarLogin();
  assert.ok(rPanel().textContent.includes("bea@example.test · Otra"), "el login nuevo enseña su propia cuenta");
  assert.ok(!rPanel().textContent.includes("ana@example.test"));
  const opciones = [...rPanel().querySelectorAll('select[aria-label="Workspace de Radiant"] option')].map((o) => o.value).filter(Boolean);
  assert.deepEqual(opciones, ["legal"], "y los workspaces de su cuenta, no los de la anterior");
  // Cloud con la cuenta y la lista en camino, y se pasa a un servidor propio que ya tiene sesión de otra cuenta.
  const PROPIO = "https://radiant.example.com";
  const rWorkspaces = () => rPanel().querySelector('select[aria-label="Workspace de Radiant"]');
  const rOpciones = () => [...rWorkspaces().querySelectorAll("option")].map((o) => o.value).filter(Boolean);
  const rPedirCuentaYLista = async (id) => {
    const pedidas = {};
    radiantIdentityPending = new Promise((entregar, fallar) => Object.assign(pedidas, { cuenta: { entregar, fallar } }));
    radiantWorkspacesPending = new Promise((entregar, fallar) => Object.assign(pedidas, { lista: { entregar, fallar } }));
    await rElegir(rWorkspaces(), id);
    rBoton("Actualizar").click();
    await espera(50);
    radiantIdentityPending = null;
    radiantWorkspacesPending = null;
    return pedidas;
  };
  const deCloud = { cuenta: radiantIdentity(), lista: radiantCuenta.workspaces };
  const tardias = await rPedirCuentaYLista("legal");
  radiant.workspace = null;
  Object.assign(radiantCuenta, { email: "dora@example.test", organization: "Propia", workspaces: [{ id: "casa", name: "Casa" }] });
  rBoton("Servidor propio").click();
  await espera(50);
  const rPropio = rPanel().querySelector('input[aria-label="Dirección del servidor"]');
  rPropio.value = PROPIO;
  rPropio.dispatchEvent(new radiantApp.w.Event("input", { bubbles: true }));
  rBoton("Usar este servidor").click();
  await espera(120);
  assert.deepEqual(radiantCalls.at(-1), ["server", PROPIO]);
  assert.ok(rPanel().textContent.includes(`Sesión iniciada como dora@example.test · Propia en ${PROPIO}.`));
  tardias.cuenta.entregar(deCloud.cuenta);
  tardias.lista.entregar(deCloud.lista);
  await espera(80);
  assert.ok(!rPanel().textContent.includes("bea@example.test"), "la cuenta de Cloud que llega tarde no entra en el servidor propio");
  assert.ok(rPanel().textContent.includes("dora@example.test · Propia"));
  assert.deepEqual(rOpciones(), ["casa"], "ni sus workspaces");
  // Cuenta A con sus peticiones en camino, cierra sesión y entra la cuenta B: el fallo tardío de A no borra a B.
  const fallidas = await rPedirCuentaYLista("casa");
  rBoton("Cerrar sesión").click();
  await espera(80);
  Object.assign(radiantCuenta, { email: "eva@example.test", workspaces: [{ id: "taller", name: "Taller" }] });
  rBoton("Iniciar sesión").click();
  await espera(80);
  await completarLogin();
  assert.ok(rPanel().textContent.includes("eva@example.test · Propia"));
  const caducada = { what: { clave: "radiant.error.no_session" }, detail: "HTTP 401 session_revoked" };
  fallidas.cuenta.fallar(caducada);
  fallidas.lista.fallar(caducada);
  await espera(80);
  assert.ok(rPanel().textContent.includes("eva@example.test · Propia"), "el fallo tardío de la cuenta anterior no borra la nueva");
  assert.deepEqual(rOpciones(), ["taller"]);
  assert.ok(!rPanel().textContent.includes("No hay sesión en este servidor"), "ni enseña su error");
  rBoton("Radiant Cloud").click();
  await espera(120);
  assert.deepEqual(radiantCalls.at(-1), ["server", CLOUD]);
  // Una cuenta en varias organizaciones elige una antes de ver workspaces.
  rBoton("Cerrar sesión").click();
  await espera(80);
  Object.assign(radiantCuenta, {
    status: "organization_selection_required", email: "carla@example.test", organization: null,
    organizations: [{ id: "org_danil", name: "Danil" }, { id: "org_otra", name: "Otra" }],
    note: { clave: "radiant.identity.organization_selection_required" },
  });
  rBoton("Iniciar sesión").click();
  await espera(80);
  await completarLogin();
  assert.ok(rPanel().textContent.includes("Tu cuenta pertenece a varias organizaciones."), "lo que falta sale del catálogo");
  assert.equal(rPanel().querySelector('select[aria-label="Workspace de Radiant"]'), null, "sin organización no se ofrecen workspaces");
  const rOrganizacion = rPanel().querySelector('select[aria-label="Organización"]');
  assert.deepEqual([...rOrganizacion.querySelectorAll("option")].map((o) => o.value).filter(Boolean), ["org_danil", "org_otra"]);
  await rElegir(rOrganizacion, "org_otra");
  assert.deepEqual(radiantCalls.at(-1), ["organization", "org_otra"]);
  assert.ok(rPanel().textContent.includes("carla@example.test · Otra"), "la organización elegida queda en la cuenta");
  assert.equal(rPanel().querySelector('select[aria-label="Organización"]'), null);
  assert.ok(rPanel().querySelector('select[aria-label="Workspace de Radiant"]'));
  // Gobernar el workspace con el remoto elegido: lo instalado se resume y lo que falta se dice.
  const rGobierno = () => rPanel().querySelector('button[aria-label="Gobernar este workspace con Radiant"]');
  assert.ok(rGobierno()?.disabled, "sin workspace remoto elegido no se gobierna");
  radiant.workspace = { id: "eng", name: "Ingeniería" };
  radiantApp.emit("radiant", null);
  await espera(120);
  assert.ok(rPanel().textContent.includes("Gobernar este workspace con Radiant (Ingeniería)."));
  rGobierno().click();
  await espera(120);
  assert.deepEqual(radiantCalls.at(-1), ["govern"]);
  assert.ok(rPanel().textContent.includes("Gobernado por Radiant · workspace Ingeniería."), "el interruptor queda puesto");
  assert.ok(rPanel().textContent.includes("gobierno (raíz)"), "la raíz de gobierno sale en el resumen");
  assert.ok(rPanel().textContent.includes("revisar") && rPanel().textContent.includes("revisor"));
  assert.ok(rPanel().textContent.includes("Tailscale no está instalado en este equipo."), "un MCP de tailnet dice por qué no se activa");
  assert.ok(rPanel().textContent.includes("No instalado"), "y el estado de Tailscale se ve");
  rBoton("Conectar").click();
  await espera(80);
  assert.deepEqual(radiantCalls.at(-1), ["connect", "jira"], "Conectar pide la URL de Pipes al backend");
  // El MCP gobernado con OAuth: el login lo hace la CLI de cada agente que recibe servidores.
  assert.ok(rPanel().textContent.includes("Inicio de sesión de los servidores MCP"));
  assert.ok(rPanel().textContent.includes("Esta CLI no inicia sesión en servidores MCP · su CLI no la ofrece"),
    "el agente sin login MCP lo dice con su motivo");
  assert.ok(!rPanel().textContent.includes("Codex"), "un agente que no recibe servidores no sale");
  rBoton("Iniciar sesión con Claude Code").click();
  await espera(80);
  assert.deepEqual(radiantCalls.at(-1), ["mcp_login", "claude", "atlassian"]);
  assert.ok(rPanel().textContent.includes("Se abrió tu navegador para autorizar Atlassian."));
  radiantSesiones.push("claude");
  radiantApp.emit("mcp", null);
  await espera(120);
  assert.equal(rBoton("Iniciar sesión con Claude Code"), undefined, "con sesión ya no se ofrece");
  assert.ok(rPanel().textContent.includes("Sesión iniciada"));
  gobierno = { ...GOBERNADO(), stale: true };
  gobierno.governed.last_error = "radiant.error.unreachable";
  rBoton("Renovar").click();
  await espera(60);
  radiantApp.emit("radiant", null);
  await espera(120);
  assert.ok(rPanel().textContent.includes("Vencido"), "un gobierno sin renovar se marca vencido");
  assert.ok(rPanel().textContent.includes("No se pudo renovar."), "y se dice que lo instalado sigue");
  rGobierno().click();
  await espera(120);
  assert.deepEqual(radiantCalls.at(-1), ["ungovern"]);
  assert.ok(!rPanel().textContent.includes("Gobernado por Radiant"), "desactivar quita el gobierno de la pantalla");
  gobierno = { ...SIN_GOBIERNO, notice: "radiant.governance.notice.denied" };
  radiantApp.emit("radiant", null);
  await espera(120);
  assert.ok(rPanel().textContent.includes("Radiant dejó de conceder este workspace"), "un 403 se avisa");
  gobierno = SIN_GOBIERNO;
  radiant.workspace = null;
  // Cambiar de workspace de Terminus borra lo mostrado, y la respuesta tardía del anterior no entra.
  const cambiarDeWorkspace = () => radiantApp.w.dispatchEvent(new radiantApp.w.CustomEvent("harness:workspace"));
  const carla = radiantIdentity();
  let entregarIdentidad;
  radiantIdentityPending = new Promise((resolve) => { entregarIdentidad = resolve; });
  rBoton("Cerrar sesión").click();
  await espera(80);
  rBoton("Iniciar sesión").click();
  await espera(80);
  await completarLogin();
  assert.ok(rPanel().textContent.includes(`Sesión iniciada en ${CLOUD}.`), "la identidad del primer workspace sigue en camino");
  radiantIdentityPending = null;
  Object.assign(radiant, { server: CLOUD, signed_in: true, workspace: null, login: null });
  Object.assign(radiantCuenta, { status: "ok", email: "bea@example.test", organization: "Otra", organizations: [], note: null, workspaces: [{ id: "legal", name: "Legal" }] });
  cambiarDeWorkspace();
  assert.ok(!rPanel().textContent.includes("Sesión iniciada"), "el cambio borra la sesión mostrada sin esperar al servicio");
  await espera(120);
  assert.ok(rPanel().textContent.includes("bea@example.test · Otra"), "el workspace nuevo enseña su propia cuenta");
  entregarIdentidad(carla);
  await espera(80);
  assert.ok(!rPanel().textContent.includes("carla@example.test"), "la respuesta tardía del workspace anterior se descarta");
  assert.ok(rPanel().textContent.includes("bea@example.test · Otra"));
  Object.assign(radiant, { server: null, signed_in: false, workspace: null, login: null });
  cambiarDeWorkspace();
  await espera(80);
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
  const languageApp = await arrancar("listo", "language-select", {
    ...RESPUESTAS,
    list_workspaces: () => ({ workspaces: [{ id: "w", name: "W", context_root: null, lengua: savedLanguage }], active: "w" }),
    list_language_packs: [], list_bundled_language_packs: [],
    set_workspace_language: ({ lengua }) =>
      new Promise((resolve) => languageSaves.push(() => { savedLanguage = lengua; resolve(null); })),
  });
  const languageDoc = languageApp.w.document;
  languageDoc.querySelector('button[aria-label="Configuración"]')?.click();
  await espera(100);
  const languageSelect = () =>
    [...languageDoc.querySelectorAll("select")].find((s) => s.querySelector('option[value="en"]') && s.querySelector('option[value=""]'));
  const pickLanguage = async (code) => {
    const select = languageSelect();
    select.value = code;
    select.dispatchEvent(new languageApp.w.Event("change", { bubbles: true }));
    await espera(80);
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
    return { name: a.name, description: a.description, instructions: "Trabaja.", tools: [], model: null, origin: `${base}/agent.md`, folder: base, agents: ["claude"], own: true, own_scope: a.scope };
  };
  const perfilDe = (display) => ({ display_name: display, body: null, background: null, veil: 0.82, agent: null, model: null, effort: null, hidden: false });
  const cambiosDeCarpetas = [];
  const creados = [];
  const agentesApp = await arrancar("listo", "settings-agents", {
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
        agent: { name: "qa", description: "Verifica que un cambio funcione.", instructions: "", tools: [], model: null, origin: qaDelRepositorio, folder: "/repo/app/.agents/agents/qa", agents: ["claude"], own: false, own_scope: null },
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
    create_encargado: ({ name, description, scope }) => {
      creados.push([name, scope]);
      const a = { name, scope, list: [scope.id], display: null, description };
      agentesPropios.push(a);
      return { encargado: declaracion(a), eclipsado_por: null };
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
    await espera(60);
    return menuDe(name);
  };
  const renglones = (menu) => [...menu.querySelectorAll('[role="menuitem"]')];
  const renglon = (menu, carpeta) => renglones(menu).find((r) => r.textContent.startsWith(carpeta));
  const dialogoDeMudanza = (name) =>
    [...agDoc.querySelectorAll('[role="dialog"],[role="alertdialog"]')]
      .find((d) => d.textContent.includes(`¿Pasar ${name} al catálogo del workspace?`));
  const panelDeAjustes = () => agDoc.querySelector("#cfg-panel");

  agDoc.querySelector('button[aria-label="Configuración"]')?.click();
  await espera(100);
  const pestanas = [...agDoc.querySelectorAll('[role="tab"][id^="cfg-tab-"]')].map((b) => b.id);
  const skills = pestanas.indexOf("cfg-tab-skills");
  assert.deepEqual(pestanas.slice(skills, skills + 3), ["cfg-tab-skills", "cfg-tab-agentes", "cfg-tab-plugins"]);
  agDoc.querySelector("#cfg-tab-agentes").click();
  await espera(120);

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
  await espera(80);
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
  await espera(150);
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
  await espera(60);
  assert.equal(menuDe("giskard-po"), null, "Esc cierra el menú");
  assert.ok(panelDeAjustes(), "y no se lleva Configuración");
  assert.equal(agDoc.activeElement, botonCon(propia("giskard-po"), "Agregar a proyecto…"), "el foco vuelve al botón");

  // Agregar uno de proyecto a otra carpeta pide la mudanza; Cancelar va primero.
  menu = await abrirMenuDe("giskard-po");
  renglon(menu, "Radiant").click();
  await espera(80);
  assert.ok(dialogoDeMudanza("giskard-po"), "uno de proyecto pide pasar al catálogo");
  assert.equal(agDoc.activeElement?.textContent?.trim(), "Cancelar", "el foco empieza en Cancelar");
  tecla("Escape");
  await espera(80);
  assert.equal(dialogoDeMudanza("giskard-po"), undefined);
  assert.ok(panelDeAjustes(), "Esc en el diálogo no cierra Configuración");
  assert.deepEqual(cambiosDeCarpetas, [], "cancelar no cambia nada");
  assert.equal(agDoc.activeElement, botonCon(propia("giskard-po"), "Agregar a proyecto…"));
  menu = await abrirMenuDe("giskard-po");
  renglon(menu, "Radiant").click();
  await espera(80);
  const avisosAntes = avisosAlRiel;
  botonCon(dialogoDeMudanza("giskard-po"), "Pasar al catálogo y agregar").click();
  await espera(150);
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
  await espera(40);
  assert.equal(cambiosDeCarpetas.length, cambiosAntes, "un renglón deshabilitado no pide nada");
  tecla("Escape");
  await espera(60);
  radiantDeclaraQa = true;
  menu = await abrirMenuDe("qa");
  renglon(menu, "Radiant").click();
  await espera(80);
  botonCon(dialogoDeMudanza("qa"), "Pasar al catálogo y agregar").click();
  await espera(120);
  const rechazo = dialogoDeMudanza("qa")?.querySelector('[role="alert"]');
  assert.equal(
    rechazo?.textContent,
    `No se agregó qa a Radiant. Ahí gana el qa del repositorio, que se declara en ${qaDeRadiant}.`,
    "el rechazo se lee dentro del diálogo, con quién gana y dónde",
  );
  botonCon(dialogoDeMudanza("qa"), "Cancelar").click();
  await espera(80);
  assert.deepEqual(chips("qa"), ["kn"]);

  // Quitar de «todas» la vuelve lista fija; Deshacer la devuelve a «todas».
  const perfilesAntes = avisosDePerfiles;
  quitarDe("notas-de-version", "kn").click();
  await espera(120);
  assert.deepEqual(cambiosDeCarpetas.at(-1), ["notas-de-version", { kind: "workspace" }, { kind: "remove", folder: "kn" }]);
  assert.equal(rotuloDeCarpetas("notas-de-version"), "Activo en:");
  assert.deepEqual(chips("notas-de-version"), ["Terminus App", "Radiant"]);
  assert.ok(botonCon(propia("notas-de-version"), "Agregar a proyecto…"), "vuelve «Agregar a proyecto…»");
  assert.ok(panelDeAjustes().textContent.includes("notas-de-version ya no está en kn."));
  assert.ok(panelDeAjustes().textContent.includes("Ahora está en una lista fija de proyectos: los nuevos no lo tendrán."));
  assert.equal(agDoc.activeElement?.getAttribute("aria-label"), "Quitar notas-de-version de Radiant", "el foco pasa a la vecina");
  botonCon(panelDeAjustes(), "Deshacer").click();
  await espera(150);
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
  await espera(120);
  assert.ok(panelDeAjustes().textContent.includes("giskard-po ya no aparece en Radiant."));
  assert.equal(quitarDe("giskard-po", "Terminus App"), null);
  agentesPropios.find((a) => a.name === "giskard-po").list = ["app", "kn"];
  botonCon(panelDeAjustes(), "Deshacer").click();
  await espera(150);
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
  await espera(100);
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
  const renombrar = await arrancar("listo", "workspace-rename", {
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
  await espera(300);
  renombrar.w.document.querySelector('[data-workspace-column] [data-workspace-tile="w"]')
    ?.dispatchEvent(new renombrar.w.MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  await espera(80);
  [...renombrar.w.document.querySelectorAll('[role="menuitem"]')]
    .find((b) => b.textContent?.trim() === "Administrar workspaces")?.click();
  await espera(100);
  const lapiz = (name) =>
    renombrar.w.document.querySelector(`button[aria-label="Cambiarle el nombre a «${name}»"]`);
  const campoDeNombre = (name) =>
    renombrar.w.document.querySelector(`input[aria-label="Nuevo nombre de «${name}»"]`);
  assert.ok(lapiz("Beta"), "renombrar el workspace que no es el activo tiene que ser un gesto visible");
  assert.ok(lapiz("Acme"), "y el activo también");
  lapiz("Beta").click();
  await espera(50);
  assert.deepEqual(cambiosDeWorkspace, [], "pedir renombrar no cambia de cliente");
  const cancelado = campoDeNombre("Beta");
  assert.ok(cancelado, "el gesto abre el campo del nombre");
  cancelado.value = "Gamma";
  cancelado.dispatchEvent(new renombrar.w.InputEvent("input", { bubbles: true }));
  cancelado.dispatchEvent(new renombrar.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await espera(50);
  assert.deepEqual(renombres, [], "Escape cancela sin guardar");
  assert.ok(lapiz("Beta"), "y Escape no se lleva por delante Configuración");
  lapiz("Beta").click();
  await espera(50);
  const escrito = campoDeNombre("Beta");
  escrito.value = "Gamma";
  escrito.dispatchEvent(new renombrar.w.InputEvent("input", { bubbles: true }));
  escrito.dispatchEvent(new renombrar.w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await espera(150);
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
  const columna = await arrancar("listo", "workspace-column", { ...CON_TAREA,
    list_workspaces: () => structuredClone(espaciosDeColumna),
    workspaces_startup: () => structuredClone(espaciosDeColumna),
    list_projects: () => [{ id: "pa", name: "Proyecto", kind: "folder", working_directory: "/lab", sources: [] }],
    list_live_sessions: ({ project }) => project === "pa" ? [task("s1", null, "delivered"), task("s2", null, "failed"), task("s3", null, "delivered")] : [],
    load_session: ({ id }) => ({ ...CON_TAREA.load_session, id, turns: [] }),
    list_workspace_attention: () => structuredClone(atencion),
    mark_task_seen: ({ workspace, session }) => { vistos.push([workspace, session]); },
    set_active_workspace: ({ id }) => { cambiosDeColumna.push(id); espaciosDeColumna.active = id; },
  });
  await espera(300);
  const doc = columna.w.document;
  const cuadro = (id) => doc.querySelector(`[data-workspace-column] [data-workspace-tile="${id}"]`);
  assert.deepEqual([...doc.querySelectorAll("[data-workspace-column] [data-workspace-tile]")].map((b) => b.textContent.trim()),
    ["AC", "B", "GL", "D"], "la columna lista cada workspace con sus iniciales");
  assert.equal(cuadro("w").getAttribute("aria-current"), "true", "el activo lleva la marca de selección");
  assert.equal(cuadro("w2").getAttribute("aria-current"), null);
  assert.equal(doc.querySelector("[data-title-bar] [data-workspace-name]")?.textContent.trim(), "Acme Corp", "el nombre abre la fila del título");
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
  assert.ok(filaDeColumna("s1").querySelector('[aria-label="Terminó y no la has abierto"].text-success-strong svg.lucide-check'), "la fila dice terminada sin ver");
  assert.ok(filaDeColumna("s3").querySelector('[aria-label="Resultado entregado"].text-neutral-500'), "una entregada ya vista queda en gris");
  const pliegue = doc.querySelector('button[aria-label="Plegar «Proyecto»"]');
  pliegue.click();
  await espera(50);
  const proyecto = [...doc.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith("Proyecto") && b.querySelector('[aria-label="Una subtarea falló o se interrumpió"]'));
  assert.ok(proyecto, "el proyecto plegado agrega el fallo sin ver de dentro");
  doc.querySelector('button[aria-label="Desplegar «Proyecto»"]').click();
  await espera(50);
  assert.deepEqual(vistos, [], "entrar al workspace no marca nada como visto");
  filaDeColumna("s1").click();
  await espera(250);
  assert.deepEqual(vistos, [["w", "s1"]], "abrir la tarea la marca como vista");
  atencion = [{ ...atencion[0], tasks: [atencion[0].tasks[1]] }, ...atencion.slice(1)];
  columna.emit("attention", structuredClone(atencion));
  await espera(50);
  assert.equal(filaDeColumna("s1").querySelector('[aria-label="Terminó y no la has abierto"]'), null, "y la marca se limpia con el evento");
  assert.ok(filaDeColumna("s1").querySelector('[aria-label="Resultado entregado"]'));
  columna.emit("attention", [{ workspace: "w", tasks: [{ session: "s1", project: "pa", state: "unseen" }] }]);
  await espera(80);
  assert.deepEqual(vistos, [["w", "s1"], ["w", "s1"]], "un turno que cierra con la tarea delante no queda sin ver");
  cuadro("w2").click();
  await espera(300);
  assert.deepEqual(cambiosDeColumna, ["w2"], "un clic cambia de workspace");
  assert.equal(cuadro("w2").getAttribute("aria-current"), "true");
  assert.equal(doc.querySelector("[data-title-bar] [data-workspace-name]")?.textContent.trim(), "Beta");
  cuadro("w2").dispatchEvent(new columna.w.MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  await espera(80);
  assert.ok([...doc.querySelectorAll('[role="menuitem"]')].some((b) => b.textContent.trim() === "Administrar workspaces"), "administrar sigue alcanzable desde el cuadro");
  assert.ok(doc.querySelector('[data-workspace-column] button[aria-label="Nuevo workspace"]'), "y crear uno, desde la columna");
  /**
   * El menú del nombre cambia de cliente igual que la columna. El actual va marcado y sin señal:
   * sus tareas ya están en el riel. Los demás dicen lo más urgente, y el nombre nunca lleva señal.
   */
  const teclaEn = (el, key) => el.dispatchEvent(new columna.w.KeyboardEvent("keydown", { key, bubbles: true }));
  const nombreEnLaBarra = () => doc.querySelector("[data-title-bar] [data-workspace-name]");
  teclaEn(nombreEnLaBarra(), "ArrowDown");
  await espera(100);
  const menuDelNombre = doc.querySelector('[role="menu"][data-workspace-menu]');
  assert.ok(menuDelNombre, "flecha abajo sobre el nombre abre su menú");
  const renglonDe = (id) => menuDelNombre.querySelector(`[role="menuitemradio"][data-workspace-option="${id}"]`);
  assert.deepEqual([...menuDelNombre.querySelectorAll('[role="menuitemradio"]')].map((r) => r.dataset.workspaceOption), ["w", "w2", "w3", "w4"]);
  assert.equal(renglonDe("w2").getAttribute("aria-checked"), "true", "el activo va marcado en el menú");
  assert.equal(renglonDe("w2").querySelector("[data-attention-badge]"), null, "y sin señal, aunque tenga un permiso pendiente");
  assert.equal(renglonDe("w").querySelector("[data-attention-badge]")?.dataset.attentionBadge, "failed");
  assert.equal(renglonDe("w3").querySelector("[data-attention-badge]")?.dataset.attentionBadge, "asked");
  assert.equal(renglonDe("w4").querySelector("[data-attention-badge]"), null, "un estado que la ventana no conoce tampoco se pinta aquí");
  assert.equal(nombreEnLaBarra().querySelector("[data-attention-badge]"), null, "el nombre no lleva señal aunque otro workspace espere");
  teclaEn(renglonDe("w"), "Enter");
  await espera(300);
  assert.deepEqual(cambiosDeColumna, ["w2", "w"], "elegir en el menú cambia de workspace");
  assert.equal(nombreEnLaBarra()?.textContent.trim(), "Acme Corp");
  assert.equal(doc.querySelector('[role="menu"][data-workspace-menu]'), null, "y el menú se cierra");
  assert.equal(cuadro("w").getAttribute("aria-current"), "true", "la columna sigue al menú");
  espaciosDeColumna.workspaces = espaciosDeColumna.workspaces.slice(0, 1);
  columna.w.dispatchEvent(new columna.w.CustomEvent("harness:workspace"));
  await espera(300);
  assert.equal(doc.querySelector("[data-workspace-column]"), null, "al quedar uno, la columna se va sin recargar");
  assert.equal(nombreEnLaBarra()?.textContent.trim(), "Acme Corp", "y el nombre se queda");
  assert.deepEqual(columna.fallos, []);
  /**
   * Con un solo workspace no hay columna: crear el segundo sale del menú del nombre. En macOS solo
   * la fila del título se aparta del semáforo, y el build de una rama se nombra al final.
   */
  const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";
  const LARGO = "Software y Servicios Danil, Consultoría de Gobierno de Agentes";
  const unoSolo = { workspaces: [{ id: "w", name: LARGO, context_root: null }], active: "w" };
  const solo = await arrancar("listo", "title-bar-one", { ...CON_TAREA,
    list_workspaces: () => structuredClone(unoSolo),
    workspaces_startup: () => structuredClone(unoSolo),
    list_workspace_attention: () => [{ workspace: "w", tasks: [{ session: "s1", project: "", state: "asked" }] }],
    "plugin:window|title": "Terminus · una-rama",
  }, MAC);
  await espera(300);
  const d1 = solo.w.document;
  const barra = d1.querySelector("[data-title-bar]");
  const nombreSolo = barra?.querySelector("[data-workspace-name]");
  assert.equal(nombreSolo?.textContent.trim(), LARGO, "el nombre del workspace abre la fila del título");
  assert.equal(nombreSolo.getAttribute("title"), LARGO, "un nombre que no cabe se lee entero al pasar por encima");
  assert.equal(nombreSolo.querySelector("[data-attention-badge]"), null, "el nombre no lleva señal");
  assert.equal(d1.querySelector("[data-workspace-column]"), null, "con un solo workspace no hay columna");
  assert.ok(barra.classList.contains("pl-[84px]"), "en macOS la fila del título se aparta del semáforo");
  assert.equal(d1.querySelectorAll(".pl-\\[84px\\]").length, 1, "y ninguna otra cabecera reserva su hueco");
  assert.equal(barra.querySelector("[data-window-branch]")?.textContent, "una-rama", "el build de la rama se nombra al final de la fila");
  assert.equal(d1.body.textContent.split("una-rama").length, 2, "una sola vez");
  const altas = [];
  solo.w.addEventListener("harness:new-workspace", () => altas.push(1));
  const abrirMenuSolo = async () => {
    nombreSolo.dispatchEvent(new solo.w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await espera(100);
    return d1.querySelector('[role="menu"][data-workspace-menu]');
  };
  let menuSolo = await abrirMenuSolo();
  assert.ok(menuSolo, "Enter sobre el nombre abre su menú");
  assert.deepEqual([...menuSolo.querySelectorAll('[role="menuitemradio"]')].map((r) => r.getAttribute("aria-checked")), ["true"]);
  assert.equal(menuSolo.querySelector("[data-attention-badge]"), null, "la pregunta de este workspace se ve en el riel, no en el menú");
  menuSolo.dispatchEvent(new solo.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await espera(100);
  assert.equal(d1.querySelector('[role="menu"][data-workspace-menu]'), null, "Escape cierra el menú");
  assert.equal(d1.activeElement, nombreSolo, "y el foco vuelve al nombre");
  menuSolo = await abrirMenuSolo();
  const itemDe = (texto) => [...menuSolo.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent.trim() === texto);
  itemDe("Nuevo workspace").dispatchEvent(new solo.w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await espera(150);
  assert.equal(altas.length, 1, "Nuevo workspace pide el alta desde el menú del nombre");
  assert.deepEqual(solo.fallos, []);
  /**
   * Ocultar el riel vive a la izquierda de Agentes y Tareas. Oculto, lo trae de vuelta la fila de
   * las pestañas y la fila del título sigue igual. En pantalla completa no hay semáforo que apartar.
   */
  const plegado = await arrancar("listo", "title-bar-collapsed", { ...CON_TAREA,
    list_workspaces: () => structuredClone(unoSolo),
    workspaces_startup: () => structuredClone(unoSolo),
    "plugin:window|is_fullscreen": true,
  }, MAC);
  await espera(300);
  const d2 = plegado.w.document;
  const ocultarRiel = d2.querySelector('button[aria-label="Ocultar el historial"]');
  assert.equal(ocultarRiel.parentElement.querySelector('button[aria-label="Proyectos"]'), null, "el encabezado del riel no repite «Proyectos»: ya lo dice la sección de abajo");
  assert.equal(ocultarRiel.nextElementSibling?.getAttribute("aria-label"), "Buscar tareas o agentes", "la lupa comparte la fila con el control del sidebar");
  assert.equal(d2.querySelector("[data-title-bar]").classList.contains("pl-[84px]"), false, "en pantalla completa la fila no reserva el semáforo");
  ocultarRiel.click();
  await espera(100);
  assert.equal(d2.querySelector('button[aria-label="Buscar tareas o agentes"]'), null, "la lupa desaparece cuando el sidebar está cerrado");
  assert.ok(d2.querySelector('[data-conversacion] button[aria-label="Mostrar el historial"]'), "con el riel oculto, la fila de pestañas lo trae de vuelta");
  assert.equal(d2.querySelector("[data-title-bar] [data-workspace-name]")?.textContent.trim(), LARGO, "y la fila del título no cambia");
  assert.equal(d2.querySelector("[data-window-branch]"), null, "sin título de ventana no se nombra ninguna build");
  d2.querySelector('button[aria-label="Mostrar el historial"]').click();
  await espera(100);
  assert.ok(d2.querySelector('button[aria-label="Ocultar el historial"]'));
  assert.deepEqual(plegado.fallos, []);
  /**
   * En Windows los tres botones de la ventana cierran la fila del título, una sola vez, con el árbol
   * de trabajo abierto o cerrado. La app de producción no pinta ningún rótulo de build.
   */
  const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0";
  const enWindows = await arrancar("listo", "title-bar-windows", { ...CON_TAREA, "plugin:window|title": "Terminus" }, WINDOWS);
  await espera(300);
  const d3 = enWindows.w.document;
  const minimizar = () => [...d3.querySelectorAll('button[aria-label="Minimizar"]')];
  assert.equal(minimizar().length, 1, "un solo juego de botones de ventana");
  assert.ok(minimizar()[0].closest("[data-title-bar]"), "y vive en la fila del título");
  assert.equal(d3.querySelector("[data-window-branch]"), null, "la app de producción no nombra su build");
  assert.equal(d3.querySelector("[data-title-bar]").classList.contains("pl-[84px]"), false, "fuera de macOS no hay semáforo");
  d3.querySelector('[data-sesion="s1"]').click();
  await espera(250);
  d3.querySelector('button[aria-label="Ver el árbol de trabajo"]')?.click();
  await espera(150);
  assert.ok(d3.querySelector('button[aria-label="Cerrar el árbol de trabajo"]'), "el árbol de trabajo abre");
  assert.equal(minimizar().length, 1, "con el árbol abierto siguen siendo uno");
  assert.ok(minimizar()[0].closest("[data-title-bar]"));
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
  const cruce = await arrancar("listo", 20, { ...CON_TAREA,
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
    await espera(300);
  };
  cruce.w.document.querySelector('[data-sesion="s1"]').click();
  await espera(250);
  cruce.emit("chat", { kind: "started", session: "s1", workspace: "w" });
  cruce.emit("chat", { kind: "delta", session: "s1", workspace: "w", text: "Voy por la mitad" });
  await espera(150);
  assert.ok(rotuloDeEspera(), "el turno arranca y el rótulo de espera aparece");
  assert.match(cuerpoDelCruce(), /Voy por la mitad/);
  // El turno lleva un minuto largo corriendo cuando se vuelve a mirarlo: es lo
  // que el registro del backend sabe y la ventana no puede deducir.
  enVuelo = [{ session: "s1", workspace: "w", project: "pa", started_at: Date.now() - 95_000 }];
  await mudarA("w2");
  cruce.w.document.querySelector('[data-sesion="s1"]').click();
  await espera(100);
  cruce.emit("chat", { kind: "delta", session: "s1", workspace: "w", text: " y sigo desde el otro workspace" });
  assert.doesNotMatch(cuerpoDelCruce(), /Voy por la mitad|sigo desde el otro workspace/, "a matching session ID in another workspace cannot share its live transcript");
  assert.equal(rotuloDeEspera(), false, "en el otro cliente no se pinta el turno de este");
  await mudarA("w");
  cruce.w.document.querySelector('[data-sesion="s1"]').click();
  await espera(300);
  assert.ok(rotuloDeEspera(), "al volver, la tarea sigue contestando");
  assert.match(cuerpoDelCruce(), /Voy por la mitad y sigo desde el otro workspace/, "lo que llegó por eventos mientras se miraba otro cliente no está en disco todavía");
  assert.match(relojDelTurno() ?? "", /1m 3\ds/, "el reloj cuenta desde que arrancó el turno, no desde que se repintó");
  // Y el cierre que llega mirando el otro cliente: el filtro por workspace lo
  // descarta, y la única forma de enterarse es volver a preguntar.
  enVuelo = [];
  await mudarA("w2");
  cruce.emit("chat", { kind: "done", session: "s1", workspace: "w", ok: true });
  await espera(150);
  await mudarA("w");
  await espera(250);
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
  const finishApp = await arrancar("listo", "finish-task", {
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
  await espera(100);
  assert.equal(finishButton("merged").getAttribute("aria-busy"), "true");
  assert.ok(finishButton("merged").querySelector(".finish-task-flame"));
  assert.equal(finishButton("merged").disabled, true);
  assert.equal(finishApp.w.document.querySelector("[data-finish-celebration]"), null);
  finishButton("merged").click();
  assert.equal(finishCalls.length, 1);
  settleFinish();
  await espera(100);
  assert.equal(finishButton("merged").getAttribute("aria-busy"), "false");
  assert.equal(finishButton("merged").querySelector(".finish-task-flame"), null);
  assert.equal(finishButton("merged").disabled, false);
  assert.match(finishApp.w.document.body.textContent, /Trabajo pendiente/);
  const finishToast = [...finishApp.w.document.querySelectorAll('[role="alert"]')].find(el => el.textContent.includes("Trabajo pendiente"));
  assert.ok(finishToast, "El error de finalizar aparece en un toast");
  assert.equal(finishToast.closest('[data-sesion]'), null);
  finishToast.querySelector("button").click();
  await espera(50);
  assert.doesNotMatch(finishApp.w.document.body.textContent, /Trabajo pendiente/);
  assert.ok(finishButton("merged"));
  assert.equal(finishApp.w.document.querySelector('[role="alertdialog"]'), null);
  rejectFinish = false;
  finishApp.w.document.querySelector('button[aria-label="Buscar tareas o agentes"]').click();
  await espera(50);
  const finishSearch = finishApp.w.document.querySelector('[data-sidebar-search] input[role="searchbox"]');
  finishSearch.value = "Tarea";
  finishSearch.dispatchEvent(new finishApp.w.Event("input", { bubbles: true }));
  await espera(80);
  assert.ok(finishButton("child"), "Una subtarea compartida usa el estado integrado del padre");
  finishButton("child").click();
  await espera(50);
  settleFinish();
  await espera(150);
  assert.ok(finishButton("merged"), "Finalizar la hija no finaliza al padre");
  assert.equal(finishApp.w.document.querySelector('[data-sesion="child"]'), null);
  // La barra ya no guarda un grupo de archivadas: la hija finalizada se va del todo.
  assert.equal(finishApp.w.document.querySelector('button[aria-label="Desplegar la tarea archivada"]'), null);
  finishButton("merged").click();
  await espera(50);
  settleFinish();
  await espera(150);
  assert.deepEqual(finishCalls, [{ project: "finish-project", id: "merged" }, { project: "finish-project", id: "child" }, { project: "finish-project", id: "merged" }]);
  // Finalizada, la madre también sale de la barra; lo archivado vive en el historial.
  assert.equal(finishApp.w.document.querySelector('[data-sesion="merged"]'), null);
  assert.equal(finishApp.w.document.querySelector('button[aria-label="Desplegar la tarea archivada"]'), null);
  assert.deepEqual(finishApp.fallos, []);

  // El sondeo del entorno no puede retener el primer pintado. `Setup` decide
  // con `setup_required`, que es un stat; lo caro va detrás y aquí no llega.
  const mudo = await arrancar("mudo", "entorno-en-segundo-plano");
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

  const blockerCalls = [];
  const discarded = [];
  const blockedFinishes = [];
  let blockers = { unsaved: [{ session: "blocked", title: "Tarea blocked", files: ["src/a.ts"] }], not_finished: false };
  const blockedApp = await arrancar("listo", "task-blockers", {
    ...CON_TAREA,
    list_projects: [{ id: "blocked-project", name: "Avisos", node: null, sources: [], working_directory: "/lab", created_at: 1, updated_at: 1, sessions: 1, kind: "folder" }],
    list_live_sessions: ({ project }) => project === "blocked-project" ? [task("blocked", null, "delivered")] : [],
    list_session_git: () => ({ blocked: gitRow("feature/done", { pull: { number: 44, state: "merged", head_sha: "abc" }, pull_known: true }) }),
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
  await espera(100);
  assert.deepEqual(blockerCalls, [{ project: "blocked-project", id: "blocked", finish: true }]);
  assert.deepEqual(blockedFinishes, [], "no se mata un turno ni se toma un candado antes de que la persona decida");
  const avisoDeCambios = blockedApp.w.document.querySelector('[role="dialog"]');
  assert.ok(avisoDeCambios, "los cambios sin guardar avisan, no dan error");
  assert.match(avisoDeCambios.textContent, /src\/a\.ts/, "el aviso nombra el archivo que estorba");
  const descartar = [...avisoDeCambios.querySelectorAll("button")].find(b => b.textContent.trim() === "Descartar y continuar");
  assert.ok(descartar, "el aviso lleva la salida, y borrar se pide explícitamente");
  descartar.click();
  await espera(150);
  assert.deepEqual(discarded, [{ project: "blocked-project", id: "blocked", files: ["src/a.ts"] }], "se descarta solo lo que el aviso enseñó");
  assert.deepEqual(blockedFinishes, [], "lo que apareció con el aviso abierto para el gesto");
  const avisoOtraVez = blockedApp.w.document.querySelector('[role="dialog"]');
  assert.ok(avisoOtraVez, "lo nuevo se enseña en el aviso, no en un error plegado");
  assert.match(avisoOtraVez.textContent, /llego-despues\.txt/);
  assert.doesNotMatch(avisoOtraVez.textContent, /src\/a\.ts/);
  [...avisoOtraVez.querySelectorAll("button")].find(b => b.textContent.trim() === "Descartar y continuar").click();
  await espera(150);
  assert.deepEqual(discarded.at(-1), { project: "blocked-project", id: "blocked", files: ["llego-despues.txt"] });
  assert.deepEqual(blockedFinishes, [{ project: "blocked-project", id: "blocked" }]);
  assert.equal(blockedApp.w.document.querySelector('[role="dialog"]'), null);
  blockers = { unsaved: [], not_finished: true };
  blockedFinish().click();
  await espera(100);
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
  const localLinks = await arrancar("listo", "local-file-links", {
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
  await espera(150);
  const localButton = [...localLinks.w.document.querySelectorAll("button, a")]
    .find(el => el.textContent.trim() === "Abrir mockup HTML");
  assert.ok(localButton, "El enlace local debe conservar un control para abrirlo");
  assert.equal(localButton.tagName, "BUTTON", "El menú nativo no debe navegar a una ruta local");
  assert.equal(localPreviews.length, 0, "El archivo no se lee antes del clic");
  assert.ok(![...localLinks.w.document.querySelectorAll("button, a")]
    .some(el => el.textContent.trim() === "No ejecutar"));
  localButton.click();
  await espera(150);
  assert.deepEqual(localPreviews, [{ path: localPath, rel: localPath }]);
  assert.ok([...localLinks.w.document.querySelectorAll('[role="tab"]')]
    .some(el => el.textContent.trim() === "finalizar-tarea.html"));
  assert.ok(localLinks.w.document.querySelector(".preview-path"));
  assert.ok(!localLinks.comandos.includes("open_external"));
  assert.ok(!localLinks.comandos.includes("site_open"));
  assert.deepEqual(localLinks.fallos, []);
  assert.ok(!localLinks.comandos.includes("artifact_history"),
    "un archivo fuera de la carpeta de la tarea no tiene cadena de versiones que leer");
  assert.doesNotMatch(localLinks.w.document.body.textContent, /historial de este documento/);

  const codeLinks = await arrancar("listo", "local-file-links-code", {
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
  await espera(150);
  const boton = (texto) => [...codeLinks.w.document.querySelectorAll("button")].find(el => el.textContent.trim() === texto);
  boton("Afuera").click();
  await espera(200);
  const vistaDeCodigo = () => codeLinks.w.document.querySelector('[role="group"][aria-label="Cómo se ve el archivo"]');
  assert.ok(vistaDeCodigo(), "en una tarea de código, un archivo de fuera abre en la vista de código");
  assert.equal(codeLinks.w.document.querySelector(".preview-path"), null);
  // La conversación solo está montada mientras se ve. Se vuelve a su pestaña para pulsar el otro enlace.
  [...codeLinks.w.document.querySelectorAll('[role="tab"]')].find((el) => el.textContent.includes("Una tarea"))?.click();
  await espera(150);
  boton("Adentro").click();
  await espera(200);
  assert.ok(codeLinks.comandos.includes("tree_show"), "un archivo dentro del repositorio abre en su árbol, donde se escribe");
  assert.ok(!codeLinks.comandos.includes("artifact_history"));
  assert.doesNotMatch(codeLinks.w.document.body.textContent, /historial de este documento/);
  assert.deepEqual(codeLinks.fallos, []);

  /**
   * El primer arranque sin workspace: el alta pinta sus pasos en orden, Atrás
   * conserva lo escrito y volver sin cambiar el nombre no crea otro workspace.
   */
  let altaActiva = null;
  const altaCreados = [];
  const altaProyectos = [];
  const altaUbicaciones = [];
  const altaEspacios = () => ({
    workspaces: altaActiva ? [{ id: "n", name: "Norte", context_root: null }] : [],
    active: altaActiva,
    migrations: [],
  });
  const alta = await arrancar("listo", "alta", {
    ...RESPUESTAS,
    list_workspaces: altaEspacios,
    workspaces_startup: altaEspacios,
    list_language_packs: [], list_bundled_language_packs: [],
    list_agents: [
      { id: "codex", label: "Codex", available: true, driver: true, sin_cuenta: false, source: null },
      { id: "opencode-local", label: "Locales", available: true, driver: true, sin_cuenta: true, source: null },
    ],
    add_workspace: ({ name }) => { altaCreados.push(name); return { id: "n", name }; },
    set_active_workspace: ({ id }) => { altaActiva = id; },
    set_workspace_language: null,
    rename_workspace: ({ id, name }) => ({ id, name }),
    list_accounts: { agent: "codex", env_var: "", shared_credential: null, secret_note: null, active: null, accounts: [] },
    list_providers: [],
    "plugin:dialog|open": "/tmp/contexto",
    set_workspace_source: ({ locator }) => ({ id: "ctx", kind: "folder", name: "contexto", identity: locator, locator }),
    get_project_directory: "/tmp/terminus",
    set_project_directory: ({ directory }) => { altaUbicaciones.push(directory); return directory; },
    list_project_repositories: [],
    create_project: ({ name }) => { altaProyectos.push(name); return { id: "p1", name, working_directory: "/tmp/terminus/p1" }; },
  });
  const altaDoc = alta.w.document;
  const altaTitulo = () => altaDoc.querySelector("h1")?.textContent?.trim();
  const altaBoton = (texto) => [...altaDoc.querySelectorAll("button")].find((b) => b.textContent?.trim() === texto);
  await espera(150);
  assert.equal(altaTitulo(), "Elige tus proveedores de IA.", "sin workspace el alta empieza en los proveedores");
  assert.ok(altaDoc.body.textContent.includes("Modelos locales (OpenCode · llama.cpp)"));
  assert.ok(altaBoton("Instalar y continuar")?.disabled, "sin proveedores elegidos no se avanza");
  altaDoc.querySelector('input[type="checkbox"]').click();
  await espera(30);
  altaBoton("Instalar y continuar").click();
  await espera(80);
  assert.equal(altaTitulo(), "Crea tu primer workspace.");
  const altaNombre = altaDoc.querySelector('input[type="text"]');
  altaNombre.value = "Norte";
  altaNombre.dispatchEvent(new alta.w.InputEvent("input", { bubbles: true }));
  await espera(20);
  altaBoton("Crear workspace").click();
  await espera(200);
  assert.equal(altaTitulo(), "Conecta tus cuentas.", altaDoc.body.textContent.slice(0, 600));
  altaBoton("Atrás").click();
  await espera(80);
  assert.equal(altaDoc.querySelector('input[type="text"]')?.value, "Norte", "Atrás conserva el nombre");
  altaBoton("Continuar").click();
  await espera(120);
  assert.deepEqual(altaCreados, ["Norte"], "volver sin cambiar el nombre no crea otro workspace");
  altaBoton("Continuar").click();
  await espera(120);
  assert.equal(altaTitulo(), "Conecta tus repositorios.");
  altaDoc.querySelector("button[aria-expanded]")?.click();
  await espera(80);
  assert.ok(
    altaDoc.querySelector('button[aria-expanded="true"]')?.textContent?.includes("GitHub"),
    "la tarjeta de GitHub despliega su conexión",
  );
  altaBoton("Continuar").click();
  await espera(80);
  assert.equal(altaTitulo(), "Elige tu fuente de contexto principal.");
  assert.ok(altaBoton("Agregar después"), "sin contexto elegido el botón deja seguir");
  const altaOpcion = (texto) => [...altaDoc.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith(texto));
  assert.ok(!altaOpcion("GitHub") && !altaOpcion("Bitbucket"), "un servicio sin conectar no se ofrece como contexto");
  assert.ok(!altaOpcion("Empezar vacía"), "la fuente de contexto no crea carpetas");
  altaOpcion("Explorar carpeta").click();
  await espera(80);
  altaBoton("Usar como contexto principal").click();
  await espera(150);
  assert.equal(altaTitulo(), "Agrega tu primer proyecto.");
  assert.ok(altaOpcion("Explorar carpeta") && altaOpcion("Empezar vacía"), "el proyecto se elige como en «Añadir un proyecto»");
  altaOpcion("Empezar vacía").click();
  await espera(80);
  assert.ok(altaDoc.body.textContent.includes("/tmp/terminus"), "enseña la ubicación del workspace");
  altaBoton("Cambiar…").click();
  await espera(80);
  assert.deepEqual(altaUbicaciones, ["/tmp/contexto"], "la ubicación se cambia desde el alta");
  const altaProyecto = altaDoc.querySelector('input[type="text"]');
  altaProyecto.value = "Mi proyecto";
  altaProyecto.dispatchEvent(new alta.w.InputEvent("input", { bubbles: true }));
  await espera(20);
  altaBoton("Terminar").click();
  await espera(200);
  assert.deepEqual(altaProyectos, ["Mi proyecto"]);
  assert.ok(!altaDoc.body.textContent.includes("Agrega tu primer proyecto."), "terminar entra a la app");
  assert.deepEqual(alta.fallos, []);

  /** Saltar el alta desde los proveedores crea el workspace por omisión y entra a la app. */
  let saltoActiva = null;
  const saltoCreados = [];
  const saltoEspacios = () => ({
    workspaces: saltoActiva ? [{ id: "m", name: "Mi workspace", context_root: null }] : [],
    active: saltoActiva,
    migrations: [],
  });
  const salto = await arrancar("listo", "alta-manual", {
    ...RESPUESTAS,
    list_workspaces: saltoEspacios,
    workspaces_startup: saltoEspacios,
    list_language_packs: [], list_bundled_language_packs: [],
    add_workspace: ({ name }) => { saltoCreados.push(name); return { id: "m", name }; },
    set_active_workspace: ({ id }) => { saltoActiva = id; },
    set_workspace_language: null,
  });
  await espera(150);
  [...salto.w.document.querySelectorAll("button")]
    .find((b) => b.textContent?.trim() === "Configurar manualmente")
    ?.click();
  await espera(200);
  assert.deepEqual(saltoCreados, ["Mi workspace"], "configurar a mano crea el workspace por omisión");
  assert.ok(!salto.w.document.body.textContent.includes("Elige tus proveedores de IA."), "configurar a mano entra a la app");
  assert.deepEqual(salto.fallos, []);

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
        ? { questions: [{ request_id: "req-1", turn: "t-preg" }], permissions: [] }
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
  const conPregunta = await arrancar("listo", "pregunta-viva", PREGUNTA_VIVA);
  const docP = conPregunta.w.document;
  docP.querySelector('[data-sesion="s1"]')?.click();
  await espera(150);
  conPregunta.emit("chat", { kind: "started", session: "s1", workspace: "w" });
  conPregunta.emit("question", {
    workspace: "w",
    session: "s1",
    turno: "t-preg",
    preguntas: PREGUNTA.questions,
    request_id: "req-1",
  });
  await espera(120);
  // Lo que hace el backend al preguntar: persiste el tramo y sigue esperando.
  hilos.s1 = [...hilos.s1, PREGUNTA];
  for (let vuelta = 0; vuelta < 2; vuelta++) {
    docP.querySelector('[data-sesion="s2"]')?.click();
    await espera(150);
    docP.querySelector('[data-sesion="s1"]')?.click();
    await espera(150);
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
  await espera(200);
  process.off("unhandledRejection", anota);
  if (contestadas.length !== 1 || enviadas.length > 0) {
    console.error(
      "Contestar tras ir y volver no usa el canal vivo: " +
        `answer_question=${contestadas.length}, send_message=${enviadas.length}.`,
    );
    process.exit(1);
  }
  assert.equal(contestadas[0].requestId, "req-1");

  // Esc cierra la pregunta sin contestarla y devuelve la caja de escribir.
  // Mientras el agente espere, esa caja no existe.
  conPregunta.emit("question", {
    workspace: "w",
    session: "s1",
    turno: "t-preg2",
    preguntas: PREGUNTA.questions,
    request_id: "req-2",
  });
  await espera(150);
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
  await espera(200);
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
  await espera(150);
  [...docP.querySelectorAll("button")]
    .find((b) => b.textContent?.trim().startsWith("Omitir"))
    ?.click();
  await espera(200);
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
  await espera(150);
  const tarjetaDos = docP.querySelector('[data-interruption="question"]');
  const teclaEnDos = (key, extra = {}) =>
    (docP.activeElement && tarjetaDos.contains(docP.activeElement) ? docP.activeElement : tarjetaDos)
      .dispatchEvent(new conPregunta.w.KeyboardEvent("keydown", { key, bubbles: true, ...extra }));
  assert.match(tarjetaDos.textContent, /1 de 2/);
  assert.match(tarjetaDos.textContent, /Respondidas 0\/2/);
  const encabezadoDePregunta = () => tarjetaDos.querySelector("p")?.previousElementSibling?.textContent;
  assert.equal(encabezadoDePregunta(), "El agente pregunta", "sin header va el texto del catálogo");
  teclaEnDos("2");
  await espera(50);
  assert.match(tarjetaDos.textContent, /¿Con qué color\?/, "un número elige y pasa a la siguiente");
  assert.equal(encabezadoDePregunta(), "Color", "el header de Claude va encima de la pregunta");
  assert.match(tarjetaDos.textContent, /Respondidas 1\/2/);
  teclaEnDos("3");
  await espera(50);
  const campoOtra = tarjetaDos.querySelector("textarea");
  assert.ok(campoOtra, "n+1 abre el campo de «Otra»");
  campoOtra.value = "Morado";
  campoOtra.dispatchEvent(new conPregunta.w.Event("input", { bubbles: true }));
  await espera(20);
  const antesDeDos = contestadas.length;
  campoOtra.dispatchEvent(
    new conPregunta.w.KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }),
  );
  await espera(200);
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
  const atadurasTres = { p1: [{ request_id: "req-p1", turn: "t-tres" }], p2: [{ request_id: "req-p2", turn: "t-tres" }] };
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
  const aMedias = await arrancar("listo", "preguntas-a-medias", A_MEDIAS);
  const docMedias = aMedias.w.document;
  const traza = [];
  const abrir = async (id) => {
    docMedias.querySelector(`[data-sesion="${id}"]`)?.click();
    await espera(150);
  };
  // La tarjeta que se ve: las de pestañas montadas y escondidas no cuentan.
  const tarjeta = () =>
    [...docMedias.querySelectorAll('[data-interruption="question"]')].find((el) => !el.closest(".hidden, [hidden]"));
  const teclaEnLaTarjeta = async (key, extra = {}) => {
    tarjeta().dispatchEvent(new aMedias.w.KeyboardEvent("keydown", { key, bubbles: true, ...extra }));
    await espera(40);
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
  await espera(40);
  opcionM("Rojo").click();
  await espera(40);
  await teclaEnLaTarjeta("ArrowRight");
  await teclaEnLaTarjeta("3");
  const otraM = tarjeta().querySelector("textarea");
  assert.ok(otraM, "n+1 abre «Otra» en la tercera página");
  otraM.value = "Morado";
  otraM.dispatchEvent(new aMedias.w.Event("input", { bubbles: true }));
  await espera(40);
  assert.deepEqual(foto("p1 a medias"), { paso: "p1 a medias", tramo: "false", plegada: false, pagina: "3 de 3", respondidas: "Respondidas 3/3", elegidas: [], otra: "Morado" });
  const tarjetaDeP1 = tarjeta();
  tramo().click();
  botonM("Plegar preguntas").click();
  await espera(40);
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
  await espera(40);
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
  await espera(200);
  assert.equal(contestadasTres.length, 1, "⌘↵ en la última no mandó las respuestas");
  assert.equal(contestadasTres[0].requestId, "req-p1");
  assert.deepEqual(contestadasTres[0].respuestas, [
    { turn: "t-tres", question: "q1", chosen: ["o1"], free_text: null },
    { turn: "t-tres", question: "q2", chosen: ["a", "r"], free_text: null },
    { turn: "t-tres", question: "q3", chosen: [], free_text: "Morado" },
  ]);
  hilosTres.p1 = [...hilosTres.p1, { role: "user", id: "resp-req-p1", text: "Hecho", answers: contestadasTres[0].respuestas.map((r) => ({ ...r, question_text: "", text: "Hecho", source: "persona", when: 0 })) }];
  // El registro de lo contestado se pliega y sigue plegado al volver.
  const registro = () => celdaM().querySelector('section[aria-label="Preguntas"] button[aria-expanded]');
  assert.equal(registro()?.getAttribute("aria-expanded"), "true", "el registro de preguntas no nace abierto");
  registro().click();
  await espera(40);
  await abrir("p2");
  await abrir("p1");
  assert.equal(registro()?.getAttribute("aria-expanded"), "false", "al remontar se abrió el registro de preguntas plegado");

  // El turno siguiente repite `q1..q3`.
  const OTRA_VEZ = { role: "agent", id: "t-otra", text: "Una más", questions: TRES };
  aMedias.emit("chat", { kind: "started", session: "p1", workspace: "w" });
  aMedias.emit("question", { workspace: "w", session: "p1", turno: "t-otra", preguntas: TRES, request_id: "req-p1b" });
  await espera(150);
  hilosTres.p1 = [...hilosTres.p1, OTRA_VEZ];
  atadurasTres.p1 = [{ request_id: "req-p1b", turn: "t-otra" }];
  assert.deepEqual(
    foto("p1, turno nuevo"),
    { paso: "p1, turno nuevo", tramo: "true", plegada: false, pagina: "1 de 3", respondidas: "Respondidas 0/3", elegidas: [], otra: null },
    "el turno nuevo heredó lo elegido en el anterior",
  );
  await teclaEnLaTarjeta("2");
  assert.equal(foto("p1, turno nuevo a medias").pagina, "2 de 3");

  // Cerrar la pestaña suelta lo contestado a medias: reabrirla empieza de cero.
  docMedias.querySelector('button[aria-label="Cerrar «Pregunta uno»"]')?.click();
  await espera(150);
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
  const nace = await arrancar("listo", "tarea-que-nace", NACE);
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
  await espera(150);
  nace.emit("chat", { kind: "started", session: "nueva", workspace: "w" });
  nace.emit("chat", { kind: "tool", session: "nueva", workspace: "w", id: "ls", text: "Bash", target: "ls -la" });
  nace.emit("chat", { kind: "tool_done", session: "nueva", workspace: "w", id: "ls", text: "Bash", ok: true });
  nace.emit("chat", { kind: "delta", session: "nueva", workspace: "w", text: "Listo." });
  nace.emit("chat", { kind: "done", session: "nueva", workspace: "w", ok: true });
  await espera(300);
  assert.equal(tramoNace()?.getAttribute("aria-expanded"), "false", "el primer turno de la tarea nueva no pinta su tramo");
  tramoNace().click();
  await espera(40);
  docNace.querySelector('[data-sesion="vieja"]')?.click();
  await espera(150);
  assert.equal(tramoNace(), undefined, "la tarea vieja no tiene tramo: la celda que se ve sigue siendo la nueva");
  docNace.querySelector('[data-sesion="nueva"]')?.click();
  await espera(150);
  assert.equal(tramoNace()?.getAttribute("aria-expanded"), "true", "al volver a la tarea recién nacida se plegó su tramo");
  [...docNace.querySelectorAll("button")]
    .find((b) => b.getAttribute("aria-label") === "Cerrar «Revisa la carpeta»")
    ?.click();
  await espera(150);
  docNace.querySelector('[data-sesion="nueva"]')?.click();
  await espera(150);
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
      agent: "codex",
      permission_mode: "manual",
      turns: [],
    }),
    list_permission_modes: modos,
    list_active_turns: ["s1"],
    pending_requests: ({ session }) =>
      session === "s1"
        ? { questions: [], permissions: [{ request_id: "perm-1", tool: "Bash", target: "rm -rf" }] }
        : { questions: [], permissions: [] },
  };
  const ventana = await arrancar("listo", "estado-de-ventana", VENTANA);
  const docV = ventana.w.document;
  const modoActual = () =>
    [...docV.querySelectorAll("[aria-label]")]
      .map((el) => el.getAttribute("aria-label"))
      .find((etiqueta) => etiqueta.startsWith("Permisos: "));
  docV.querySelector('[data-sesion="s1"]')?.click();
  await espera(200);
  assert.equal(modoActual(), "Permisos: Manual");
  const cajaV = docV.querySelector("textarea");
  cajaV.focus();
  cajaV.dispatchEvent(
    new ventana.w.KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }),
  );
  await espera(120);
  assert.equal(modoActual(), "Permisos: Automático", "shift+Tab cambia el modo");
  docV.querySelector('[data-sesion="s2"]')?.click();
  await espera(200);
  docV.querySelector('[data-sesion="s1"]')?.click();
  await espera(250);
  if (modoActual() !== "Permisos: Automático") {
    console.error(`Volver a la tarea revierte lo elegido en su caja: ${modoActual()}.`);
    process.exit(1);
  }
  // Y el gate del permiso pendiente aparece sin que nadie repita su evento.
  ventana.w.dispatchEvent(new ventana.w.Event("focus"));
  await espera(400);
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
    const auto = await arrancar("listo", `automatico-aprueba-${cambio}`, {
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
    await espera(200);
    auto.w.dispatchEvent(new auto.w.Event("focus"));
    await espera(400);
    assert.ok(docA.body.textContent.includes("Aprobar acción"), "el gate pendiente está a la vista antes de cambiar de modo");
    const cajaA = docA.querySelector("textarea");
    cajaA.focus();
    cajaA.dispatchEvent(new auto.w.KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
    await espera(300);
    if (cambio === "acepta") {
      assert.deepEqual(
        respuestas.map(({ session, requestId, allow }) => ({ session, requestId, allow })),
        [{ session: "s1", requestId: "perm-1", allow: true }],
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

  // Lo nuevo del workspace arranca con su modo por defecto y lo que ya existe
  // conserva el suyo. El ajuste vive en General, antes del contexto.
  const defaultSaves = [];
  const conDefault = { workspaces: [{ id: "w", name: "W", context_root: null, default_permission_mode: "auto" }], active: "w" };
  const porDefecto = await arrancar("listo", "default-permission-mode", {
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
  await espera(150);
  assert.equal(defaultModeLabel(), "Permisos: Automático", "a new task starts with the workspace default");
  defaultDoc.querySelector('[data-sesion="s1"]')?.click();
  await espera(200);
  assert.equal(defaultModeLabel(), "Permisos: Manual", "an existing task keeps its own mode");
  defaultDoc.querySelector('button[aria-label="Nueva tarea"]').click();
  await espera(150);
  assert.equal(defaultModeLabel(), "Permisos: Automático", "and the next new task starts with the default again");
  defaultDoc.querySelector('button[aria-label="Configuración"]')?.click();
  await espera(150);
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
  await espera(80);
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

  const prosa = await arrancar("listo", "markdown-como-se-escribio", {
    ...CON_TAREA,
    load_session: {
      ...CON_TAREA.load_session,
      turns: [{ role: "assistant", text: PROSA, artifacts: [] }],
    },
  });
  const docM = prosa.w.document;
  docM.querySelector('[data-sesion="s1"]')?.click();
  await espera(250);
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
  const diagrama = await arrancar("listo", "diagrama-en-toda-la-ventana", {
    ...CON_TAREA,
    load_session: {
      ...CON_TAREA.load_session,
      turns: [{ role: "assistant", text: "```mermaid\ngraph TD\n  A --> B\n```", artifacts: [] }],
    },
  });
  const docD = diagrama.w.document;
  docD.querySelector('[data-sesion="s1"]')?.click();
  await espera(250);
  const extender = docD.querySelector('button[aria-label="Ver diagrama en toda la ventana"]');
  assert.ok(extender, "el diagrama no ofrece extenderse a toda la ventana");
  const capa = () => docD.querySelector('[role="dialog"][aria-modal="true"]');
  for (const cerrar of ["boton", "escape"]) {
    extender.focus();
    extender.click();
    await espera(50);
    assert.ok(capa(), "extender no abrió la capa");
    assert.ok(capa().classList.contains("fixed") && capa().classList.contains("inset-0"), "la capa no cubre la ventana");
    assert.ok(capa().contains(docD.activeElement), "el foco se quedó detrás de la capa");
    if (cerrar === "boton") {
      capa().querySelector('button[aria-label="Salir de la vista en toda la ventana"]').click();
    } else {
      docD.activeElement.dispatchEvent(new diagrama.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    }
    await espera(50);
    assert.equal(capa(), null, `cerrar con ${cerrar} dejó la capa puesta`);
    assert.equal(docD.activeElement, extender, `cerrar con ${cerrar} no devolvió el foco`);
  }
  assert.deepEqual(diagrama.fallos, []);
  diagrama.w.close();

  let activos = ["s1"];
  let esperandoHija = true;
  const fondo = await arrancar("listo", "hija-en-segundo-plano", {
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
  const reconciliar = async () => { fondo.w.dispatchEvent(new fondo.w.Event("focus")); await espera(400); };
  docFondo.querySelector('[data-sesion="s1"]').click();
  await espera(350);
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
  await espera(250);
  assert.equal(rotulo(), "El agente está trabajando", "el turno nuevo no hereda la espera del anterior");
  assert.deepEqual(fondo.fallos, []);
  fondo.w.close();

  // Un primer turno que Rust niega deja su aviso en el blanco, y solo ahí: la
  // tarea nueva siguiente, de este proyecto o de otro, sale limpia.
  const unstarted = await arrancar("listo", "first-turn-rejected", {
    ...RESPUESTAS,
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
  await espera(100);
  const firstPrompt = unstartedDoc.querySelector("textarea");
  firstPrompt.value = rejectedPrompt;
  firstPrompt.dispatchEvent(new unstarted.w.Event("input", { bubbles: true }));
  firstPrompt.closest("form").dispatchEvent(new unstarted.w.Event("submit", { bubbles: true, cancelable: true }));
  await espera(150);
  assert.ok(ghost(), "the rejection is said where it happened");
  assert.equal(unstartedDoc.querySelector("textarea").value, rejectedPrompt, "the text comes back to retry");
  assert.equal(unstartedDoc.querySelector("[data-sesion]"), null, "no row is left for a task that was not created");
  unstarted.w.dispatchEvent(new unstarted.w.KeyboardEvent("keydown", { key: "t", ctrlKey: true, metaKey: true, bubbles: true }));
  await espera(150);
  assert.equal(ghost(), false, "a new task after a rejected first turn starts clean");
  unstartedDoc.querySelector('button[aria-label="Nueva tarea en calc"]').click();
  await espera(150);
  assert.equal(ghost(), false, "and so does one in another project");
  assert.equal(unstartedDoc.body.textContent.includes(rejectedPrompt), false);
  assert.deepEqual(unstarted.fallos, []);

  // Las columnas laterales ceden ancho hasta su mínimo antes de que la caja se
  // aplaste. jsdom no calcula el reparto: se comprueba lo que lo decide.
  unstartedDoc.querySelector('button[aria-label="Ver el árbol de trabajo"]')?.click();
  await espera(100);
  const conversation = unstartedDoc.querySelector("[data-conversacion]");
  assert.ok(conversation.classList.contains("flex-[1_1_30rem]"), "the conversation keeps a base width");
  const workColumn = conversation.nextElementSibling.nextElementSibling;
  assert.equal(workColumn.style.minWidth, "300px", "the work column yields down to its minimum");
  assert.ok(workColumn.classList.contains("shrink-[1000]"));
  unstarted.w.close();

  for (const settings of [true, false]) {
    for (const available of [true, false]) {
      let latest = { rid: 276, currentVersion: "0.2.76", version: "0.2.77", rawJson: {} };
      const installed = [];
      let checks = 0;
      let finishDownload;
      const updater = await arrancar("listo", `update-latest-${settings}-${available}`, {
        ...RESPUESTAS,
        "plugin:updater|check": () => { checks++; return latest; },
        "plugin:updater|download_and_install": ({ rid }) => {
          installed.push(rid);
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
        await espera(100);
        doc.querySelector("#cfg-tab-entorno").click();
        await espera(100);
      }
      latest = available ? { ...latest, rid: 278, version: "0.2.78" } : null;
      const install = [...doc.querySelectorAll("button")].find(b => b.textContent.trim() === "Actualizar");
      assert.ok(install, `update action is visible (settings=${settings})`);
      install.click();
      await espera(100);
      if (available) {
        latest = { ...latest, rid: 279, version: "0.2.79" };
        const before = checks;
        const clock = Date.now;
        Date.now = () => clock() + 31 * 60 * 1000;
        try {
          updater.w.dispatchEvent(new updater.w.Event("focus"));
          await espera(20);
          if (!settings) assert.equal(checks, before, "downloading skips background checks");
          assert.ok(doc.body.textContent.includes("0.2.78"), "downloading keeps the selected release");
        } finally { Date.now = clock; }
        finishDownload();
        await espera(20);
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
          await espera(20);
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
  const notice = await arrancar("listo", "update-focus", {
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
    await espera(20);
    assert.equal(checks, 1, "focus within ten minutes does not check again");
    [...doc.querySelectorAll("button")].find(b => b.textContent.trim() === "Ahora no").click();
    elapsed = 11 * 60 * 1000;
    focus();
    await espera(20);
    assert.ok(!doc.body.textContent.includes("Hay una versi\u00f3n nueva:"), "dismissed version stays hidden");
    elapsed += 11 * 60 * 1000;
    release = new Promise(resolve => { resolveCheck = resolve; });
    focus();
    doc.dispatchEvent(new notice.w.Event("visibilitychange"));
    await espera(20);
    assert.equal(checks, 3, "focus and visibility share the pending check");
    resolveCheck({ rid: 278, currentVersion: "0.2.76", version: "0.2.78", rawJson: {} });
    await espera(20);
    assert.ok(doc.body.textContent.includes("Hay una versi\u00f3n nueva: 0.2.78"), "a newer version is announced");
  } finally {
    Date.now = clock;
    notice.w.close();
  }

  await spaceScenarios({ arrancar, espera, CON_TAREA });

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
const manual = await arrancar("falta", 3);
const entrar = [...manual.w.document.querySelectorAll(".setup-actions button")].at(-1);
if (entrar) {
  entrar.dispatchEvent(new manual.w.MouseEvent("click", { bubbles: true }));
  await espera(500);
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
