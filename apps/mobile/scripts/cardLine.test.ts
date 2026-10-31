/**
 * La línea 2 de la tarjeta del teléfono (`src/lib/cardLine.ts`) y qué git pide
 * (`src/lib/taskGit.ts`).
 *
 *   node --test apps/mobile/scripts/cardLine.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { cardPull, type TaskGit, taskCard } from "@terminus/tasks";
import { secondLine } from "../src/lib/cardLine.ts";
import { effectiveGit, gitAsks, gitAsksKey, staleGit, withGitAnswer } from "../src/lib/taskGit.ts";

const row = { id: "t1", title: "Tarea", esperando: false, folder: "p1", agent: "Ada", provider: "claude", machine: "vm", machine_on: true, last_message: "¿Sigo?" };
const card = (extra: Record<string, unknown> = {}) => taskCard({ ...row, ...extra }, { live: [], approving: [] });
const git = (extra: Partial<TaskGit> = {}, checks?: "failure"): TaskGit => ({
  head: "abc",
  shared_with: null,
  pull: { number: 7, state: "open", head_sha: "abc", checks },
  pull_known: true,
  stale: false,
  ...extra,
});

test("proveedor · carpeta · máquina · agente · PR, en ese orden", () => {
  assert.deepEqual(secondLine(card(), cardPull(git())), ["provider", "folder", "machine", "agent", "pull"]);
});

test("sin proveedor, o con uno sin marca, la línea empieza en la carpeta", () => {
  assert.deepEqual(secondLine(card({ provider: null }), null), ["folder", "machine", "agent"]);
  assert.deepEqual(secondLine(card({ provider: "desconocido" }), null), ["folder", "machine", "agent"]);
  assert.equal(secondLine(card({ provider: "antigravity" }), null)[0], "provider");
  assert.equal(secondLine(card({ provider: "opencode-zen" }), null)[0], "provider");
});

test("si te necesita conserva metadatos, sin mostrar el último mensaje", () => {
  assert.deepEqual(secondLine(card({ esperando: true }), cardPull(git())), ["provider", "folder", "machine", "agent", "pull"]);
});

test("si falló, la línea normal: no el último mensaje", () => {
  assert.deepEqual(secondLine(card({ outcome: "failed" }), null), ["provider", "folder", "machine", "agent"]);
});

test("PR con checks fallidos: número en rojo; con git viejo, gris", () => {
  const failing = cardPull(git({}, "failure"));
  assert.equal(failing?.numberTone, "failure");
  assert.deepEqual(secondLine(card(), failing).at(-1), "pull");
  const stale = cardPull(git({ stale: true }, "failure"));
  assert.equal(stale?.numberTone, "muted");
  assert.equal(stale?.tone, "muted");
});

test("git: una llamada por máquina, workspace y carpeta con sus tareas visibles", () => {
  const asks = gitAsks([
    { host: "mac", workspace: "w", folder: "p1", id: "a" },
    { host: "mac", workspace: "w", folder: "p1", id: "b" },
    { host: "vm", workspace: "w2", folder: "p1", id: "c" },
    { host: "mac", workspace: "w", folder: "", id: "d" },
    { host: "mac", workspace: "w", folder: "p1", id: "a" },
  ]);
  assert.deepEqual(asks, [
    { host: "mac", workspace: "w", project: "p1", priority: ["a", "b"] },
    { host: "vm", workspace: "w2", project: "p1", priority: ["c"] },
  ]);
  assert.equal(gitAsksKey(asks), gitAsksKey([...asks].reverse()));
});

test("git leído: por host/id; lo que no se pudo releer queda viejo, no se borra", () => {
  const one = withGitAnswer({}, "vm", { a: git(), junk: 3 });
  assert.deepEqual(Object.keys(one), ["vm/a"]);
  assert.equal(withGitAnswer(one, "vm", { a: git() }), one, "lo mismo no cambia el libro");
  const unknown = withGitAnswer(one, "vm", { a: { ...git(), kind: "unknown", pull: null } });
  assert.equal(unknown["vm/a"].stale, true);
  assert.equal(unknown["vm/a"].pull?.number, 7);
  const off = staleGit(one, "vm", ["a", "zz"]);
  assert.equal(off["vm/a"].stale, true);
  assert.equal(cardPull(off["vm/a"])?.tone, "muted");
  assert.equal(staleGit(off, "vm", ["a"]), off);
});

test("una rama compartida se resuelve dentro de la máquina y workspace elegidos", () => {
  const child = { host: "mac", workspace: "w", id: "child", parent: "parent", subagent: "a" };
  const parent = { host: "mac", workspace: "w", id: "parent" };
  const own = git({ shared_with: "parent", pull: null });
  const merged = git({ pull: { number: 8, state: "merged", head_sha: "abc" } });
  const book = { "mac/child": own, "mac/parent": merged, "vm/parent": git() };
  assert.equal(effectiveGit(book, child, [child, parent]).pull?.state, "merged");
  assert.equal(effectiveGit(book, child, [child, { ...parent, host: "vm" }]).pull, null);
  assert.equal(effectiveGit(book, child, [child, { ...parent, workspace: "other" }]).pull, null);
  assert.equal(effectiveGit({}, child, [child]).stale, true);
});
