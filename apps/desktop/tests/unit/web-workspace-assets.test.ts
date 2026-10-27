/**
 * En la web el logo y el fondo de un workspace de la cuenta se leen de
 * `logo_url` / `background_url` con la sesión y se muestran como `data:`; se
 * suben y se quitan en la cuenta. Un workspace que la cuenta no tiene, o un
 * plano de control anterior, deja el camino del motor.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { webWorkspaceAssets } from "../../src/web/workspace-assets.ts";

const API = "https://computers.test";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3]);
const b64 = (bytes: Uint8Array, type: string) => `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;

type Req = { url: string; method: string; token: string | null; type: string | null };

function account() {
  const state = {
    logo: PNG as Uint8Array | null,
    background: null as Uint8Array | null,
    v: { logo: "l1", background: "" },
    conflictOnce: false,
  };
  const requests: Req[] = [];
  const row = () => ({
    id: "w1",
    name: "Uno",
    settings: { chat_background: JSON.stringify({ preset: null, veil: { chat: 0.4 } }) },
    logo_url: state.logo ? `${API}/v1/workspaces/w1/logo?v=${state.v.logo}` : null,
    background_url: state.background ? `${API}/v1/workspaces/w1/background?v=${state.v.background}` : null,
  });
  const f = async (input: string, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    const headers = new Headers(init.headers);
    requests.push({ url, method, token: headers.get("authorization"), type: headers.get("content-type") });
    const path = new URL(url).pathname;
    if (path === "/v1/workspaces") return Response.json({ workspaces: [row(), { id: "old", name: "Viejo" }] });
    const m = path.match(/^\/v1\/workspaces\/([^/]+)\/(logo|background)$/);
    if (!m) return new Response("{}", { status: 404 });
    const kind = m[2] as "logo" | "background";
    if (m[1] !== "w1") return Response.json({ error: { code: "not_found" } }, { status: 404 });
    if (method === "GET") {
      const bytes = state[kind];
      if (!bytes) return Response.json({ error: { code: `no_${kind}` } }, { status: 404 });
      return new Response(new Blob([bytes as Uint8Array<ArrayBuffer>]), { headers: { "content-type": kind === "logo" ? "image/png" : "image/webp" } });
    }
    if (state.conflictOnce) {
      state.conflictOnce = false;
      return Response.json({ error: { code: "settings_conflict" } }, { status: 409 });
    }
    if (method === "PUT") {
      const body = new Uint8Array(await (init.body as Blob).arrayBuffer());
      if (body.length > 10) return Response.json({ error: { code: "image_too_large" } }, { status: 413 });
      state[kind] = body;
      state.v[kind] = `${kind}-new`;
    } else state[kind] = null;
    return Response.json(row());
  };
  return { state, requests, f };
}

test("lee el logo y el fondo de la cuenta como data:, con la sesión y solo de su origen", async () => {
  const a = account();
  a.state.background = WEBP;
  a.state.v.background = "b1";
  const assets = webWorkspaceAssets(API, async () => "tok", undefined, a.f);
  assert.equal(await assets.read("w1", "logo"), b64(PNG, "image/png"));
  assert.equal(await assets.read("w1", "background"), b64(WEBP, "image/webp"));
  assert.deepEqual(await assets.setting("w1"), { preset: null, veil: { chat: 0.4 } });
  assert.equal(await assets.read("w1", "logo"), b64(PNG, "image/png"));
  assert.equal(a.requests.filter((r) => r.url.includes("/logo?v=")).length, 1, "la URL versionada se pide una vez");
  assert.equal(a.requests.filter((r) => r.url.endsWith("/v1/workspaces")).length, 1, "la lista se lee una vez");
  assert.ok(a.requests.every((r) => r.token === "Bearer tok"));
});

test("sin imagen es null; un workspace que la cuenta no conoce, o sin los campos, es undefined", async () => {
  const a = account();
  const assets = webWorkspaceAssets(API, () => "tok", undefined, a.f);
  assert.equal(await assets.read("w1", "background"), null);
  assert.equal(await assets.read("old", "logo"), undefined, "un plano de control anterior no manda logo_url");
  assert.equal(await assets.read("nadie", "logo"), undefined);
});

test("una URL de otro origen no recibe la sesión", async () => {
  const requests: string[] = [];
  const assets = webWorkspaceAssets(API, () => "tok", undefined, async (url) => {
    requests.push(url);
    return Response.json({ workspaces: [{ id: "w1", logo_url: "https://evil.test/logo.png", background_url: null }] });
  });
  assert.equal(await assets.read("w1", "logo"), null);
  assert.deepEqual(requests, [`${API}/v1/workspaces`]);
});

test("sube y quita en la cuenta, y la lectura siguiente usa la URL nueva", async () => {
  const a = account();
  const assets = webWorkspaceAssets(API, () => "tok", undefined, a.f);
  const nuevo = new Uint8Array([1, 2, 3]);
  a.state.conflictOnce = true;
  assert.equal(await assets.put("w1", "background", new Blob([nuevo], { type: "image/webp" })), true);
  const put = a.requests.filter((r) => r.method === "PUT");
  assert.equal(put.length, 2, "un conflicto de versión se intenta otra vez");
  assert.equal(put[1].url, `${API}/v1/workspaces/w1/background`);
  assert.equal(put[1].type, "image/webp");
  assert.equal(await assets.read("w1", "background"), b64(nuevo, "image/webp"));
  assert.ok(a.requests.some((r) => r.url === `${API}/v1/workspaces/w1/background?v=background-new`));

  assert.equal(await assets.remove("w1", "logo"), true);
  assert.equal(a.requests.at(-1)?.method, "DELETE");
  assert.equal(await assets.read("w1", "logo"), null);
});

test("un workspace fuera de la cuenta vuelve al motor; otro rechazo se dice", async () => {
  const a = account();
  const assets = webWorkspaceAssets(API, () => "tok", undefined, a.f);
  assert.equal(await assets.put("nadie", "logo", new Blob([PNG], { type: "image/png" })), false, "ni siquiera se pide");
  assert.equal(a.requests.filter((r) => r.method !== "GET").length, 0);
  await assert.rejects(assets.put("w1", "logo", new Blob([new Uint8Array(20)], { type: "image/png" })), (e: unknown) => (e as { detail?: string }).detail === "image_too_large");
});

test("un 404 not_found del plano de control (de otro dueño) también vuelve al motor", async () => {
  const assets = webWorkspaceAssets(API, () => "tok", undefined, async (url, init) =>
    init?.method === "PUT" ? Response.json({ error: { code: "not_found" } }, { status: 404 }) : Response.json({ workspaces: [{ id: "w1", logo_url: null, background_url: null }] }),
  );
  assert.equal(await assets.put("w1", "logo", new Blob([PNG], { type: "image/png" })), false);
});

test("una sesión rechazada avisa y la lista se vuelve a pedir", async () => {
  let avisos = 0;
  let listas = 0;
  const assets = webWorkspaceAssets(API, () => "tok", () => avisos++, async () => {
    listas++;
    return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
  });
  assert.equal(await assets.read("w1", "logo"), undefined);
  assert.equal(await assets.read("w1", "logo"), undefined);
  assert.equal(avisos, 2);
  assert.equal(listas, 2);
});
