#!/usr/bin/env node
/** Preguntas vivas, tareas que nacen y permisos elegidos en la caja. */
import assert from "node:assert/strict";
import { sleep } from "../../tests/helpers/jsdom-app.mjs";
import { TASK_AFTER_QUEUE, boot } from "../../tests/helpers/mount-guard.mjs";

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
  ...TASK_AFTER_QUEUE,
  list_live_sessions: [
    { ...TASK_AFTER_QUEUE.list_live_sessions[0], id: "s1", title: "Con pregunta" },
    { ...TASK_AFTER_QUEUE.list_live_sessions[0], id: "s2", title: "La otra" },
  ],
  load_session: ({ id }) => ({ ...TASK_AFTER_QUEUE.load_session, id, turns: hilos[id] }),
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
  ...TASK_AFTER_QUEUE,
  list_live_sessions: Object.entries(titulos).map(([id, title]) => ({ ...TASK_AFTER_QUEUE.list_live_sessions[0], id, title })),
  load_session: ({ id }) => ({ ...TASK_AFTER_QUEUE.load_session, id, turns: hilosTres[id] }),
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
  ...TASK_AFTER_QUEUE,
  list_live_sessions: () => [
    { ...TASK_AFTER_QUEUE.list_live_sessions[0], id: "vieja", title: "Vieja" },
    ...(creada ? [{ ...TASK_AFTER_QUEUE.list_live_sessions[0], id: "nueva", title: "Revisa la carpeta" }] : []),
  ],
  load_session: ({ id }) => ({
    ...TASK_AFTER_QUEUE.load_session,
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
  ...TASK_AFTER_QUEUE,
  list_live_sessions: [
    { ...TASK_AFTER_QUEUE.list_live_sessions[0], id: "s1", title: "Con modo" },
    { ...TASK_AFTER_QUEUE.list_live_sessions[0], id: "s2", title: "La otra" },
  ],
  load_session: ({ id }) => ({
    ...TASK_AFTER_QUEUE.load_session,
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

// Los árboles montados conservan sus relojes: el proceso no termina solo.
process.exit(0);
