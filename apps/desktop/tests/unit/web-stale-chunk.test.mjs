/**
 * A tab opened before a deploy asks for a lazy screen whose chunk the new build
 * no longer has; Vite reports it with `vite:preloadError`. The page reloads into
 * the new build instead of leaving the screen blank, and only once in a while
 * so a broken chunk does not loop. Mounts `dist-web/`.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { relay } from "../helpers/fake-relay.mjs";
import { boot, sleep } from "../helpers/jsdom-app.mjs";

const SUPABASE = "https://supabase.test";
const API = "https://computers.danil.ai/v1/computers";
const session = JSON.stringify({
  access_token: "stored",
  refresh_token: "r",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: "u1", aud: "authenticated", role: "authenticated", email: "persona@example.com", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
});

test("a chunk gone after a deploy reloads the page once", async () => {
  const fake = relay();
  const own = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input?.url ?? input);
    if (!url.startsWith(API)) return own(input, init);
    return new Response(JSON.stringify([{ computer_id: "cmp_a", name: "Casa", state: "online" }]), { status: 200 });
  };
  let w;
  const app = await boot("listo", "web-stale-chunk", {}, undefined, { "sb-supabase-auth-token": session }, {
    web: true,
    antes: (win) => {
      w = win;
      globalThis.WebSocket = fake.Socket;
      win.terminusWeb = { supabaseUrl: SUPABASE, supabaseKey: "public-anon-key" };
    },
  });
  const fail = () => {
    const event = new w.Event("vite:preloadError", { cancelable: true });
    w.dispatchEvent(event);
    return event.defaultPrevented;
  };
  try {
    await sleep(1500);
    assert.equal(fail(), true, "the failed chunk is handled");
    assert.ok(w.sessionStorage.getItem("terminus.web.reloaded-at"), "the reload is recorded");
    assert.ok(app.fallos.some((f) => /navigation/i.test(f)), `the page reloads: ${app.fallos.join(" | ")}`);
    assert.equal(fail(), false, "a second failure right after does not reload again");
  } finally {
    globalThis.fetch = own;
  }
});
