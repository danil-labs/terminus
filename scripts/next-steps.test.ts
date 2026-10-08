/**
 * Las respuestas rápidas que el agente deja al final de su mensaje. Los casos
 * viven en `src/lib/next-steps.cases.json`, que también lee `runtime/chat/next_steps.rs`:
 * si las dos lecturas se separan, una de las dos pruebas falla.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { partirSiguientes, textoSinSiguientes, ultimaVezEnviada, usadaDesde, vistaPrevia, vistaPreviaDelHilo } from "../src/lib/nextSteps.ts";

type Caso = {
  name: string;
  input: string;
  streaming: boolean;
  parts: (
    | { kind: "markdown"; markdown: string }
    | { kind: "next_steps"; prose: string; options: string[]; complete: boolean }
  )[];
  plain: string;
  preview: string;
};

const casos: Caso[] = JSON.parse(
  readFileSync(new URL("../src/lib/next-steps.cases.json", import.meta.url), "utf8"),
);

for (const caso of casos) {
  test(`partir: ${caso.name}`, () => {
    const partes = partirSiguientes(caso.input, caso.streaming).map((p) =>
      p.kind === "markdown"
        ? { kind: p.kind, markdown: p.markdown }
        : { kind: p.kind, prose: p.prose, options: p.options.map((o) => o.prompt), complete: p.complete },
    );
    assert.deepEqual(partes, caso.parts);
  });

  test(`limpiar: ${caso.name}`, () => {
    assert.equal(textoSinSiguientes(caso.input), caso.plain);
    assert.equal(vistaPrevia(caso.input), caso.preview);
  });
}

test("el id de un bloque no cambia mientras llegan sus opciones", () => {
  const a = partirSiguientes("Hecho.\n<NEXT_STEPS>\n- [ ] Un", true);
  const b = partirSiguientes("Hecho.\n<NEXT_STEPS>\n- [ ] Uno\n- [ ] Do", true);
  const idDe = (ps: typeof a) => ps.find((p) => p.kind === "next_steps")?.id;
  assert.ok(idDe(a));
  assert.equal(idDe(a), idDe(b));
});

test("una opción cuenta como usada solo si la persona la mandó después del turno", () => {
  const hilo = [
    { role: "user", text: "Abre el PR contra dev" },
    { role: "agent", text: "…" },
    { role: "user", text: "  Corre las pruebas en la VM \n" },
    { role: "agent", text: "Abre el PR contra dev" },
  ];
  const vez = ultimaVezEnviada(hilo, []);
  assert.ok(usadaDesde(vez, "Corre las pruebas en la VM", 1));
  assert.ok(!usadaDesde(vez, "Abre el PR contra dev", 1), "lo que la persona dijo antes no la gasta, ni lo que repite el agente");
});

test("lo que espera en la cola ya cuenta como mandado", () => {
  const vez = ultimaVezEnviada([{ role: "agent", text: "…" }], ["Abre el PR contra dev "]);
  assert.ok(usadaDesde(vez, "Abre el PR contra dev", 0));
});

test("un bloque que pega la persona es contenido y la vista previa lo conserva", () => {
  const pegado = "Mira:\n<NEXT_STEPS>\n- [ ] Uno\n</NEXT_STEPS>";
  assert.equal(vistaPreviaDelHilo([{ role: "agent", text: "Hola" }, { role: "user", text: pegado }]), "Mira: <NEXT_STEPS> - [ ] Uno </NEXT_STEPS>");
  assert.equal(vistaPreviaDelHilo([{ role: "user", text: "Hola" }, { role: "agent", text: pegado }]), "Mira:");
});
