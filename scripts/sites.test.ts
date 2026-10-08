import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

/**
 * **Cuándo se puede enseñar la capa nativa de un sitio, que es lo que falla
 * callado.**
 *
 * La capa es un webview hijo de la ventana: flota sobre el DOM y se pinta encima
 * de lo que haya en su rectángulo. Quien decide si se enseña es
 * `lib/sites.ts`, y **equivocarse ahí no da ningún error**:
 *
 * - hacia esconder de más, la pestaña se queda en un hueco vacío con la página
 *   ya cargada detrás — que es exactamente lo que pasó: `index.html` tiene
 *   `#root` **y** el `<script type="module">` que arranca la app, la primera
 *   versión contaba hijos de `<body>` y pedía uno solo, y la respuesta era
 *   «siempre hay algo encima». El webview pedía la página —se veía en el
 *   registro del servidor— y se quedaba en 1×1 y oculto;
 * - hacia enseñar de más, un menú o un diálogo se abre **detrás** del sitio.
 *
 * Ninguno de los dos se parece a un fallo, y no lo caza ningún guarda de estilo
 * ni el compilador. Por eso esto.
 *
 * El módulo se importa **una vez y con el DOM ya puesto**: engancha su
 * `MutationObserver` a `document.body` en la primera consulta, y ese `body` es
 * el que tenga el globo en ese momento.
 */

const dom = new JSDOM("<!doctype html><html><body></body></html>");
const g = globalThis as Record<string, unknown>;
g.window = dom.window;
g.document = dom.window.document;
g.MutationObserver = dom.window.MutationObserver;

const { hayCapaEncima, corta } = await import("../src/lib/sites.ts");

const body = dom.window.document.body;

/** Deja `<body>` como lo deja `index.html` recién cargado. */
function comoIndexHtml() {
  body.innerHTML = "";
  const root = dom.window.document.createElement("div");
  root.id = "root";
  const script = dom.window.document.createElement("script");
  script.setAttribute("type", "module");
  body.append(root, script);
}

/**
 * `MutationObserver` entrega en una microtarea, así que hay que soltar el hilo
 * antes de preguntar. Sin esto la prueba leería el estado de antes y pasaría
 * sobre el defecto.
 */
const asentar = () => new Promise((r) => setTimeout(r, 0));

test("el arranque de la app no cuenta como algo abierto encima", async () => {
  comoIndexHtml();
  await asentar();
  assert.equal(
    hayCapaEncima(),
    false,
    "`#root` y el `<script>` de arranque son el estado normal: con esto en " +
      "`true` la capa no se enseña nunca y nada falla",
  );
});

test("un portal abierto esconde la capa", async () => {
  comoIndexHtml();
  await asentar();
  // Así montan `Kobalte.Portal` y el `Portal` de Solid: un `div` hermano de
  // `#root`. Es lo que hay detrás de un diálogo, un menú, un globo y de
  // Configuración entera.
  const portal = dom.window.document.createElement("div");
  portal.append(dom.window.document.createElement("div"));
  body.append(portal);
  await asentar();
  assert.equal(hayCapaEncima(), true, "un portal taparía la capa");

  portal.remove();
  await asentar();
  assert.equal(hayCapaEncima(), false, "al cerrarse, la capa vuelve");
});

test("lo que no pinta un píxel no esconde nada", async () => {
  comoIndexHtml();
  for (const etiqueta of ["script", "link", "style", "template", "noscript"]) {
    body.append(dom.window.document.createElement(etiqueta));
  }
  await asentar();
  assert.equal(
    hayCapaEncima(),
    false,
    "ninguna de esas etiquetas ocupa sitio: contarlas esconde la capa para siempre",
  );
});

test("la dirección se lee igual en la pestaña y en la vista", () => {
  assert.equal(corta("http://localhost:3000"), "localhost:3000");
  assert.equal(corta("http://127.0.0.1:4321/"), "127.0.0.1:4321");
  assert.equal(corta("https://localhost:8443/panel"), "localhost:8443/panel");
});
