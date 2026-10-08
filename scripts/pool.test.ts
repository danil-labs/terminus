import assert from "node:assert/strict";
import test from "node:test";
import { pooled } from "../src/lib/pool.ts";

const tick = () => new Promise((done) => setTimeout(done, 1));

test("never runs more than the limit at once", async () => {
  let running = 0;
  let peak = 0;
  await pooled(Array.from({ length: 70 }, (_, i) => i), 4, async () => {
    running += 1;
    peak = Math.max(peak, running);
    await tick();
    running -= 1;
  });
  assert.equal(peak, 4);
});

test("keeps the order of the input, whatever finishes first", async () => {
  const results = await pooled([30, 1, 10], 3, async (ms) => {
    await new Promise((done) => setTimeout(done, ms));
    return ms;
  });
  assert.deepEqual(results.map((r) => (r.status === "fulfilled" ? r.value : null)), [30, 1, 10]);
});

test("a failure settles its own slot and the rest go on", async () => {
  const results = await pooled([1, 2, 3], 2, async (n) => {
    if (n === 2) throw new Error("two");
    return n;
  });
  assert.deepEqual(results.map((r) => r.status), ["fulfilled", "rejected", "fulfilled"]);
});

test("an empty list and a silly limit do not hang", async () => {
  assert.deepEqual(await pooled([], 4, async () => 1), []);
  assert.equal((await pooled([1, 2], 0, async (n) => n)).length, 2);
});
