/**
 * La bitácora de cambios en la web: la cuenta sale del claim `active_account_id`
 * de la sesión, la llamada va a `rpc/audit_log_list` con la llave pública y el
 * token, y la página pide las anteriores por `before_id`. Sin cuenta activa no
 * llama; `42501` es falta de permiso; una fila con forma rara se descarta.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { AUDIT_PAGE, activeAccountOf, webAuditLog } from "../../src/web/audit-log.ts";

const b64url = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
const jwt = (claims: Record<string, unknown>) => `${b64url({ alg: "ES256" })}.${b64url(claims)}.firma`;
const row = (id: number, extra: Record<string, unknown> = {}) => ({
  id, created_at: "2026-10-30T12:00:00Z", event_type: "agents.update", entity_type: "agents", entity_id: "7",
  action: "update", changed_fields: ["assistant_name"], details: { assistant_name: "Recepción" },
  actor_type: "member", actor_name: "Ana", actor_email: "ana@ejemplo.com",
  on_behalf_of_name: null, on_behalf_of_email: null, support_grant_id: null, ...extra,
});

function server(reply: (body: Record<string, unknown>) => { status: number; json: unknown }) {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const f = async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    calls.push({ url, headers: init?.headers as Record<string, string>, body });
    const { status, json } = reply(body);
    return new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
  };
  return { f, calls };
}

test("lee la cuenta activa del token", () => {
  assert.equal(activeAccountOf(jwt({ sub: "u", active_account_id: 42 })), 42);
  assert.equal(activeAccountOf(jwt({ sub: "u", active_account_id: "42" })), 42);
  assert.equal(activeAccountOf(jwt({ sub: "u" })), null);
  assert.equal(activeAccountOf("no-es-un-jwt"), null);
});

test("pide la página con la sesión y la llave pública, y la siguiente por before_id", async () => {
  const full = Array.from({ length: AUDIT_PAGE }, (_, i) => row(100 - i));
  const { f, calls } = server((body) => ({ status: 200, json: body.p_before_id ? [row(10, { actor_type: "ai", actor_name: null, actor_email: null, on_behalf_of_name: "Ana" })] : full }));
  const source = webAuditLog("https://api.danil.test/", "sb_publishable_x", () => jwt({ active_account_id: 7 }), undefined, f);

  const first = await source.list();
  assert.equal(first.kind, "ok");
  assert.ok(first.kind === "ok" && first.more && first.entries.length === AUDIT_PAGE);
  assert.equal(calls[0].url, "https://api.danil.test/rest/v1/rpc/audit_log_list");
  assert.equal(calls[0].headers.apikey, "sb_publishable_x");
  assert.match(calls[0].headers.authorization, /^Bearer /);
  assert.deepEqual(calls[0].body, { p_account_id: 7, p_before_id: null, p_limit: AUDIT_PAGE });

  const next = await source.list(51);
  assert.deepEqual(calls[1].body, { p_account_id: 7, p_before_id: 51, p_limit: AUDIT_PAGE });
  assert.ok(next.kind === "ok" && !next.more && next.entries[0].actor_type === "ai" && next.entries[0].on_behalf_of_name === "Ana");
});

test("sin cuenta activa no llama", async () => {
  const { f, calls } = server(() => ({ status: 200, json: [] }));
  const page = await webAuditLog("https://api.danil.test", "k", () => jwt({ sub: "u" }), undefined, f).list();
  assert.equal(page.kind, "no_account");
  assert.equal(calls.length, 0);
});

test("sin audit.read es falta de permiso; otros fallos, no disponible; 401 avisa a la sesión", async () => {
  let gone = 0;
  const forbidden = server(() => ({ status: 403, json: { code: "42501", message: "forbidden" } }));
  assert.equal((await webAuditLog("https://a", "k", () => jwt({ active_account_id: 1 }), undefined, forbidden.f).list()).kind, "forbidden");
  const broken = server(() => ({ status: 500, json: { code: "XX000" } }));
  assert.equal((await webAuditLog("https://a", "k", () => jwt({ active_account_id: 1 }), undefined, broken.f).list()).kind, "unavailable");
  const expired = server(() => ({ status: 401, json: { code: "PGRST301" } }));
  assert.equal((await webAuditLog("https://a", "k", () => jwt({ active_account_id: 1 }), () => gone++, expired.f).list()).kind, "unavailable");
  assert.equal(gone, 1);
  const offline = webAuditLog("https://a", "k", () => jwt({ active_account_id: 1 }), undefined, async () => { throw new TypeError("network"); });
  assert.equal((await offline.list()).kind, "unavailable");
});

test("descarta filas con forma rara y conserva los tipos de actor conocidos", async () => {
  const { f } = server(() => ({ status: 200, json: [row(3), row(2, { actor_type: "hacker" }), { id: "x" }, row(1, { actor_type: "danil_support", support_grant_id: 9, changed_fields: "value" })] }));
  const page = await webAuditLog("https://a", "k", () => jwt({ active_account_id: 1 }), undefined, f).list();
  assert.ok(page.kind === "ok");
  assert.deepEqual(page.entries.map((e) => [e.id, e.actor_type]), [[3, "member"], [1, "danil_support"]]);
  assert.deepEqual(page.entries[1].changed_fields, []);
  assert.equal(page.entries[1].support_grant_id, 9);
});
