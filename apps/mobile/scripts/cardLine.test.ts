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
import { gitAsks, gitAsksKey, staleGit, withGitAnswer } from "../src/lib/taskGit.ts";

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
  assert.deepEqual(secondLine(card(), cardPull(git()), false), ["provider", "folder", "machine", "agent", "pull"]);
});

test("sin proveedor, o con uno sin marca, la línea empieza en la carpeta", () => {
  assert.deepEqual(secondLine(card({ provider: null }), null, false), ["folder", "machine", "agent"]);
  assert.deepEqual(secondLine(card({ provider: "desconocido" }), null, false), ["folder", "machine", "agent"]);
  assert.equal(secondLine(card({ provider: "antigravity" }), null, false)[0], "provider");
  assert.equal(secondLine(card({ provider: "opencode-zen" }), null, false)[0], "provider");
});

test("compacta no lleva línea 2, ni proveedor ni PR", () => {
  assert.deepEqual(secondLine(card(), cardPull(git()), true), []);
});

test("si te necesita: lo que pide, el PR y el cuadrado de la carpeta", () => {
  assert.deepEqual(secondLine(card({ esperando: true }), cardPull(git()), false), ["request", "pull", "folder-square"]);
});

test("PR con checks fallidos: número en rojo; con git viejo, gris", () => {
  const failing = cardPull(git({}, "failure"));
  assert.equal(failing?.numberTone, "failure");
  assert.deepEqual(secondLine(card(), failing, false).at(-1), "pull");
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
