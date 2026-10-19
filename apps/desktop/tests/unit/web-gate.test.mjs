/**
 * The browser build served by the Danil app: it reads the Supabase session that
 * app stored on the same origin, lists the computers, opens all of them without
 * starting any and, when the relay refuses, refreshes the session or explains it.
 * Mounts `dist-web/`.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { relay } from "../helpers/fake-relay.mjs";
import { boot, sleep } from "../helpers/jsdom-app.mjs";

const SUPABASE = "https://supabase.test";
const API = "https://computers.danil.ai/v1/computers";
const session = (token) => JSON.stringify({
  access_token: token,
  refresh_token: `r-${token}`,
  token_type: "bearer",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: "u1", aud: "authenticated", role: "authenticated", email: "persona@example.com", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
});

test("the web build uses the stored session, opens every computer and explains refusals", async () => {
  const fake = relay();
  const requests = [];
  let licensed = true;
  let refreshes = 0;
  const computers = [
    { computer_id: "cmp_a", name: "Casa", state: "offline" },
    { computer_id: "cmp_b", name: "Trabajo", state: "online" },
  ];
  const own = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input?.url ?? input);
    if (url.startsWith(`${SUPABASE}/auth/v1/token`)) {
      refreshes += 1;
      return new Response(session("fresh"), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (!url.startsWith(API)) return own(input, init);
    const token = new Headers(init?.headers).get("authorization");
    requests.push({ url, method: init?.method ?? "GET", token });
    if (token !== "Bearer stored" && token !== "Bearer fresh") return new Response("", { status: 401 });
    if (!licensed) return new Response(JSON.stringify({ error: "license_required" }), { status: 403 });
    return new Response(init?.method === "POST" ? "{}" : JSON.stringify(computers), { status: 200 });
  };

  let w;
  const app = await boot("listo", "web-gate", {}, undefined, { "sb-supabase-auth-token": session("stored") }, {
    web: true,
    antes: (win) => {
      w = win;
      globalThis.WebSocket = fake.Socket;
      win.terminusWeb = { supabaseUrl: SUPABASE, supabaseKey: "public-anon-key" };
    },
  });
  const text = () => w.document.body.textContent ?? "";
  try {
    await sleep(1500);
    assert.equal(requests[0]?.token, "Bearer stored", "the API gets the session the app stored");
    assert.equal(w.document.querySelector("[data-web-gate]"), null, "several computers open without a picker");
    assert.deepEqual(
      fake.sockets.map((s) => s.url).sort(),
      ["wss://computers.danil.ai/v1/computers/cmp_a/session", "wss://computers.danil.ai/v1/computers/cmp_b/session"],
      "one relay session per computer",
    );
    assert.deepEqual(fake.sockets[0]?.protocols, ["danil.computers.v1", "bearer.stored"]);
    assert.ok(!requests.some((r) => r.method === "POST"), "opening starts no computer");
    assert.ok(fake.calls.some((c) => c.command === "list_projects"), "the app mounted over the relay");
    assert.equal(w.document.querySelectorAll("[data-machine-row]").length, 2, "each computer has its row");

    licensed = false;
    fake.drop(4003);
    await sleep(1500);
    assert.ok(refreshes >= 1, "4003 refreshes the session");
    assert.ok(text().includes("no tiene licencia"), "a refused reconnection shows the license notice");
    assert.equal(fake.sockets.length, 2, "it does not retry the sockets blindly");
    assert.equal(w.document.querySelectorAll("[data-web-gate]").length, 1, "one notice for every refused session");
    assert.deepEqual(app.fallos, []);
  } finally {
    globalThis.fetch = own;
  }
});
