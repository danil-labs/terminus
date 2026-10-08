/**
 * Que el medidor de contexto salga con lo que cada agente publica.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { type UsageRecord, ventanaDe } from "../src/lib/usage.ts";

const turno = (extra: Partial<UsageRecord>): UsageRecord => ({
  schema: 1, at: 0, workspace: "", agent: "x", account: null, model: null, project: "p", session: "s",
  turn: 0, tokens: { input_uncached: 0, cache_read: 0, cache_write: 0, output: 0, reasoning: 0 },
  cost_usd: null, context_used: null, context_limit: null, context_source: null, raw: null, ...extra,
});

test("con ocupación y límite, el medidor mide", () => {
  assert.deepEqual(ventanaDe([turno({ context_used: 7763, context_limit: 200000, context_source: "protocolo" })]), {
    modo: "medido", usado: 7763, limite: 200000, fuente: "protocolo",
  });
});

test("sin límite publicado, el medidor dice lo que lleva sin porcentaje", () => {
  assert.deepEqual(ventanaDe([turno({ context_used: 34698 })]), { modo: "sin-limite", usado: 34698 });
});

test("sin nada publicado no hay medidor", () => {
  assert.equal(ventanaDe([turno({})]), null);
});
