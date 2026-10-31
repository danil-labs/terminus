import assert from "node:assert/strict";
import test from "node:test";
import { supabaseSession } from "../../src/web/session.ts";

test("an approval session refuses the replacement identity while extra slots stay usable", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input).includes("/logout")) {
      assert.equal(new URL(String(input)).searchParams.get("scope"), "local");
      return new Response(null, { status: 204 });
    }
    const email = JSON.parse(String(init?.body)).email;
    return new Response(JSON.stringify({
      access_token: `token-${email}`, refresh_token: `refresh-${email}`,
      expires_in: 3600, token_type: "bearer",
      user: { id: email, email, app_metadata: {}, user_metadata: {} },
    }), { headers: { "content-type": "application/json" } });
  };
  let ended = 0;
  const primary = supabaseSession("https://session.test", "public-key", { onGone: () => ended++ });
  const extra = supabaseSession("https://session.test", "public-key", { storageKey: "terminus-auth:extra-test" });
  try {
    await primary.client.auth.signInWithPassword({ email: "a@example.test", password: "fixture" });
    await extra.client.auth.signInWithPassword({ email: "b@example.test", password: "fixture" });
    assert.equal(await primary.email?.(), "a@example.test");
    assert.equal(await primary.getToken(), "token-a@example.test");
    await primary.client.auth.signInWithPassword({ email: "c@example.test", password: "fixture" });
    assert.ok(ended > 0);
    await assert.rejects(primary.getToken(), /session changed/);
    await assert.rejects(primary.email!(), /session changed/);
    assert.equal(await extra.getToken(), "token-b@example.test");
    await assert.rejects(primary.signOut!(), /session changed/);
    await extra.signOut!();
    assert.equal((await primary.client.auth.getSession()).data.session?.user.id, "c@example.test");
  } finally {
    primary.client.auth.stopAutoRefresh();
    extra.client.auth.stopAutoRefresh();
    globalThis.fetch = original;
  }
});
