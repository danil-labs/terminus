import assert from "node:assert/strict";
import { test } from "node:test";
import "../helpers/catalog.ts";
import { elegirLengua } from "../../src/lib/i18n.ts";
import {
  applySidebarView,
  DEFAULT_SIDEBAR_VIEW,
  groupLabel,
  loadSidebarView,
  nonDefaultCount,
  saveSidebarView,
  scopeLabel,
  sectionOf,
  type SidebarTask,
  type SidebarView,
} from "../../src/lib/sidebarView.ts";

const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  },
});

const task = (id: string, extra: Partial<SidebarTask> = {}): SidebarTask => ({
  id,
  esperando: false,
  folder: "terminus",
  agent: null,
  ...extra,
});

const idle = { live: [] as string[], approving: [] as string[] };
const ids = (tasks: SidebarTask[]) => tasks.map((x) => x.id);
const view = (extra: Partial<SidebarView>): SidebarView => ({ ...DEFAULT_SIDEBAR_VIEW, ...extra });

test("a task needs you when it waits for approval, asked something or failed", () => {
  assert.equal(sectionOf(task("a"), { live: [], approving: ["a"] }), "needs_you");
  assert.equal(sectionOf(task("a", { esperando: true }), idle), "needs_you");
  assert.equal(sectionOf(task("a", { outcome: "failed" }), idle), "needs_you");
  assert.equal(sectionOf(task("a", { outcome: "failed" }), { live: new Set(["a"]), approving: [] }), "active", "a live turn hides the old failure");
});

test("delivered and seen, or done, settles; unseen and live stay active", () => {
  assert.equal(sectionOf(task("a", { outcome: "delivered" }), idle), "settled");
  assert.equal(sectionOf(task("a", { stage: "done" }), idle), "settled");
  assert.equal(sectionOf(task("a", { outcome: "delivered", sin_ver: true }), idle), "active");
  assert.equal(sectionOf(task("a", { stage: "done" }), { live: ["a"], approving: [] }), "active");
  assert.equal(sectionOf(task("a"), idle), "active");
  assert.equal(
    sectionOf(task("a", { delegated_activity: { aprobando: true, esperando: false, viva: false } }), idle),
    "needs_you",
    "delegated activity wins over the row",
  );
});

test("without grouping there are always three sections, pinned first, order kept", () => {
  const tasks = [
    task("new"),
    task("asks", { esperando: true }),
    task("pinned", { pinned: true }),
    task("done", { outcome: "delivered" }),
    task("archived", { archived: true }),
    task("chat", { chat_de_agente: true }),
  ];
  const groups = applySidebarView(tasks, DEFAULT_SIDEBAR_VIEW, idle);
  assert.deepEqual(groups.map((g) => g.key), ["needs_you", "active", "settled"]);
  assert.deepEqual(ids(groups[0].tasks), ["asks"]);
  assert.deepEqual(ids(groups[1].tasks), ["pinned", "chat", "new"]);
  assert.deepEqual(ids(groups[2].tasks), ["done"]);
  assert.deepEqual(ids(applySidebarView([], DEFAULT_SIDEBAR_VIEW, idle)[0].tasks), []);
});

test("folders and agent filter before grouping", () => {
  const tasks = [
    task("a", { folder: "terminus", agent: "ada" }),
    task("b", { folder: "web", agent: "ada" }),
    task("c", { folder: "terminus", agent: "bob" }),
    task("d", { folder: null }),
  ];
  const all = (v: SidebarView) => applySidebarView(tasks, v, idle).flatMap((g) => ids(g.tasks));
  assert.deepEqual(all(view({ folders: ["terminus"] })), ["a", "c"]);
  assert.deepEqual(all(view({ agent: "ada" })), ["a", "b"]);
  assert.deepEqual(all(view({ folders: ["web", "terminus"], agent: "bob" })), ["c"]);
  assert.deepEqual(
    applySidebarView(tasks, view({ folders: ["x"] }), { ...idle, folderOf: (x) => (x.id === "d" ? "x" : null) })
      .flatMap((g) => ids(g.tasks)),
    ["d"],
  );
});

test("grouping keeps only non-empty groups, then the settled section", () => {
  const tasks = [
    task("a", { folder: "web", agent: "ada" }),
    task("b", { folder: null, esperando: true }),
    task("c", { folder: "terminus", agent: "bob" }),
    task("d", { folder: "web", pinned: true }),
    task("e", { folder: "web", outcome: "delivered" }),
  ];
  const byFolder = applySidebarView(tasks, view({ group: "folder" }), idle);
  assert.deepEqual(byFolder.map((g) => `${g.kind}:${g.key}`), ["folder:web", "folder:terminus", "folder:", "section:settled"]);
  assert.deepEqual(ids(byFolder[0].tasks), ["d", "a"]);
  assert.deepEqual(ids(byFolder[3].tasks), ["e"]);

  const byStatus = applySidebarView(tasks, view({ group: "status" }), { live: ["c"], approving: [] });
  assert.deepEqual(byStatus.map((g) => g.key), ["asked", "working", "idle", "settled"]);

  const byAgent = applySidebarView(tasks, view({ group: "agent" }), idle);
  assert.deepEqual(byAgent.map((g) => g.key), ["ada", "bob", "", "settled"]);
  assert.deepEqual(ids(byAgent[2].tasks), ["d", "b"]);
});

test("the view survives a restart and bad data falls back to the default", () => {
  store.clear();
  assert.deepEqual(loadSidebarView(), DEFAULT_SIDEBAR_VIEW);
  const chosen = view({ folders: ["terminus"], agent: "ada", group: "status", density: "compact" });
  saveSidebarView(chosen);
  assert.deepEqual(loadSidebarView(), chosen);
  store.set("harness.layout.sidebar.view", "{broken");
  assert.deepEqual(loadSidebarView(), DEFAULT_SIDEBAR_VIEW);
  store.set("harness.layout.sidebar.view", JSON.stringify({ folders: ["a", 3, "a"], agent: 7, group: "size", density: "compact" }));
  assert.deepEqual(loadSidebarView(), view({ folders: ["a"], density: "compact" }));
});

test("the badge counts each setting away from its default", () => {
  assert.equal(nonDefaultCount(DEFAULT_SIDEBAR_VIEW), 0);
  assert.equal(nonDefaultCount(view({ folders: ["a", "b"] })), 1);
  assert.equal(nonDefaultCount(view({ folders: ["a"], agent: "ada", group: "agent", density: "compact" })), 4);
});

test("the scope line says what is shown, in the app language", () => {
  const name = (id: string) => ({ f1: "terminus", f2: "web" })[id] ?? id;
  elegirLengua("es");
  assert.equal(scopeLabel(DEFAULT_SIDEBAR_VIEW, name), "Todas las carpetas");
  assert.equal(scopeLabel(view({ folders: ["f1"], group: "status" }), name), "terminus · por estado");
  assert.equal(scopeLabel(view({ folders: ["f1", "f2"], agent: "ada" }), name), "terminus, web · ada");
  assert.equal(groupLabel({ kind: "folder", key: "", tasks: [] }, name), "Sin carpeta");
  assert.equal(groupLabel({ kind: "section", key: "needs_you", tasks: [] }, name), "Te necesitan");
  elegirLengua("en");
  assert.equal(scopeLabel(view({ group: "agent" }), name), "All folders · by agent");
  elegirLengua("es");
});
