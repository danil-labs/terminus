/**
 * Cuándo el chat del teléfono sigue el final (`src/lib/follow.ts`), con la regla
 * del hilo del escritorio: pegado abajo sigue, si subió no se mueve, y el botón
 * aparece y baja.
 *
 *   node --test apps/mobile/scripts/follow.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { type Follow, MARGIN, OPENED, SLOP, fromTop, jumped, scrolled, shouldStick, showJump, unseen } from "../src/lib/follow.ts";

const VIEWPORT = 600;
/** Un scroll a `offset` con `content` de alto. */
const at = (state: Follow, offset: number, content: number, replies = 0) => scrolled(state, { offset, content, viewport: VIEWPORT }, replies);

test("al abrir sigue el final, sin botón", () => {
  assert.equal(shouldStick(OPENED), true);
  assert.equal(showJump(OPENED), false);
});

test("pegado abajo: el texto que crece se sigue", () => {
  // Abajo del todo con 2000 de alto.
  let s = at(OPENED, 1400, 2000);
  // Llega texto: el contenido crece y el scroll aún no se mueve. Sigue siguiendo.
  s = at(s, 1400, 2300);
  assert.equal(shouldStick(s), true);
  assert.equal(showJump(s), false);
});

test("dentro del margen cuenta como abajo", () => {
  const s = at(at(OPENED, 1400, 2000), 1400 - MARGIN + 1, 2000);
  assert.equal(shouldStick(s), true);
  assert.equal(s.near, true);
});

test("si subió no se mueve: crecer por abajo no lo arrastra y aparece el botón", () => {
  let s = at(OPENED, 1400, 2000, 3);
  s = at(s, 900, 2000, 3);
  assert.equal(shouldStick(s), false, "subir lejos del final suelta el hilo");
  assert.equal(showJump(s), true);
  // Llega texto mientras lee arriba.
  s = at(s, 900, 2600, 3);
  assert.equal(shouldStick(s), false, "el contenido nuevo no lo regresa abajo");
  assert.equal(showJump(s), true);
});

test("el botón cuenta las respuestas que entraron desde que subió", () => {
  let s = at(at(OPENED, 1400, 2000, 3), 900, 2000, 3);
  assert.equal(unseen(s, 3), 0);
  s = at(s, 900, 2600, 5);
  assert.equal(unseen(s, 5), 2);
});

test("tocar el botón baja y vuelve a seguir", () => {
  let s = at(at(OPENED, 1400, 2000, 1), 300, 2000, 1);
  s = jumped(s);
  assert.equal(shouldStick(s), true);
  assert.equal(showJump(s), false);
  assert.equal(unseen(s, 4), 0);
  // La bajada animada emite scrolls hacia abajo, aún lejos del final: no suelta.
  s = at(s, 700, 2000, 1);
  assert.equal(shouldStick(s), true);
  s = at(s, 1400, 2000, 1);
  assert.equal(s.near, true);
});

test("volver abajo a mano también vuelve a seguir", () => {
  let s = at(at(OPENED, 1400, 2000), 500, 2000);
  s = at(s, 1000, 2000);
  assert.equal(shouldStick(s), false, "bajar sin llegar no basta");
  s = at(s, 1390, 2000);
  assert.equal(shouldStick(s), true);
  assert.equal(showJump(s), false);
});

test("encoger acota el scroll al fondo nuevo y no suelta", () => {
  let s = at(OPENED, 1400, 2000);
  // El markdown se re-envuelve y encoge 22 px: el scroll baja a 1378, en el fondo nuevo.
  s = at(s, 1378, 1978);
  assert.equal(shouldStick(s), true);
});

test("una conversación más corta que la pantalla no ofrece el botón", () => {
  const s = at(OPENED, 0, 300);
  assert.equal(showJump(s), false);
  assert.equal(shouldStick(s), true);
});

test("el redondeo al crecer no suelta; un arrastre lento sí", () => {
  // Abajo con 9629; crece a 10294 y el navegador mueve el scroll un píxel hacia arriba.
  let s = at(OPENED, 9029, 9629);
  s = at(s, 9028, 10294);
  assert.equal(shouldStick(s), true, "un píxel no es un gesto");
  // Antes de que baje, la persona arrastra despacio hacia arriba: un píxel por evento.
  for (let k = 2; k <= SLOP + 2; k++) s = at(s, 9029 - k, 10294);
  assert.equal(shouldStick(s), false, "los píxeles sueltos se suman");
});

test("en la lista invertida el final es el desplazamiento 0", () => {
  const metrics = { content: 2000, viewport: VIEWPORT };
  assert.equal(fromTop(0, metrics), 1400);
  assert.equal(scrolled(OPENED, { ...metrics, offset: fromTop(0, metrics) }, 0).near, true);
  assert.equal(scrolled(OPENED, { ...metrics, offset: fromTop(900, metrics) }, 0).near, false);
});

test("el primer gesto, si ya aleja del final, suelta el hilo", () => {
  const metrics = { content: 9000, viewport: VIEWPORT };
  const next = scrolled(OPENED, { ...metrics, offset: fromTop(2000, metrics) }, 3);
  assert.equal(next.following, false);
  assert.equal(next.seen, 3);
});
