import assert from "node:assert/strict";
import test from "node:test";
import { claseDeFondo as backgroundClass, fondoDe as backgroundOf } from "../src/lib/chat-background.ts";

test("los fondos anteriores se normalizan al patrón vigente", () => {
  for (const stored of [null, "", "none", "dots", "foto-propia"]) {
    assert.equal(backgroundOf(stored), "dusk");
  }
  assert.equal(backgroundOf("dusk"), "dusk");
  assert.equal(backgroundOf("propia"), "propia");
});

test("la imagen propia conserva su archivo sin clase de patrón", () => {
  assert.equal(backgroundClass("propia"), null);
  assert.equal(backgroundClass("dusk"), "chat-bg-dusk");
});
