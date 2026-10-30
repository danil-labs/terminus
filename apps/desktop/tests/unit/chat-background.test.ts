import assert from "node:assert/strict";
import test from "node:test";
import { fondoDe as backgroundOf } from "../../src/lib/chat-background.ts";

test("los fondos anteriores, también el atardecer bicolor, caen al neutro", () => {
  for (const stored of [null, "", "none", "dots", "foto-propia", "dusk"]) {
    assert.equal(backgroundOf(stored), "neutro");
  }
  assert.equal(backgroundOf("neutro"), "neutro");
  assert.equal(backgroundOf("propia"), "propia");
});
