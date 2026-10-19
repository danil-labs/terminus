#!/usr/bin/env node
/**
 * Development bridge between the Terminus mobile app and a Seldon engine.
 *
 *   node apps/mobile/bridge/bridge.mjs [--data <engine data dir>] [--port 6780] [--allow-lan]
 *
 * It speaks RPC1 to the engine over loopback, like the window, and serves the
 * phone a small HTTP API with a bearer token. Only commands in ALLOWED reach the
 * engine. Without `--allow-lan` it answers loopback and Tailscale (100.64.0.0/10)
 * addresses only: plain HTTP is acceptable inside the tailnet, not on a LAN.
 *
 * It also turns what the desktop announces into `notice` events: a task that
 * starts needing the person (`attention`) or a turn that ends well (`done`;
 * the engine marks a task `unseen` as soon as its turn starts). The phone shows
 * them as local notifications today; a push gateway will deliver them later.
 *
 * `--data` defaults to the engine lab (`apps/desktop/.engine/lab/data`). Never point it at
 * the data of an installed Terminus.
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createConnection } from "node:net";
import { networkInterfaces } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CLI_COMMANDS, INVOKE_COMMANDS, NEEDS_YOU as NEEDS_YOU_STATES } from "../../../packages/protocol/src/commands.ts";

// The engine lab lives with the desktop app, which downloads and runs it (`scripts/engine.mjs`).
const DESKTOP = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "desktop");
const option = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const DATA = resolve(option("data", join(DESKTOP, ".engine", "lab", "data")));
const PORT = Number(option("port", "6780"));
const ALLOW_LAN = process.argv.includes("--allow-lan");
const STATE = join(DESKTOP, ".engine", "mobile-bridge.json");
const MAX_BODY = 1 << 20;
const LONG_POLL_MS = 25_000;
const MAX_FRAME = 16 * 1024 * 1024;

// The allowlist is the contract with the app; Node strips the types on import.
const CLI = new Set(CLI_COMMANDS);
const INVOKE = new Set(INVOKE_COMMANDS);
const NEEDS_YOU = new Set(NEEDS_YOU_STATES);

function bridgeToken() {
  if (existsSync(STATE)) {
    const saved = JSON.parse(readFileSync(STATE, "utf8"));
    if (typeof saved.token === "string" && saved.token.length >= 32) return saved.token;
  }
  mkdirSync(dirname(STATE), { recursive: true });
  const token = randomBytes(32).toString("base64url");
  writeFileSync(STATE, JSON.stringify({ token }), { mode: 0o600 });
  chmodSync(STATE, 0o600);
  return token;
}
const TOKEN = bridgeToken();

function engine() {
  const endpointFile = join(DATA, "seldon-endpoint.json");
  if (!existsSync(endpointFile)) throw Object.assign(new Error("engine_down"), { status: 503 });
  const endpoint = JSON.parse(readFileSync(endpointFile, "utf8"));
  const separator = endpoint.address.lastIndexOf(":");
  const host = endpoint.address.slice(0, separator);
  if (host !== "127.0.0.1" && host !== "[::1]" && host !== "::1") throw new Error("engine endpoint is not loopback");
  return {
    host: host.replace(/^\[|\]$/g, ""),
    port: Number(endpoint.address.slice(separator + 1)),
    token: readFileSync(endpoint.token_file, "utf8").trim(),
  };
}

function rpc(command, args = {}, { workspace = null, folder = null, requestId = randomUUID(), timeout = 30_000 } = {}) {
  const target = engine();
  const request = { version: 1, token: target.token, workspace, folder, command, args, request_id: requestId };
  return new Promise((done, reject) => {
    const socket = createConnection({ host: target.host, port: target.port });
    let buffer = Buffer.alloc(0);
    socket.setTimeout(timeout, () => socket.destroy(Object.assign(new Error("engine_timeout"), { status: 504 })));
    socket.on("connect", () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > MAX_FRAME) socket.destroy(new Error("response_too_large"));
      const end = buffer.indexOf(10);
      if (end < 0) return;
      socket.end();
      const response = JSON.parse(buffer.subarray(0, end).toString("utf8"));
      if (response.request_id !== requestId) reject(new Error("version_mismatch"));
      else done(response);
    });
    socket.on("error", (error) => reject(Object.assign(error, { status: error.status ?? 503 })));
  });
}

/** `service invoke` answers `pending` until the command ends; it is polled with the same id. */
async function invoke(command, args, workspace) {
  const requestId = randomUUID();
  const deadline = Date.now() + 120_000;
  for (;;) {
    const response = await rpc("service invoke", { command, arguments: args }, { workspace, requestId });
    if (response.result?.pending !== true) return response;
    if (Date.now() > deadline) return { result: null, error: { code: "io", message_key: "cli.error.io", detail: "pending" } };
    await new Promise((r) => setTimeout(r, 200));
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One reader of the engine's event log, shared by every phone. */
const feed = {
  cursor: null,
  seq: 0,
  events: [],
  waiters: new Set(),
  attention: new Map(),
  /** The folder of each task seen in `session` events; `done` does not carry it. */
  folders: new Map(),
  push(event) {
    this.seq += 1;
    this.events.push({ ...event, seq: this.seq });
    if (this.events.length > 2000) this.events.splice(0, this.events.length - 2000);
    for (const wake of this.waiters) wake();
    this.waiters.clear();
  },
};

function noticesFrom(list) {
  const next = new Map();
  for (const entry of Array.isArray(list) ? list : []) {
    for (const task of entry.tasks ?? []) {
      if (NEEDS_YOU.has(task.state)) next.set(`${entry.workspace}/${task.session}`, { ...task, workspace: entry.workspace });
    }
  }
  const notices = [];
  for (const [key, task] of next) {
    if (NEEDS_YOU.has(task.state) && feed.attention.get(key)?.state !== task.state) notices.push(task);
  }
  feed.attention = next;
  return notices;
}

async function follow() {
  for (;;) {
    try {
      if (feed.cursor === null) {
        const first = await rpc("service events", { cursor: null, replay: false }, { timeout: 5_000 });
        feed.cursor = first.result?.latest ?? 0;
        const attention = await invoke("list_workspace_attention", {}, null);
        noticesFrom(attention.result?.value ?? attention.result);
        continue;
      }
      const page = await rpc("service events", { cursor: feed.cursor, replay: false }, { timeout: 5_000 });
      const result = page.result;
      if (!result) throw new Error(page.error?.code ?? "engine_down");
      if (result.gap) feed.push({ name: "resync", payload: null });
      feed.cursor = result.cursor;
      for (const event of result.events) {
        feed.push({ name: event.name, payload: event.payload });
        if (event.name === "attention") {
          for (const notice of noticesFrom(event.payload)) feed.push({ name: "notice", payload: notice });
        }
        if (event.name === "session" && event.payload?.session) feed.folders.set(event.payload.session, event.payload.project);
        const chat = event.payload;
        if (event.name === "chat" && chat?.kind === "done" && chat.ok === true) {
          feed.push({ name: "notice", payload: { workspace: chat.workspace, session: chat.session, project: feed.folders.get(chat.session) ?? null, state: "finished" } });
        }
      }
      await sleep(result.events.length ? 50 : 400);
    } catch {
      feed.cursor = null;
      await sleep(2_000);
    }
  }
}

function inTailnet(address) {
  const v4 = address.replace(/^::ffff:/, "");
  if (v4 === "127.0.0.1" || address === "::1") return true;
  const parts = v4.split(".").map(Number);
  return parts.length === 4 && parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
}

function authorized(request) {
  const header = request.headers.authorization ?? "";
  if (!header.startsWith("Bearer ")) return false;
  const given = createHash("sha256").update(header.slice(7)).digest();
  const expected = createHash("sha256").update(TOKEN).digest();
  return timingSafeEqual(given, expected);
}

function send(response, status, body) {
  const text = JSON.stringify(body);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(text);
}

async function readJson(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error("body_too_large"), { status: 413 });
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

async function call(body) {
  const { command, workspace = null, folder = null, args = {} } = body;
  if (typeof command !== "string") return [400, { error: { code: "invalid_request" } }];
  if (CLI.has(command)) return [200, await rpc(command, args, { workspace, folder })];
  if (INVOKE.has(command)) return [200, await invoke(command, args, workspace)];
  return [403, { error: { code: "command_not_allowed", detail: command } }];
}

async function events(url) {
  const after = Number(url.searchParams.get("after") ?? "-1");
  if (after < 0) return { events: [], after: feed.seq };
  const deadline = Date.now() + LONG_POLL_MS;
  while (Date.now() < deadline) {
    const fresh = feed.events.filter((e) => e.seq > after);
    if (after > feed.seq) return { events: [{ seq: feed.seq, name: "resync", payload: null }], after: feed.seq };
    if (fresh.length) return { events: fresh, after: fresh[fresh.length - 1].seq };
    await new Promise((wake) => {
      feed.waiters.add(wake);
      setTimeout(wake, Math.max(0, deadline - Date.now()));
    });
  }
  return { events: [], after };
}

const server = createServer(async (request, response) => {
  if (!ALLOW_LAN && !inTailnet(request.socket.remoteAddress ?? "")) {
    request.socket.destroy();
    return;
  }
  if (!authorized(request)) return send(response, 401, { error: { code: "invalid_token" } });
  const url = new URL(request.url ?? "/", "http://bridge");
  try {
    if (request.method === "GET" && url.pathname === "/v1/status") {
      const status = await rpc("status", {}, { timeout: 5_000 });
      const s = status.result ?? {};
      return send(response, 200, { bridge: 1, engine: { version: s.version, runtime: s.runtime, product: s.product } });
    }
    if (request.method === "GET" && url.pathname === "/v1/events") return send(response, 200, await events(url));
    if (request.method === "POST" && url.pathname === "/v1/call") {
      const [status, body] = await call(await readJson(request));
      return send(response, status, body);
    }
    send(response, 404, { error: { code: "not_found" } });
  } catch (error) {
    send(response, error.status ?? 500, { error: { code: error.message ?? "io" } });
  }
});

function addresses() {
  const found = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const item of list ?? []) {
      if (item.family === "IPv4" && (ALLOW_LAN || inTailnet(item.address))) found.push(item.address);
    }
  }
  return found;
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Terminus mobile bridge on port ${PORT}, engine data ${DATA}`);
  for (const address of addresses()) {
    const url = `http://${address}:${PORT}`;
    console.log(`  ${url}\n  terminus-mobile://pair?url=${encodeURIComponent(url)}&token=${TOKEN}`);
  }
  void follow();
});
