#!/usr/bin/env node
/** Prosa y diagramas del chat, tareas hijas en segundo plano, primer turno negado y actualizaciones. */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { dist, sleep } from "../../tests/helpers/jsdom-app.mjs";
import { TASK_AFTER_QUEUE, RESPUESTAS, boot, bootPorCarpeta, task } from "../../tests/helpers/mount-guard.mjs";

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
  ...TASK_AFTER_QUEUE,
  load_session: {
    ...TASK_AFTER_QUEUE.load_session,
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
  ...TASK_AFTER_QUEUE,
  load_session: {
    ...TASK_AFTER_QUEUE.load_session,
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
  ...TASK_AFTER_QUEUE,
  list_projects: [{ id: "p", name: "Proyecto", kind: "folder", working_directory: "/lab", sources: [] }],
  list_live_sessions: () => [task("s1", null, null)],
  load_session: ({ id }) => ({ ...TASK_AFTER_QUEUE.load_session, id, turns: [] }),
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
  list_live_sessions: ({ project }) => project ? [{ ...TASK_AFTER_QUEUE.list_live_sessions[0], id: `t-${project}` }] : [],
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

// Los árboles montados conservan sus relojes: el proceso no termina solo.
process.exit(0);
