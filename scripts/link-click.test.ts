/**
 * El clic en un enlace web del chat: con el modificador de la plataforma sale
 * al navegador sin preguntar, y sin él ofrece la elección.
 *
 * Prueba `clicEnEnlaceWeb`, que es lo que llama el `onClick` del enlace en
 * `ui/Markdown.tsx`, con eventos de ratón de jsdom. No monta el popover.
 */
import assert from "node:assert/strict";
import test, { before } from "node:test";
import { JSDOM } from "jsdom";

let clicEnEnlaceWeb: typeof import("../src/lib/links.ts").clicEnEnlaceWeb;
const DESTINO = "https://ejemplo.test/informe";

before(async () => {
  const dom = new JSDOM("<!doctype html><body></body>");
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = dom.window;
  // El de Node no lo acepta el `dispatchEvent` de jsdom.
  g.CustomEvent = dom.window.CustomEvent;
  ({ clicEnEnlaceWeb } = await import("../src/lib/links.ts"));
});

function clic(mod: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean }, mac: boolean) {
  const fuera: string[] = [];
  const oir = (e: Event) => fuera.push((e as CustomEvent<string>).detail);
  window.addEventListener("harness:abrir-fuera", oir);
  let panel = 0;
  const e = new window.MouseEvent("click", { bubbles: true, cancelable: true, ...mod });
  clicEnEnlaceWeb(e, DESTINO, () => panel++, mac);
  window.removeEventListener("harness:abrir-fuera", oir);
  return { fuera, panel, navega: !e.defaultPrevented };
}

test("Ctrl+clic fuera de macOS abre en el navegador y no el panel", () => {
  assert.deepEqual(clic({ ctrlKey: true }, false), { fuera: [DESTINO], panel: 0, navega: false });
});

test("⌘+clic en macOS abre en el navegador y no el panel", () => {
  assert.deepEqual(clic({ metaKey: true }, true), { fuera: [DESTINO], panel: 0, navega: false });
});

test("el clic simple abre el panel y no sale", () => {
  assert.deepEqual(clic({}, false), { fuera: [], panel: 1, navega: false });
  assert.deepEqual(clic({}, true), { fuera: [], panel: 1, navega: false });
});

test("el modificador de la otra plataforma no cuenta", () => {
  // En macOS Ctrl+clic es el clic derecho; en Windows ⌘ es la tecla Windows.
  assert.deepEqual(clic({ ctrlKey: true }, true), { fuera: [], panel: 1, navega: false });
  assert.deepEqual(clic({ metaKey: true }, false), { fuera: [], panel: 1, navega: false });
});
