/**
 * Que un `focus()` automático no le quite el sitio a quien está escribiendo.
 * La guarda vive en `src/lib/focus.ts` y la usan los `focus()` que no nacen de
 * un gesto. El caso legítimo se comprueba en `scripts/mount-frontend.mjs`.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
const g = globalThis as unknown as Record<string, unknown>;
g.document = dom.window.document;
g.HTMLElement = dom.window.HTMLElement;
g.HTMLInputElement = dom.window.HTMLInputElement;
g.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;

const { atenderElCampo, enfocarSiNadieEscribe, escribiendoEnOtroSitio, pedirElCampo } =
  await import("../src/lib/focus.ts");

const doc = dom.window.document;

function poner(html: string): HTMLElement {
  doc.body.innerHTML = html;
  return doc.body.firstElementChild as HTMLElement;
}

function par(html: string): [HTMLElement, HTMLElement] {
  doc.body.innerHTML = html;
  return [doc.body.children[0] as HTMLElement, doc.body.children[1] as HTMLElement];
}

test("un botón enfocado no es alguien escribiendo", () => {
  const [boton, destino] = par("<button></button><textarea></textarea>");
  boton.focus();
  assert.equal(escribiendoEnOtroSitio(destino), false);
  enfocarSiNadieEscribe(destino);
  assert.equal(doc.activeElement, destino);
});

test("un campo de texto ajeno se queda con el foco", () => {
  const [cola, compositor] = par("<textarea></textarea><textarea></textarea>");
  cola.focus();
  assert.equal(escribiendoEnOtroSitio(compositor), true);
  enfocarSiNadieEscribe(compositor);
  assert.equal(doc.activeElement, cola);
});

test("una casilla o un radio no son texto a medio escribir", () => {
  for (const tipo of ["checkbox", "radio", "button", "submit"]) {
    const [control, destino] = par(`<input type="${tipo}"><textarea></textarea>`);
    control.focus();
    assert.equal(escribiendoEnOtroSitio(destino), false, tipo);
  }
});

test("un contenteditable cuenta, y uno apagado no", () => {
  const [caja, destino] = par('<div contenteditable="true" tabindex="0"></div><textarea></textarea>');
  caja.focus();
  assert.equal(escribiendoEnOtroSitio(destino), true);
  caja.setAttribute("contenteditable", "false");
  assert.equal(escribiendoEnOtroSitio(destino), false);
});

test("reenfocar el campo que ya lo tiene sigue permitido", () => {
  const destino = poner("<textarea></textarea>");
  destino.focus();
  assert.equal(escribiendoEnOtroSitio(destino), false);
  enfocarSiNadieEscribe(destino);
  assert.equal(doc.activeElement, destino);
});

const unTic = () => new Promise((listo) => setTimeout(listo));

test("el compositor que se monta en el mismo tic recoge el pedido", async () => {
  const campo = poner("<textarea></textarea>");
  pedirElCampo();
  const baja = atenderElCampo(() => (campo.focus(), true));
  assert.equal(doc.activeElement, campo);
  baja();
  await unTic();
});

test("uno de solo lectura lo deja pasar al que puede", () => {
  const [ajeno, campo] = par("<textarea></textarea><textarea></textarea>");
  const bajas = [
    atenderElCampo(() => false),
    atenderElCampo(() => (campo.focus(), true)),
  ];
  pedirElCampo();
  assert.equal(doc.activeElement, campo);
  assert.notEqual(doc.activeElement, ajeno);
  for (const baja of bajas) baja();
});

test("un pedido atendido o caducado no se lo lleva un compositor posterior", async () => {
  const [primero, segundo] = par("<textarea></textarea><textarea></textarea>");
  const baja = atenderElCampo(() => (primero.focus(), true));
  pedirElCampo();
  baja();
  atenderElCampo(() => (segundo.focus(), true))();
  assert.equal(doc.activeElement, primero);

  pedirElCampo();
  await unTic();
  atenderElCampo(() => (segundo.focus(), true))();
  assert.equal(doc.activeElement, primero);
});
