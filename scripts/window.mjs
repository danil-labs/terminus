#!/usr/bin/env node
/**
 * Un override de plataforma no puede perder lo estructural de la ventana.
 *
 * `tauri.conf.json` lleva `"create": false` porque la ventana la construye
 * `lib.rs` a mano — sin eso no hay `on_navigation`, y sin `on_navigation` la
 * ventana se puede navegar fuera de la app y quien lo hace se queda sin salida.
 * `tauri.windows.conf.json` redefine `app.windows` para traer los controles de
 * ventana a Windows, y **Tauri no fusiona ese array: lo reemplaza entero**, así
 * que un override que no repita `create` se lo lleva por delante sin tocarlo.
 *
 * En Windows eso es: Tauri crea la ventana `main`, el setup hook intenta
 * crearla otra vez, y el proceso muere antes de que arranque el log.
 *
 *     thread 'main' panicked at tauri-2.11.5/src/app.rs:1425:11:
 *     Failed to setup app: a webview with label `main` already exists
 *
 * Exit 101, ventana que aparece y desaparece, y ni una línea en el registro
 * que lo explique. Los dos archivos eran correctos por separado.
 *
 * Lo que se compara son las llaves que deciden **quién construye la ventana y
 * cómo se la llama**, no la apariencia: un override existe justamente para
 * cambiar `decorations` o el título, y eso no se toca aquí.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const tauri = join(raiz, "src-tauri");

/** Las que rompen el arranque si se pierden, no las que pintan. */
const ESTRUCTURALES = ["label", "create"];

const leer = (p) => JSON.parse(readFileSync(join(tauri, p), "utf8"));

const base = leer("tauri.conf.json").app?.windows ?? [];
const overrides = readdirSync(tauri).filter((n) => /^tauri\.[a-z]+\.conf\.json$/.test(n));

const problemas = [];

for (const nombre of overrides) {
  const suyas = leer(nombre).app?.windows;
  if (!suyas) continue;

  if (suyas.length !== base.length) {
    problemas.push(
      `${nombre} define ${suyas.length} ventana(s) y tauri.conf.json define ${base.length}. ` +
        `Tauri reemplaza el array entero, así que la cuenta tiene que coincidir.`,
    );
    continue;
  }

  for (const [i, ventana] of suyas.entries()) {
    for (const llave of ESTRUCTURALES) {
      const esperado = base[i]?.[llave];
      if (esperado === undefined) continue;
      if (ventana[llave] !== esperado) {
        problemas.push(
          `${nombre}, ventana ${i}: falta \`"${llave}": ${JSON.stringify(esperado)}\`` +
            (llave in ventana ? ` (dice ${JSON.stringify(ventana[llave])})` : ""),
        );
      }
    }
  }
}

if (problemas.length) {
  console.error("");
  for (const p of problemas) console.error(`  ${p}`);
  console.error("");
  console.error("  Tauri no fusiona `app.windows`: el override reemplaza el array entero.");
  console.error("  Lo que no repita, se pierde — y `create` decide quién construye la");
  console.error("  ventana. Perderlo la construye dos veces y la app muere al abrir.");
  console.error("");
  process.exit(1);
}

console.log(
  `Las ${overrides.length} configuraciones de plataforma conservan ${ESTRUCTURALES.join(" y ")}.`,
);
