import assert from "node:assert/strict";
import { test } from "node:test";
import {
  conflictCopyOf,
  deleteMemoryFile,
  entriesIn,
  type MemoryFetch,
  type MemorySource,
  memoryDirs,
  memoryEntryText,
  memoryFiles,
  memoryHistory,
  parseMemoryEntry,
  readMemoryFile,
  writeMemoryFile,
} from "../src/index.ts";

type Seen = { url: string; method?: string; headers?: Record<string, string>; body?: string };

function source(status: number, body: unknown, seen: Seen[] = []): MemorySource {
  const fetch: MemoryFetch = async (url, init) => {
    seen.push({ url, method: init?.method, headers: init?.headers, body: init?.body });
    return { status, ok: status >= 200 && status < 300, json: async () => body };
  };
  return { endpoint: "https://computers.example", getToken: async () => "tok", fetch };
}

test("lee entradas, una versión vieja y el historial por el Worker, con el token de la cuenta", async () => {
  const seen: Seen[] = [];
  const files = await memoryFiles(source(200, { commit: "c".repeat(40), files: [{ path: "memory/a.md", oid: "1" }, { bad: 1 }] }, seen), "w 1");
  assert.deepEqual(files, { kind: "ok", value: { commit: "c".repeat(40), files: [{ path: "memory/a.md", oid: "1" }] } });
  assert.equal(seen[0]?.url, "https://computers.example/v1/workspaces/w%201/memory/files");
  assert.equal(seen[0]?.headers?.authorization, "Bearer tok");

  const old = await readMemoryFile(source(200, { path: "memory/a.md", ref: "abc", oid: "9", content: "v1" }, seen), "w", "memory/a.md", "abc");
  assert.deepEqual(old, { kind: "ok", value: { path: "memory/a.md", ref: "abc", oid: "9", content: "v1" } });
  assert.equal(seen[1]?.url, "https://computers.example/v1/workspaces/w/memory/file?path=memory%2Fa.md&ref=abc");

  const history = await memoryHistory(
    source(200, { path: "memory/a.md", versions: [{ commit: "c2", message: "edit", author: { name: "Ana", email: "a@a" }, at: "2026-10-22T00:00:00.000Z", oid: null }] }),
    "w",
    "memory/a.md",
  );
  assert.equal(history.kind, "ok");
  assert.deepEqual(history.kind === "ok" ? history.value[0] : null, { commit: "c2", message: "edit", author: { name: "Ana", email: "a@a" }, at: "2026-10-22T00:00:00.000Z", oid: null });
});

test("escribe con base y lee la copia del conflicto; borrar contra otra versión es conflict", async () => {
  const seen: Seen[] = [];
  const put = await writeMemoryFile(
    source(200, { status: "written", commit: "c3", path: "memory/a.md", conflict_copy: "memory/a.conflicto-mac.md", changed: true }, seen),
    "w",
    "memory/a.md",
    "texto",
    null,
  );
  assert.deepEqual(put, { kind: "ok", value: { status: "written", commit: "c3", path: "memory/a.md", conflict_copy: "memory/a.conflicto-mac.md", changed: true } });
  assert.equal(seen[0]?.method, "PUT");
  assert.deepEqual(JSON.parse(seen[0]?.body ?? "{}"), { path: "memory/a.md", content: "texto", base: null });

  const del = await deleteMemoryFile(source(409, { error: { code: "memory_conflict" }, current: "abc" }, seen), "w", "memory/a.md", "old");
  assert.deepEqual(del, { kind: "conflict", current: "abc" });
  assert.equal(seen[1]?.url, "https://computers.example/v1/workspaces/w/memory/file?path=memory%2Fa.md&base=old");
  assert.equal(seen[1]?.method, "DELETE");
});

test("cada fallo del Worker tiene su nombre; nunca una lista vacía", async () => {
  const kinds = async (status: number, body: unknown = null) => (await memoryFiles(source(status, body), "w")).kind;
  assert.equal(await kinds(503, { error: { code: "memory_busy" } }), "busy");
  assert.equal(await kinds(503, { error: { code: "memory_disabled" } }), "disabled");
  assert.equal(await kinds(400, { error: { code: "bad_request" } }), "invalid");
  assert.equal(await kinds(401), "unauthorized");
  assert.equal(await kinds(403), "license");
  assert.equal(await kinds(404), "missing");
  assert.equal(await kinds(500), "error");
  assert.equal(await kinds(200, { nope: true }), "error");
  const down: MemorySource = { endpoint: "x.example", getToken: async () => "t", fetch: async () => Promise.reject(new Error("red")) };
  assert.deepEqual(await memoryFiles(down, "w"), { kind: "error", status: null });
});

test("las carpetas de cada alcance y las entradas directas de una carpeta", () => {
  assert.deepEqual(memoryDirs("p1", { kind: "workspace" }), ["memory/"]);
  assert.deepEqual(memoryDirs("p1", { kind: "project" }), ["projects/p1/memory/"]);
  assert.deepEqual(memoryDirs("p1", { kind: "agent", name: "arq" }), ["projects/p1/agents/arq/memory/", "agents/arq/memory/"]);
  const files = [
    { path: "memory/a.md", oid: "1" },
    { path: "memory/MEMORY.md", oid: "2" },
    { path: "projects/p1/memory/b.md", oid: "3" },
    { path: "memory/x/c.md", oid: "4" },
  ];
  assert.deepEqual(entriesIn(files, "memory/").map((f) => f.path), ["memory/a.md"]);
});

test("reconoce la copia de un conflicto con la misma forma que el Worker y el motor", () => {
  assert.deepEqual(conflictCopyOf("projects/p1/memory/deploy.conflicto-mac-de-ana.md"), { original: "projects/p1/memory/deploy.md", who: "mac-de-ana" });
  assert.deepEqual(conflictCopyOf("deploy.conflicto-ana-lopez-2.md"), { original: "deploy.md", who: "ana-lopez" });
  assert.equal(conflictCopyOf("memory/deploy.md"), null);
  assert.equal(conflictCopyOf("memory/conflicto.md"), null);
});

test("lee el frontmatter del motor y arma uno que el motor acepta", () => {
  const raw = "---\ntype: decision\nmodified: 2026-10-21T17:28:50Z\norigin:\n  workspace: w\n  project: p\n  agent: claude\n---\n\nDecidido por la persona.\n";
  assert.deepEqual(parseMemoryEntry(raw), {
    type: "decision",
    modified: "2026-10-21T17:28:50Z",
    origin: { workspace: "w", project: "p", agent: "claude" },
    body: "Decidido por la persona.\n",
  });
  assert.deepEqual(parseMemoryEntry("sin frontmatter"), { type: null, modified: null, origin: {}, body: "sin frontmatter" });

  const text = memoryEntryText({ type: "regla", body: "  Una regla\n", workspace: "w", project: "p", now: new Date("2026-10-22T10:00:00.123Z") });
  assert.equal(text, "---\ntype: regla\nmodified: 2026-10-22T10:00:00Z\norigin:\n  workspace: w\n  project: p\n---\n\nUna regla\n");
  assert.equal(parseMemoryEntry(text).body, "Una regla\n");
});
