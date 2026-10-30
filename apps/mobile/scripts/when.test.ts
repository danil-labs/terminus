import assert from "node:assert/strict";
import { test } from "node:test";
import { shortWhen } from "../src/lib/when.ts";

const now = new Date(2026, 9, 30, 12, 0).getTime();

test("la hora corta de una fila", () => {
  assert.equal(shortWhen(now - 20_000, "es", now), "ahora");
  assert.equal(shortWhen(now - 2 * 60_000, "es", now), "2 min");
  assert.equal(shortWhen((now - 2 * 60_000) / 1000, "es", now), "2 min", "segundos de un motor viejo");
  assert.equal(shortWhen(now - 3 * 3_600_000, "es", now), "3 h");
  assert.equal(shortWhen(new Date(2026, 9, 29, 20, 0).getTime(), "es", now), "ayer");
  assert.equal(shortWhen(new Date(2026, 9, 29, 20, 0).getTime(), "en", now), "yesterday");
  assert.equal(shortWhen(new Date(2026, 9, 1, 9, 0).getTime(), "es", now), "1 oct");
  assert.equal(shortWhen(null, "es", now), "");
  assert.equal(shortWhen("2026-10-30T11:58:00", "es", now), "2 min");
});
