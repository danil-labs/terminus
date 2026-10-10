#!/usr/bin/env node
/**
 * Un proceso que alguien espera lleva plazo, y la deuda solo baja.
 *
 *   node scripts/processes.mjs              guarda: compara con processes-baseline.json
 *   node scripts/processes.mjs --ajustar    baja el cupo a lo que hay hoy
 *
 * Esperar a un CLI sin plazo cuelga al hilo que llamó y deja al hijo vivo. No da
 * error: se ve como que la máquina va lenta. El tope es `util::output_with_timeout`,
 * o `util::output_with_progress` para un instalador que avisa de su avance.
 *
 * El turno queda fuera: ahí el proceso dura lo que dure la conversación. El cupo
 * es por archivo y solo baja, como en `comments.mjs` — poner plazo a los que ya
 * están exige medir cuánto tarda cada uno, y eso no lo decide un script.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { archivos, RAIZ } from "./git.mjs";

const ROOT = fileURLToPath(new URL("../src-tauri/src", import.meta.url));
const BASELINE = join(RAIZ, "scripts/processes-baseline.json");

/** Dónde el proceso dura lo que dura la conversación: el turno y su transporte. */
const DEL_TURNO = ["runtime/chat/", "runtime/acp.rs", "cli/service/", "cli/server.rs"];
/** Cuántas líneas alrededor de la llamada se acepta el plazo. */
const VENTANA = 20;

const conPlazo = /output_with_timeout|output_with_input|output_with_progress|PLAZO_SIN_AVANCE|proceso largo: a propósito/;

function cuenta() {
  const porArchivo = {};
  for (const f of archivos(ROOT, [".rs"])) {
    const rel = relative(ROOT, f).split(sep).join("/");
    if (/(^|\/)tests\.rs$|_tests\.rs$|(^|\/)tests\//.test(rel)) continue;
    if (DEL_TURNO.some((d) => rel.startsWith(d))) continue;
    const lineas = readFileSync(f, "utf8").split("\n");
    let enPruebas = false;
    let n = 0;
    lineas.forEach((l, i) => {
      if (/^\s*#\[cfg\(test\)\]/.test(l)) enPruebas = true;
      if (enPruebas) return;
      if (!/Command::new\s*\(/.test(l)) return;
      if (/^\s*(\/\/|\*|\/\*)/.test(l)) return;
      // exec en Unix reemplaza este proceso; no espera a un hijo.
      const nearby = lineas.slice(Math.max(0, i - 8), i + VENTANA).join("\n");
      if (/#\[cfg\(unix\)\]/.test(nearby) && /\.exec\(\)/.test(nearby)) return;
      if (conPlazo.test(lineas.slice(Math.max(0, i - 3), i + VENTANA).join("\n"))) return;
      n += 1;
    });
    if (n) porArchivo[rel] = n;
  }
  return porArchivo;
}

const suma = (o) => Object.values(o).reduce((a, b) => a + b, 0);
const hoy = cuenta();

if (process.argv.includes("--ajustar")) {
  writeFileSync(BASELINE, `${JSON.stringify(hoy, null, 2)}\n`);
  console.log(`Cupo: ${suma(hoy)} procesos sin plazo.`);
  process.exit(0);
}

const cupo = JSON.parse(readFileSync(BASELINE, "utf8"));
const subieron = Object.entries(hoy).filter(([f, n]) => n > (cupo[f] ?? 0));

if (subieron.length === 0) {
  console.log(`Ningún proceso nuevo se espera sin plazo: ${suma(hoy)} sin él (cupo ${suma(cupo)}).`);
  if (suma(hoy) < suma(cupo)) {
    console.log("Bajaron: fija el trinquete con `node scripts/processes.mjs --ajustar`.");
  }
  process.exit(0);
}

console.error("\n  Un proceso que alguien espera, sin plazo:\n");
for (const [f, n] of subieron) console.error(`    ${f}  ${n} (cupo ${cupo[f] ?? 0})`);
console.error("\n  Espéralo con `util::output_with_timeout`. Sin plazo, un CLI que no");
console.error("  contesta cuelga a quien llamó y deja al hijo vivo detrás.");
console.error("\n  Si dura de verdad lo que dure y nadie lo espera para pintar, dilo");
console.error("  en su línea: `proceso largo: a propósito`.\n");
process.exit(1);
