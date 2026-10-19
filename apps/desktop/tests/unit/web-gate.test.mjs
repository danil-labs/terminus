/**
 * The browser build served by the Danil app: it reads the Supabase session that
 * app stored on the same origin, lists the computers, opens the chosen one and,
 * when the relay refuses it, refreshes the session or explains the refusal.
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

test("the web build uses the stored session, picks the computer and explains refusals", async () => {
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
    await sleep(300);
    assert.equal(requests[0]?.token, "Bearer stored", "the API gets the session the app stored");
    assert.equal(w.document.querySelectorAll("[data-computer]").length, 2, "several computers show the picker");
    assert.ok(text().includes("Apagada") && text().includes("Encendida"));

    const casa = w.document.querySelector('[data-computer="cmp_a"]');
    [...casa.querySelectorAll("button")].find((b) => b.textContent.includes("Encender")).click();
    await sleep(200);
    assert.ok(requests.some((r) => r.method === "POST" && r.url === `${API}/cmp_a/start`), "start goes to the control plane");

    const trabajo = w.document.querySelector('[data-computer="cmp_b"]');
    [...trabajo.querySelectorAll("button")].find((b) => b.textContent.includes("Abrir")).click();
    await sleep(1200);
    assert.equal(w.localStorage.getItem("terminus-web:computer"), "cmp_b");
    assert.equal(fake.sockets[0]?.url, "wss://computers.danil.ai/v1/computers/cmp_b/session");
    assert.deepEqual(fake.sockets[0]?.protocols, ["danil.computers.v1", "bearer.stored"]);
    assert.ok(fake.calls.some((c) => c.command === "list_projects"), "the app mounted over the relay");

    licensed = false;
    fake.drop(4003);
    await sleep(1500);
    assert.equal(refreshes, 1, "4003 refreshes the session");
    assert.ok(text().includes("no tiene licencia"), "a refused reconnection shows the license notice");
    assert.equal(fake.sockets.length, 1, "it does not retry the socket blindly");
    assert.deepEqual(app.fallos, []);
  } finally {
    globalThis.fetch = own;
  }
});
