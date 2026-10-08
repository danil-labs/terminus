#!/usr/bin/env node
/**
 * Colores que la hoja compilada sirve desde la paleta por omisión de Tailwind,
 * o sea: **los que no participan de la inversión de tema.**
 *
 * **El cuarto lado del mismo agujero, y un escalón por debajo de
 * `missing-classes.mjs`.** Aquél comprueba que la clase escrita EXISTA en la hoja.
 * Los dos escalones que rompieron el modo oscuro existían. Lo que no existe es su
 * variable dentro de `@theme`: la rampa declarada en este repo es
 * 50/100/200/300/500/700/900/950, y los otros dos los sirvió Tailwind desde su
 * paleta por omisión — **con un solo valor, el mismo en los dos temas**.
 *
 * El peor de los nueve medía **1,31:1**: en modo oscuro, la tarjeta de un
 * adjunto se quedaba sin nombre y sin botón de quitar, con la «x» flotando sola
 * porque esa sí se leía.
 *
 *   pnpm build && node scripts/theme-inversion.mjs
 *
 * ## Por qué esta prosa no escribe los nombres que caza
 *
 * **Tailwind escanea este archivo.** No solo `src/`: además del `@source`
 * explícito hay detección automática desde la raíz del proyecto, y llega a
 * `scripts/*.mjs`. Escribir aquí el nombre del escalón malo lo GENERA en la hoja,
 * y entonces el guarda se delata a sí mismo: falla en un árbol limpio nombrando
 * un color que no usa nadie. Pasó al escribirlo. Por eso los escalones se
 * nombran por su número y nunca pegados a una utility.
 *
 * ## Cómo lo distingue, que es lo que lo hace preciso
 *
 * No hay lista de excepciones que mantener, y por eso no se pudre: **este repo
 * declara todos sus colores en hexadecimal o en `rgb()`, y Tailwind emite los
 * suyos en `oklch()`.** Un `--color-*` en `oklch` dentro del CSS compilado es,
 * por construcción, un color que nadie de aquí eligió.
 *
 * No basta con «está definido dos veces». Hay tokens que **a propósito** valen lo
 * mismo en los dos temas —`brand-yellow`, `brand-navy`, `error`, `success`— y una
 * regla que exigiera dos definiciones los marcaría a todos. Esa lista de perdones
 * sería justo lo que deja de mirarse.
 *
 * ## Qué NO puede ver
 *
 * Un color crudo escrito a mano —`bg-[rgb(10_13_35/0.05)]`— tampoco se invierte,
 * y este guarda no lo caza: Tailwind lo emite como un valor literal en la utility,
 * no como un `--color-*`. Ese es el otro defecto de la misma familia (la fila
 * activa del riel, que medía 1,00:1) y hoy no lo comprueba nada.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist/assets");

if (!existsSync(DIST)) {
  console.error("No hay `dist/assets`. Corre `pnpm build` primero.");
  process.exit(2);
}
const stylesheets = readdirSync(DIST).filter((f) => f.endsWith(".css"));
if (stylesheets.length === 0) {
  console.error("No hay hojas en dist/assets. Corre `pnpm build` primero.");
  process.exit(2);
}
const css = stylesheets.map((sheet) => readFileSync(join(DIST, sheet), "utf8")).join("\n");

const foreignColors = [...css.matchAll(/(--color-[\w-]+)\s*:\s*(oklch\([^;}]*\))/g)].map((m) => ({
  token: m[1],
  value: m[2],
}));

if (foreignColors.length === 0) {
  console.log("Ningún color viene de la paleta por omisión: todos se invierten con el tema.");
  process.exit(0);
}

console.error(
  `\n${foreignColors.length} color(es) los sirve la paleta por omisión de Tailwind, así que valen\n` +
    `lo mismo en los dos temas:\n`,
);
for (const { token, value } of foreignColors) {
  const suffix = token.replace("--color-", "");
  console.error(`  ${token}: ${value}`);
  console.error(`      lo pide alguna clase que acabe en «${suffix}». Búscala así:`);
  console.error(`      grep -rn ${suffix} src/\n`);
}
console.error(
  "Qué hacer: usa un escalón que SÍ esté en `@theme static` de `src/styles/global.css`.\n" +
    "La rampa de neutros declarada es 50/100/200/300/500/700/900/950. Si de verdad hace\n" +
    "falta un escalón nuevo, se declara ahí **con su valor para cada tema**, que es lo\n" +
    "que la paleta por omisión no puede dar.\n",
);
process.exit(1);
