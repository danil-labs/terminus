/**
 * El ancla de Safari (`src/lib/scrollAnchor.ts`): devuelve lo que se movió una sola
 * vez, aunque la lista vuelva a medir después.
 *
 *   node --test apps/mobile/scripts/scroll-anchor.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { restoreAnchor } from "../src/lib/scrollAnchor.ts";

/** Un hilo invertido: subir `scrollTop` baja lo que se ve. `pushed` es lo que creció por abajo. */
const thread = (scrollTop: number) => {
  const state = { pushed: 0 };
  const scroller = { scrollTop } as unknown as Element;
  const element = { isConnected: true, getBoundingClientRect: () => ({ top: scroller.scrollTop - state.pushed }) } as unknown as Element;
  return { state, scroller, element };
};

test("lo que subió vuelve a su sitio, y volver a medir no lo mueve otra vez", () => {
  const { state, scroller, element } = thread(500);
  const anchor = { element, top: 500 };
  state.pushed = 300;
  restoreAnchor(scroller, anchor);
  assert.equal(element.getBoundingClientRect().top, 500);
  restoreAnchor(scroller, anchor);
  assert.equal(scroller.scrollTop, 800);
});

test("un ancla que ya no está en el hilo no mueve nada", () => {
  const { scroller, element } = thread(500);
  restoreAnchor(scroller, { element: { ...element, isConnected: false } as Element, top: 900 });
  assert.equal(scroller.scrollTop, 500);
  restoreAnchor(scroller, null);
  assert.equal(scroller.scrollTop, 500);
});
