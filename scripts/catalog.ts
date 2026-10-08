/**
 * Carga los catálogos en el motor **desde disco**, para las pruebas de Node.
 *
 * `src/locales/catalogs.ts` hace lo mismo con `import.meta.glob`, que es de
 * Vite y aquí no existe. Sin esto, una prueba que afirme un rótulo en español
 * —`enCurso(...)` devuelve «Leyendo»— recibiría la clave
 * `common.steps.read.one`, porque el motor cae a devolver la clave cuando no
 * hay catálogo. Es el respaldo funcionando, y sería un rojo que no dice nada de
 * lo que la prueba vino a comprobar.
 *
 * Lee el mismo directorio que el glob, así que las dos rutas ven el mismo
 * conjunto de archivos.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { registrarCatalogo, type Manifiesto } from "../src/lib/i18n.ts";

const LENGUAS = join(dirname(fileURLToPath(import.meta.url)), "../src/locales");

for (const codigo of readdirSync(LENGUAS, { withFileTypes: true })) {
  if (!codigo.isDirectory()) continue;
  const dir = join(LENGUAS, codigo.name);
  let manifiesto: Manifiesto | null = null;
  const frases: Record<string, unknown> = {};
  for (const archivo of readdirSync(dir)) {
    if (!archivo.endsWith(".json")) continue;
    const json = JSON.parse(readFileSync(join(dir, archivo), "utf8"));
    if (basename(archivo, ".json") === "manifiesto") manifiesto = json;
    else Object.assign(frases, json);
  }
  if (manifiesto) registrarCatalogo(manifiesto, frases as Record<string, string>);
}
