import assert from "node:assert/strict";
import test from "node:test";
import { SignInUnavailable, workosSession } from "../../src/web/workos-session.ts";

type Reply = { status: number; body?: unknown };

/** The entry Worker as the page sees it: each POST takes the next reply. */
function worker(replies: Reply[]) {
  const calls: string[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(`${init?.method} ${String(input)}`);
    assert.equal(init?.credentials, "same-origin");
    const reply = replies.shift() ?? { status: 500 };
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status, headers: { "content-type": "application/json" } });
  };
  return { calls, fetch: fetch as typeof globalThis.fetch };
}

const user = { user_id: "6f1c2b8e-3a4d-4e5f-8a9b-0c1d2e3f4a5b", email: "prueba@danil.ai", name: "Prueba" };
const minted = (token: string, seconds = 600, who = user) => ({ status: 200, body: { access_token: token, expires_at: Math.floor(Date.now() / 1000) + seconds, user: who } });

test("the token is asked once, reused until near expiry and renewed after a refusal", async () => {
  const w = worker([minted("t1"), minted("t2", 30), minted("t3"), minted("t4")]);
  let ended = 0;
  const session = workosSession({ base: "/", fetch: w.fetch, onGone: () => ended++ });
  const [a, b] = await Promise.all([session.getToken(), session.getToken()]);
  assert.equal(a, "t1");
  assert.equal(b, "t1");
  assert.deepEqual(await session.user(), user);
  assert.equal(w.calls.length, 1);
  assert.equal(w.calls[0], "POST /auth/session");
  assert.equal(await session.unauthorized(), true);
  assert.equal(await session.getToken(), "t3", "a token about to expire is not handed out");
  assert.equal(await session.getToken(), "t3");
  assert.equal(ended, 0);
});

test("a refused session ends once and stays ended", async () => {
  const w = worker([minted("t1"), { status: 401, body: { error: "session_ended" } }]);
  let ended = 0;
  let cleared = 0;
  const session = workosSession({ base: "/", fetch: w.fetch, onGone: () => ended++ });
  await session.getToken();
  session.watch(user.user_id, () => cleared++);
  assert.equal(await session.unauthorized(), false);
  assert.equal(ended, 1);
  assert.equal(cleared, 1);
  await assert.rejects(session.getToken(), /session ended/);
  assert.equal(await session.unauthorized(), false);
  assert.equal(w.calls.length, 2);
});

test("no session reads as signed out; an unavailable Worker is an error, never a session", async () => {
  assert.equal(await workosSession({ base: "/", fetch: worker([{ status: 401 }]).fetch }).user(), null);
  await assert.rejects(workosSession({ base: "/", fetch: worker([{ status: 503, body: { error: "identity_unavailable" } }]).fetch }).user(), SignInUnavailable);
  let ended = 0;
  const down = workosSession({ base: "/", fetch: worker([minted("t1"), { status: 503 }]).fetch, onGone: () => ended++ });
  await down.getToken();
  assert.equal(await down.unauthorized(), false);
  assert.equal(ended, 0, "an outage does not sign the person out");
});

test("another person behind the same cookie ends the session", async () => {
  let ended = 0;
  const session = workosSession({ base: "/", fetch: worker([minted("t1"), minted("t2", 600, { ...user, user_id: "someone-else" })]).fetch, onGone: () => ended++ });
  await session.getToken();
  assert.equal(await session.unauthorized(), false);
  assert.equal(ended, 1);
});

test("signing out here clears the Worker session and ends it", async () => {
  const w = worker([minted("t1"), { status: 200, body: { location: "https://api.workos.com/user_management/sessions/logout?session_id=s" } }]);
  let ended = 0;
  const session = workosSession({ base: "/", fetch: w.fetch, onGone: () => ended++ });
  await session.getToken();
  await session.signOutLocal();
  assert.equal(w.calls[1], "POST /auth/logout");
  assert.equal(ended, 1);
});
