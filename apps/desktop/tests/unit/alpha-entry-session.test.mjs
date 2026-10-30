import test from "node:test";
import assert from "node:assert/strict";
import worker from "../../alpha-entry/worker.mjs";
import { safeNext } from "../../alpha-entry/session.mjs";

const origin = "https://alfa-app.danil.ai";
const supabaseUrl = "https://project.supabase.co";
const uuid = "6f1c2b8e-3a4d-4e5f-8a9b-0c1d2e3f4a5b";
const b64url = bytes => Buffer.from(bytes).toString("base64url");
const decode = part => JSON.parse(Buffer.from(part, "base64url").toString());

const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const privateJwk = { ...(await crypto.subtle.exportKey("jwk", pair.privateKey)), kid: "danil-alfa-test" };
const workosAccess = `${b64url(Buffer.from("{}"))}.${b64url(Buffer.from(JSON.stringify({ sid: "session_01ABC", sub: "user_01ABC" })))}.sig`;

/** WorkOS and Supabase as the Worker sees them; `state` changes what each answers. */
function world(overrides = {}) {
  const state = {
    workosUser: { id: "user_01ABC", email: "Prueba@danil.ai", email_verified: true, first_name: "Prueba", last_name: "Danil" },
    sessions: [{ id: "session_01ABC", user_id: "user_01ABC", status: "active", ended_at: null, expires_at: new Date(Date.now() + 3_600_000).toISOString() }],
    person: 42,
    row: { id: 42, uuid, email: "prueba@danil.ai", name: "Prueba", merged_into_user_id: null },
    login: { id: uuid, banned_until: null },
    account: 7,
    workosDown: false,
    ...overrides,
  };
  const calls = [];
  const fetch = async (input, init = {}) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    calls.push({ url: request.url, method: request.method, headers: request.headers, body: init.body ?? null });
    if (url.origin === "https://api.workos.com") {
      if (state.workosDown) throw new TypeError("network");
      assert.equal(request.headers.get("Authorization"), "Bearer sk_test");
      if (url.pathname === "/user_management/authenticate") {
        const body = JSON.parse(init.body);
        if (body.code !== "code_ok") return Response.json({ error: "invalid_grant" }, { status: 400 });
        return Response.json({ user: { id: "user_01ABC" }, access_token: workosAccess, refresh_token: "rt", authentication_method: "GoogleOAuth" });
      }
      if (url.pathname === "/user_management/users/user_01ABC") return Response.json(state.workosUser);
      if (url.pathname === "/user_management/users/user_01ABC/sessions") return Response.json({ data: state.sessions, list_metadata: { after: null } });
      return Response.json({}, { status: 404 });
    }
    if (url.origin === supabaseUrl) {
      assert.equal(request.headers.get("apikey"), "service");
      if (url.pathname === "/rest/v1/rpc/resolve_login") return Response.json(state.person);
      if (url.pathname === "/rest/v1/users") return Response.json(state.row ? [state.row] : []);
      if (url.pathname === `/auth/v1/admin/users/${uuid}`) return state.login ? Response.json(state.login) : Response.json({}, { status: 404 });
      if (url.pathname === "/rest/v1/rpc/custom_access_token_hook") {
        const { event } = JSON.parse(init.body);
        assert.equal(event.user_id, uuid);
        return Response.json({ ...event, claims: { ...event.claims, ...(state.account ? { active_account_id: state.account } : {}) } });
      }
    }
    return Response.json({}, { status: 500 });
  };
  const env = {
    WORKOS_CLIENT_ID: "client_01TEST",
    WORKOS_API_KEY: "sk_test",
    SUPABASE_URL: supabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: "service",
    DANIL_SIGNING_JWK: JSON.stringify(privateJwk),
    SESSION_COOKIE_KEY: b64url(Buffer.alloc(32, 7)),
    TERMINUS_WEB: { fetch: async () => new Response("assets") },
  };
  return { state, calls, env, fetch };
}

async function withFetch(w, run) {
  const original = globalThis.fetch;
  globalThis.fetch = w.fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

const call = (w, path, init = {}) => withFetch(w, () => worker.fetch(new Request(origin + path, { redirect: "manual", ...init }), w.env));
const cookiesOf = response => response.headers.getSetCookie().map(c => c.split(";")[0]);
const cookieHeader = response => cookiesOf(response).filter(c => !c.endsWith("=")).join("; ");

async function signedIn(w, next = "/terminus/inbox") {
  const started = await call(w, `/terminus/auth/workos/start?provider=GoogleOAuth&next=${encodeURIComponent(next)}`);
  const state = new URL(started.headers.get("Location")).searchParams.get("state");
  const back = await call(w, `/terminus/auth/workos/callback?code=code_ok&state=${state}`, { headers: { Cookie: cookieHeader(started) } });
  return { started, back, cookie: cookieHeader(back) };
}

const session = (w, cookie, headers = {}) => call(w, "/terminus/auth/session", { method: "POST", headers: { Origin: origin, Cookie: cookie, ...headers } });

test("start sends to WorkOS with PKCE and a sealed, host-only flow cookie", async () => {
  const w = world();
  const response = await call(w, "/terminus/auth/workos/start?provider=MicrosoftOAuth&next=/terminus/inbox");
  assert.equal(response.status, 303);
  const location = new URL(response.headers.get("Location"));
  assert.equal(location.origin + location.pathname, "https://api.workos.com/user_management/authorize");
  assert.equal(location.searchParams.get("client_id"), "client_01TEST");
  assert.equal(location.searchParams.get("redirect_uri"), `${origin}/terminus/auth/workos/callback`);
  assert.equal(location.searchParams.get("provider"), "MicrosoftOAuth");
  assert.equal(location.searchParams.get("code_challenge_method"), "S256");
  const cookie = response.headers.getSetCookie()[0];
  assert.match(cookie, /^__Host-danil_alfa_flow=[\w-]+\.[\w-]+; Path=\/; Max-Age=600; HttpOnly; Secure; SameSite=Lax$/);
  assert.ok(!cookie.includes(location.searchParams.get("state")));
  assert.equal((await call(w, "/terminus/auth/workos/start?provider=GitHubOAuth")).status, 400);
  assert.equal((await call(w, "/terminus/auth/workos/start", { method: "POST" })).status, 405);
});

test("callback opens a session and the session mints a Supabase-shaped token signed by the project key", async () => {
  const w = world();
  const { back, cookie } = await signedIn(w);
  assert.equal(back.status, 303);
  assert.equal(back.headers.get("Location"), `${origin}/terminus/inbox`);
  assert.match(cookie, /^__Host-danil_alfa=/);
  const authenticate = w.calls.find(c => c.url.endsWith("/user_management/authenticate"));
  const sent = JSON.parse(authenticate.body);
  assert.equal(sent.grant_type, "authorization_code");
  assert.ok(sent.code_verifier.length >= 43);
  assert.equal(sent.client_secret, "sk_test");

  const response = await session(w, cookie);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const body = await response.json();
  assert.deepEqual(body.user, { user_id: uuid, email: "prueba@danil.ai", name: "Prueba" });
  const [head, claims, signature] = body.access_token.split(".");
  assert.deepEqual(decode(head), { alg: "ES256", kid: "danil-alfa-test", typ: "JWT" });
  const verified = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pair.publicKey, Buffer.from(signature, "base64url"), new TextEncoder().encode(`${head}.${claims}`));
  assert.ok(verified);
  const c = decode(claims);
  assert.equal(c.iss, `${supabaseUrl}/auth/v1`);
  assert.equal(c.sub, uuid);
  assert.equal(c.aud, "authenticated");
  assert.equal(c.role, "authenticated");
  assert.equal(c.email, "prueba@danil.ai");
  assert.equal(c.active_account_id, 7);
  assert.equal(c.is_anonymous, false);
  assert.equal(c.exp - c.iat, 600);
  assert.equal(body.expires_at, c.exp);
  assert.match(c.session_id, /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal((await (await session(w, cookie)).json()).access_token.split(".").length, 3);
  const resolve = JSON.parse(w.calls.find(x => x.url.endsWith("/rpc/resolve_login")).body);
  assert.deepEqual(resolve, { p_provider: "workos", p_subject: "user_01ABC", p_email: "prueba@danil.ai", p_email_verified: true, p_name: "Prueba Danil" });
});

test("a person without an active account still gets a token, without the claim", async () => {
  const w = world({ account: null });
  const { cookie } = await signedIn(w);
  const claims = decode((await (await session(w, cookie)).json()).access_token.split(".")[1]);
  assert.equal("active_account_id" in claims, false);
});

test("callback refuses a forged state, a missing flow cookie and a refused code", async () => {
  const w = world();
  const started = await call(w, "/terminus/auth/workos/start");
  const state = new URL(started.headers.get("Location")).searchParams.get("state");
  for (const [query, cookie] of [[`code=code_ok&state=x${state.slice(1)}`, cookieHeader(started)], [`code=code_ok&state=${state}`, ""], [`code=bad&state=${state}`, cookieHeader(started)], [`error=access_denied&state=${state}`, cookieHeader(started)]]) {
    const response = await call(w, `/terminus/auth/workos/callback?${query}`, { headers: { Cookie: cookie } });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("Location"), `${origin}/terminus/auth?error=callback_failed`);
    assert.ok(!cookiesOf(response).some(c => c.startsWith("__Host-danil_alfa=") && !c.endsWith("=")));
  }
});

test("the database decides who enters", async () => {
  for (const [overrides, error] of [
    [{ workosUser: { id: "user_01ABC", email: "prueba@danil.ai", email_verified: false } }, "email_not_verified"],
    [{ person: null }, "unknown_person"],
    [{ row: { id: 42, uuid, email: "x@danil.ai", merged_into_user_id: 9 } }, "unknown_person"],
    [{ row: { id: 42, uuid: null, email: "x@danil.ai", merged_into_user_id: null } }, "no_login_yet"],
    [{ login: { id: uuid, banned_until: "2126-01-01T00:00:00Z" } }, "login_banned"],
  ]) {
    const { back } = await signedIn(world(overrides));
    assert.equal(back.headers.get("Location"), `${origin}/terminus/auth?error=${error}`, error);
  }
  const w = world();
  const { cookie } = await signedIn(w);
  w.state.login = { id: uuid, banned_until: "2126-01-01T00:00:00Z" };
  const response = await session(w, cookie);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "login_banned" });
});

test("an ended WorkOS session or a tampered cookie gives no token and clears the cookie", async () => {
  const w = world();
  const { cookie } = await signedIn(w);
  w.state.sessions = [{ ...w.state.sessions[0], status: "revoked" }];
  const ended = await session(w, cookie);
  assert.equal(ended.status, 401);
  assert.deepEqual(await ended.json(), { error: "session_ended" });
  assert.deepEqual(cookiesOf(ended), ["__Host-danil_alfa="]);
  const tampered = cookie.slice(0, -2) + (cookie.endsWith("A") ? "BB" : "AA");
  const forged = await session(world(), tampered);
  assert.equal(forged.status, 401);
  assert.equal((await session(world(), "")).status, 401);
});

test("WorkOS down denies with 503 and never a token", async () => {
  const w = world();
  const { cookie } = await signedIn(w);
  w.state.workosDown = true;
  const response = await session(w, cookie);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "identity_unavailable" });
  assert.deepEqual(cookiesOf(response), []);
  const { back } = await signedIn(world({ workosDown: true }));
  assert.equal(back.status, 303);
  assert.notEqual(new URL(back.headers.get("Location")).hostname, "api.workos.com");
});

test("session and logout need the same Origin, no body and a person, not an AI", async () => {
  const w = world();
  const { cookie } = await signedIn(w);
  const before = w.calls.length;
  assert.equal((await session(w, cookie, { Origin: "https://evil.example" })).status, 403);
  assert.equal((await call(w, "/terminus/auth/session", { method: "POST", headers: { Cookie: cookie } })).status, 403);
  assert.equal((await call(w, "/terminus/auth/session", { method: "GET", headers: { Origin: origin, Cookie: cookie } })).status, 405);
  const ai = await session(w, cookie, { "x-danil-actor": "AI" });
  assert.equal(ai.status, 403);
  assert.deepEqual(await ai.json(), { error: "identity_requires_person" });
  assert.equal(w.calls.length, before);
  const withBody = await call(w, "/terminus/auth/session", { method: "POST", headers: { Origin: origin, Cookie: cookie }, body: "x".repeat(10_000_000) });
  assert.equal(withBody.status, 400);
});

test("logout clears the cookie and ends the WorkOS session in the browser", async () => {
  const w = world();
  const { cookie } = await signedIn(w);
  const response = await call(w, "/terminus/auth/logout", { method: "POST", headers: { Origin: origin, Cookie: cookie } });
  assert.equal(response.status, 200);
  assert.deepEqual(cookiesOf(response), ["__Host-danil_alfa="]);
  const location = new URL((await response.json()).location);
  assert.equal(location.origin + location.pathname, "https://api.workos.com/user_management/sessions/logout");
  assert.equal(location.searchParams.get("session_id"), "session_01ABC");
  assert.equal(location.searchParams.get("return_to"), `${origin}/terminus/auth`);
  const anonymous = await call(w, "/terminus/auth/logout", { method: "POST", headers: { Origin: origin } });
  assert.equal((await anonymous.json()).location, `${origin}/terminus/auth`);
});

test("without its configuration sign-in is unavailable, never open", async () => {
  const w = world();
  delete w.env.DANIL_SIGNING_JWK;
  assert.equal((await call(w, "/terminus/auth/workos/start")).status, 503);
  assert.equal((await session(w, "")).status, 503);
  assert.equal((await call(w, "/terminus/auth")).status, 200);
});

test("return paths stay inside Terminus", () => {
  assert.equal(safeNext("/terminus/inbox?x=1#y"), "/terminus/inbox?x=1#y");
  for (const value of [null, "", "https://evil.example/terminus/", "//evil.example/terminus/", "/terminus/auth", "/terminus/auth?next=x", "/other", "/terminus/\\evil", "/terminus/\n"]) {
    assert.equal(safeNext(value), "/terminus/", String(value));
  }
});
