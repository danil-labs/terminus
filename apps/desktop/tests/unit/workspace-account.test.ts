import assert from "node:assert/strict";
import test from "node:test";
import { resolveWorkspaceAccount } from "../../../../packages/attention/src/workspace-account.ts";

const accounts = [{ id: 1, name: "Danil" }, { id: 2, name: "Ventas" }, { id: 3, name: "Ventas" }, { id: 4, name: "Danil Workspace" }];
const resolve = (workspace: string | null, active: number | null) =>
  resolveWorkspaceAccount(workspace, { accounts: async () => accounts, active: async () => active });

test("the same name that is also the active account resolves", async () => {
  assert.deepEqual(await resolve(" danil ", 1), { id: 1, name: "Danil" });
});

test("anything less resolves to nothing, never to another account", async () => {
  assert.equal(await resolve(null, 1), null);
  assert.equal(await resolve("", 1), null);
  assert.equal(await resolve("Acme", 1), null);
  assert.equal(await resolve("Danil", 4), null, "not the active account");
  assert.equal(await resolve("Danil", null), null);
  assert.equal(await resolve("Ventas", 2), null, "ambiguous name");
});

test("a partial name is not a match", async () => {
  assert.equal(await resolve("Danil", 4), null);
  assert.equal(await resolve("Workspace", 4), null);
});
