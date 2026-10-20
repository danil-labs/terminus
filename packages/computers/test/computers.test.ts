import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type SocketLike,
  RelaySession,
  SUBPROTOCOL,
  apiUrl,
  cachedAt,
  canAct,
  defaultComputer,
  groupWorkspaces,
  machineCompatibility,
  isManaged,
  wakes,
  listComputers,
  powerOf,
  sessionUrl,
  startComputer,
} from "../src/index.ts";

class FakeSocket implements SocketLike {
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason?: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  url: string;
  protocols?: string[];
  constructor(url: string, protocols?: string[]) {
    this.url = url;
    this.protocols = protocols;
    FakeSocket.all.push(this);
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  receive(message: object) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  close(code = 1000, reason = "") {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function session() {
  FakeSocket.all = [];
  const relay = new RelaySession(
    { endpoint: "https://computers.example", computerId: "cmp_a", getToken: () => "jwt" },
    (url, protocols) => new FakeSocket(url, protocols),
  );
  relay.start();
  return relay;
}

test("las URLs del plano de control aceptan host, https o wss", () => {
  assert.equal(apiUrl("computers.danil.ai", "/v1/computers"), "https://computers.danil.ai/v1/computers");
  assert.equal(apiUrl("http://127.0.0.1:8787/", "/v1/computers"), "http://127.0.0.1:8787/v1/computers");
  assert.equal(sessionUrl("https://computers.danil.ai", "cmp_x"), "wss://computers.danil.ai/v1/computers/cmp_x/session");
  assert.equal(sessionUrl("http://127.0.0.1:8787", "cmp_x"), "ws://127.0.0.1:8787/v1/computers/cmp_x/session");
});

test("el JWT va en los subprotocolos, nunca en la URL", async () => {
  const relay = session();
  await tick();
  const socket = FakeSocket.all[0];
  assert.deepEqual(socket.protocols, [SUBPROTOCOL, "bearer.jwt"]);
  assert.ok(!socket.url.includes("jwt"));
  relay.close();
});

test("una llamada pendiente se reenvía con el mismo id al reconectar, y `cached` llega aparte", async () => {
  const relay = session();
  await tick();
  const first = FakeSocket.all[0];
  const pending = relay.call("id-1", "list_projects", "w", null, {});
  first.open();
  assert.equal(first.sent.at(-1)?.id, "id-1");
  first.close(1006);
  await new Promise((r) => setTimeout(r, 600));
  const second = FakeSocket.all[1];
  second.open();
  assert.equal(second.sent.filter((m) => m.type === "call").at(-1)?.id, "id-1");
  second.receive({ type: "result", id: "id-1", value: [1], cached: { updated_at: "2026-10-19T10:00:00Z" } });
  const result = await pending;
  assert.deepEqual(result.value, [1]);
  assert.equal(cachedAt(result.cached), Date.parse("2026-10-19T10:00:00Z"));
  relay.close();
});

test("4003 `unlinked` cierra la sesión sin pedir otra vez la cuenta ni reconectar", async () => {
  FakeSocket.all = [];
  let unlinked = 0;
  let unauthorized = 0;
  const relay = new RelaySession(
    { endpoint: "https://computers.example", computerId: "cmp_a", getToken: () => "jwt", onUnlinked: () => unlinked++, onUnauthorized: () => unauthorized++ },
    (url, protocols) => new FakeSocket(url, protocols),
  );
  relay.start();
  await tick();
  FakeSocket.all[0].open();
  FakeSocket.all[0].close(4003, "unlinked");
  await new Promise((r) => setTimeout(r, 700));
  assert.equal(unlinked, 1);
  assert.equal(unauthorized, 0);
  assert.equal(FakeSocket.all.length, 1, "no reconnection");
});

test("un error del relay rechaza con su código", async () => {
  const relay = session();
  await tick();
  const socket = FakeSocket.all[0];
  socket.open();
  const pending = relay.call("id-2", "load_session", "w", null, {});
  socket.receive({ type: "result", id: "id-2", error: { code: "machine_off" } });
  await assert.rejects(pending, (e: { code: string }) => e.code === "machine_off");
  relay.close();
});

test("el estado del relay se publica y 4001 no reconecta", async () => {
  const relay = session();
  await tick();
  const socket = FakeSocket.all[0];
  const states: string[] = [];
  relay.onState((s) => states.push(s));
  socket.open();
  socket.receive({ type: "state", state: "offline" });
  socket.receive({ type: "state", state: "starting" });
  assert.deepEqual(states, ["offline", "starting"]);
  socket.close(4001);
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(FakeSocket.all.length, 1);
});

test("solo una VM administrada se despierta; apagado es neutro", () => {
  assert.equal(powerOf("online"), "on");
  assert.equal(powerOf("stopped"), "off");
  assert.equal(powerOf("provisioning"), "off");
  assert.equal(powerOf("version_mismatch"), "outdated");
  assert.equal(isManaged({ provider: "aws-ec2" }), true);
  // La regla de la web: sin proveedor es una VM de antes; `kind` y `wakeable` mandan.
  assert.equal(wakes({ provider: null }), true);
  assert.equal(wakes({ provider: null, kind: "physical" }), false);
  assert.equal(wakes({ provider: "aws-ec2", wakeable: false }), false);
  assert.equal(canAct({ provider: "aws-ec2" }, "offline"), "wakes");
  assert.equal(canAct({ kind: "physical" }, "offline"), "asleep");
  assert.equal(canAct({ kind: "physical" }, "online"), "now");
  assert.equal(canAct({ provider: "aws-ec2" }, "outdated"), "outdated");
  const mac = { computer_id: "cmp_mac", provider: null, kind: "physical" };
  const vm = { computer_id: "cmp_vm", provider: "aws-ec2" };
  assert.equal(defaultComputer([mac, vm]), vm);
  assert.equal(defaultComputer([mac]), mac);
});

test("la API dice licencia, no tuya y error sin confundirlos", async () => {
  const answer = (status: number, body: unknown = null) => async () => ({ status, ok: status < 300, json: async () => body });
  assert.equal((await listComputers("x.example", "t", answer(403))).kind, "license");
  assert.equal((await listComputers("x.example", "t", answer(401))).kind, "unauthorized");
  assert.equal((await startComputer("x.example", "t", "cmp", answer(404))).kind, "missing");
  const ok = await listComputers("x.example", "t", answer(200, [{ computer_id: "cmp_a", state: "online" }, { bad: 1 }]));
  assert.deepEqual(ok.kind === "ok" ? ok.value.map((c) => c.computer_id) : null, ["cmp_a"]);
  let seen: Record<string, string> | undefined;
  await listComputers("x.example", "tok", async (_url, init) => {
    seen = init?.headers;
    return { status: 200, ok: true, json: async () => [] };
  });
  assert.equal(seen?.authorization, "Bearer tok");
});

test("un workspace es el mismo en dos máquinas por remoto o, si no, por nombre único", () => {
  const groups = groupWorkspaces([
    { machine: "vm", rows: [{ id: "a", name: "Producto", provider: "github", remote: "org/app" }, { id: "b", name: "Notas" }] },
    { machine: "mac", rows: [{ id: "x", name: "Otro nombre", provider: "github", remote: "org/app" }, { id: "y", name: "notas" }, { id: "z", name: "Solo Mac" }] },
  ]);
  assert.deepEqual(
    groups.map((g) => [g.key, [...g.members]]),
    [["vm~a", [["vm", "a"], ["mac", "x"]]], ["vm~b", [["vm", "b"], ["mac", "y"]]], ["mac~z", [["mac", "z"]]]],
  );
});

test("el contrato: igual es ok, distinto es desactualizado, sin dato no se sabe", () => {
  assert.equal(machineCompatibility("ABC", "abc"), "ok");
  assert.equal(machineCompatibility("abc", "def"), "outdated");
  assert.equal(machineCompatibility(null, "abc"), "unknown");
});
