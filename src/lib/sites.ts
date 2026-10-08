/**
 * Dónde va la capa nativa de un sitio, y cuándo se la puede enseñar.
 *
 * **Un webview nativo no es un `div`: flota sobre la ventana.** No participa
 * del layout, nadie lo mueve al mover lo de al lado, y **se pinta encima de
 * todo lo que el DOM ponga en ese rectángulo** — un diálogo, un menú, un globo.
 * Las dos mitades del problema viven aquí para que no se resuelvan dos veces
 * con dos criterios distintos:
 *
 * | | Qué contesta |
 * |---|---|
 * | [`seguirHueco`] | Dónde está el hueco de la pestaña, ahora y cada vez que cambia |
 * | [`hayCapaEncima`] | Si el DOM tiene algo abierto que la capa taparía |
 *
 * **El hueco se mide en píxeles CSS y no se toca.** `getBoundingClientRect()` da
 * píxeles CSS, que son los puntos lógicos que `sites::site_place` espera: Rust
 * convierte con el factor de escala de la ventana. Multiplicar aquí por
 * `devicePixelRatio` pone la capa al doble de lejos en un Mac Retina y acierta
 * en una pantalla normal — la misma trampa que `scripts/drop.mjs` caza al revés,
 * y por la que **ni una máquina verifica por la otra**.
 *
 * Un `ResizeObserver` sobre el hueco alcanza para todo lo que lo mueve: plegar
 * el historial, abrir la columna de artefactos, arrastrar el separador y
 * redimensionar la ventana **cambian su tamaño**, no solo su posición; mover la
 * ventana por la pantalla no cambia nada, porque la posición es relativa a ella.
 * Las medidas se juntan en un `requestAnimationFrame`: arrastrar el separador
 * dispara el observador decenas de veces por segundo y cada una es un `invoke`.
 *
 * **Lo que hay encima es «cualquier cosa fuera de la app», y no una lista.** Los
 * diálogos, los menús, los globos y Configuración salen a `<body>` por un portal
 * —`Kobalte.Portal` y el `Portal` de Solid—, así que un hijo de `<body>` **que
 * pinte algo** y no sea `#root` es algo abierto encima. Mirarlo por `role=` se
 * queda corto en silencio el día que se monte un átomo con un rol que nadie
 * apuntó, y el síntoma sería un menú abierto **detrás** de un sitio web sin que
 * nada falle.
 *
 * **«Que pinte algo» es la mitad que no da error.** Contar hijos y pedir uno
 * solo da 2 desde el primer instante —`index.html` tiene `#root` y el
 * `<script type="module">` que arranca la app—, así que la respuesta es «siempre
 * hay algo encima» y la capa no se enseña nunca: el webview carga la página y se
 * queda en 1×1 y oculto, sin que nada falle. Por eso `PINTAN_NADA` es una lista
 * de etiquetas y no de roles — equivocarse hacia el lado de esconder solo
 * esconde de más, y hacia el otro tapa la interfaz.
 */

import { createSignal, onCleanup } from "solid-js";

/**
 * Cómo se lee una dirección en pantalla: `localhost:3000`.
 *
 * Vive aquí y no en cada sitio que la pinta porque son dos —la pestaña de la
 * tira y la propia vista— y dos recortes distintos de la misma URL es cómo se
 * acaba con una pestaña que dice `localhost:3000` y un mensaje que dice
 * `http://localhost:3000/`.
 */
export const corta = (url: string) =>
  url.replace(/^https?:\/\//, "").replace(/\/$/, "");

/**
 * Lo tecleado en la barra de una pestaña de navegador, como dirección.
 *
 * Con esquema se respeta tal cual —`abrible` en Rust decide si pasa—. Sin él,
 * algo con forma de host (`github.com`, `localhost:3000`) gana `https://`, o
 * `http://` si es de esta computadora: un servidor de desarrollo casi nunca
 * tiene certificado. Lo demás es una búsqueda.
 */
export function aDireccion(texto: string): string | null {
  const t = texto.trim();
  if (!t) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return t;
  if (!/\s/.test(t)) {
    if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(t)) return `http://${t}`;
    if (/^[^/]+\.[a-z]{2,}(:\d+)?(\/|$)/i.test(t) || /^[^/]+:\d+(\/|$)/.test(t)) return `https://${t}`;
  }
  return `https://duckduckgo.com/?q=${encodeURIComponent(t)}`;
}

/** El rectángulo del hueco, en píxeles CSS. Es lo que viaja a `site_place`. */
export type Hueco = { x: number; y: number; width: number; height: number };

const [encima, setEncima] = createSignal(false);

/** Mientras se arrastra un separador las capas se esconden: una capa nativa sigue al DOM con retraso y se montaría encima. */
const [moviendoHueco, setMoviendoHueco] = createSignal(false);
export { moviendoHueco, setMoviendoHueco };

/**
 * Si el DOM tiene algo abierto que la capa taparía.
 *
 * El observador se enciende con el primer sitio que se abre y no se apaga: es
 * un `MutationObserver` sobre `childList` de `<body>` **sin `subtree`**, así que
 * solo se despierta cuando un portal se monta o se desmonta. Ponerle `subtree`
 * lo despertaría con cada token que pinta el chat.
 */
export function hayCapaEncima() {
  encender();
  return encima();
}

let observando: MutationObserver | null = null;

/** Etiquetas que están en `<body>` y no ocupan un píxel. */
const PINTAN_NADA = new Set([
  "SCRIPT",
  "LINK",
  "STYLE",
  "TEMPLATE",
  "META",
  "NOSCRIPT",
  "TITLE",
]);

function encender() {
  if (observando || typeof MutationObserver === "undefined") return;
  const mirar = () =>
    setEncima(
      Array.from(document.body.children).some(
        (el) => el.id !== "root" && !PINTAN_NADA.has(el.tagName),
      ),
    );
  observando = new MutationObserver(mirar);
  observando.observe(document.body, { childList: true });
  mirar();
}

/**
 * Llama a `cuando` con el hueco de `el`, ahora y cada vez que cambie.
 *
 * Devuelve la baja, y además se da de baja sola con el componente que la montó
 * (`onCleanup`): una capa nativa que sobrevive a su pestaña se queda flotando
 * sobre la interfaz sin nada que la esconda.
 */
export function seguirHueco(el: HTMLElement, cuando: (h: Hueco) => void) {
  let pedido = 0;
  const medir = () => {
    pedido = 0;
    const r = el.getBoundingClientRect();
    cuando({ x: r.x, y: r.y, width: r.width, height: r.height });
  };
  const pedir = () => {
    if (pedido) return;
    pedido = requestAnimationFrame(medir);
  };

  // `ResizeObserver` no existe en jsdom, donde corre el guarda `mount-frontend`. Sin esta
  // pregunta, montar la app ahí lanzaría en el primer sitio abierto — que es
  // justo la clase de fallo que ese guarda existe para cazar, y no puede ser él
  // quien lo cause.
  const ro =
    typeof ResizeObserver === "undefined" ? null : new ResizeObserver(pedir);
  ro?.observe(el);
  const mo = typeof MutationObserver === "undefined"
    ? null
    : new MutationObserver(pedir);
  for (let parent = el.parentElement; parent; parent = parent.parentElement) {
    mo?.observe(parent, {
      attributes: true,
      attributeFilter: ["style", "class", "data-ventana"],
    });
  }
  window.addEventListener("resize", pedir);
  const baja = () => {
    if (pedido) cancelAnimationFrame(pedido);
    ro?.disconnect();
    mo?.disconnect();
    window.removeEventListener("resize", pedir);
  };
  onCleanup(baja);
  medir();
  return baja;
}
