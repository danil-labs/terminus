import assert from "node:assert/strict";
import test from "node:test";

const { descendientes: descendants, esChatDeAgente: isAgentChat, taskTree } = await import("../src/features/projects/taskTree.ts");

test("archivar una hija no archiva a su padre ni a sus hermanas", () => {
  const parent = { id: "parent", parent: null, archived: false };
  const child = { id: "child", parent: "parent", archived: true };
  const sibling = { id: "sibling", parent: "parent", archived: false };
  const sessions = [parent, child, sibling];
  assert.deepEqual(taskTree(sessions, false), [{ tarea: parent, hijas: [{ tarea: sibling, hijas: [] }] }]);
  assert.deepEqual(taskTree(sessions, true), [{ tarea: child, hijas: [] }]);
});

test("una subtarea de una subtarea cuelga de su padre, no se vuelve raíz", () => {
  const root = { id: "raiz", parent: null, archived: false };
  const child = { id: "hija", parent: "raiz", archived: false };
  const grandchild = { id: "nieta", parent: "hija", archived: false };
  const greatGrandchild = { id: "bisnieta", parent: "nieta", archived: false };
  const tree = taskTree([root, child, grandchild, greatGrandchild], false);
  assert.equal(tree.length, 1);
  assert.deepEqual(
    descendants(tree[0]).map((t) => t.id),
    ["hija", "nieta", "bisnieta"],
  );
  assert.equal(tree[0].hijas[0].hijas[0].tarea, grandchild);
});

test("una nieta que cambia renueva la cadena de sus ancestros, no las demás ramas", () => {
  const root = { id: "raiz", parent: null, archived: false };
  const child = { id: "hija", parent: "raiz", archived: false };
  const grandchild = { id: "nieta", parent: "hija", archived: false };
  const standalone = { id: "sola", parent: null, archived: false };
  const before = taskTree([root, child, grandchild, standalone], false);
  const same = taskTree([root, child, grandchild, standalone], false, before);
  assert.equal(same[0], before[0]);
  const after = taskTree([root, child, { ...grandchild }, standalone], false, before);
  assert.notEqual(after[0], before[0]);
  assert.notEqual(after[0].hijas[0], before[0].hijas[0]);
  assert.equal(after[1], before[1]);
});

test("una nieta con la hija archivada aparte se pinta como raíz del otro grupo", () => {
  const root = { id: "raiz", parent: null, archived: false };
  const child = { id: "hija", parent: "raiz", archived: true };
  const grandchild = { id: "nieta", parent: "hija", archived: true };
  assert.deepEqual(taskTree([root, child, grandchild], true), [
    { tarea: child, hijas: [{ tarea: grandchild, hijas: [] }] },
  ]);
});

test("los historiales antiguos siguen disponibles y las tareas con arquetipo son tareas", () => {
  assert.equal(isAgentChat({ chat_de_agente: true }), true);
  assert.equal(isAgentChat({ chat_de_agente: false }), false);
  assert.equal(isAgentChat({}), false);
  const chat = { id: "chat", parent: null, chat_de_agente: true, archived: false };
  const withArchetype = {
    id: "con-arquetipo",
    parent: null,
    encargado: "Holmes",
    chat_de_agente: false,
    archived: false,
  };
  const task = { id: "tarea", parent: null, archived: false };
  assert.deepEqual(taskTree([chat, withArchetype, task], false), [
    { tarea: withArchetype, hijas: [] },
    { tarea: task, hijas: [] },
  ]);
  assert.deepEqual(taskTree([chat, withArchetype, task], false, undefined, true), [
    { tarea: chat, hijas: [] },
    { tarea: withArchetype, hijas: [] },
    { tarea: task, hijas: [] },
  ]);
});

const { canFinishTask, effectiveTaskGit, UNKNOWN_GIT } = await import("../src/features/projects/taskGit.ts");
const merged = {
  ...UNKNOWN_GIT,
  kind: "branch" as const,
  branch: "feat/example",
  head: "merged-commit",
  pull_known: true,
  pull: { number: 7, state: "merged" as const, head_sha: "merged-commit" },
};

test("finalizar exige el commit mergeado actual y una observación vigente", () => {
  assert.equal(canFinishTask({}, merged, false), true);
  for (const status of [
    UNKNOWN_GIT,
    { ...merged, head: "new-commit" },
    { ...merged, head: null },
    { ...merged, stale: true },
    { ...merged, pull_known: false },
    { ...merged, pull: { ...merged.pull, state: "open" as const } },
    { ...merged, pull: { ...merged.pull, state: "closed" as const } },
  ]) assert.equal(canFinishTask({}, status, false), false);
});

test("sin PR, finalizar acepta la rama integrada en su base local", () => {
  const local = { ...UNKNOWN_GIT, kind: "branch" as const, branch: "feature/mul", head: "c3fd21d", merged_locally: true };
  assert.equal(canFinishTask({}, local, false), true, "sin remoto no hay PR que esperar");
  assert.equal(canFinishTask({}, { ...local, has_remote: true, pull_known: true }, false), true);
  for (const status of [
    { ...local, merged_locally: false },
    { ...local, has_remote: true },
    { ...local, stale: true },
    { ...local, kind: "detached" as const },
    { ...merged, merged_locally: true, pull: { ...merged.pull, state: "closed" as const } },
    { ...merged, merged_locally: true, head: "new-commit" },
  ]) assert.equal(canFinishTask({}, status, false), false);
});

test("no se finalizan tareas archivadas o en vuelo", () => {
  assert.equal(canFinishTask({ archived: true }, merged, false), false);
  assert.equal(canFinishTask({ subagent: "native-child" }, merged, false), true);
  assert.equal(canFinishTask({}, merged, true), false);
});

test("subtareas compartidas y nativas heredan el estado efectivo del padre", () => {
  const parent = { id: "parent", parent: null };
  const native = { id: "native", parent: "parent", subagent: "native-id" };
  const shared = { id: "shared", parent: "parent" };
  const sessions = [parent, native, shared];
  const rows = { parent: merged, shared: { ...UNKNOWN_GIT, shared_with: "parent" } };
  assert.equal(canFinishTask(native, effectiveTaskGit(native, rows, sessions), false), true);
  assert.equal(canFinishTask({}, effectiveTaskGit(shared, rows, sessions), false), true);
  assert.equal(effectiveTaskGit(shared, rows, sessions).shared_with, "parent");
  const stale = { ...rows, parent: { ...merged, stale: true } };
  assert.equal(canFinishTask(native, effectiveTaskGit(native, stale, sessions), false), false);
  const saved = { ...rows, parent: { ...UNKNOWN_GIT, kind: "kn" as const, kn: "saved" as const } };
  assert.equal(canFinishTask(native, effectiveTaskGit(native, saved, sessions), false), true);
});

test("si el padre kn ya guardó, la hija se puede finalizar aunque su copia esté limpia o en borrador", () => {
  const parent = { id: "parent", parent: null };
  const native = { id: "native", parent: "parent", subagent: "native-id" };
  const sessions = [parent, native];
  const saved = { ...UNKNOWN_GIT, kind: "kn" as const, kn: "saved" as const };
  const clean = { ...UNKNOWN_GIT, kind: "kn" as const, kn: "clean" as const };
  const draft = { ...UNKNOWN_GIT, kind: "kn" as const, kn: "draft" as const };
  const inherited = { parent: saved, native: clean };
  assert.equal(effectiveTaskGit(native, inherited, sessions).kn, "saved");
  assert.equal(canFinishTask(native, effectiveTaskGit(native, inherited, sessions), false), true);
  const dirty = { parent: saved, native: draft };
  assert.equal(effectiveTaskGit(native, dirty, sessions).kn, "saved");
  assert.equal(canFinishTask(native, effectiveTaskGit(native, dirty, sessions), false), true);
  const rootDraft = { parent: draft };
  assert.equal(canFinishTask({}, effectiveTaskGit(parent, rootDraft, [parent]), false), false);
});
