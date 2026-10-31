import assert from "node:assert/strict";
import test from "node:test";
import worker from "../../alpha-entry/worker.mjs";

const origin = "https://alfa-app.danil.ai";
const bff = (seen) => ({ fetch: async (request) => { seen.push(request); return Response.json({ ok: true }); } });
const read = (path, env, init = {}) =>
  worker.fetch(new Request(`${origin}/alpha-api${path}`, { headers: { Authorization: "Bearer token" }, ...init }), env);

test("customer service reads reach the BFF without a query", async () => {
  for (const path of ["/api/agents", "/api/agents/7", "/api/agents/7/connections", "/api/calendar/connections", "/api/http_tools", "/api/account_variables"]) {
    const seen = [];
    const response = await read(path, { APPV2_BFF: bff(seen) });
    assert.equal(response.status, 200, path);
    assert.equal(new URL(seen[0].url).pathname, path);
    assert.equal(new URL(seen[0].url).search, "");
  }
});

test("the list stays closed around those reads", async () => {
  const seen = [];
  const env = { APPV2_BFF: bff(seen) };
  for (const path of ["/api/agents/7/test-chat", "/api/agents/0", "/api/agents/abc", "/api/agents/configurations", "/api/calendar/1/agents", "/api/account_variables/KEY", "/api/http_tools/agent-tools"]) {
    assert.equal((await read(path, env)).status, 404, path);
  }
  assert.equal((await read("/api/agents?include=available", env)).status, 400);
  assert.equal((await read("/api/agents/99999999999999999999", env)).status, 400);
  assert.equal((await read("/api/agents/7", env, { method: "PATCH", body: "{}" })).status, 405);
  assert.equal(seen.length, 0);
});

test("without a session nothing is forwarded", async () => {
  const seen = [];
  const response = await worker.fetch(new Request(`${origin}/alpha-api/api/agents`), { APPV2_BFF: bff(seen) });
  assert.equal(response.status, 401);
  assert.equal(seen.length, 0);
});
