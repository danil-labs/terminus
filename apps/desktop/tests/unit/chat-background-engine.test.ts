/**
 * El fondo del chat contra un motor simulado por el `invoke` real
 * (`__TAURI_INTERNALS__`): un motor sin `set_chat_background` no pierde la
 * imagen al cambiar el velo ni recibe una ruta sin importar, y un workspace sin
 * fondo propio no hereda el del workspace anterior.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

type Call = { command: string; args: Record<string, unknown> | undefined };

const stored = new Map<string, string>();
const g = globalThis as Record<string, unknown>;
g.localStorage = {
  getItem: (k: string) => stored.get(k) ?? null,
  setItem: (k: string, v: string) => void stored.set(k, v),
  removeItem: (k: string) => void stored.delete(k),
};
g.document = { documentElement: { style: { setProperty() {} } } };

let replies: Record<string, (args: Record<string, unknown> | undefined) => unknown> = {};
const calls: Call[] = [];
g.window = {
  __TAURI_INTERNALS__: {
    invoke: async (command: string, args?: Record<string, unknown>) => {
      calls.push({ command, args });
      const reply = replies[command];
      if (!reply) throw { what: { clave: "shell.service.command" }, detail: "command" };
      return reply(args);
    },
  },
};

const engine = () => import("../../src/lib/chat-background-engine.ts");
const store = () => import("../../src/lib/chat-background-store.ts");

test("un motor anterior no borra la imagen ni recibe una ruta cuando solo cambian el patrón o el velo", async () => {
  replies = { choose_chat_background: () => null };
  calls.length = 0;
  const s = await store();
  s.ponerFondoPropio("/datos/fondo.png");
  const { guardarFondo } = await engine();
  await guardarFondo();
  s.elegirVeloDeFondo(0.5);
  await guardarFondo();
  s.elegirFondoDeChat("dusk");
  await guardarFondo();
  const borrados = calls.filter((c) => c.command === "choose_chat_background" && !c.args?.path);
  assert.deepEqual(borrados, [], "ningún respaldo quita la imagen");
  assert.ok(
    !calls.some((c) => c.command === "choose_chat_background" && c.args?.path),
    "una ruta solo viaja justo después de importarla",
  );
});

test("un workspace sin fondo propio vuelve al patrón de la app, no al del workspace anterior", async () => {
  const s = await store();
  s.ponerFondoPropio(null);
  s.elegirFondoDeChat("dusk");
  s.elegirVeloDeFondo(0.7);
  s.elegirVeloDePaneles(0.25);
  const { cargarFondoDelWorkspace } = await engine();

  replies = { chat_background: () => ({ preset: null, data_url: "data:image/png;base64,AAAA", veil: { chat: 0.3, tabs: null, panels: 0.9 } }) };
  await cargarFondoDelWorkspace("w1");
  assert.equal(s.fondoDeChat(), "propia");
  assert.equal(s.veloDeFondo(), 0.3);
  assert.equal(s.veloDePaneles(), 0.9);

  replies = { chat_background: () => null };
  await cargarFondoDelWorkspace("w1");
  assert.equal(s.imagenDelWorkspace(), null);
  assert.equal(s.fondoDeChat(), "dusk", "vuelve el patrón de la app");

  replies = { chat_background: () => ({ preset: null, data_url: "data:image/png;base64,AAAA", veil: { chat: 0.3, tabs: null, panels: 0.9 } }) };
  await cargarFondoDelWorkspace("w1");
  replies = { chat_background: () => ({ preset: null, data_url: null, veil: null }) };
  await cargarFondoDelWorkspace("w2");
  assert.equal(s.imagenDelWorkspace(), null, "todo nulo es no tener fondo propio");
  assert.equal(s.fondoDeChat(), "dusk");
});
