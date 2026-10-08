import assert from "node:assert/strict";
import { test } from "node:test";
import { createEffect, createResource, createRoot, createSignal } from "solid-js";
import { forgetRosters, lastRoster, rememberRoster } from "../src/lib/handlerRoster.ts";
import type { HandlerDefinition } from "../src/lib/model.ts";

const luego = () => new Promise((listo) => setTimeout(listo, 0));

const encargado = (name: string): HandlerDefinition => ({
  name,
  description: "",
  instructions: "",
  tools: [],
  model: null,
  origin: "repo",
  folder: null,
  agents: [],
  own: false,
  own_scope: null,
});

test("refrescar el recurso conserva lo que ya trajo: no pasa por vacío", async () => {
  await createRoot(async (dispose) => {
    forgetRosters();
    const [creados, setCreados] = createSignal(0);
    const vistos: (HandlerDefinition[] | undefined)[] = [];
    const [encargados] = createResource(
      () => `app:${creados()}`,
      async () => [encargado("ada")],
    );
    createEffect(() => vistos.push(encargados()));
    await luego();
    setCreados(1);
    await luego();
    await luego();
    assert.ok(!vistos.slice(1).some((v) => v === undefined), "un refresco no debe vaciar la lista");
    dispose();
  });
});

test("una fila que vuelve a montar nace con lo último que se supo, no vacía", async () => {
  forgetRosters();
  rememberRoster("app", [encargado("ada")]);
  await createRoot(async (dispose) => {
    const [encargados] = createResource(() => "app:0", async () => [encargado("ada")]);
    const roster = () => encargados() ?? lastRoster("app");
    const plegada: boolean[] = [];
    createEffect(() => plegada.push((roster()?.length ?? 0) === 0));
    await luego();
    assert.ok(!plegada.includes(true), "la sección no debe plegarse en ningún instante");
    dispose();
  });
});
