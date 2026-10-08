/**
 * Que `/btw` en Claude vaya a la pregunta al margen y no al envío, que con otro
 * agente siga siendo texto del turno, que el menú lo ofrezca solo con el agente
 * que lo declara y que «Pasar al hilo» deje el texto en la caja sin mandarlo.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { alHilo, comandosConAlMargen, preguntaAlMargen } from "../src/lib/side-question.ts";
import { slashSuggestions, type SlashMenu } from "../src/lib/skills.ts";

const deClaude: SlashMenu = {
  commands: [{ name: "context", description: null }],
  skills: [],
  side_question: "btw",
};
const deCodex: SlashMenu = { commands: [], skills: [], side_question: null };

test("/btw con texto es una pregunta al margen si el agente la declara", () => {
  assert.equal(preguntaAlMargen("/btw ¿dónde se decide?", "btw"), "¿dónde se decide?");
  assert.equal(preguntaAlMargen("/btw   varias\nlíneas  ", "btw"), "varias\nlíneas");
  assert.equal(preguntaAlMargen("/BTW mayúsculas", "btw"), "mayúsculas");
});

test("con otro agente, /btw sigue el camino de hoy", () => {
  assert.equal(preguntaAlMargen("/btw ¿dónde?", null), null);
  assert.equal(preguntaAlMargen("/btw ¿dónde?", deCodex.side_question ?? null), null);
});

// Sin pregunta no hay nada que contestar; `/btwx` es otro comando y `hola /btw` no empieza por él.
test("solo el comando entero y con pregunta detrás", () => {
  assert.equal(preguntaAlMargen("/btw", "btw"), null);
  assert.equal(preguntaAlMargen("/btw    ", "btw"), null);
  assert.equal(preguntaAlMargen("/btwx algo", "btw"), null);
  assert.equal(preguntaAlMargen("hola /btw algo", "btw"), null);
  assert.equal(preguntaAlMargen("!btw algo", "btw"), null);
});

test("el menú ofrece /btw solo con el agente que lo declara, una vez", () => {
  const conPublicado = { ...deClaude, commands: [...deClaude.commands, { name: "btw", description: null }] };
  const filas = comandosConAlMargen(conPublicado, "Pregunta al margen");
  assert.deepEqual(
    filas.filter((c) => c.name === "btw"),
    [{ name: "btw", description: "Pregunta al margen" }],
  );
  const grupos = slashSuggestions([], filas, "bt");
  assert.equal(grupos[0].kind, "agent");
  assert.equal(grupos[0].rows[0].name, "btw");

  assert.deepEqual(comandosConAlMargen(deCodex, "Pregunta al margen"), []);
  assert.deepEqual(slashSuggestions([], comandosConAlMargen(deCodex, "x"), "bt"), []);
});

// El texto vuelve a la caja y se manda solo si la persona quiere: no puede
// salir como otra pregunta al margen ni como un `!` que se ejecute.
test("«Pasar al hilo» deja pregunta y respuesta en la caja, detrás de lo escrito", () => {
  const texto = "Pregunté al margen: ¿dónde?\n\nEn mandar().";
  assert.equal(alHilo("", texto), texto);
  assert.equal(alHilo("  ", texto), texto);
  assert.equal(alHilo("borrador", texto), `borrador\n\n${texto}`);
  assert.equal(preguntaAlMargen(alHilo("", texto), "btw"), null);
  assert.equal(alHilo("", "/btw otra"), " /btw otra");
  assert.equal(alHilo("", "!rm -rf x"), " !rm -rf x");
});
