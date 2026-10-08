import assert from "node:assert/strict";
import { test } from "node:test";
import { storageRefresh } from "../src/lib/storageRefresh.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function setup() {
  const requests: { fresh: boolean; result: ReturnType<typeof deferred<number>> }[] = [];
  const values: number[] = [];
  const errors: unknown[] = [];
  const active: boolean[] = [];
  const refresh = storageRefresh({
    read: (fresh) => {
      const result = deferred<number>();
      requests.push({ fresh, result });
      return result.promise;
    },
    receive: (n: number) => values.push(n),
    fail: (e) => errors.push(e),
    measuring: (a) => active.push(a),
  });
  return { refresh, requests, values, errors, active };
}

test("la lectura antigua no pisa el barrido y varios avisos se agrupan", async () => {
  const s = setup();
  const done = s.refresh.refresh(false);
  void s.refresh.refresh();
  void s.refresh.refresh();
  void s.refresh.refresh(false);
  assert.equal(s.requests.length, 1);
  s.requests[0].result.resolve(23);
  await Promise.resolve();
  assert.deepEqual(s.requests.map((r) => r.fresh), [false, true]);
  s.requests[1].result.resolve(10600);
  await done;
  assert.deepEqual(s.values, [23, 10600]);
  assert.deepEqual(s.active, [true, false]);
});

test("cambiar de workspace descarta el resultado del anterior", async () => {
  const s = setup();
  const done = s.refresh.refresh();
  void s.refresh.reset();
  s.requests[0].result.resolve(9000);
  await Promise.resolve();
  assert.deepEqual(s.values, []);
  s.requests[1].result.resolve(300);
  await done;
  assert.deepEqual(s.values, [300]);
});

test("un error se informa y la siguiente medición puede recuperarse", async () => {
  const s = setup();
  const first = s.refresh.refresh();
  s.requests[0].result.reject("sin acceso");
  await first;
  assert.deepEqual(s.errors, ["sin acceso"]);
  const second = s.refresh.refresh();
  s.requests[1].result.resolve(42);
  await second;
  assert.deepEqual(s.values, [42]);
});

test("desmontar descarta la medición y cancela la pendiente", async () => {
  const s = setup();
  const done = s.refresh.refresh();
  void s.refresh.refresh();
  s.refresh.dispose();
  s.requests[0].result.resolve(100);
  await done;
  await s.refresh.refresh();
  assert.deepEqual(s.values, []);
  assert.equal(s.requests.length, 1);
});
