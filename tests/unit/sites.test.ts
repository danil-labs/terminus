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

const { hayCapaEncima, corta, suspendSiteLayers } = await import("../../src/lib/sites.ts");

const body = dom.window.document.body;

/** El hueco de una capa en la columna derecha, como el PDF de Typst. */
const HUECO = { x: 600, y: 40, width: 400, height: 700 };

/** jsdom no maqueta: cada elemento dice el rectángulo que tendría en la ventana. */
function ocupa(el: Element, x: number, y: number, width: number, height: number) {
  el.getBoundingClientRect = () => ({ x, y, width, height, top: y, left: x, right: x + width, bottom: y + height, toJSON() {} }) as DOMRect;
}

/** Un portal como los de `Kobalte.Portal` y Solid: un `div` sin tamaño con lo que pinta `fixed` dentro. */
function abrirPortal(x: number, y: number, width: number, height: number) {
  const portal = dom.window.document.createElement("div");
  const dentro = dom.window.document.createElement("div");
  ocupa(dentro, x, y, width, height);
  portal.append(dentro);
  body.append(portal);
  return portal;
}

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
    hayCapaEncima(HUECO),
    false,
    "`#root` y el `<script>` de arranque son el estado normal: con esto en " +
      "`true` la capa no se enseña nunca y nada falla",
  );
});

test("un portal sobre el hueco esconde la capa", async () => {
  comoIndexHtml();
  await asentar();
  const portal = abrirPortal(700, 100, 200, 160);
  await asentar();
  assert.equal(hayCapaEncima(HUECO), true, "el menú se abriría detrás de la capa");

  portal.remove();
  await asentar();
  assert.equal(hayCapaEncima(HUECO), false, "al cerrarse, la capa vuelve");
});

test("un portal en otra columna no esconde la capa", async () => {
  comoIndexHtml();
  await asentar();
  // El menú de `/` del chat, a la izquierda del PDF.
  abrirPortal(40, 500, 400, 240);
  await asentar();
  assert.equal(hayCapaEncima(HUECO), false, "escribir `/` en el chat escondía la vista de Typst");
  assert.equal(hayCapaEncima({ x: 0, y: 0, width: 500, height: 800 }), true, "la capa de esa columna sí se esconde");
});

test("un diálogo esconde todas las capas", async () => {
  comoIndexHtml();
  await asentar();
  // El fondo del diálogo cubre la ventana entera, aunque la caja esté en medio.
  const portal = dom.window.document.createElement("div");
  const fondo = dom.window.document.createElement("div");
  const caja = dom.window.document.createElement("div");
  ocupa(fondo, 0, 0, 1280, 800);
  ocupa(caja, 340, 200, 600, 400);
  portal.append(fondo, caja);
  body.append(portal);
  await asentar();
  assert.equal(hayCapaEncima(HUECO), true);
  assert.equal(hayCapaEncima({ x: 0, y: 0, width: 300, height: 800 }), true);
});

test("tocarse por el borde no es estar encima", async () => {
  comoIndexHtml();
  await asentar();
  abrirPortal(HUECO.x - 200, HUECO.y, 200, 300);
  await asentar();
  assert.equal(hayCapaEncima(HUECO), false);
});

test("lo que no pinta un píxel no esconde nada", async () => {
  comoIndexHtml();
  for (const etiqueta of ["script", "link", "style", "template", "noscript"]) {
    body.append(dom.window.document.createElement(etiqueta));
  }
  await asentar();
  assert.equal(
    hayCapaEncima(HUECO),
    false,
    "ninguna de esas etiquetas ocupa sitio: contarlas esconde la capa para siempre",
  );
});

test("la capa modal nativa de un visual del chat esconde todas las capas", async () => {
  comoIndexHtml();
  await asentar();
  const soltar = suspendSiteLayers();
  assert.equal(hayCapaEncima(HUECO), true, "el visual ampliado vive bajo #root, sin portal que medir");
  soltar();
  assert.equal(hayCapaEncima(HUECO), false);
});

test("la dirección se lee igual en la pestaña y en la vista", () => {
  assert.equal(corta("http://localhost:3000"), "localhost:3000");
  assert.equal(corta("http://127.0.0.1:4321/"), "127.0.0.1:4321");
  assert.equal(corta("https://localhost:8443/panel"), "localhost:8443/panel");
});
