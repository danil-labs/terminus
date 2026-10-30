import assert from "node:assert/strict";
import test from "node:test";
import { cn } from "../../src/lib/utils.ts";

test("un tamaño de la escala convive con el color", () => {
  assert.equal(cn("text-caption text-neutral-500"), "text-caption text-neutral-500");
});

test("el último tamaño de la escala gana", () => {
  assert.equal(cn("text-caption", "text-ui"), "text-ui");
  assert.equal(cn("text-sm", "text-caption"), "text-caption");
});
