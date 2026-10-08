import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { elegirLengua, registrarCatalogo, type Manifiesto } from "../src/lib/i18n.ts";
import { df, nf } from "../src/lib/format.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = (code: string): Manifiesto =>
  JSON.parse(readFileSync(join(ROOT, "src/locales", code, "manifiesto.json"), "utf8"));
registrarCatalogo(manifest("es"), {});
registrarCatalogo(manifest("en"), {});

test("different options get different formatters", () => {
  elegirLengua("es");
  assert.notEqual(df({ dateStyle: "medium" }), df({ dateStyle: "short" }));
});

test("changing the language changes the formatter and what it writes", () => {
  const september = new Date(2026, 8, 20);
  elegirLengua("es");
  const spanish = df({ month: "long" });
  assert.equal(spanish.format(september), "septiembre");
  const spanishNumbers = nf();
  elegirLengua("en");
  assert.notEqual(df({ month: "long" }), spanish);
  assert.equal(df({ month: "long" }).format(september), "September");
  assert.notEqual(nf(), spanishNumbers);
  elegirLengua("es");
  assert.equal(df({ month: "long" }), spanish, "and coming back finds the first one again");
});
