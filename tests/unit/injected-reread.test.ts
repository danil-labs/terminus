/**
 * Que releer una tarea con el turno corriendo no pinte dos veces lo que una
 * persona metió en él ni el trabajo del agente que lo precede.
 */

import assert from "node:assert/strict";
import test from "node:test";

import "../helpers/catalog.ts";
import type { Msg } from "../../src/features/chat/Chat.tsx";
import { transcripcion, type Turn, vivoSinPersistir } from "../../src/features/chat/transcript.ts";

const turno = (role: string, id: string, text: string): Turn => ({
  role,
  id,
  text,
  duration_ms: null,
  questions: null,
  artifacts: null,
});

const persistidos = (turns: Turn[]) =>
  new Set(transcripcion(turns).map((m) => m.turno).filter((t): t is string => !!t));

const trabajo: Msg = { role: "agent", text: "Reviso el archivo." };
const leido: Msg = { role: "system", text: "Read", meta: "usó" };
const inyectado: Msg = { role: "user", text: "Mejor el otro", turno: "u2" };
const despues: Msg = { role: "agent", text: "Cambio al otro." };

test("lo metido a mitad de turno ya guardado se lleva lo anterior de vivo", () => {
  const disco = [turno("user", "u1", "Revisa a.txt"), turno("agent", "a1", "Reviso el archivo."), turno("user", "u2", "Mejor el otro")];
  assert.deepEqual(vivoSinPersistir([trabajo, leido, inyectado, despues], persistidos(disco)), [despues]);
});

test("mientras el motor no lo guarda, vivo se queda entero", () => {
  const disco = [turno("user", "u1", "Revisa a.txt")];
  const vivo = [trabajo, leido, inyectado, despues];
  assert.deepEqual(vivoSinPersistir(vivo, persistidos(disco)), vivo);
});

test("con dos metidos, corta en el último que ya está en disco", () => {
  const segundo: Msg = { role: "user", text: "Y añade pruebas", turno: "u3" };
  const final: Msg = { role: "agent", text: "Añado pruebas." };
  const disco = [turno("user", "u1", "Revisa a.txt"), turno("agent", "a1", "x"), turno("user", "u2", "Mejor el otro")];
  assert.deepEqual(
    vivoSinPersistir([trabajo, inyectado, despues, segundo, final], persistidos(disco)),
    [despues, segundo, final],
  );
});

test("un globo sin id, de un motor anterior, no corta nada", () => {
  const sinId: Msg = { role: "user", text: "Mejor el otro" };
  const disco = [turno("user", "u1", "Revisa a.txt"), turno("agent", "a1", "x")];
  assert.deepEqual(vivoSinPersistir([trabajo, sinId, despues], persistidos(disco)), [trabajo, sinId, despues]);
});
