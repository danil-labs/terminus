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
  listWorkspacesWithDeleted,
  powerOf,
  purgeWorkspace,
  restoreWorkspace,
  sessionUrl,
  startComputer,
} from "../src/index.ts";

class FakeSocket implements SocketLike {
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
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
  close(code = 1000) {
    this.readyState = 3;
    this.onclose?.({ code });
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

test("los workspaces se juntan por id igual, nunca por nombre ni remoto", () => {
  const groups = groupWorkspaces([
    { machine: "vm", rows: [{ id: "a", name: "Producto", provider: "github", remote: "org/app" }, { id: "b", name: "Notas" }] },
    { machine: "mac", rows: [{ id: "a", name: "Otro nombre" }, { id: "x", name: "Producto", provider: "github", remote: "org/app" }, { id: "y", name: "notas" }] },
  ]);
  assert.deepEqual(
    groups.map((g) => [g.key, g.row.name, [...g.members]]),
    [["a", "Producto", [["vm", "a"], ["mac", "a"]]], ["b", "Notas", [["vm", "b"]]], ["x", "Producto", [["mac", "x"]]], ["y", "notas", [["mac", "y"]]]],
  );
});

test("el contrato: igual es ok, distinto es desactualizado, sin dato no se sabe", () => {
  assert.equal(machineCompatibility("ABC", "abc"), "ok");
  assert.equal(machineCompatibility("abc", "def"), "outdated");
  assert.equal(machineCompatibility(null, "abc"), "unknown");
});

test("llevar trabajo: exportar, importar y cancelar despiertan; las partes, la llave y el estado ni esperan en pending; nada se copia al espejo", async () => {
  const { INTENT_COMMANDS, MIRROR_COMMANDS } = await import("../src/index.ts");
  assert.ok(INTENT_COMMANDS.has("work_import"));
  assert.ok(INTENT_COMMANDS.has("work_cancel"));
  // computers#16: armar el bundle pasa de los 60 s de una lectura; sus argumentos son metadatos.
  assert.ok(INTENT_COMMANDS.has("work_export"));
  for (const command of ["work_read_part", "work_write_part", "work_key", "work_status"]) {
    assert.ok(!INTENT_COMMANDS.has(command), `${command} no puede guardarse en pending:`);
  }
  for (const command of ["work_read_part", "work_write_part", "work_export", "work_key"]) {
    assert.ok(!MIRROR_COMMANDS.has(command), `${command} no puede quedar en el espejo`);
  }
});

const jwt = (exp: number, n = 1) => `h.${Buffer.from(JSON.stringify({ exp: Math.floor(exp / 1000), n })).toString("base64url")}.s`;

test("la sesión manda los contratos que habla en la URL, y solo los bien formados", () => {
  assert.equal(sessionUrl("https://c.example", "cmp_x", ["abc123", "mal formado", "abc123", "def.4"]), "wss://c.example/v1/computers/cmp_x/session?contracts=abc123,def.4");
  assert.equal(sessionUrl("https://c.example", "cmp_x", []), "wss://c.example/v1/computers/cmp_x/session");
});

test("antes de que venza el token se renueva con `auth` sin reconectar; 4005 reabre con uno nuevo", async () => {
  FakeSocket.all = [];
  let n = 0;
  const tokens: string[] = [];
  const relay = new RelaySession(
    {
      endpoint: "https://c.example",
      computerId: "cmp_a",
      contracts: ["abc123"],
      getToken: () => {
        const t = jwt(Date.now() + 46_000, ++n);
        tokens.push(t);
        return t;
      },
    },
    (url, protocols) => new FakeSocket(url, protocols),
  );
  relay.start();
  await tick();
  const socket = FakeSocket.all[0];
  assert.ok(socket.url.endsWith("?contracts=abc123"));
  socket.open();
  await new Promise((r) => setTimeout(r, 1_100));
  const auth = socket.sent.filter((m) => m.type === "auth");
  assert.equal(auth.length, 1, "a fresh token goes over the open socket");
  assert.equal(auth[0].token, tokens[1]);
  assert.equal(FakeSocket.all.length, 1, "without reconnecting");
  socket.receive({ type: "auth", expires_at: new Date(Date.now() + 600_000).toISOString() });
  socket.close(4005);
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(FakeSocket.all.length, 2, "an expired session opens again");
  assert.deepEqual(FakeSocket.all[1].protocols, [SUBPROTOCOL, `bearer.${tokens.at(-1)}`], "with a new token");
  relay.close();
});

test("cada `hello` del motor llega como `engine` con su contrato", async () => {
  const relay = session();
  await tick();
  const socket = FakeSocket.all[0];
  const seen: (string | null)[] = [];
  relay.onEngine((e) => seen.push(e.contract));
  socket.open();
  socket.receive({ type: "engine", contract: "old", host_version: "0.2.82" });
  socket.receive({ type: "engine", contract: "new", host_version: "0.2.86" });
  assert.deepEqual(seen, ["old", "new"]);
  assert.deepEqual(relay.engine(), { contract: "new", host_version: "0.2.86" });
  relay.close();
});

test("lápidas: la lista con borrados, restaurar, purgar y el 409 con su código", async () => {
  const asked: [string, string | undefined][] = [];
  const reply = (status: number, body: unknown) => async (url: string, init?: { method?: string }) => {
    asked.push([url, init?.method]);
    return { status, ok: status < 300, json: async () => body };
  };
  const both = await listWorkspacesWithDeleted("https://c.example", "t", reply(200, { workspaces: [{ id: "w", name: "W", projects: [], computers: ["c"] }], deleted: [{ id: "w9", name: "Viejo", projects: [], computers: [], deleted_at: "2026-10-22T10:00:00Z" }] }));
  assert.equal(both.kind, "ok");
  if (both.kind === "ok") assert.deepEqual([both.value.workspaces.map((w) => w.id), both.value.deleted.map((w) => [w.id, w.deleted_at])], [["w"], [["w9", "2026-10-22T10:00:00Z"]]]);
  assert.equal(asked[0][0], "https://c.example/v1/workspaces?include_deleted=1");
  const restored = await restoreWorkspace("https://c.example", "t", "w9", reply(200, { id: "w9", name: "Viejo", projects: [], computers: [] }));
  assert.equal(restored.kind === "ok" && restored.value?.id, "w9");
  assert.equal((await purgeWorkspace("https://c.example", "t", "w9", reply(204, null))).kind, "ok");
  assert.deepEqual(asked.slice(1), [["https://c.example/v1/workspaces/w9/restore", "POST"], ["https://c.example/v1/workspaces/w9/purge", "POST"]]);
  assert.deepEqual(await purgeWorkspace("https://c.example", "t", "w", reply(409, { error: "workspace_not_deleted" })), { kind: "error", status: 409, code: "workspace_not_deleted" });
});
