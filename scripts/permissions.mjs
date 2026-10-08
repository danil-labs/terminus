#!/usr/bin/env node
/**
 * Que la ventana tenga permiso para lo que la interfaz le pide.
 *
 * **Existe porque el fallo es mudo y el botón se queda ahí.** En Tauri 2 cada
 * comando de la ventana está detrás de un permiso declarado en
 * `capabilities/default.json`. Llamar a uno que no está no da error de
 * compilación —`tsc` ve un método que existe— ni error en pantalla: la promesa
 * se rechaza, y quien la llama la envuelve en un `catch` porque una ventana que
 * no se puede minimizar no debería tirar la app. El resultado es un botón que
 * se pinta, se puede pulsar, hace hover, y **no hace nada**.
 *
 * Es exactamente lo que pasó con maximizar. `core:window:default` trae
 * `allow-internal-toggle-maximize` —el que usa el doble clic sobre la zona de
 * arrastre— pero **no** `allow-toggle-maximize`, que es el que necesita
 * `toggleMaximize()` desde el código. Doble clic en la cabecera maximizaba; el
 * botón de al lado no. Dos caminos al mismo sitio, uno roto, ninguna señal.
 *
 * ## Por qué no basta con acordarse
 *
 * El nombre del permiso no aparece en ningún sitio junto a la llamada: está en
 * otro archivo, en otro formato (`toggleMaximize` → `allow-toggle-maximize`) y
 * en otro idioma que el editor no relaciona. Quien añade un botón de ventana
 * copia el de al lado, que ya funcionaba porque su permiso sí estaba.
 *
 * ## Qué mira, y qué no puede mirar
 *
 * Solo los archivos que importan `@tauri-apps/api/window`, y dentro de ellos los
 * métodos cuyo nombre tiene un `allow-*` en el manifiesto que genera Tauri
 * (`gen/schemas/acl-manifests.json`) — la lista real de la versión instalada, no
 * una copia que envejece aquí. Lo que no tiene permiso asociado no es un comando
 * y no se comprueba: `onResized` y compañía son suscripciones a eventos.
 *
 * No sigue el método a través de una variable que cruce de archivo. No hace
 * falta hoy y añadirlo sería inventar un analizador; si algún día se escapa uno
 * por ahí, el arreglo es traer la llamada al archivo que la usa.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { archivos } from "./git.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFIESTO = join(raiz, "src-tauri/gen/schemas/acl-manifests.json");
const CAPACIDADES = join(raiz, "src-tauri/capabilities/default.json");

/** `toggleMaximize` → `toggle-maximize`. */
const guion = (m) => m.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

let manifiesto;
try {
  manifiesto = JSON.parse(readFileSync(MANIFIESTO, "utf8"))["core:window"];
} catch (e) {
  // El manifiesto lo genera `cargo` al construir. Sin él no se puede afirmar
  // nada, y afirmar «todo bien» sin haber mirado es peor que no correr.
  console.error(
    `No pude leer ${relative(raiz, MANIFIESTO)} — lo genera el build de Rust.\n` +
      `Corre \`cargo check\` dentro de src-tauri y repite.\n  ${e.message}`,
  );
  process.exit(1);
}

/** Todo `allow-*` que existe en esta versión de Tauri. */
const existentes = new Set(Object.keys(manifiesto.permissions));
/** Los que vienen puestos sin pedirlos. */
const porOmision = new Set(manifiesto.default_permission.permissions);

const capacidades = JSON.parse(readFileSync(CAPACIDADES, "utf8"));
const concedidos = new Set();
for (const p of capacidades.permissions) {
  // `core:default` arrastra `core:window:default`, que arrastra su lista.
  if (p === "core:default" || p === "core:window:default") {
    for (const d of porOmision) concedidos.add(d);
  } else if (p.startsWith("core:window:")) {
    concedidos.add(p.slice("core:window:".length));
  }
}

const faltan = new Map();
let mirados = 0;

for (const archivo of archivos(join(raiz, "src"), [".ts", ".tsx"])) {
  const texto = readFileSync(archivo, "utf8");
  if (!texto.includes("@tauri-apps/api/window")) continue;
  mirados++;
  for (const m of texto.matchAll(/\.([a-zA-Z][a-zA-Z0-9]*)\s*\(/g)) {
    const permiso = `allow-${guion(m[1])}`;
    if (!existentes.has(permiso)) continue; // no es un comando de ventana
    if (concedidos.has(permiso)) continue;
    const donde = faltan.get(permiso) ?? new Set();
    donde.add(`${relative(raiz, archivo).replace(/\\/g, "/")} → ${m[1]}()`);
    faltan.set(permiso, donde);
  }
}

if (!faltan.size) {
  console.log(
    `Los comandos de ventana de ${mirados} archivo(s) tienen su permiso.`,
  );
  process.exit(0);
}

for (const [permiso, donde] of faltan) {
  console.error(`Falta \`core:window:${permiso}\` — lo necesita:`);
  for (const d of donde) console.error(`    ${d}`);
}
console.error(
  `\nSin el permiso la llamada no falla a la vista: la promesa se rechaza, el\n` +
    `\`catch\` se la traga y el botón se queda pintado sin hacer nada. Añádelos a\n` +
    `src-tauri/capabilities/default.json.`,
);
process.exit(1);
