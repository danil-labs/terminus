import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

const store = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  },
});
const { readShellCache, shellCacheWriter, writeShellCache, SAVE_DELAY } = await import("../../src/lib/shellCache.ts");

type Snapshot = Parameters<typeof writeShellCache>[0];
const row = (id: string, text = "") => ({ id, title: `Tarea ${id}`, last_message: text }) as unknown as Snapshot["sessions"][string][number];
const snapshot = (workspace: string, rows = 3, text = ""): Snapshot => ({
  workspace,
  projects: [{ id: "p" } as Snapshot["projects"][number]],
  sessions: { "": Array.from({ length: rows }, (_, n) => row(`${workspace}${n}`, text)), p: [] },
  spaces: [],
  desk: null,
});

beforeEach(() => store.clear());

test("la última foto guardada es la que se lee al arrancar", () => {
  writeShellCache(snapshot("a"), 1);
  writeShellCache(snapshot("b"), 2);
  assert.equal(readShellCache()?.workspace, "b");
  assert.deepEqual(readShellCache()?.sessions[""].map((r) => r.id), ["b0", "b1", "b2"]);
});

test("solo se guardan los cuatro workspaces más recientes", () => {
  for (const [n, id] of ["a", "b", "c", "d", "e"].entries()) writeShellCache(snapshot(id), n);
  const stored = JSON.parse(store.get("harness:shell-cache") ?? "{}");
  assert.deepEqual(Object.keys(stored.workspaces).sort(), ["b", "c", "d", "e"]);
});

test("una foto demasiado grande se recorta por carpeta y, si no cabe, no se guarda", () => {
  writeShellCache(snapshot("a", 200, "x".repeat(1000)), 1);
  assert.equal(readShellCache()?.sessions[""].length, 80);
  writeShellCache(snapshot("a", 200, "x".repeat(50_000)), 2);
  assert.equal(readShellCache(), null);
});

test("guardar espera a que pare de cambiar y escribe solo la última", () => {
  const written: string[] = [];
  const timers: { run: () => void; ms: number }[] = [];
  const writer = shellCacheWriter(
    (s) => void written.push(s.workspace),
    (run, ms) => timers.push({ run, ms }) - 1,
    (handle) => {
      timers[handle as number] = { run: () => {}, ms: 0 };
    },
  );
  writer.save(snapshot("a"));
  writer.save(snapshot("b"));
  assert.equal(timers.at(-1)?.ms, SAVE_DELAY);
  for (const t of timers) t.run();
  assert.deepEqual(written, ["b"]);
  writer.save(snapshot("c"));
  writer.cancel();
  writer.flush();
  assert.deepEqual(written, ["b"]);
});

test("una foto ilegible no rompe el arranque", () => {
  store.set("harness:shell-cache", "{no es json");
  assert.equal(readShellCache(), null);
});
