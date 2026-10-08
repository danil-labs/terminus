import assert from "node:assert/strict";
import test from "node:test";

import type { Window } from "../src/lib/limits.ts";
import {
  enLaFranja as stripWindows,
  rotuloDeAlcance as scopeLabel,
  stripStage,
  stripWidthRem,
} from "../src/lib/limitsBar.ts";

const w = (label: string, extra: Partial<Window> = {}): Window => ({
  label,
  used_pct: 10,
  resets_at: null,
  ...extra,
});

test("un caché sin duration_s sigue ordenando por el rótulo", () => {
  const order = stripWindows(
    [w("últimos 30 días"), w("últimas 5 horas"), w("esta semana")],
    "codex",
  ).map((x) => x.label);
  assert.deepEqual(order, ["últimas 5 horas", "esta semana", "últimos 30 días"]);
});

test("Gemini va implícito y Claude, GPT se nombra corto", () => {
  const gemini = w("esta semana · modelos Gemini", {
    duration_s: 604_800,
    scope: "modelos Gemini",
  });
  const others = w("esta semana · modelos Claude y GPT", {
    duration_s: 604_800,
    scope: "modelos Claude y GPT",
  });
  assert.equal(scopeLabel("antigravity", gemini), null);
  assert.equal(scopeLabel("antigravity", others), "Claude, GPT");
  assert.equal(scopeLabel("claude", w("esta semana · Fable", { scope: "Fable" })), "Fable");
  const order = stripWindows([others, gemini], "antigravity").map((x) => x.scope);
  assert.deepEqual(order, ["modelos Gemini", "modelos Claude y GPT"]);
});

const WINDOWS = [
  [6, 6],
  [5, 9],
];
const LEGEND_LENGTH = "uso restante".length;

test("con hueco de sobra la franja se pinta entera", () => {
  assert.equal(stripStage(60, WINDOWS, LEGEND_LENGTH), "full");
});

test("lo primero que se cae son los medidores, y después la leyenda", () => {
  const full = stripWidthRem(WINDOWS, LEGEND_LENGTH, "full");
  const barsOff = stripWidthRem(WINDOWS, LEGEND_LENGTH, "bars-off");
  const compact = stripWidthRem(WINDOWS, LEGEND_LENGTH, "compact");
  assert.ok(barsOff < full);
  assert.ok(compact < barsOff);
  assert.equal(stripStage(full - 0.1, WINDOWS, LEGEND_LENGTH), "bars-off");
  assert.equal(stripStage(barsOff - 0.1, WINDOWS, LEGEND_LENGTH), "compact");
});
