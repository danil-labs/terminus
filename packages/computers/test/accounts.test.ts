import assert from "node:assert/strict";
import { test } from "node:test";
import { groupAccounts, resetLabel, usageTone, windowLabel, windowLeft } from "../src/index.ts";

test("una tarjeta por correo con sus máquinas; el consumo se lee de una encendida", () => {
  const groups = groupAccounts("claude", [
    { machine: "vm", on: false, accounts: [{ id: "a1", label: "Trabajo", identity: "Ana@Example.com" }, { id: "a2", label: "Sin correo", identity: null }] },
    { machine: "mac", on: true, accounts: [{ id: "m1", label: "", identity: "ana@example.com" }] },
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].email, "ana@example.com");
  assert.deepEqual(groups[0].members, [{ machine: "vm", id: "a1", on: false }, { machine: "mac", id: "m1", on: true }]);
  assert.deepEqual(groups[0].usageFrom, { machine: "mac", id: "m1", on: true });
  assert.equal(groups[1].email, null);
  assert.equal(groups[1].key, "claude:vm~a2");
});

test("lo que queda, su tono y cuándo vuelve, con las palabras del escritorio", () => {
  assert.equal(windowLeft({ used_pct: 37.6 }), 62);
  assert.equal(windowLeft({ used_pct: 120 }), 0);
  assert.equal(usageTone(4), "error");
  assert.equal(usageTone(20), "warning");
  assert.equal(usageTone(60), "neutral");
  const now = 1_000_000_000_000;
  assert.equal(resetLabel("es", null, 0, now), "sin empezar");
  assert.equal(resetLabel("es", null, 3, now), "sin fecha de reset");
  assert.equal(resetLabel("es", now - 1, 3, now), "ya reseteó");
  assert.equal(resetLabel("es", now + 25 * 60_000, 3, now), "reset en 25 min");
  assert.equal(resetLabel("es", now + 3 * 3_600_000, 3, now), "reset en 3 h");
  assert.equal(resetLabel("es", now + 5 * 86_400_000, 3, now), "reset en 5 días");
  assert.equal(windowLabel("es", { used_pct: 38, resets_at: now + 3 * 3_600_000 }, now), "resta 62% · reset en 3 h");
});
