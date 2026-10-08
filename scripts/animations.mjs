#!/usr/bin/env node
/**
 * Ninguna animación infinita con timing continuo fuera de la lista de abajo.
 *
 * WebKit recompone la ventana a 60 cuadros por segundo mientras haya una en
 * pantalla, y un punto de 7 px pulsando ocupaba dos tercios de un núcleo. Con
 * `steps()` solo repinta cuando cambia de paso.
 */
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { archivos } from "./git.mjs";

const RAIZ = fileURLToPath(new URL("../src", import.meta.url));

/** Animaciones de CSS que corren solo mientras dura un gesto corto. */
const KEYFRAMES_PERMITIDOS = new Set(["finish-task-ignition", "finish-task-exhaust"]);

/** Cuántas clases continuas de Tailwind puede llevar cada archivo. El cupo no sube. */
const CUPO_TAILWIND = {
  "features/settings/AccountCard.tsx": 2,
  "features/settings/Accounts.tsx": 1,
  "features/settings/Environment.tsx": 1,
  "features/settings/General.tsx": 2,
  "features/shell/Sidebar.tsx": 1,
  "features/shell/Storage.tsx": 1,
  "features/shell/UsageBar.tsx": 2,
  "ui/Terminal.tsx": 1,
};

const DECLARACION = /(?:^|[;{\s])(?:animation|--animate-[\w-]+)\s*:\s*([^;}]+)/g;
const POR_PASOS = /\bsteps\(|\bstep-(?:start|end)\b/;
const TAILWIND_CONTINUA = /\banimate-(?:spin|pulse|ping|bounce)(?![\w-])/g;

const fallos = [];
for (const f of archivos(RAIZ, [".css"])) {
  const fuente = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
  for (const m of fuente.matchAll(DECLARACION)) {
    const valor = m[1].trim();
    if (!/\binfinite\b/.test(valor) || POR_PASOS.test(valor)) continue;
    if (valor.split(/\s+/).some((palabra) => KEYFRAMES_PERMITIDOS.has(palabra))) continue;
    const linea = fuente.slice(0, m.index).split("\n").length;
    fallos.push(`${relative(RAIZ, f)}:${linea}  ${valor}`);
  }
}

for (const f of archivos(RAIZ, [".ts", ".tsx"])) {
  const cuantas = [...readFileSync(f, "utf8").matchAll(TAILWIND_CONTINUA)].length;
  const clave = relative(RAIZ, f).replaceAll("\\", "/");
  const cupo = CUPO_TAILWIND[clave] ?? 0;
  if (cuantas > cupo) fallos.push(`${clave}  ${cuantas} clases animate-spin/pulse/ping/bounce, cupo ${cupo}`);
}

if (fallos.length === 0) {
  console.log("Ninguna animación infinita nueva repinta la ventana a 60 cuadros por segundo.");
  process.exit(0);
}

for (const f of fallos) console.error(`Animación infinita continua — ${f}`);
console.error(
  "\nMientras esté en pantalla, WebKit recompone la ventana a 60 cuadros por segundo.\n" +
    "Usa `steps()` —o los tokens `animate-danil-pulse` y `animate-spin-steps`— y, si\n" +
    "hay varias a la vez, periodos múltiplos de un mismo paso anclados a un reloj\n" +
    "común (ver los astros en `global.css`).",
);
process.exit(1);
