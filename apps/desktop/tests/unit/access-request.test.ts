/**
 * La solicitud de acceso en la web: el cliente de `/auth/access-request` por el
 * proxy de alfa contra un `fetch` falso.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { validPhone, webAccessRequest } from "../../src/web/access-request.ts";

function fake(handler: (n: number) => { status: number; body?: unknown }) {
  const seen: { url: string; init: RequestInit }[] = [];
  const f = async (url: string, init: RequestInit = {}) => {
    seen.push({ url, init });
    const { status, body } = handler(seen.length);
    return new Response(body === undefined ? "" : JSON.stringify(body), { status });
  };
  return { f, seen };
}

const session = (refresh = true) => {
  const calls = { refresh: 0 };
  return { calls, getToken: async () => `tok${calls.refresh}`, unauthorized: async () => (calls.refresh++, refresh) };
};
const draft = { phone: " +52 999 123 4567 ", name: "  ", company: " Acme ", locale: "es" as const };

test("requested reads the proxy with the session", async () => {
  const { f, seen } = fake(() => ({ status: 200, body: { requested: true, requested_at: "2026-10-30T00:00:00Z" } }));
  assert.equal(await webAccessRequest(session(), "/alpha-api", f).requested(), true);
  assert.equal(seen[0].url, "/alpha-api/auth/access-request");
  assert.equal(seen[0].init.method, "GET");
  assert.equal((seen[0].init.headers as Record<string, string>).Authorization, "Bearer tok0");
});

test("send posts only its fields, trimmed, without the email", async () => {
  const { f, seen } = fake(() => ({ status: 200, body: { ok: true } }));
  await webAccessRequest(session(), "/alpha-api", f).send(draft);
  assert.deepEqual(JSON.parse(String(seen[0].init.body)), { phone: "+52 999 123 4567", locale: "es", company: "Acme" });
});

test("a refused token is refreshed once; other failures throw", async () => {
  const { f, seen } = fake((n) => (n === 1 ? { status: 401 } : { status: 200, body: { requested: false } }));
  const s = session();
  assert.equal(await webAccessRequest(s, "/alpha-api", f).requested(), false);
  assert.equal(s.calls.refresh, 1);
  assert.equal((seen[1].init.headers as Record<string, string>).Authorization, "Bearer tok1");
  const down = fake(() => ({ status: 503, body: { error: "access_request_unavailable" } }));
  await assert.rejects(webAccessRequest(session(), "/alpha-api", down.f).send(draft));
});

test("validPhone follows the BFF", () => {
  for (const ok of ["+52 999 123 4567", "(999) 123-4567", "12345678", "1".repeat(15)]) assert.equal(validPhone(ok), true, ok);
  for (const bad of ["", "1234567", "1".repeat(16), "tel 9991234567", "+52+999123456"]) assert.equal(validPhone(bad), false, bad);
});
