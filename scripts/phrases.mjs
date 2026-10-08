#!/usr/bin/env node
/**
 * La hoja de traducción: cada frase de la app y dónde sale.
 *
 * Existe porque **quien traduce no lee el código**. Un catálogo JSON ordenado
 * por clave es correcto para la máquina y no dice lo único que hace falta para
 * traducir bien: *dónde sale esto*. «Entrar» no se traduce igual si es el botón
 * de un formulario o el rótulo de una pestaña, y el traductor no tiene manera
 * de saberlo mirando `settings.enter`.
 *
 * Se **genera**, no se escribe: un documento escrito a mano se desincroniza en
 * el primer arreglo y entonces miente sobre lo que hay que traducir.
 *
 *   node scripts/phrases.mjs            → escribe docs/FRASES.md
 *   node scripts/phrases.mjs --check    → falla si el archivo está desactualizado
 *
 * ## Qué NO puede decir, y por eso lo imprime
 *
 * «Dónde sale» es **la pantalla y el sitio en el código**, no el momento. Que
 * una frase salga «cuando falla la descarga y la persona ya entró» no está
 * escrito en ninguna parte que un script pueda leer: está en la condición que
 * la rodea. Lo que sí es exacto es la pantalla, el archivo y la línea, y con eso
 * quien traduce puede ir a mirar.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const FUENTE = join(RAIZ, "src");
const LENGUAS = join(RAIZ, "src/locales");
const BACKEND = join(RAIZ, "src-tauri/src");
const SALIDA = join(RAIZ, "docs/FRASES.md");
/**
 * La ruta de un archivo tal y como se escribe en la hoja, siempre con `/`.
 *
 * `relative()` devuelve el separador de la plataforma: `src/locales/es` en
 * macOS y `src\lenguas\es` en Windows. Como esta hoja se commitea y el guarda
 * la compara carácter a carácter, sin normalizar **el resultado depende de
 * quién la generó**: en Windows `pnpm verificar` sale roja siempre, regenerar
 * reescribe las 891 filas con barras invertidas, y entonces sale roja en macOS.
 * Un ping-pong que no converge y que no tiene nada que ver con las frases.
 *
 * Se fija a `/` porque es lo que ya está commiteado y lo que enlaza bien.
 */
const ruta = (archivo) => relative(RAIZ, archivo).split(sep).join("/");

const BASE = "es";
/** La lengua puente, que va en su propia columna para poder revisarla al lado. */
const PUENTE = "en";

/**
 * De qué parte de la app es un archivo.
 *
 * Se ordena de lo específico a lo general y se queda con la primera: dos
 * pantallas de `ajustes/` tienen nombre propio —el alta y la preparación— y
 * agruparlas con el resto de Configuración escondería justo las dos que ve
 * alguien que abre la app por primera vez.
 */
const PANTALLAS = [
  ["src/features/settings/Onboarding", "Alta"],
  ["src/features/settings/Setup", "Preparación"],
  ["src/features/settings/", "Configuración"],
  ["src/features/chat/", "Conversación"],
  ["src/features/projects/", "Proyectos y tareas"],
  ["src/features/artifacts/", "Artefactos"],
  ["src/features/code/", "Código"],
  ["src/features/shell/", "Ventana"],
  ["src/app/", "Ventana"],
  ["src/ui/", "Piezas comunes"],
  ["src/lib/", "Piezas comunes"],
  // El backend no tiene pantalla: el mismo `Failure` de `providers/mod.rs` sale
  // en el alta y en Configuración. Lo que sí es exacto —y es lo que necesita
  // quien traduce— es el módulo que la posee, con su archivo y su línea.
  ["src-tauri/", "Del backend"],
];

const pantallaDe = (rel) =>
  PANTALLAS.find(([p]) => rel.startsWith(p))?.[1] ?? "Sin clasificar";

/**
 * Las entradas de una carpeta **en el mismo orden en toda plataforma**.
 *
 * `readdirSync` no promete orden: NTFS entrega alfabético y ext4 el que le
 * queda al directorio. Aquí eso no era cosmético — el grupo de una frase lo
 * decide `donde[0].rel`, o sea **el primer archivo que se encontró usándola**,
 * así que la misma hoja generada en Windows y en Linux ponía filas en
 * pantallas distintas. Es la otra mitad del ping-pong que ya documenta `ruta`:
 * el guarda comparaba carácter a carácter una hoja que dependía del sistema de
 * archivos de quien la generó.
 */
const ordenadas = (entradas) => [...entradas].sort((a, b) => (a.name < b.name ? -1 : 1));

function tsx(dir, salida = []) {
  for (const e of ordenadas(readdirSync(dir, { withFileTypes: true }))) {
    const p = join(dir, e.name);
    if (e.isDirectory()) tsx(p, salida);
    else if (/\.tsx?$/.test(e.name)) salida.push(p);
  }
  return salida;
}

function rs(dir, salida = []) {
  for (const e of ordenadas(readdirSync(dir, { withFileTypes: true }))) {
    const p = join(dir, e.name);
    if (e.isDirectory()) rs(p, salida);
    else if (e.name.endsWith(".rs")) salida.push(p);
  }
  return salida;
}

/**
 * El archivo con los comentarios en blanco **y con sus líneas intactas**.
 *
 * La cuenta de líneas que sale de aquí es la que se escribe en la hoja, así
 * que borrar un salto de línea corre todo lo de abajo. El `^\s*` de antes lo
 * hacía: `\s` incluye `\n`, así que un comentario precedido de líneas en
 * blanco se las llevaba —y cuántas se llevaba dependía de si el archivo venía
 * con `\r\n` o con `\n`—. Resultado: números distintos según el sistema de
 * quien generó la hoja, y un guarda que sale rojo en CI con el gate verde en
 * local. La sangría se busca con `[ \t]*`, que no cruza líneas.
 *
 * Y se normalizan los finales de línea antes de mirar nada, por lo mismo.
 */
const sinComentarios = (s) =>
  s
    .split("\r\n")
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/^[ \t]*\/\/.*$/gm, "");

// ── Dónde se usa cada clave ──────────────────────────────────────────────────
const usos = new Map();
for (const archivo of tsx(FUENTE)) {
  if (archivo.startsWith(LENGUAS)) continue;
  const s = sinComentarios(readFileSync(archivo, "utf8"));
  const rel = ruta(archivo);
  for (const m of s.matchAll(/\bt\(\s*"([^"]+)"/g)) {
    const linea = s.slice(0, m.index).split("\n").length;
    if (!usos.has(m[1])) usos.set(m[1], []);
    usos.get(m[1]).push({ rel, linea });
  }
}

// Y las que pide el backend. Desde que Rust manda `Frase::new("clave")` en vez
// de prosa (`util::Frase`), su texto **sí** está en el catálogo y hay que
// enseñárselo a quien traduce, con el módulo que lo posee.
for (const archivo of rs(BACKEND)) {
  const s = sinComentarios(readFileSync(archivo, "utf8"));
  const rel = ruta(archivo);
  for (const m of s.matchAll(/\bFrase::new\(\s*"([^"]+)"/g)) {
    const linea = s.slice(0, m.index).split("\n").length;
    if (!usos.has(m[1])) usos.set(m[1], []);
    usos.get(m[1]).push({ rel, linea });
  }
}

// ── El catálogo ──────────────────────────────────────────────────────────────
function catalogo(codigo) {
  const dir = join(LENGUAS, codigo);
  const frases = new Map();
  if (!existsSync(dir)) return frases;
  for (const nombre of [...readdirSync(dir)].sort()) {
    if (!nombre.endsWith(".json") || nombre === "manifiesto.json") continue;
    const json = JSON.parse(readFileSync(join(dir, nombre), "utf8"));
    for (const [k, v] of Object.entries(json)) frases.set(k, { v, archivo: nombre });
  }
  return frases;
}

const es = catalogo(BASE);
const en = catalogo(PUENTE);

/** Un plural se enseña con sus formas a la vista: son lo que hay que traducir. */
const texto = (v) =>
  typeof v === "string"
    ? v
    : Object.entries(v)
        .map(([forma, s]) => `**${forma}:** ${s}`)
        .join("<br>");

/** Markdown: la barra parte la celda y el salto de línea parte la fila. */
const celda = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");

// ── Agrupar por pantalla ─────────────────────────────────────────────────────
const grupos = new Map();
const sinUso = [];
for (const [clave, { v }] of [...es].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
  // Ordenados, no en el orden en que se encontraron: `donde[0]` decide en qué
  // pantalla cae la fila, y el orden de hallazgo depende del sistema de archivos.
  const donde = (usos.get(clave) ?? [])
    .slice()
    .sort((x, y) => (x.rel === y.rel ? x.linea - y.linea : x.rel < y.rel ? -1 : 1));
  const pantalla = donde.length ? pantallaDe(donde[0].rel) : "Sin sitio conocido";
  if (!donde.length) sinUso.push(clave);
  if (!grupos.has(pantalla)) grupos.set(pantalla, []);
  grupos.get(pantalla).push({ clave, v, donde });
}

const orden = [...new Set([...PANTALLAS.map(([, n]) => n), "Sin sitio conocido", "Sin clasificar"])];
const pantallasOrdenadas = orden.filter((p) => grupos.has(p));

// ── Escribir ─────────────────────────────────────────────────────────────────
const l = [];
l.push("# Las frases de Terminus, y dónde sale cada una");
l.push("");
l.push("**Este archivo se genera.** No lo edites: se rehace con");
l.push("`node scripts/phrases.mjs` y cualquier cambio a mano se pierde en la");
l.push("siguiente corrida. Para cambiar una frase, cambia el catálogo en");
l.push("`src/locales/es/`.");
l.push("");
l.push("Existe para quien traduce, que no lee el código: un JSON ordenado por clave");
l.push("no dice lo único que hace falta para traducir bien —*dónde sale esto*—, y");
l.push("«Entrar» no se traduce igual si es el botón de un formulario o el rótulo de");
l.push("una pestaña.");
l.push("");
l.push(`| | |`);
l.push(`|---|---|`);
l.push(`| Frases en el catálogo | **${es.size}** |`);
l.push(`| Con traducción al inglés | ${[...es.keys()].filter((k) => en.has(k)).length} |`);
l.push(`| Sitios donde se usan | ${[...usos.values()].reduce((n, u) => n + u.length, 0)} |`);
l.push("");
l.push("**«Dónde sale» es la pantalla y el sitio en el código, no el momento.** Que");
l.push("una frase salga *cuando falla la descarga y la persona ya entró* está en la");
l.push("condición que la rodea, y eso no lo puede leer un script. La ruta y la línea");
l.push("sí son exactas: con ellas se va a mirar.");
l.push("");

for (const pantalla of pantallasOrdenadas) {
  const filas = grupos.get(pantalla);
  l.push(`## ${pantalla} — ${filas.length} frase(s)`);
  l.push("");
  l.push("| Español | Inglés | Dónde sale | Clave |");
  l.push("|---|---|---|---|");
  for (const { clave, v, donde } of filas) {
    const ingles = en.has(clave) ? texto(en.get(clave).v) : "_falta_";
    const sitios = donde.length
      ? donde.map((d) => `\`${d.rel}:${d.linea}\``).join("<br>")
      : "_ninguno la usa_";
    l.push(`| ${celda(texto(v))} | ${celda(ingles)} | ${sitios} | \`${clave}\` |`);
  }
  l.push("");
}

if (sinUso.length) {
  l.push("## Frases que hoy no usa nadie");
  l.push("");
  l.push("O las arma el código en tiempo de ejecución —y entonces la clave no aparece");
  l.push("entera en ningún archivo— o sobran. `scripts/locales.mjs` distingue los dos");
  l.push("casos y falla con las segundas.");
  l.push("");
  for (const c of sinUso) l.push(`- \`${c}\``);
  l.push("");
}

l.push("---");
l.push("");
l.push("**Lo que esta hoja no cubre:** el texto del backend que todavía no se migró a");
l.push("clave —cada módulo de `src-tauri/` se pasa por separado, y el que ya lo hizo");
l.push("sale arriba en *Del backend*—; el renglón técnico de un error (`Failure::detail`),");
l.push("que se queda en Rust a propósito porque es lo que se lee al reportar un fallo");
l.push("de la máquina de otra persona; y lo que no se traduce nunca —lo que escribe el");
l.push("agente, el `stderr` de los CLIs y los nombres que pone la persona—.");
l.push("");

const nuevo = l.join("\n");

if (process.argv.includes("--check")) {
  const actual = existsSync(SALIDA) ? readFileSync(SALIDA, "utf8") : "";
  if (actual !== nuevo) {
    // **Dice en qué se diferencia, no solo que se diferencia.** Sin esto, un
    // rojo en una máquina que no es la tuya —CI en Linux con el gate verde en
    // Windows— no se puede diagnosticar: la única salida es adivinar.
    const hoja = actual.split("\n");
    const debe = nuevo.split("\n");
    const i = debe.findIndex((l, n) => l !== hoja[n]);
    const detalle =
      i < 0
        ? `mismo contenido y ${Math.abs(hoja.length - debe.length)} línea(s) de más`
        : `primera diferencia en la línea ${i + 1}:\n` +
          `  hoja:     ${JSON.stringify(hoja[i] ?? null)}\n` +
          `  esperado: ${JSON.stringify(debe[i] ?? null)}`;
    console.error(
      `${relative(RAIZ, SALIDA)} está desactualizado.\n` +
        `${detalle}\n` +
        "Córrelo: node scripts/phrases.mjs",
    );
    process.exit(1);
  }
  console.log(`${relative(RAIZ, SALIDA)} al día — ${es.size} frases.`);
  process.exit(0);
}

writeFileSync(SALIDA, nuevo);
console.log(
  `${relative(RAIZ, SALIDA)} — ${es.size} frases en ${pantallasOrdenadas.length} pantalla(s).`,
);
console.log(
  "«Dónde sale» es la pantalla y la línea, no el momento: la condición que\n" +
    "envuelve una frase no la puede leer un script.",
);
