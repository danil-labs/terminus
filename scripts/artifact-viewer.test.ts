import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { envolver, leerEstado } from "../src/features/artifacts/sandbox.ts";

// jsdom prueba navegación y mensajes; no demuestra aislamiento de un navegador.
test("legacy HTML slides retain navigation after removing the editor", () => {
  const dom = new JSDOM(envolver('<section class="slide">One</section><section class="slide">Two</section>'), {
    runScripts: "dangerously",
    beforeParse(window) { window.scrollTo = () => {}; },
  });
  try {
    const { window } = dom;
    const active = () => window.document.querySelector(".harness-active")?.textContent;
    assert.equal(active(), "One");
    window.dispatchEvent(new window.MessageEvent("message", { data: { harness: "control", accion: "siguiente" } }));
    assert.equal(active(), "Two");
    window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowLeft" }));
    assert.equal(active(), "One");
  } finally { dom.window.close(); }
});

test("retired editor and converter controls cannot extract or edit the document", () => {
  const dom = new JSDOM(envolver("<p>Original</p>"), { runScripts: "dangerously" });
  try {
    const { window } = dom;
    const messages: unknown[] = [];
    window.postMessage = (message: unknown) => { messages.push(message); };
    for (const action of ["editar", "formato", "contenido", "bloques"]) {
      window.dispatchEvent(new window.MessageEvent("message", { data: {
        harness: "control", accion: action, on: true, cual: "negrita", peticion: 1,
      } }));
      assert.equal(leerEstado({ harness: action, html: "hostile", bloques: [] }), null);
    }
    assert.notEqual(window.document.body.contentEditable, "true");
    assert.deepEqual(messages, []);
    assert.equal(window.document.querySelector("p")?.textContent, "Original");
  } finally { dom.window.close(); }
});
