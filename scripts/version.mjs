#!/usr/bin/env node
/**
 * Sube la versión en los cuatro sitios que la llevan, y deja el `Cargo.lock` a
 * cargo.
 *
 * La versión vive repetida en `package.json`, `tauri.conf.json`, `Cargo.toml` y
 * `Cargo.lock`, y subirla con un `sed` sobre `version = "0.1.7"` parece
 * inofensivo hasta que se corre sobre el lock: **ahí esa línea la tienen todas
 * las dependencias**, y las que casen quedan apuntando a versiones que no
 * existen. El árbol local sigue compilando —cargo ya tiene todo descargado— y el
 * fallo aparece en el runner:
 *
 *     error: failed to select a version for `crypto-common = "^0.1.3"`
 *            (locked to 0.1.8)
 *
 * Por eso aquí **el lock no se edita**: se toca `Cargo.toml` y se deja que
 * `cargo` lo escriba. Es el único que sabe qué línea es la del paquete de uno.
 *
 * ## Y verifica después de subir, no antes
 *
 * Verificar **antes** del bump deja a `cargo check` mirando un lock que todavía
 * estaba bien. Un cambio de versión no es cosmético —toca el lock, y el lock
 * decide si compila— así que la
 * comprobación va detrás. Aquí va incluida para que no dependa de acordarse.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const nueva = process.argv[2];

const salir = (...lineas) => {
  console.error("");
  for (const l of lineas) console.error(`  ${l}`);
  console.error("");
  process.exit(1);
};

if (!nueva || !/^\d+\.\d+\.\d+$/.test(nueva)) {
  salir("Uso: pnpm version:subir 0.1.9", "Tres números y nada más — es lo que compara el updater.");
}

const rutaPaquete = join(raiz, "package.json");
const rutaTauri = join(raiz, "src-tauri/tauri.conf.json");
const rutaCargo = join(raiz, "src-tauri/Cargo.toml");

const actual = JSON.parse(readFileSync(rutaTauri, "utf8")).version;
if (actual === nueva) salir(`Ya está en ${nueva}.`);

/**
 * Reemplaza **una** aparición y falla si no encuentra exactamente una.
 *
 * Un `replace` que no encuentra nada devuelve el texto igual y no se queja: el
 * archivo se reescribe idéntico y la versión se queda atrás en un solo sitio —
 * que es la forma de que el instalador diga una cosa y el updater otra.
 */
function sustituir(ruta, patron, hecho) {
  const texto = readFileSync(ruta, "utf8");
  // Con `g`, y no sin él: `String.match` sin `g` devuelve **un** resultado con
  // sus grupos de captura dentro, así que contar su longitud cuenta paréntesis,
  // no apariciones. Un patrón con dos grupos «encontraba tres».
  const encontradas = texto.match(new RegExp(patron.source, "gm"));
  if (!encontradas || encontradas.length !== 1) {
    salir(
      `En ${ruta} esperaba una línea de versión y encontré ${encontradas?.length ?? 0}.`,
      "El formato del archivo cambió: revísalo antes de seguir.",
    );
  }
  writeFileSync(ruta, texto.replace(patron, hecho), "utf8");
}

sustituir(rutaPaquete, /^(\s*"version":\s*")\d+\.\d+\.\d+(")/m, `$1${nueva}$2`);
sustituir(rutaTauri, /^(\s*"version":\s*")\d+\.\d+\.\d+(")/m, `$1${nueva}$2`);
// Solo la del `[package]`, que es la primera del archivo. Las de las
// dependencias vienen después y no se tocan.
sustituir(rutaCargo, /^(version = ")\d+\.\d+\.\d+(")/m, `$1${nueva}$2`);

console.log(`\n  ${actual} → ${nueva}\n`);
console.log("  Dejando el Cargo.lock a cargo…");
execFileSync("cargo", ["check", "--quiet"], {
  cwd: join(raiz, "src-tauri"),
  stdio: ["ignore", "inherit", "inherit"],
});

console.log("\n  Ahora la nota, que es lo que se lee en la release:");
console.log("      release-notes/es.md y release-notes/en.md");

// **Y aquí se corre, que es lo que la cabecera prometía.** Imprimía un
// recordatorio —«y después `pnpm verificar`»— justo debajo del párrafo que dice
// «aquí va incluida para que no dependa de acordarse». Seguía dependiendo de
// acordarse, y de la única persona que ya tenía la versión subida en el árbol.
//
// Hereda la salida: `verificar` pinta sus filas una a una, y capturarla sería
// mirar una pantalla en blanco durante un minuto.
console.log("\n  Y verificando, que el lock cambió y la corrida de antes no vale…\n");
try {
  execFileSync("pnpm", ["verificar"], {
    cwd: raiz,
    stdio: "inherit",
    // En Windows `pnpm` es un `.cmd`, y a esos no los lanza `CreateProcess`
    // directamente. Es el mismo motivo por el que `preview::abridor` no usa
    // `cmd` para abrir una URL, con el signo cambiado: aquí hace falta el
    // intérprete, y el argumento es fijo y nuestro.
    shell: process.platform === "win32",
  });
} catch {
  // **La versión ya está subida y eso no se deshace aquí.** Revertirlo dejaría
  // el árbol como estaba y el fallo sin investigar; lo que hace falta es que
  // quien publica sepa que no puede, con la versión puesta para reproducirlo.
  salir(
    `\`pnpm verificar\` no pasó con la versión en ${nueva}.`,
    "Los cuatro archivos ya están subidos: arregla lo que falle y vuelve a",
    "correrlo, o revierte el bump si no era el momento.",
  );
}
console.log(`\n  Verificado en ${nueva}. Escribe la nota y abre el PR a main.\n`);
