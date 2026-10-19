#!/usr/bin/env node
/**
 * Cuánto pesa lo que la ventana descarga y evalúa antes de pintar: el script
 * de `dist/index.html`, lo que precarga y su CSS, comprimidos con gzip.
 *
 *   node tests/perf/bundle-size.mjs              guarda: compara con bundle-size-baseline.json
 *   node tests/perf/bundle-size.mjs --update    baja el techo a lo que pesa hoy
 *
 * Los chunks perezosos (mermaid, pdf.js, excalidraw) no cuentan. El techo va en
 * KiB enteros y solo baja: lo nuevo que pese entra por un `import()`.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const root = join(import.meta.dirname, "../..");
const dist = join(root, "dist");
const BASELINE = join(import.meta.dirname, "bundle-size-baseline.json");
const ADJUST = process.argv.includes("--update");

if (!existsSync(join(dist, "index.html"))) {
  console.error("No hay dist/. Corre `pnpm build` antes que este guarda.");
  process.exit(1);
}
const html = readFileSync(join(dist, "index.html"), "utf8");
const initial = [
  ...[...html.matchAll(/<script\b[^>]*\bsrc="\/([^"?]+\.js)"/g)].map((m) => ["js", m[1]]),
  ...[...html.matchAll(/<link\b[^>]*\brel="modulepreload"[^>]*\bhref="\/([^"?]+\.js)"/g)].map((m) => ["js", m[1]]),
  ...[...html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="\/([^"?]+\.css)"/g)].map((m) => ["css", m[1]]),
];
if (!initial.some(([kind]) => kind === "js")) {
  console.error("dist/index.html no tiene script principal.");
  process.exit(1);
}
const sizes = { jsGzipKiB: 0, cssGzipKiB: 0 };
let raw = 0;
for (const [kind, file] of initial) {
  const bytes = readFileSync(join(dist, file));
  raw += bytes.length;
  sizes[`${kind}GzipKiB`] += gzipSync(bytes, { level: 9 }).length;
}
const counters = Object.fromEntries(Object.entries(sizes).map(([k, v]) => [k, Math.ceil(v / 1024)]));
console.log(`carga inicial: ${initial.length} archivos, ${Math.round(raw / 1024)} KiB sin comprimir · gzip ${JSON.stringify(counters)}`);

const ceiling = JSON.parse(readFileSync(BASELINE, "utf8"));
if (ADJUST) {
  const lowered = Object.fromEntries(Object.entries(ceiling).map(([k, v]) => [k, Math.min(v, counters[k])]));
  writeFileSync(BASELINE, `${JSON.stringify(lowered, null, 2)}\n`);
  console.log(`techo: ${JSON.stringify(lowered)}`);
  process.exit(0);
}
const over = Object.entries(ceiling).filter(([k, v]) => counters[k] > v);
if (over.length > 0) {
  console.error("La carga inicial pesa más que el techo de bundle-size-baseline.json:");
  for (const [k, v] of over) console.error(`  ${k}: ${counters[k]} > ${v}`);
  process.exit(1);
}
const room = Object.entries(ceiling).filter(([k, v]) => counters[k] < v);
if (room.length > 0) console.log(`Bajó: ${room.map(([k, v]) => `${k} ${v} → ${counters[k]}`).join(", ")}. Fíjalo con --update.`);
process.exit(0);
