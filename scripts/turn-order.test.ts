/**
 * Que una tarea reabierta enseñe el turno en el orden en que ocurrió.
 *
 * `transcripcion()` es lo único que traduce lo guardado a lo que se pinta.
 * Se afirma sobre la secuencia de mensajes, que es lo que `bloques()` agrupa
 * después en sus pliegues.
 */

import assert from "node:assert/strict";
import test from "node:test";

import "./catalog.ts";
import { transcripcion, type Turn } from "../src/features/chat/transcript.ts";

const leer = { name: "Read", target: "a.txt", ok: true };

/** Un turno del agente que habló, leyó un archivo y volvió a hablar. */
const conOrden: Turn = {
  role: "agent",
  id: "t1",
  text: "Voy a leerlo.\n\nListo.",
  tools: [leer],
  pieces: [{ text: "Voy a leerlo." }, { tool: 0 }, { text: "\n\nListo." }],
  duration_ms: 1200,
  questions: null,
  artifacts: null,
};

test("un turno guardado con su orden se pinta en ese orden", () => {
  const msgs = transcripcion([conOrden]);
  assert.deepEqual(
    msgs.map((m) => [m.role, m.meta ?? null, m.text]),
    [
      ["agent", null, "Voy a leerlo."],
      ["system", "usó", "Read"],
      ["agent", null, "Listo."],
    ],
  );
});

test("los mensajes seguidos tras la última herramienta son una sola respuesta", () => {
  const msgs = transcripcion([
    {
      ...conOrden,
      text: "Voy a leerlo.\n\nListo.\n\nCommit abc.",
      pieces: [{ text: "Voy a leerlo." }, { tool: 0 }, { text: "Listo." }, { text: "Commit abc." }],
    },
  ]).filter((m) => m.role === "agent");
  assert.deepEqual(
    msgs.map((m) => [m.text, m.avanceDe ?? null]),
    [
      ["Voy a leerlo.", "t1"],
      ["Listo.\n\nCommit abc.", null],
    ],
  );
});

test("lo que arrastra el turno va solo en su último mensaje", () => {
  const msgs = transcripcion([{ ...conOrden, code: [], artifacts: [] }]).filter(
    (m) => m.role === "agent",
  );
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].turno, undefined);
  assert.equal(msgs[0].duration_ms, undefined);
  assert.equal(msgs[1].turno, "t1");
  assert.equal(msgs[1].duration_ms, 1200);
});

// El campo es opcional y su ausencia significa «no se registró». Una
// transcripción escrita antes de que existiera tiene que seguir leyéndose,
// con el rastro delante como siempre.
test("un turno sin orden registrado se pinta como antes", () => {
  const { pieces: _pieces, ...sinOrden } = conOrden;
  assert.deepEqual(
    transcripcion([sinOrden]).map((m) => [m.role, m.text]),
    [
      ["system", "Read"],
      ["agent", "Voy a leerlo.\n\nListo."],
    ],
  );
});

test("el mecanismo de preguntas no sale como paso", () => {
  const msgs = transcripcion([
    {
      ...conOrden,
      tools: [{ name: "Write", target: "/tmp/x/.preguntas.json", ok: true }],
    },
  ]);
  assert.deepEqual(
    msgs.map((m) => m.role),
    ["agent", "agent"],
  );
});
