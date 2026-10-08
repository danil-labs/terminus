/**
 * Arrastrar una tarea hasta un proyecto, ejercitado de verdad.
 *
 * **Es lógica que no se puede leer.** `lib/drag.ts` decide con un umbral de
 * píxeles si el gesto fue un clic o un arrastre, resuelve el destino con
 * `elementFromPoint` y tiene que dejar claro que soltar no abre además la tarea
 * que se movió. Nada de eso lo ve `tsc`, ninguna guarda de texto lo mira, y
 * comprobarlo a mano exige una persona con el ratón encima de la ventana.
 *
 * Corre en jsdom con un DOM mínimo: dos filas de destino con `data-destino` y
 * eventos de puntero fabricados. No monta la app — lo que se prueba es el
 * módulo, no el sidebar.
 */
import assert from "node:assert/strict";
import test, { before, beforeEach } from "node:test";
import { JSDOM } from "jsdom";

let arrastrar: typeof import("../src/lib/drag.ts").arrastrar;
let fueArrastre: typeof import("../src/lib/drag.ts").fueArrastre;
let tareaEnVuelo: typeof import("../src/lib/drag.ts").tareaEnVuelo;
let destinoEnVuelo: typeof import("../src/lib/drag.ts").destinoEnVuelo;

/** Dónde dice el DOM falso que está cada cosa: `[x, y] -> elemento`. */
let bajoElPuntero: Element | null = null;

before(async () => {
  const dom = new JSDOM("<!doctype html><body></body>", {
    pretendToBeVisual: true,
  });
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = dom.window;
  g.document = dom.window.document;
  // El módulo los usa a secas, como en el navegador: aquí hay que exponerlos o
  // el bucle que desplaza la lista revienta con `ReferenceError`.
  g.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
  g.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
  // jsdom no implementa `elementFromPoint` —lanza «Not implemented»— así que la
  // geometría se declara aquí: lo que se prueba es qué hace el módulo con la
  // respuesta, no si jsdom sabe medir.
  dom.window.document.elementFromPoint = () => bajoElPuntero;
  const m = await import("../src/lib/drag.ts");
  arrastrar = m.arrastrar;
  fueArrastre = m.fueArrastre;
  tareaEnVuelo = m.tareaEnVuelo;
  destinoEnVuelo = m.destinoEnVuelo;
});

function fila(destino: string) {
  const el = document.createElement("div");
  el.dataset.destino = destino;
  document.body.append(el);
  return el;
}

function puntero(tipo: string, x: number, y: number) {
  window.dispatchEvent(
    new window.MouseEvent(tipo, { clientX: x, clientY: y, bubbles: true }),
  );
}

const TAREA = { id: "t1", de: "p1", titulo: "Revisar el scoring" };
const abajo = (e: { button?: number; x: number; y: number }) =>
  ({ button: e.button ?? 0, clientX: e.x, clientY: e.y }) as PointerEvent;

beforeEach(() => {
  document.body.innerHTML = "";
  bajoElPuntero = null;
});

test("un clic no mueve nada: sin recorrer el umbral no hay arrastre", () => {
  let movida: string | null = null;
  bajoElPuntero = fila("p2");
  arrastrar(abajo({ x: 10, y: 10 }), TAREA, (a) => (movida = a));
  // Tres píxeles es el temblor de una mano, no un gesto.
  puntero("pointermove", 12, 12);
  puntero("pointerup", 12, 12);
  assert.equal(movida, null);
  assert.equal(tareaEnVuelo(), null);
  // Y la fila tiene que poder abrir la tarea: si esto quedara marcado, el clic
  // no llegaría nunca a `onPick`.
  assert.equal(fueArrastre(), false);
});

test("soltar sobre otro proyecto la mueve, y no abre la tarea", () => {
  let movida: string | null = null;
  const destino = fila("p2");
  arrastrar(abajo({ x: 10, y: 10 }), TAREA, (a) => (movida = a));
  bajoElPuntero = destino;
  puntero("pointermove", 40, 60);
  assert.deepEqual(tareaEnVuelo(), TAREA);
  assert.equal(destinoEnVuelo(), "p2");
  puntero("pointerup", 40, 60);
  assert.equal(movida, "p2");
  // El navegador dispara un `click` después del `pointerup`: la fila lo
  // descarta con esto, o mover una tarea abriría además la tarea movida.
  assert.equal(fueArrastre(), true);
  assert.equal(tareaEnVuelo(), null);
});

test("su propio proyecto no es destino", () => {
  let llamado = false;
  bajoElPuntero = fila("p1");
  arrastrar(abajo({ x: 10, y: 10 }), TAREA, () => (llamado = true));
  puntero("pointermove", 40, 60);
  assert.equal(destinoEnVuelo(), null);
  puntero("pointerup", 40, 60);
  assert.equal(llamado, false);
});

test("«Recientes» es un destino, y su id es la cadena vacía", () => {
  let movida: string | null = null;
  bajoElPuntero = fila("");
  arrastrar(abajo({ x: 10, y: 10 }), TAREA, (a) => (movida = a));
  puntero("pointermove", 40, 60);
  puntero("pointerup", 40, 60);
  // `""` y no `null`: así nombra el backend a «sin proyecto», y confundir los
  // dos es la diferencia entre sacarla del proyecto y no hacer nada.
  assert.equal(movida, "");
});

test("soltar en el vacío no mueve nada", () => {
  let llamado = false;
  arrastrar(abajo({ x: 10, y: 10 }), TAREA, () => (llamado = true));
  puntero("pointermove", 400, 600);
  puntero("pointerup", 400, 600);
  assert.equal(llamado, false);
  // Pero el gesto sí fue un arrastre: la tarea tampoco se abre.
  assert.equal(fueArrastre(), true);
});

test("Escape suelta la tarea donde estaba", () => {
  let llamado = false;
  bajoElPuntero = fila("p2");
  arrastrar(abajo({ x: 10, y: 10 }), TAREA, () => (llamado = true));
  puntero("pointermove", 40, 60);
  window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" }));
  assert.equal(tareaEnVuelo(), null);
  puntero("pointerup", 40, 60);
  assert.equal(llamado, false);
});
