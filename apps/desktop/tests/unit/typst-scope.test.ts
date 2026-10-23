import assert from "node:assert/strict";
import test from "node:test";

import { esTypst, llevaVistaTypst } from "../../src/features/code/typstScope.ts";

const principal = "taller-cicy-entre-el-orden-y-el-caos/main.typ";

test("la vista de Typst no se queda pegada al abrir otro archivo en la misma pestaña", () => {
  // Lado a lado con un .typ, luego una notebook y un JSON, y de vuelta al .typ.
  const recorrido = [
    [principal, true],
    ["kit-taller/notebooks/01_logistica_y_caos.ipynb", false],
    ["kit-taller/resultados/automatas_elementales_rapido.json", false],
    ["notas/README.md", false],
    ["figuras/atractor.png", false],
    ["entregable.pdf", false],
    ["taller-cicy-entre-el-orden-y-el-caos/secciones/intro.typ", true],
    [principal, true],
  ] as const;
  for (const [ruta, esperada] of recorrido) {
    assert.equal(llevaVistaTypst(ruta, principal), esperada, ruta);
  }
});

test("sin principal elegido ningún archivo lleva la vista de Typst", () => {
  assert.equal(llevaVistaTypst(principal, null), false);
});

test("un .typ se reconoce sin importar mayúsculas", () => {
  assert.ok(esTypst("Capitulo.TYP"));
  assert.ok(!esTypst("datos.typ.json"));
});
