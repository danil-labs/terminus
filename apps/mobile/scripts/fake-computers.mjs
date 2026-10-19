#!/usr/bin/env node
/**
 * Un Danil Computers falso para probar la app sin la sesión de nadie:
 * el login de Supabase (`/auth/v1/token`), el plano de control
 * (`/v1/computers`, `/start`) y el relay (`/v1/computers/:id/session`, protocolo
 * v1 con espejo), sobre HTTP y WebSocket reales en localhost.
 *
 *   node apps/mobile/scripts/fake-computers.mjs [--port 8787] [--mac-off] [--license]
 *
 * Dos máquinas comparten el workspace «Producto»: la VM de Danil (`aws-ec2`,
 * apagada, con copia en el espejo) y una Mac propia (sin proveedor, encendida;
 * apagada con `--mac-off`). Cada una tiene su motor en memoria: tareas, un
 * agente, permisos y eventos. Para la app:
 *
 *   EXPO_PUBLIC_SUPABASE_URL=http://<ip>:8787 EXPO_PUBLIC_COMPUTERS_ENDPOINT=http://<ip>:8787 npm start
 *
 * y entrar con cualquier correo y contraseña. Sin dependencias.
 */
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";

const option = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const PORT = Number(option("port", "8787"));
const LICENSE = !process.argv.includes("--license");
const WAKE_MS = Number(option("wake-ms", "800"));
const TOKEN = "fake-jwt";
const INTENT = new Set(["send_message", "inject_message", "create_project", "create_agent", "create_agent_thread", "login_account", "submit_login_code", "respond_permission", "answer_question", "answer_shell_output", "run_shell_command", "queue_ready", "resume_awaiting_quota", "recreate_task_work"]);
const MIRROR = new Set(["workspaces_startup", "list_workspaces", "list_projects", "list_spaces", "list_live_sessions", "list_agent_status", "list_providers", "load_session", "pending_requests", "list_active_turns", "list_workspace_attention", "list_agents"]);

// --- Motores --------------------------------------------------------------------

function engine(name, projects, tasks) {
  const now = Date.now();
  const sessions = new Map(tasks.map((t, i) => [t.id, { ...t, created_at: now - (i + 1) * 60_000, updated_at: now - i * 60_000, turns: [{ id: `${t.id}-u`, role: "user", text: t.title }, { id: `${t.id}-a`, role: "agent", text: `Hecho en ${name}.` }], pending: null }]));
  return { name, projects, sessions, live: new Set(), cursor: 0, events: [] };
}

const machines = {
  cmp_vm: {
    row: { computer_id: "cmp_vm", name: "VM de Danil", plan: "standard", provider: "aws-ec2", host_version: "0.3.0" },
    state: "offline",
    engine: engine("la VM", [{ id: "p1", name: "web" }], [
      { id: "t-vm-1", project: "p1", title: "Revisar el checkout", agent: "Ada", provider: "codex", model: "gpt-5.6" },
      { id: "t-vm-2", project: "p1", title: "Arreglar el login", agent: null, provider: "codex", model: "gpt-5.6", esperando: true },
    ]),
    mirror: new Map(),
  },
  cmp_mac: {
    row: { computer_id: "cmp_mac", name: "Mac de Alberto", plan: null, provider: null, host_version: "0.3.0" },
    state: process.argv.includes("--mac-off") ? "offline" : "online",
    engine: engine("la Mac", [{ id: "p1", name: "web" }, { id: "p2", name: "api" }], [
      { id: "t-mac-1", project: "p2", title: "Subir la API a v2", agent: null, provider: "claude", model: null },
    ]),
    mirror: new Map(),
  },
};

const row = (s) => ({
  id: s.id, title: s.title, provider: s.provider, model: s.model, last_message: s.turns.at(-1)?.text ?? null,
  created_at: s.created_at, updated_at: s.updated_at, esperando: Boolean(s.esperando), outcome: null, agent: s.agent, space: null,
});

function attentionOf(e) {
  const tasks = [...e.sessions.values()].flatMap((s) => (s.pending ? [{ session: s.id, project: s.project, state: "approving" }] : s.esperando ? [{ session: s.id, project: s.project, state: "asked" }] : []));
  return [{ workspace: "w", tasks }];
}

function emit(m, name, payload) {
  m.engine.cursor += 1;
  const page = { type: "events", cursor: m.engine.cursor, events: [{ name, payload }] };
  for (const socket of sockets) if (socket.computer === m.row.computer_id && socket.subscribed) socket.send(page);
}

/** Un turno: arranca, escribe, y termina o pide permiso si el mensaje lo dice. */
function turn(m, s, prompt) {
  const e = m.engine;
  s.turns.push({ id: randomUUID(), role: "user", text: prompt });
  e.live.add(s.id);
  emit(m, "chat", { workspace: "w", session: s.id, kind: "started", text: "", meta: null, ok: null, request_id: null });
  setTimeout(() => {
    emit(m, "chat", { workspace: "w", session: s.id, kind: "delta", text: "Trabajando en ello", meta: null, ok: null, request_id: null });
    if (/permiso/i.test(prompt)) {
      s.pending = { request_id: randomUUID(), tool: "Bash", target: "rm -rf build" };
      emit(m, "chat", { workspace: "w", session: s.id, kind: "permission", text: "Bash", meta: null, ok: null, request_id: s.pending.request_id, target: "rm -rf build" });
      emit(m, "attention", attentionOf(e));
      return;
    }
    finish(m, s);
  }, 150);
}

function finish(m, s) {
  s.turns.push({ id: randomUUID(), role: "agent", text: "Listo." });
  s.updated_at = Date.now();
  m.engine.live.delete(s.id);
  emit(m, "chat", { workspace: "w", session: s.id, kind: "done", text: "", meta: null, ok: true, request_id: null });
  emit(m, "attention", attentionOf(m.engine));
}

function invoke(m, command, args) {
  const e = m.engine;
  switch (command) {
    case "list_workspaces": return { workspaces: [{ id: "w", name: "Producto" }], active: "w" };
    case "list_projects": return e.projects.map((p) => ({ ...p, working_directory: `/lab/${p.name}` }));
    case "list_spaces": return [{ id: "s1", name: null, folders: e.projects.map((p) => p.id) }];
    case "list_live_sessions": return [...e.sessions.values()].filter((s) => s.project === args.project).map(row);
    case "list_agents": return { agents: args.project === "p1" && m.row.provider ? [{ name: "Ada", description: "Revisa PRs" }] : [] };
    case "list_agent_status": return args.project === "p1" && m.row.provider ? [{ name: "Ada", status: "awake", minutes_since_last_turn: 3, live_tasks: 0 }] : [];
    case "list_providers": return [{ id: "codex", label: "Codex", available: true, driver: true }];
    case "list_active_turns": return [...e.live];
    case "list_workspace_attention": return attentionOf(e);
    case "load_session": {
      const s = e.sessions.get(args.id);
      if (!s) throw { code: "command_failed", detail: "no such task" };
      return { id: s.id, provider: s.provider, model: s.model, agent: s.agent, turns: s.turns };
    }
    case "pending_requests": {
      const s = e.sessions.get(args.session);
      return { questions: [], permissions: s?.pending ? [{ request_id: s.pending.request_id, tool: s.pending.tool, target: s.pending.target }] : [] };
    }
    case "send_message": {
      let s = args.session ? e.sessions.get(args.session) : null;
      if (!s) {
        const id = `t-${randomUUID().slice(0, 8)}`;
        s = { id, project: args.project, title: String(args.prompt).slice(0, 40), agent: args.agent ?? null, provider: args.provider, model: args.model ?? null, created_at: Date.now(), updated_at: Date.now(), turns: [], pending: null };
        e.sessions.set(id, s);
        emit(m, "session", { workspace: "w", project: args.project, session: id });
      }
      turn(m, s, String(args.prompt));
      return s.id;
    }
    case "inject_message": return null;
    case "stop_turn": e.live.delete(args.session); return null;
    case "respond_permission": {
      const s = e.sessions.get(args.session);
      if (!s?.pending || s.pending.request_id !== args.requestId) throw { code: "command_failed", detail: "no pending permission" };
      s.pending = null;
      setTimeout(() => finish(m, s), 100);
      return { role: "user", text: args.allow ? "Aprobado" : "Rechazado" };
    }
    case "answer_question": return null;
    case "mark_task_seen": return null;
  }
  throw { code: "command", detail: command };
}

const keyOf = (c) => JSON.stringify([c.command, c.workspace ?? null, c.folder ?? null, c.args ?? {}]);

// Antes de apagarse, la VM dejó en el espejo lo que se leía: la lista y sus tareas.
function seedMirror(m) {
  const reads = [
    ["list_workspaces", null, {}], ["list_projects", "w", {}], ["list_spaces", "w", {}], ["list_active_turns", "w", { workspace: "w" }],
    ["list_workspace_attention", null, {}], ["list_providers", "w", {}],
    ...["", ...m.engine.projects.map((p) => p.id)].flatMap((project) => [["list_live_sessions", "w", { project, open: [] }], ...(project ? [["list_agents", "w", { project }], ["list_agent_status", "w", { project }]] : [])]),
    ...[...m.engine.sessions.values()].flatMap((s) => [["load_session", "w", { project: s.project, id: s.id }], ["pending_requests", "w", { session: s.id }]]),
  ];
  for (const [command, workspace, args] of reads) m.mirror.set(keyOf({ command, workspace, folder: null, args }), { value: invoke(m, command, args), at: new Date(Date.now() - 3_600_000).toISOString() });
}
seedMirror(machines.cmp_vm);

// --- Relay ------------------------------------------------------------------------

const sockets = new Set();

function setState(m, state) {
  m.state = state;
  for (const s of sockets) if (s.computer === m.row.computer_id) s.send({ type: "state", state });
}

function wake(m) {
  if (m.state === "starting" || m.state === "online") return true;
  if (!m.row.provider) return false;
  setState(m, "starting");
  setTimeout(() => {
    setState(m, "online");
    for (const s of sockets) if (s.computer === m.row.computer_id) s.flush();
  }, WAKE_MS);
  return true;
}

function onCall(socket, m, call) {
  const reply = (body) => socket.send({ type: "result", id: call.id, ...body });
  const run = () => {
    try {
      const value = invoke(m, call.command, call.args ?? {});
      if (MIRROR.has(call.command)) m.mirror.set(keyOf(call), { value, at: new Date().toISOString() });
      reply({ value });
    } catch (error) {
      reply({ error: { code: error.code ?? "io", detail: error.detail ?? null } });
    }
  };
  if (m.state === "online") return run();
  if (INTENT.has(call.command)) {
    if (!wake(m)) return reply({ error: { code: "start_failed" } });
    socket.queue.push(run);
    return;
  }
  const kept = MIRROR.has(call.command) ? m.mirror.get(keyOf(call)) : null;
  if (kept) return reply({ value: kept.value, cached: { updated_at: kept.at } });
  reply({ error: { code: "machine_off" } });
}

// --- WebSocket mínimo (RFC 6455, frames de texto) ---------------------------------

function upgrade(request, raw, computer) {
  const offered = (request.headers["sec-websocket-protocol"] ?? "").split(",").map((p) => p.trim());
  if (!offered.includes("danil.computers.v1") || !offered.includes(`bearer.${TOKEN}`)) {
    raw.end("HTTP/1.1 401 Unauthorized\r\n\r\n");
    return;
  }
  const accept = createHash("sha1").update(`${request.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
  raw.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\nSec-WebSocket-Protocol: danil.computers.v1\r\n\r\n`);
  const m = machines[computer];
  const socket = {
    computer,
    subscribed: false,
    queue: [],
    send(message) {
      const data = Buffer.from(JSON.stringify(message));
      const head = data.length < 126 ? Buffer.from([0x81, data.length]) : data.length < 65536 ? Buffer.from([0x81, 126, data.length >> 8, data.length & 255]) : Buffer.concat([Buffer.from([0x81, 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(data.length)); return b; })()]);
      if (!raw.destroyed) raw.write(Buffer.concat([head, data]));
    },
    flush() {
      for (const run of this.queue.splice(0)) run();
    },
  };
  sockets.add(socket);
  socket.send({ type: "state", state: m.state });
  let buffer = Buffer.alloc(0);
  raw.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 2) {
      const opcode = buffer[0] & 15;
      let length = buffer[1] & 127;
      let offset = 2;
      if (length === 126) { if (buffer.length < 4) return; length = buffer.readUInt16BE(2); offset = 4; }
      else if (length === 127) { if (buffer.length < 10) return; length = Number(buffer.readBigUInt64BE(2)); offset = 10; }
      const masked = buffer[1] & 128;
      const mask = masked ? buffer.subarray(offset, offset + 4) : null;
      if (masked) offset += 4;
      if (buffer.length < offset + length) return;
      const payload = Buffer.from(buffer.subarray(offset, offset + length));
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      buffer = buffer.subarray(offset + length);
      if (opcode === 8) { raw.end(Buffer.from([0x88, 0])); sockets.delete(socket); return; }
      if (opcode !== 1) continue;
      const message = JSON.parse(payload.toString("utf8"));
      if (message.type === "ping") socket.send({ type: "pong", t: message.t });
      if (message.type === "subscribe") socket.subscribed = true;
      if (message.type === "call") onCall(socket, m, message);
    }
  });
  raw.on("close", () => sockets.delete(socket));
  raw.on("error", () => sockets.delete(socket));
}

// --- HTTP -------------------------------------------------------------------------

const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "persona@example.com", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
const session = () => ({ access_token: TOKEN, refresh_token: "fake-refresh", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user });

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "*" });
  response.end(JSON.stringify(body));
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://fake");
  if (request.method === "OPTIONS") return json(response, 204, {});
  if (url.pathname === "/auth/v1/token" && request.method === "POST") return json(response, 200, session());
  if (url.pathname === "/auth/v1/user") return json(response, 200, user);
  if (url.pathname === "/auth/v1/logout") return json(response, 204, {});
  if (request.headers.authorization !== `Bearer ${TOKEN}`) return json(response, 401, { error: { code: "invalid_token" } });
  if (url.pathname === "/v1/computers" && request.method === "GET") return json(response, 200, Object.values(machines).map((m) => ({ ...m.row, state: m.state, last_seen: null })));
  const start = /^\/v1\/computers\/([^/]+)\/start$/.exec(url.pathname);
  if (start && request.method === "POST") {
    const m = machines[start[1]];
    if (!m) return json(response, 404, { error: { code: "not_found" } });
    if (!LICENSE) return json(response, 403, { error: { code: "license_required" } });
    wake(m);
    return json(response, 202, { computer_id: m.row.computer_id, state: m.state });
  }
  json(response, 404, { error: { code: "not_found" } });
});

server.on("upgrade", (request, raw) => {
  const match = /^\/v1\/computers\/([^/]+)\/session$/.exec(new URL(request.url ?? "/", "http://fake").pathname);
  if (!match || !machines[match[1]] || !LICENSE) return raw.end("HTTP/1.1 404 Not Found\r\n\r\n");
  upgrade(request, raw, match[1]);
});

server.listen(PORT, "0.0.0.0", () => console.log(`Danil Computers falso en http://127.0.0.1:${PORT} (VM apagada con espejo, Mac ${machines.cmp_mac.state})`));

export { machines, server };
