/**
 * ⌘A fuera de un campo selecciona el bloque donde se hizo clic, no la ventana.
 * El módulo es `src/lib/selectAll.ts`; el resaltado real se mira en la ventana.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
const win = dom.window;
const g = globalThis as unknown as Record<string, unknown>;
for (const k of ["document", "Element", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "Range", "getComputedStyle"]) {
  g[k] = k === "getComputedStyle" ? win.getComputedStyle.bind(win) : (win as unknown as Record<string, unknown>)[k];
}

const { acotarSeleccionarTodo } = await import("../../src/lib/selectAll.ts");
acotarSeleccionarTodo(win as unknown as Window);

const doc = win.document;

function montar() {
  doc.body.innerHTML = `
    <main>
      <article id="m1"><p id="p1">primer mensaje</p><pre id="code">let x = 1;</pre></article>
      <article id="m2"><p id="p2">segundo mensaje</p></article>
      <div data-select-scope id="archivo"><span id="linea">contenido del archivo</span></div>
      <textarea id="compositor">borrador</textarea>
    </main>`;
}

function clic(id: string) {
  doc.getElementById(id)!.dispatchEvent(new win.MouseEvent("pointerdown", { bubbles: true }));
}

function cmdA(id = "p1"): boolean {
  const e = new win.KeyboardEvent("keydown", { key: "a", metaKey: true, bubbles: true, cancelable: true });
  doc.getElementById(id)!.dispatchEvent(e);
  return e.defaultPrevented;
}

const seleccion = () => doc.getSelection()!.toString();

test("en un mensaje selecciona solo ese mensaje", () => {
  montar();
  clic("p2");
  assert.equal(cmdA("p2"), true);
  assert.equal(seleccion(), "segundo mensaje");
});

test("en un archivo selecciona solo el archivo", () => {
  montar();
  clic("linea");
  cmdA("linea");
  assert.equal(seleccion(), "contenido del archivo");
});

test("en un bloque de código selecciona el código y al repetir sube al mensaje", () => {
  montar();
  clic("code");
  cmdA("code");
  assert.equal(seleccion(), "let x = 1;");
  cmdA("code");
  assert.equal(seleccion(), "primer mensajelet x = 1;");
});

test("dentro de un campo deja el ⌘A nativo", () => {
  montar();
  const campo = doc.getElementById("compositor") as HTMLTextAreaElement;
  campo.focus();
  clic("compositor");
  assert.equal(cmdA("compositor"), false);
});

test("fuera de todo bloque no selecciona la ventana", () => {
  montar();
  doc.getSelection()!.removeAllRanges();
  clic("m1");
  doc.body.insertAdjacentHTML("beforeend", "<span id='suelto'>suelto</span>");
  clic("suelto");
  assert.equal(cmdA("suelto"), true);
  assert.equal(seleccion(), "");
});
