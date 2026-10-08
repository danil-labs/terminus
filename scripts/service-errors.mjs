#!/usr/bin/env node
/**
 * Lo que rechaza un `invoke` no se aplana con `String()`.
 *
 * Un comando rechaza con una cadena, con una clave de catálogo o con un
 * `Failure` —`{what, detail}`—, y el proxy del servicio normaliza lo suyo en
 * `cli/service/mod.rs`, `para_la_ventana`. `String(e)` sobre lo que no es
 * cadena pinta «[object Object]», que es la única copia del motivo —el aviso
 * del hilo no se guarda—, y deja sin acertar toda comparación por clave.
 * Se pinta con `prosaDe` y se decide con `claveDe` (`src/ui/Failure.tsx`).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { archivos } from "./git.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const FUENTE = join(raiz, "src");

// El cupo de cada archivo. Empezó en 61 aplanamientos repartidos en catorce
// archivos y hoy no queda ninguno: la tabla vacía es la que prohíbe el
// siguiente. Solo baja.
const CUPO = {};

const cuenta = {};

// La variable de un `catch`, y no el error de un `invoke`: distinguirlos pide
// un AST y un `catch` recibe igual lo que se le lance.
for (const archivo of archivos(FUENTE, [".ts", ".tsx"])) {
  const nombre = relative(FUENTE, archivo).replaceAll("\\", "/");
  const fuente = readFileSync(archivo, "utf8");
  const capturadas = new Set(
    [...fuente.matchAll(/catch\s*\(\s*([A-Za-z_$][\w$]*)/g)].map((m) => m[1]),
  );
  if (!capturadas.size) continue;
  const patron = new RegExp(`\\bString\\(\\s*(${[...capturadas].join("|")})\\s*\\)`, "g");
  const n = [...fuente.matchAll(patron)].length;
  if (n) cuenta[nombre] = n;
}

const problemas = [];

for (const [archivo, n] of Object.entries(cuenta)) {
  const cupo = CUPO[archivo] ?? 0;
  if (n > cupo) {
    problemas.push(
      cupo === 0
        ? `${archivo} aplana un error con String() y no lo hacía (${n}).`
        : `${archivo} tiene ${n} y su cupo es ${cupo}.`,
    );
  }
}

const holgura = Object.entries(CUPO)
  .filter(([a, cupo]) => (cuenta[a] ?? 0) < cupo)
  .map(([a, cupo]) => `${a}: ${cuenta[a] ?? 0} de ${cupo}`);

if (problemas.length) {
  console.error("");
  for (const p of problemas) console.error(`  ${p}`);
  console.error("");
  console.error("  Un error del backend puede ser un `Failure` o una clave de");
  console.error("  catálogo: `String()` lo vuelve «[object Object]» y borra el");
  console.error("  motivo. Píntalo con `prosaDe` y decide con `claveDe`");
  console.error("  (src/ui/Failure.tsx).");
  console.error("");
  process.exit(1);
}

if (holgura.length) {
  console.error("");
  console.error("  Bajó y el cupo no. Aprieta scripts/service-errors.mjs:");
  for (const h of holgura) console.error(`    ${h}`);
  console.error("");
  process.exit(1);
}

const total = Object.values(cuenta).reduce((a, b) => a + b, 0);
console.log(
  `Ningún error del backend se aplana fuera de su cupo — ${total} en ${Object.keys(cuenta).length} archivos.`,
);
