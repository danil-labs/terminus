import assert from "node:assert/strict";
import { test } from "node:test";
import { cardPull, type TaskGit } from "../src/index.ts";

const git = (pull: Partial<NonNullable<TaskGit["pull"]>> = {}, rest: Partial<TaskGit> = {}): TaskGit => ({
  head: "abc",
  shared_with: null,
  pull: { number: 42, state: "open", head_sha: "abc", ...pull },
  pull_known: true,
  stale: false,
  ...rest,
});

test("sin git, sin PR o sin confirmar no hay chip", () => {
  assert.equal(cardPull(null), null);
  assert.equal(cardPull(git({}, { pull: null })), null);
  assert.equal(cardPull(git({}, { pull_known: false })), null);
});

test("el PR de quien comparte el árbol se dice en la fila de la dueña", () => {
  assert.equal(cardPull(git({}, { shared_with: "padre" })), null);
});

test("el color sigue al estado del PR", () => {
  assert.deepEqual(cardPull(git()), { number: 42, state: "open", tone: "open", numberTone: "open" });
  assert.equal(cardPull(git({ state: "draft" }))?.tone, "muted");
  assert.equal(cardPull(git({ state: "closed" }))?.tone, "closed");
  assert.equal(cardPull(git({ state: "merged" }))?.tone, "merged");
  const otherHead = cardPull(git({ state: "merged", head_sha: "viejo" }));
  assert.equal(otherHead?.state, "merged_other_head");
  assert.equal(otherHead?.tone, "muted");
});

test("CI fallido: el número en rojo, solo si es del HEAD de ahora", () => {
  const failing = cardPull(git({ checks: "failure" }));
  assert.equal(failing?.numberTone, "failure");
  assert.equal(failing?.tone, "open");
  assert.equal(cardPull(git({ checks: "failure", head_sha: "otro" }))?.numberTone, "open");
  assert.equal(cardPull(git({ checks: "success" }))?.numberTone, "open");
});

test("git viejo: el número sigue, pero en gris y sin rojo", () => {
  const stale = cardPull(git({ checks: "failure" }, { stale: true }));
  assert.equal(stale?.number, 42);
  assert.equal(stale?.tone, "muted");
  assert.equal(stale?.numberTone, "muted");
});
