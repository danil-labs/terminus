#!/usr/bin/env node
/**
 * La posición de un archivo soltado NO se convierte con `devicePixelRatio`.
 *
 * **La misma posición significa cosas distintas en cada plataforma**, y las dos
 * llegan al frontend tipadas igual —`PhysicalPosition`—, así que el tipo no
 * avisa de nada:
 *
 * | | Qué manda wry | Fuente |
 * |---|---|---|
 * | macOS | puntos **lógicos** — `draggingLocation()` y el `frame` del `NSView`, sin `backingScaleFactor` | `wry/src/wkwebview/drag_drop.rs` |
 * | Windows | píxeles **físicos** — `ScreenToClient` sobre una ventana DPI-aware | `wry/src/webview2/drag_drop.rs` |
 *
 * Tauri las emite tal cual (`tauri/src/manager/webview.rs`).
 *
 * **Dividir por `devicePixelRatio` para acotar el drop a una caja parte las
 * coordenadas por dos en un Mac Retina**: el punto cae arriba a la izquierda,
 * así que soltar un archivo no adjunta nada y ni siquiera enciende el
 * resaltado. No hay error ni nada en consola; se lee como que la app no acepta
 * archivos. Y en un Mac sin Retina, o en Windows, el mismo código funciona —
 * que es por qué esto no lo caza probar.
 *
 * Hoy la zona de soltar es la ventana entera y no hay geometría que convertir.
 * Si algún día hace falta saber DÓNDE se soltó, el factor de escala se le pide
 * al backend (`window.scale_factor()`) y en macOS no se divide.
 *
 * Se mecaniza a la primera, y no a la tercera reincidencia como el resto: el
 * fallo **depende de la pantalla de quien prueba**, así que una máquina no
 * puede verificar por la otra ni el autor por el que revisa.
 */
import { readFileSync, } from "node:fs";
import { relative } from "node:path";
// `.pathname` de un `file://` da `/C:/Users/…` en Windows, y `readdirSync` lo
// resuelve contra la unidad actual. Ver `scripts/paths.mjs`.
import { fileURLToPath } from "node:url";
import { archivos } from "./git.mjs";

const RAIZ = fileURLToPath(new URL("../src", import.meta.url));
const ESCUCHA = /onDragDropEvent/;
const CONVIERTE = /devicePixelRatio/;

const fugas = [];
let escuchan = 0;
for (const f of archivos(RAIZ, [".ts", ".tsx"])) {
  const fuente = readFileSync(f, "utf8");
  if (!ESCUCHA.test(fuente)) continue;
  escuchan += 1;
  fuente.split("\n").forEach((l, i) => {
    // Un comentario que lo nombra está explicando por qué no se usa.
    if (/^\s*(\/\/|\*|\/\*)/.test(l)) return;
    if (CONVIERTE.test(l)) fugas.push(`${relative(RAIZ, f)}:${i + 1}  ${l.trim()}`);
  });
}

if (escuchan === 0) {
  console.error(
    "Nadie escucha `onDragDropEvent`: soltar un archivo en la ventana no adjunta nada.\n" +
      "El `drop` de HTML5 no sirve —entrega un `File` sin ruta en disco—, así que si\n" +
      "el manejador nativo desapareció, el gesto desapareció con él.",
  );
  process.exit(1);
}

if (fugas.length === 0) {
  console.log("Soltar un archivo no convierte coordenadas con devicePixelRatio.");
  process.exit(0);
}

for (const f of fugas) console.error(`Convierte la posición del drop — ${f}`);
console.error(
  `\nEsa posición viene en puntos lógicos en macOS y en píxeles físicos en Windows,\n` +
    `y en las dos llega tipada como \`PhysicalPosition\`. Dividir por\n` +
    `\`devicePixelRatio\` acierta en Windows y parte por dos las coordenadas en un\n` +
    `Mac Retina: el punto cae lejos de donde se soltó y el gesto deja de funcionar\n` +
    `sin dar un error. Si hace falta saber dónde se soltó, pídele el factor de\n` +
    `escala al backend y no dividas en macOS.`,
);
process.exit(1);
