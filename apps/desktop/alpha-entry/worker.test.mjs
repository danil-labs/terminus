import test from "node:test";
import assert from "node:assert/strict";
import worker from "./worker.mjs";

const origin = "https://alfa-app.danil.ai";
const prefix = "/terminus/alpha-api";
const auth = { Authorization: "Bearer user.jwt" };
function harness() {
  const calls = [];
  const env = {
    APPV2_BFF: { fetch: async request => {
      calls.push(request);
      return Response.json({ ok: true }, { headers: { "Set-Cookie": "unsafe=1", "Cache-Control": "public" } });
    } },
    TERMINUS_WEB: { fetch: async request => {
      calls.push(request);
      return new Response("assets", { headers: { "Content-Security-Policy": "default-src 'self'" } });
    } },
  };
  return { calls, env, fetch: (path, options) => worker.fetch(new Request(origin + path, options), env) };
}

test("exact reads preserve identity headers and query, never cookies or cache headers", async () => {
  for (const path of ["/auth/profile", "/api/inbox/conversations?account_id=7&limit=30&offset=0", "/api/inbox/conversations/12/messages?account_id=7&limit=50&before_id=100"]) {
    const h = harness();
    const response = await h.fetch(prefix + path, { headers: { ...auth, Origin: origin, Referer: origin + "/terminus/inbox", Cookie: "legacy=1", "X-Account-Id": "99" } });
    assert.equal(response.status, 200);
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].url, origin + path);
    assert.equal(h.calls[0].headers.get("Origin"), origin);
    assert.equal(h.calls[0].headers.get("Referer"), origin + "/terminus/inbox");
    assert.equal(h.calls[0].headers.get("Authorization"), auth.Authorization);
    assert.equal(h.calls[0].headers.get("Cookie"), null);
    assert.equal(h.calls[0].headers.get("X-Account-Id"), null);
    assert.equal(response.headers.get("Set-Cookie"), null);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  }
});

test("writes and unknown BFF paths never reach either binding", async () => {
  const h = harness();
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]) {
    assert.equal((await h.fetch(prefix + "/auth/profile", { method })).status, 405);
  }
  for (const path of ["", "/", "/auth/account", "/auth/profile/", "/api/inbox/conversations/12/ai", "/api/inbox/conversations/0/messages", "/api/inbox/conversations/9007199254740992/messages", "/api/inbox/conversations/12/messages/", "/api/inbox/conversations/%31/messages"]) {
    assert.ok([400, 404].includes((await h.fetch(prefix + path, { headers: auth })).status));
  }
  assert.equal(h.calls.length, 0);
});

test("query requires bounded integers, rejects duplicate and undeclared fields", async () => {
  const h = harness();
  for (const query of ["", "account_id=-1", "account_id=1x", "account_id=1&account_id=2", "account_id=9007199254740992", "account_id=1&limit=101", "account_id=1&offset=100001", "account_id=1&target=https://evil.example", "account_id=1&channel_id=2"]) {
    assert.equal((await h.fetch(prefix + "/api/inbox/conversations?" + query, { headers: auth })).status, 400);
  }
  assert.equal((await h.fetch(prefix + "/auth/profile?account_id=1", { headers: auth })).status, 400);
  assert.equal(h.calls.length, 0);
});

test("missing JWT is rejected and upstream authorization failures stay failures", async () => {
  const h = harness();
  assert.equal((await h.fetch(prefix + "/auth/profile")).status, 401);
  assert.equal(h.calls.length, 0);
  for (const status of [401, 403, 404, 503]) {
    h.env.APPV2_BFF.fetch = async () => Response.json({ error: "denied" }, { status });
    assert.equal((await h.fetch(prefix + "/auth/profile", { headers: auth })).status, status);
  }
});

test("upstream redirects, HTML and transport failures fail closed", async () => {
  const h = harness();
  for (const response of [Response.redirect("https://evil.example"), new Response("login", { headers: { "Content-Type": "text/html" } })]) {
    h.env.APPV2_BFF.fetch = async () => response;
    assert.equal((await h.fetch(prefix + "/auth/profile", { headers: auth })).status, 502);
  }
  h.env.APPV2_BFF.fetch = async () => { throw new Error("offline"); };
  assert.equal((await h.fetch(prefix + "/auth/profile", { headers: auth })).status, 502);
});

test("assets preserve CSP and legacy paths are not handled", async () => {
  const h = harness();
  for (const path of ["/terminus/inbox", "/terminus/m/inbox", "/terminus/sign-in", "/terminus/m/sw.js"]) {
    const response = await h.fetch(path);
    assert.equal(await response.text(), "assets");
    assert.equal(response.headers.get("Content-Security-Policy"), "default-src 'self'");
  }
  h.calls.length = 0;
  for (const path of ["/", "/api/inbox/conversations", "/auth/profile", "/terminusx/"]) assert.equal((await h.fetch(path)).status, 404);
  assert.equal((await h.fetch("/terminus/inbox", { method: "POST" })).status, 405);
  assert.equal((await worker.fetch(new Request("https://app.danil.ai/terminus/inbox"), h.env)).status, 404);
  assert.equal(h.calls.length, 0);
});


test("bare Terminus path redirects locally without hitting bindings", async () => {
  const h = harness();
  for (const method of ["GET", "HEAD"]) {
    const response = await h.fetch("/terminus?next=https%3A%2F%2Fevil.example", { method });
    assert.equal(response.status, 308);
    assert.equal(response.headers.get("Location"), origin + "/terminus/?next=https%3A%2F%2Fevil.example");
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  }
  assert.equal((await h.fetch("/terminus", { method: "POST" })).status, 405);
  assert.equal(h.calls.length, 0);
});


test("mobile inbox deep link serves the phone entry rather than global SPA fallback", async () => {
  const h = harness();
  for (const path of ["inbox", "inbox-thread", "inbox-detail", "personalize", "broadcasts", "channels", "attention-agents"]) for (const method of ["GET", "HEAD"]) {
    await h.fetch(`/terminus/m/${path}?demo=1`, { method });
    const forwarded = h.calls.at(-1);
    assert.equal(forwarded.url, origin + "/terminus/m/?demo=1");
    assert.equal(forwarded.method, method);
  }
});
