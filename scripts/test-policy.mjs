#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { relative, sep } from "node:path";
import { RAIZ as ROOT, archivos as walkFiles } from "./git.mjs";

const baselinePath = `${ROOT}${sep}scripts${sep}test-policy-baseline.json`;
const sourceRead = /readFileSync\([\s\S]{0,200}?(?:"|'|`)[^"'`\n]*?(?:src\/|src-tauri\/src\/|\.\.\/src\/)[^"'`\n]*?\.(?:ts|tsx|rs|css|mjs)["'`]/g;
const sum = (counts) => Object.values(counts).reduce((total, count) => total + count, 0);

export function countSourceReads() {
  const source_reads = {};
  for (const path of walkFiles(`${ROOT}${sep}scripts`, [".ts", ".mjs"])) {
    if (!/\.test\.(ts|mjs)$/.test(path)) continue;
    const count = (readFileSync(path, "utf8").match(sourceRead) ?? []).length;
    if (count) source_reads[relative(ROOT, path).split(sep).join("/")] = count;
  }
  return { source_reads };
}

const args = process.argv.slice(2);
if (args.includes("--ajustar")) {
  const current = countSourceReads();
  writeFileSync(baselinePath, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`Trinquete: ${sum(current.source_reads)} lecturas de fuente.`);
  process.exit(0);
}
if (args.includes("--archivo")) {
  const path = args[args.indexOf("--archivo") + 1];
  const matches = readFileSync(path.startsWith("/") ? path : `${ROOT}${sep}${path}`, "utf8").match(sourceRead) ?? [];
  for (const match of matches) console.log(`${path}  lee código de producción: ${match.replace(/\s+/g, " ").slice(0, 90)}`);
  console.log(`${matches.length} hallazgos`);
  process.exit(0);
}
if (!existsSync(baselinePath)) {
  console.error("Falta scripts/test-policy-baseline.json. Usa: node scripts/test-policy.mjs --ajustar");
  process.exit(1);
}
const current = countSourceReads().source_reads;
const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
const limits = baseline.source_reads ?? baseline.fuente ?? {};
const excess = Object.entries(current).filter(([path, count]) => count > (limits[path] ?? 0));
if (excess.length === 0) {
  console.log(`No aumentaron las lecturas de fuente: ${sum(current)}.`);
  if (sum(current) < sum(limits)) console.log("Bajaron: fija el trinquete con node scripts/test-policy.mjs --ajustar.");
  process.exit(0);
}
for (const [path, count] of excess) console.error(`${path}: ${count} lecturas (cupo ${limits[path] ?? 0})`);
console.error("Revisa las aserciones: el patrón cuenta lecturas literales, no demuestra comportamiento.");
process.exit(1);
