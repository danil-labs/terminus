import assert from "node:assert/strict";
import { test } from "node:test";
import { accountKind, menuFor, type Section, visibleSections } from "../../src/web/admin/sections.ts";

const ALL = new Set<Section>(["general", "usage", "members", "support", "audit", "skills", "mcp", "agents", "rules", "workspaces", "plan", "identity"]);

test("the plan decides the kind of account; without one, no organization means personal", () => {
  assert.equal(accountKind({ organization: "Danil", plan: "Enterprise" }), "enterprise");
  assert.equal(accountKind({ organization: "Danil", plan: "Teams" }), "teams");
  assert.equal(accountKind({ organization: "Danil", plan: null }), "teams");
  assert.equal(accountKind({ organization: null, plan: null }), "personal");
  assert.equal(accountKind({ organization: null, plan: "Personal" }), "personal");
});

test("personal keeps its own usage and sees nothing of a team or organization", () => {
  const visible = visibleSections("personal", true, ALL);
  assert.ok(visible.includes("usage"));
  for (const section of ["members", "skills", "mcp", "agents", "rules", "workspaces", "identity"] as const) assert.ok(!visible.includes(section), section);
});

test("a member only reads usage and what governs their work", () => {
  assert.deepEqual(visibleSections("teams", false, ALL), ["usage", "skills", "mcp", "agents", "rules"]);
});

test("only enterprise reaches identity, and only when it exists", () => {
  assert.ok(!visibleSections("teams", true, ALL).includes("identity"));
  assert.ok(visibleSections("enterprise", true, ALL).includes("identity"));
  assert.ok(!visibleSections("enterprise", true, new Set(["general"])).includes("identity"));
});

test("real accounts today: only what has a source appears, and a member has nothing", () => {
  const live = new Set<Section>(["general", "support", "audit"]);
  assert.deepEqual(visibleSections("teams", true, live), ["general", "support", "audit"]);
  assert.deepEqual(visibleSections("teams", false, live), []);
});

test("every order lists each section once and drops empty groups", () => {
  for (const order of ["scope", "task", "flat"] as const) {
    const sections = menuFor(order, [...ALL]).flatMap((entry) => entry.sections);
    assert.deepEqual([...sections].sort(), [...ALL].sort());
    assert.deepEqual(menuFor(order, ["general"]).map((entry) => entry.sections), [["general"]]);
  }
});
