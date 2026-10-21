import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

const store = new Map<string, string>();
let writes = 0;
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      writes++;
      store.set(key, value);
    },
    removeItem: (key: string) => void store.delete(key),
  },
});
const { ReadCache, SAVE_EVERY } = await import("../../src/web/reads.ts");

const KEY = "terminus-web:reads:v2:cmp";
let timers: { run: () => void; ms: number }[] = [];
const cache = () => new ReadCache("cmp", (run, ms) => timers.push({ run, ms }));
const tick = () => {
  const due = timers;
  timers = [];
  for (const t of due) t.run();
};

beforeEach(() => {
  store.clear();
  writes = 0;
  timers = [];
});

test("la misma lectura repetida no vuelve a escribir el almacenamiento", () => {
  const reads = cache();
  reads.put("list_projects", [{ id: "p" }]);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, SAVE_EVERY);
  tick();
  assert.equal(writes, 1);
  for (let n = 0; n < 100; n++) reads.put("list_projects", [{ id: "p" }]);
  tick();
  assert.equal(timers.length, 0, "an unchanged answer schedules nothing");
  assert.equal(writes, 1);
});

test("muchas respuestas distintas se escriben una sola vez por intervalo", () => {
  const reads = cache();
  for (let n = 0; n < 50; n++) reads.put("session_usage", { n });
  assert.equal(timers.length, 1);
  tick();
  assert.equal(writes, 1);
  assert.deepEqual(JSON.parse(JSON.parse(store.get(KEY) ?? "{}").session_usage.value), { n: 49 });
});

test("al irse la página se guarda lo pendiente y la hora de la última respuesta", () => {
  const reads = cache();
  reads.put("list_projects", []);
  reads.flush();
  assert.equal(writes, 1);
  reads.flush();
  assert.equal(writes, 1, "nothing pending, nothing written");
  const before = JSON.parse(store.get(KEY) ?? "{}").list_projects.at;
  const now = Date.now;
  Date.now = () => before + 5_000;
  try {
    reads.put("list_projects", []);
  } finally {
    Date.now = now;
  }
  assert.equal(writes, 1);
  reads.flush();
  assert.equal(writes, 2);
  assert.equal(JSON.parse(store.get(KEY) ?? "{}").list_projects.at, before + 5_000);
});

test("lo guardado se lee en la siguiente página", () => {
  const reads = cache();
  reads.put("list_spaces", [{ id: "s" }]);
  reads.flush();
  assert.deepEqual(cache().get("list_spaces")?.value, [{ id: "s" }]);
});
