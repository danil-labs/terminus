/**
 * The preparation of a managed computer in the browser: only its progress,
 * never the installer, and the app once it is done. Mounts `dist-web/`.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { engine, relay } from "../helpers/fake-relay.mjs";
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

test("a pending preparation shows its progress, never the installer, then the app", async () => {
  const fake = relay();
  const own = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input?.url ?? input);
    if (!url.startsWith(API)) return own(input, init);
    return new Response(JSON.stringify([{ computer_id: "cmp_a", name: "Casa", state: "online" }]), { status: 200 });
  };
  let prepared = 0;
  engine.setup_required = () => prepared < 2;
  engine.prepare_runtime = () => {
    prepared += 1;
    return {
      running: prepared < 2,
      stages: [
        { name: "git", essential: true, state: "succeeded" },
        { name: "node", essential: true, state: prepared < 2 ? "running" : "succeeded" },
      ],
    };
  };

  let w;
  const app = await boot("listo", "web-setup", {}, undefined, { "sb-supabase-auth-token": session }, {
    web: true,
    antes: (win) => {
      w = win;
      globalThis.WebSocket = fake.Socket;
      win.terminusWeb = { supabaseUrl: SUPABASE, supabaseKey: "public-anon-key" };
    },
  });
  const text = () => w.document.body.textContent ?? "";
  try {
    await sleep(1000);
    assert.equal(fake.sockets.length, 1, "the only computer opens");
    assert.ok(text().includes("Preparando tu computadora… 50 %"), "a pending preparation shows only its progress");
    assert.ok(!text().includes("Preparemos tu entorno"), "never the installer");
    assert.ok(!fake.calls.some((c) => c.command === "check_environment"), "nor its environment check");

    await sleep(3500);
    assert.ok(fake.calls.some((c) => c.command === "list_projects"), "the app mounts when preparation is done");
    assert.deepEqual(app.fallos, []);
  } finally {
    globalThis.fetch = own;
  }
});
