#!/usr/bin/env node
/**
 * Los comentarios no crecen, no argumentan y no cuentan historia.
 *
 *   node scripts/comments.mjs              guarda: compara con comments-baseline.json
 *   node scripts/comments.mjs --ajustar    baja el baseline a lo que hay hoy
 *   node scripts/comments.mjs --archivo p  lista lo que caza en un archivo
 *   node scripts/comments.mjs --hook       PreToolUse de Claude Code: rechaza la edición que añade
 *
 * Política: AGENTS.md § Comentarios. Sale con 1 si una categoría supera el baseline.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { archivos, esteArchivo, RAIZ } from "./git.mjs";

const BASELINE = join(RAIZ, "scripts/comments-baseline.json");
const CARPETAS = ["src-tauri/src", "src-tauri/tests", "src", "scripts"];
const EXTS = [".rs", ".ts", ".tsx", ".mjs"];
const EXCLUIDOS = [/file-icons\.ts$/, /comments-baseline\.json$/];

export const LIMITE_BLOQUE = 6;
export const LIMITE_CABECERA = 10;

const HISTORIA =
  /\b(se report[oó]|reportad[oa]|pas[oó] de verdad|cost[oó]|hubo .* y se retir[oó]|antes (era|se|hab[ií]a|sal[ií]a)|se retir[oó]|medido el 20|comprobado el 20|20\d\d-\d\d-\d\d)\b/iu;
const ARGUMENTO = /(^|[\s(])(porque|as[ií] que|por eso|o sea|es decir|de ah[ií] que|y por eso)([\s,:;.)]|$)/iu;
const NEGRITA = /\*\*[^*\n]+\*\*/;
const MARKDOWN = /^(#{1,6} |\| |```)/;

const CATEGORIAS = ["bloque_largo", "markdown", "argumento", "historia"];

/** Bloques de comentario de un texto: [{ inicio, lineas: [texto sin marcador], cabecera }]. */
export function bloques(texto, ext) {
  const lineas = texto.split("\n");
  const out = [];
  let actual = null;
  let enBloque = false;
  let primeraDeCodigo = false;
  const cerrar = () => {
    if (actual) out.push(actual);
    actual = null;
  };
  for (let i = 0; i < lineas.length; i++) {
    const cruda = lineas[i];
    const s = cruda.trim();
    let esComentario = false;
    let contenido = "";
    if (enBloque) {
      esComentario = true;
      contenido = s.replace(/^\*+\s?/, "").replace(/\*\/\}?$/, "");
      if (s.includes("*/")) enBloque = false;
    } else if (/^\/\/[/!]?/.test(s)) {
      esComentario = true;
      contenido = s.replace(/^\/\/[/!]?\s?/, "");
    } else if (/^\{?\/\*/.test(s)) {
      esComentario = true;
      contenido = s.replace(/^\{?\/\*+\s?/, "").replace(/\*\/\}?$/, "");
      if (!s.includes("*/")) enBloque = true;
    }
    if (esComentario) {
      if (!actual) {
        const marcador = s.startsWith("//!") || s.startsWith("/**");
        actual = { inicio: i + 1, lineas: [], cabecera: !primeraDeCodigo && marcador };
      }
      actual.lineas.push(contenido);
    } else {
      cerrar();
      if (s !== "" && !s.startsWith("#!")) primeraDeCodigo = true;
    }
  }
  cerrar();
  return out;
}

/** Hallazgos de un texto: [{ linea, categoria, detalle }]. */
export function hallazgos(texto, ext) {
  const out = [];
  for (const b of bloques(texto, ext)) {
    const tope = b.cabecera ? LIMITE_CABECERA : LIMITE_BLOQUE;
    // Las líneas del delimitador —`/**`, `*/`, un `*` solo— no son contenido.
    // Contándolas, un tope de seis dejaba escribir cuatro.
    const contenido = b.lineas.filter((l) => l.trim() !== "").length;
    if (contenido > tope) {
      out.push({ linea: b.inicio, categoria: "bloque_largo", detalle: `${contenido} líneas (tope ${tope})` });
    }
    b.lineas.forEach((l, k) => {
      const linea = b.inicio + k;
      if (NEGRITA.test(l) || MARKDOWN.test(l)) out.push({ linea, categoria: "markdown", detalle: l.slice(0, 60) });
      if (HISTORIA.test(l)) out.push({ linea, categoria: "historia", detalle: l.slice(0, 60) });
      if (ARGUMENTO.test(l)) out.push({ linea, categoria: "argumento", detalle: l.slice(0, 60) });
    });
  }
  return out;
}

function enAlcance(ruta) {
  return EXTS.includes(extname(ruta)) && !EXCLUIDOS.some((re) => re.test(ruta));
}

function* fuentes() {
  for (const carpeta of CARPETAS) {
    const dir = join(RAIZ, carpeta);
    if (!existsSync(dir)) continue;
    for (const p of archivos(dir, EXTS)) if (enAlcance(p)) yield p;
  }
}

function contar() {
  const totales = Object.fromEntries(CATEGORIAS.map((c) => [c, 0]));
  const porArchivo = new Map();
  for (const p of fuentes()) {
    const h = hallazgos(readFileSync(p, "utf8"), extname(p));
    if (h.length === 0) continue;
    const rel = relative(RAIZ, p);
    const cuenta = Object.fromEntries(CATEGORIAS.map((c) => [c, 0]));
    for (const x of h) {
      totales[x.categoria]++;
      cuenta[x.categoria]++;
    }
    porArchivo.set(rel, cuenta);
  }
  return { totales, porArchivo };
}

function leerBaseline() {
  if (!existsSync(BASELINE)) return null;
  return JSON.parse(readFileSync(BASELINE, "utf8"));
}

function guarda() {
  const { totales, porArchivo } = contar();
  const base = leerBaseline();
  if (!base) {
    console.error(`Falta ${relative(RAIZ, BASELINE)}. Créalo con: node scripts/comments.mjs --ajustar`);
    return 1;
  }
  let fallo = false;
  let bajo = false;
  for (const c of CATEGORIAS) {
    const ahora = totales[c];
    const tope = base[c] ?? 0;
    if (ahora > tope) {
      fallo = true;
      console.error(`${c}: ${ahora} (baseline ${tope}) — subió ${ahora - tope}`);
      const peores = [...porArchivo.entries()]
        .filter(([, n]) => n[c] > 0)
        .sort((a, b) => b[1][c] - a[1][c])
        .slice(0, 8);
      for (const [rel, n] of peores) console.error(`    ${n[c].toString().padStart(4)}  ${rel}`);
    } else if (ahora < tope) {
      bajo = true;
    }
  }
  if (fallo) {
    console.error("\nUn comentario nuevo dice qué se rompe en 1-3 líneas, o no va. AGENTS.md § Comentarios.");
    return 1;
  }
  const resumen = CATEGORIAS.map((c) => `${c}=${totales[c]}`).join("  ");
  console.log(`Los comentarios no crecen: ${resumen}.`);
  if (bajo) console.log("Bajaron: fija el trinquete con `node scripts/comments.mjs --ajustar`.");
  return 0;
}

function ajustar() {
  const { totales } = contar();
  const base = leerBaseline() ?? {};
  const nuevo = {};
  for (const c of CATEGORIAS) nuevo[c] = Math.min(totales[c], base[c] ?? totales[c]);
  writeFileSync(BASELINE, JSON.stringify(nuevo, null, 2) + "\n");
  console.log(`Baseline: ${CATEGORIAS.map((c) => `${c}=${nuevo[c]}`).join("  ")}`);
  return 0;
}

function archivo(ruta) {
  const p = join(RAIZ, ruta);
  const h = hallazgos(readFileSync(p, "utf8"), extname(p));
  for (const x of h) console.log(`${ruta}:${x.linea}  ${x.categoria}  ${x.detalle}`);
  console.log(`${h.length} hallazgos`);
  return 0;
}

function hook() {
  let entrada = "";
  try {
    entrada = readFileSync(0, "utf8");
  } catch {
    return 0;
  }
  let ev;
  try {
    ev = JSON.parse(entrada);
  } catch {
    return 0;
  }
  const t = ev.tool_input ?? {};
  const ruta = t.file_path ?? "";
  if (!ruta || !enAlcance(ruta) || !ruta.startsWith(RAIZ)) return 0;
  const ext = extname(ruta);
  let antes = "";
  let despues = "";
  if (ev.tool_name === "Edit") {
    antes = t.old_string ?? "";
    despues = t.new_string ?? "";
  } else if (ev.tool_name === "Write") {
    antes = existsSync(ruta) ? readFileSync(ruta, "utf8") : "";
    despues = t.content ?? "";
  } else {
    return 0;
  }
  const cuenta = (texto) => {
    const c = Object.fromEntries(CATEGORIAS.map((k) => [k, 0]));
    for (const x of hallazgos(texto, ext)) c[x.categoria]++;
    return c;
  };
  const a = cuenta(antes);
  const d = cuenta(despues);
  const nuevos = CATEGORIAS.filter((c) => d[c] > a[c]);
  if (nuevos.length === 0) return 0;
  const detalle = hallazgos(despues, ext)
    .filter((x) => nuevos.includes(x.categoria))
    .slice(0, 6)
    .map((x) => `  ${x.categoria}: ${x.detalle}`)
    .join("\n");
  console.error(
    `Comentario rechazado en ${relative(RAIZ, ruta)}: añade ${nuevos.join(", ")}.\n${detalle}\n` +
      "Un comentario dice qué se rompe si cambias esta línea, en 1-3 líneas, sin negritas ni historia. " +
      "Si es una regla, vive en un doc: nómbralo. AGENTS.md § Comentarios.",
  );
  return 2;
}

if (esteArchivo(import.meta.url)) {
  const args = process.argv.slice(2);
  let codigo = 0;
  if (args.includes("--hook")) codigo = hook();
  else if (args.includes("--ajustar")) codigo = ajustar();
  else if (args.includes("--archivo")) codigo = archivo(args[args.indexOf("--archivo") + 1]);
  else codigo = guarda();
  process.exit(codigo);
}
