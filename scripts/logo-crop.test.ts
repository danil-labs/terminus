import assert from "node:assert/strict";
import test from "node:test";

import { centrar, cubre, limitar, medidas, origenDelCanvas } from "../src/features/settings/logo-crop.ts";

test("una imagen ancha, al centro, recorta un cuadrado del medio", () => {
  assert.equal(cubre(400, 100, 240), 2.4);
  const { w, h } = medidas(400, 100, 1, 240);
  assert.equal(h, 240);
  const ox = centrar(w, 240);
  const oy = centrar(h, 240);
  assert.ok(oy === 0);
  const origen = origenDelCanvas(400, 100, 1, ox, oy, 240);
  assert.ok(origen.sy === 0);
  assert.equal(origen.sh, 100);
  assert.equal(origen.sw, 100);
  assert.equal(origen.sx, 150);
});

test("pegar la imagen a la izquierda muestra el principio, no el centro", () => {
  const origen = origenDelCanvas(400, 100, 1, 0, 0, 240);
  assert.ok(origen.sx === 0);
  assert.equal(origen.sw, 100);
});

test("no se puede arrastrar hasta dejar una banda vacía", () => {
  const { w } = medidas(400, 100, 1, 240);
  assert.equal(limitar(10, w, 240), 0);
  assert.equal(limitar(-10_000, w, 240), 240 - w);
});
