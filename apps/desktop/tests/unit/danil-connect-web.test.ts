/**
 * The approval page's control-plane client and the contract check the machine
 * list uses, against a fake `fetch`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { machineCompatibility } from "../../src/web/compatibility.ts";
import { approveDevice, denyDevice, lookupDevice, normalizeCode } from "../../src/web/connect/devices.ts";

const API = "https://computers.danil.ai";

function fake(handler: (url: string, init: RequestInit) => { status: number; body?: unknown }) {
  const seen: { url: string; init: RequestInit }[] = [];
  const f = async (url: string, init: RequestInit = {}) => {
    seen.push({ url, init });
    const { status, body } = handler(url, init);
    return new Response(body === undefined ? "" : JSON.stringify(body), { status });
  };
  return { f, seen };
}

test("lookup sends the code and the session and reads the machine", async () => {
  const { f, seen } = fake(() => ({ status: 200, body: { hostname: "alberto-mbp", platform: "macos", expires_at: "2026-10-19T12:15:00Z" } }));
  const answer = await lookupDevice(API, "tok", "WDJB-MJHT", f);
  assert.deepEqual(answer, { kind: "ok", value: { hostname: "alberto-mbp", platform: "macos", name: null, expires_at: "2026-10-19T12:15:00Z" } });
  assert.equal(seen[0].url, `${API}/v1/devices/lookup?user_code=WDJB-MJHT`);
  assert.equal(new Headers(seen[0].init.headers).get("authorization"), "Bearer tok");
});

test("an expired, unknown or unlicensed code is told apart", async () => {
  const cases: [number, unknown, string][] = [
    [410, { error: "expired_token" }, "expired"],
    [400, { error: "expired_token" }, "expired"],
    [404, { error: "invalid_user_code" }, "invalid"],
    [403, { error: "license_required" }, "license"],
    [403, { error: "unknown_user" }, "no_account"],
    [409, { error: "code_already_used" }, "used"],
    [409, { error: "ambiguous_danil_account" }, "ambiguous"],
    [401, null, "unauthorized"],
    [500, null, "error"],
    [200, { nothing: true }, "error"],
  ];
  for (const [status, body, kind] of cases) {
    const { f } = fake(() => ({ status, body }));
    assert.equal((await lookupDevice(API, "tok", "X", f)).kind, kind, `${status} ${JSON.stringify(body)}`);
  }
});

test("approve posts the code and the chosen name", async () => {
  const { f, seen } = fake(() => ({ status: 200, body: { computer_id: "cmp_1" } }));
  assert.deepEqual(await approveDevice(API, "tok", "WDJB-MJHT", "Mac de Alberto", f), { kind: "ok", value: null });
  assert.equal(seen[0].url, `${API}/v1/devices/approve`);
  assert.equal(seen[0].init.method, "POST");
  assert.deepEqual(JSON.parse(String(seen[0].init.body)), { user_code: "WDJB-MJHT", name: "Mac de Alberto" });
  const { f: gone } = fake(() => ({ status: 410, body: { error: "expired_token" } }));
  assert.equal((await approveDevice(API, "tok", "WDJB-MJHT", "Mac", gone)).kind, "expired");
});

test("deny posts only the code", async () => {
  const { f, seen } = fake(() => ({ status: 200, body: { denied: true } }));
  assert.deepEqual(await denyDevice(API, "tok", "WDJB-MJHT", f), { kind: "ok", value: null });
  assert.equal(seen[0].url, `${API}/v1/devices/deny`);
  assert.deepEqual(JSON.parse(String(seen[0].init.body)), { user_code: "WDJB-MJHT" });
  const { f: used } = fake(() => ({ status: 409, body: { error: "code_already_used" } }));
  assert.equal((await denyDevice(API, "tok", "WDJB-MJHT", used)).kind, "used");
});

test("the code from the link is normalized", () => {
  assert.equal(normalizeCode(" wdjb-mjht "), "WDJB-MJHT");
  assert.equal(normalizeCode(null), "");
});

test("a machine on another contract needs an update", () => {
  const own = "b64b514f9dfcda0f027dc60b2eb604e29526a8c19b2d77f7aaec3bc3991796bc";
  assert.equal(machineCompatibility(own, own), "ok");
  assert.equal(machineCompatibility(own.toUpperCase(), own), "ok");
  assert.equal(machineCompatibility("2ae5ba8e263252c80622f0706d3a5a3a534b48ab9364c724d1fea96bebab029b", own), "outdated");
  assert.equal(machineCompatibility(null, own), "unknown", "an engine that never reported");
  assert.equal(machineCompatibility(own, ""), "unknown", "a build without its own contract");
});
