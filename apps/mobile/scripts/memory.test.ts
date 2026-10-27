/**
 * La memoria del teléfono (`src/lib/memory.ts`): los alcances salen del
 * registro de la cuenta, las entradas se leen del Worker sin pasar por ninguna
 * máquina, la copia de un conflicto se reconoce y cada respuesta de una
 * escritura dice lo que la pantalla tiene que avisar.
 *
 *   node --test apps/mobile/scripts/memory.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { AccountWorkspace, MemoryFetch } from "@terminus/computers";
import { entryFileName, loadMemory, memoryItem, memoryScopes, outcomeOf, sortItems } from "../src/lib/memory.ts";

const WS: AccountWorkspace = {
  id: "w1",
  name: "Producto",
  projects: [
    { id: "p1", name: "Aplicación" },
    { id: "p2", name: "" },
  ],
  computers: ["cmp_vm"],
};

const raw = (body: string, modified: string, agent?: string) =>
  `---\ntype: decision\nmodified: ${modified}\norigin:\n  workspace: w1\n  project: p1\n${agent ? `  agent: ${agent}\n` : ""}---\n\n${body}\n`;

test("los alcances: el workspace y cada proyecto del registro", () => {
  assert.deepEqual(
    memoryScopes(WS).map((s) => [s.key, s.name, s.dir]),
    [
      ["workspace", "", "memory/"],
      ["project:p1", "Aplicación", "projects/p1/memory/"],
      ["project:p2", "p2", "projects/p2/memory/"],
    ],
  );
  assert.deepEqual(memoryScopes(null).map((s) => s.key), ["workspace"], "sin registro, solo el del workspace");
});

test("lee las entradas de una carpeta del Worker, sin el índice, y marca las copias de conflicto", async () => {
  const seen: string[] = [];
  const files = {
    commit: "c".repeat(40),
    files: [
      { path: "projects/p1/memory/deploy.md", oid: "1" },
      { path: "projects/p1/memory/deploy.conflicto-mac-de-ana.md", oid: "2" },
      { path: "projects/p1/memory/MEMORY.md", oid: "3" },
      { path: "memory/regla.md", oid: "4" },
    ],
  };
  const contents: Record<string, string> = {
    "projects/p1/memory/deploy.md": raw("Desplegar con wrangler", "2026-10-22T10:00:00Z"),
    "projects/p1/memory/deploy.conflicto-mac-de-ana.md": raw("Desplegar a mano", "2026-10-21T10:00:00Z", "claude"),
  };
  const fetch: MemoryFetch = async (url) => {
    seen.push(url);
    const u = new URL(url);
    const body = u.pathname.endsWith("/files")
      ? files
      : { path: u.searchParams.get("path"), ref: u.searchParams.get("ref"), oid: u.searchParams.get("path") === "projects/p1/memory/deploy.md" ? "1" : "2", content: contents[u.searchParams.get("path") ?? ""] };
    return { status: 200, ok: true, json: async () => body };
  };
  const loaded = await loadMemory({ endpoint: "https://computers.example", getToken: async () => "tok", fetch }, "w1", "projects/p1/memory/");
  assert.ok("items" in loaded);
  const items = "items" in loaded ? loaded.items : [];
  assert.deepEqual(
    items.map((i) => [i.file, i.oid, i.body, i.agent, i.conflictOf]),
    [
      ["deploy.md", "1", "Desplegar con wrangler", null, null],
      ["deploy.conflicto-mac-de-ana.md", "2", "Desplegar a mano", "claude", "deploy.md"],
    ],
  );
  assert.ok(seen.every((u) => u.startsWith("https://computers.example/v1/workspaces/w1/memory/")), "solo el Worker, nunca una máquina");
  assert.ok(seen.slice(1).every((u) => u.includes(`ref=${"c".repeat(40)}`)), "todas de la misma foto");
});

test("un Worker ocupado, sin memoria o sin sesión no es una lista vacía", async () => {
  const answer = (status: number, body: unknown) => ({ endpoint: "x.example", getToken: async () => "t", fetch: (async () => ({ status, ok: false, json: async () => body })) as MemoryFetch });
  assert.deepEqual(await loadMemory(answer(503, { error: { code: "memory_busy" } }), "w1", "memory/"), { problem: "busy" });
  assert.deepEqual(await loadMemory(answer(503, { error: { code: "memory_disabled" } }), "w1", "memory/"), { problem: "disabled" });
  assert.deepEqual(await loadMemory(answer(401, null), "w1", "memory/"), { problem: "signed_out" });
  assert.deepEqual(await loadMemory(answer(500, null), "w1", "memory/"), { problem: "error" });
});

test("cada respuesta de una escritura dice qué avisar", () => {
  assert.deepEqual(outcomeOf({ kind: "ok", value: { status: "written", commit: "c", path: "memory/a.md", conflict_copy: "memory/a.conflicto-mac.md" } }), { kind: "saved", copy: "memory/a.conflicto-mac.md" });
  assert.deepEqual(outcomeOf({ kind: "ok", value: { status: "written", commit: "c", path: "memory/a.md", conflict_copy: null } }), { kind: "saved", copy: null });
  assert.deepEqual(outcomeOf({ kind: "ok", value: { status: "deleted", commit: "c", path: "memory/a.md" } }), { kind: "deleted" });
  assert.deepEqual(outcomeOf({ kind: "conflict", current: "abc" }), { kind: "changed" });
  assert.deepEqual(outcomeOf({ kind: "missing" }), { kind: "gone" });
  assert.deepEqual(outcomeOf({ kind: "busy" }), { kind: "problem", problem: "busy" });
});

test("el nombre de una entrada nueva lleva .md y no es una ruta ni el índice", () => {
  assert.equal(entryFileName(" deploy "), "deploy.md");
  assert.equal(entryFileName("deploy.md"), "deploy.md");
  for (const bad of ["", "  ", "a/b", ".oculto", "MEMORY", "MEMORY.md"]) assert.equal(entryFileName(bad), null, bad);
});

test("más nuevas primero; sin fecha al final", () => {
  const a = memoryItem("memory/a.md", "1", "sin frontmatter");
  const b = memoryItem("memory/b.md", "2", raw("b", "2026-10-20T00:00:00Z"));
  const c = memoryItem("memory/c.md", "3", raw("c", "2026-10-22T00:00:00Z"));
  assert.deepEqual(sortItems([a, b, c]).map((i) => i.file), ["c.md", "b.md", "a.md"]);
});
