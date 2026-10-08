import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  elegirLengua,
  registrarCatalogo,
  saltillo,
  type Manifiesto,
} from "../src/lib/i18n.ts";
import { prosa } from "../src/lib/prose.ts";

// El control en español evita que un respaldo fijo en inglés pase como traducción.

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * El catálogo tal cual está en disco. Se compara contra `saltillo(…)` porque el
 * motor normaliza el apóstrofo al registrarlo: el saltillo maya es `U+02BC` y
 * llegan las tres variantes según con qué se escriba (`lib/i18n.ts`).
 */
function catalogo(codigo: string): Record<string, string> {
  const dir = join(RAIZ, "src/locales", codigo);
  const frases: Record<string, string> = {};
  for (const nombre of readdirSync(dir)) {
    if (!nombre.endsWith(".json") || nombre === "manifiesto.json") continue;
    Object.assign(frases, JSON.parse(readFileSync(join(dir, nombre), "utf8")));
  }
  return frases;
}

function manifiesto(codigo: string): Manifiesto {
  return JSON.parse(
    readFileSync(join(RAIZ, "src/locales", codigo, "manifiesto.json"), "utf8"),
  );
}

/** Las claves que manda el motor: su código no vive aquí, el contrato las lista. */
function clavesDelBackend(): string[] {
  const contrato = JSON.parse(readFileSync(join(RAIZ, "src-tauri/crates/engine-protocol/phrase-keys.json"), "utf8"));
  return [...new Set<string>(contrato.keys)].sort();
}

const es = catalogo("es");
const en = catalogo("en");
registrarCatalogo(manifiesto("es"), es);
registrarCatalogo(manifiesto("en"), en);

test("una frase del backend se pinta en la lengua de la ventana", () => {
  const claves = clavesDelBackend();
  assert.ok(claves.length > 0, "el backend no pide ninguna clave; el detector se rompió");

  elegirLengua("en");
  for (const clave of claves) {
    assert.equal(
      prosa({ clave }),
      saltillo(en[clave]),
      `«${clave}» no se pintó en inglés con la app en inglés`,
    );
  }

  // Control negativo: la misma clave, en español, tiene que dar el español.
  elegirLengua("es");
  for (const clave of claves) {
    assert.equal(prosa({ clave }), saltillo(es[clave]), `«${clave}» no se pintó en español`);
  }
});

test("una cadena de un módulo sin migrar se pinta tal cual", () => {
  elegirLengua("en");
  assert.equal(prosa("lo que todavía escribe Rust"), "lo que todavía escribe Rust");
});

test("los datos se interpolan en la lengua elegida", () => {
  elegirLengua("en");
  const ingles = prosa({ clave: "mcp.error.no_binary", datos: { agent: "Claude Code" } });
  assert.ok(ingles.includes("Claude Code"), ingles);
  assert.ok(!ingles.includes("{agent}"), `quedó el placeholder sin sustituir: ${ingles}`);
  assert.notEqual(
    ingles,
    saltillo(es["mcp.error.no_binary"]).replace("{agent}", "Claude Code"),
  );
});
