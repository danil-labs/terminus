import assert from "node:assert/strict";
import test from "node:test";

import { adjuntosDevueltos, adjuntosSinMandar } from "../src/lib/taskDraft.ts";

test("al mandar, la caja se queda sin los adjuntos del mensaje", () => {
  const caja = ["C:/fotos/a.png", "C:/fotos/b.png"];
  assert.deepEqual(adjuntosSinMandar(caja, ["C:/fotos/a.png", "C:/fotos/b.png"]), []);
});

test("lo añadido mientras se mandaba no sale con el mensaje", () => {
  const caja = ["C:/fotos/a.png", "C:/fotos/nueva.png"];
  assert.deepEqual(adjuntosSinMandar(caja, ["C:/fotos/a.png"]), ["C:/fotos/nueva.png"]);
});

test("si el envío falla, los adjuntos vuelven a la caja", () => {
  const enviados = ["C:/fotos/a.png", "C:/fotos/b.png"];
  const caja = adjuntosSinMandar(enviados, enviados);
  assert.deepEqual(adjuntosDevueltos(caja, enviados), enviados);
});

test("si falla con uno nuevo añadido entretanto, están los dos y ninguno repetido", () => {
  const enviados = ["C:/fotos/a.png"];
  const caja = [...adjuntosSinMandar(enviados, enviados), "C:/fotos/nueva.png", "C:/fotos/a.png"];
  assert.deepEqual(adjuntosDevueltos(caja, enviados), ["C:/fotos/a.png", "C:/fotos/nueva.png"]);
});
