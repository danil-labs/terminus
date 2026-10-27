/**
 * Conectar una cuenta de IA en otra máquina desde el teléfono
 * (`src/app/accounts.tsx` sobre `src/lib/engine.ts`), con un relay falso que
 * contesta como el motor de una VM: por el relay, las llamadas de cuentas sin
 * workspace fallan con `command_failed` y la frase del motor (medido en
 * vm-alberto, motor 1198b04). Con el workspace, el login corre y sus eventos
 * `account` (enlace, código, final) llegan al teléfono.
 *
 *   node --test apps/mobile/scripts/accounts.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Computer, SocketLike } from "@terminus/computers";
import type { EngineEvent, LoginEvent } from "@terminus/protocol";
import { LOGIN_START, type LoginProgress, accountWorkspace, accountsOf, addAccount, beginLogin, failureText, loginStep, submitLoginCode } from "../src/lib/engine.ts";
import { accountFleet } from "../src/lib/hosts.ts";

type Call = { type: string; id: string; command: string; workspace?: string | null; args: Record<string, unknown> };

const RELAY_WITHOUT_WORKSPACE = "Por el relay, la llamada tiene que decir de qué workspace es.";

/** El relay de una VM con el motor detrás: las cuentas son de un workspace. */
class FakeSocket implements SocketLike {
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: Call[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason?: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor() {
    FakeSocket.all.push(this);
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
    this.push({ type: "state", state: "online" });
  }
  push(message: object) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  account(event: LoginEvent) {
    this.push({ type: "events", cursor: this.sent.length, gap: false, replay: false, runtime: "rt", events: [{ name: "account", payload: event }] });
  }
  send(data: string) {
    const m = JSON.parse(data) as Call;
    this.sent.push(m);
    if (m.type !== "call") return;
    const reply = (answer: object) => setTimeout(() => this.push({ type: "result", id: m.id, ...answer }), 0);
    // Como `admit_relayed` + `workspaces::active`: sin workspace en el sobre no hay activo.
    if (!m.workspace) {
      if (m.command === "list_accounts") return reply({ value: { provider: m.args.provider, accounts: [] } });
      return reply({ error: { code: "command_failed", message_key: "cli.error.command_failed", detail: RELAY_WITHOUT_WORKSPACE } });
    }
    if (m.command === "list_accounts") return reply({ value: { provider: m.args.provider, accounts: [{ id: "c1", label: "ana@x.com", identity: "ana@x.com", created_at: 1, authenticated_at: 2 }] } });
    if (m.command === "add_account") return reply({ value: { id: "a1", label: "" } });
    if (m.command === "login_account") {
      reply({ value: null });
      // El CLI imprime su enlace y pide el código, por eventos de la máquina (sin workspace).
      setTimeout(() => this.account({ account: "a1", kind: "url", text: "https://claude.ai/oauth/authorize?code=true" }), 5);
      setTimeout(() => this.account({ account: "a1", kind: "code", text: "" }), 10);
      return;
    }
    if (m.command === "submit_login_code") {
      reply({ value: null });
      setTimeout(() => this.account({ account: "a1", kind: "done", text: "" }), 5);
      return;
    }
    reply({ value: null });
  }
  close(code = 1000) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const VM = { computer_id: "cmp_vm", name: "vm-ana", state: "online", provider: "aws-ec2", workspaces: ["w1", "w2"] } as Computer;

function start() {
  FakeSocket.all = [];
  const machines = accountFleet({ endpoint: "https://computers.example", getToken: () => "jwt", storage: null }, () => new FakeSocket());
  const [vm] = machines.set([VM]);
  return { machines, vm, socket: () => FakeSocket.all.at(-1) as FakeSocket };
}

test("el workspace de las cuentas: el abierto si la máquina lo tiene; si no, el suyo", () => {
  const linked = new Set(["w1", "w2"]);
  assert.equal(accountWorkspace({ linked }, "w2"), "w2");
  assert.equal(accountWorkspace({ linked }, "w9"), "w1", "el abierto no está en esa máquina: el primero suyo");
  assert.equal(accountWorkspace({ linked }, null), "w1");
  assert.equal(accountWorkspace({ linked: new Set() }, "w1"), null, "sin workspaces suyos no hay dónde conectar");
  assert.equal(accountWorkspace({ linked: null }, "w1"), "w1", "el bridge o un plano anterior: el abierto");
});

test("sin workspace la VM no conecta, y el error dice la frase del motor y no «command_failed»", async () => {
  const { machines, vm, socket } = start();
  await sleep(0);
  socket().open();
  const error = await addAccount(vm, null, "claude").then(
    () => null,
    (e: unknown) => e,
  );
  assert.ok(error, "add_account sin workspace falla");
  assert.equal(failureText(error), RELAY_WITHOUT_WORKSPACE);
  assert.equal((await accountsOf(vm, null, "claude"))?.accounts.length, 0, "y la lista sale vacía, que es por qué la VM no enseñaba cuentas");
  machines.close();
});

test("con el workspace, el login corre en la VM: enlace, código y conectada", async () => {
  const { machines, vm, socket } = start();
  await sleep(0);
  socket().open();
  const workspace = accountWorkspace(vm, "w1");
  assert.equal(workspace, "w1");

  let login: LoginProgress = LOGIN_START;
  const opened: string[] = [];
  vm.onEvents((events: EngineEvent[]) => {
    for (const event of events) {
      if (event.name !== "account") continue;
      const e = event.payload as LoginEvent;
      if (e.account !== "a1") continue;
      login = loginStep(login, e);
      if (e.kind === "url") opened.push(e.text);
    }
  });

  assert.equal((await accountsOf(vm, workspace, "claude"))?.accounts[0]?.identity, "ana@x.com");
  const id = await addAccount(vm, workspace, "claude");
  assert.equal(id, "a1");
  await beginLogin(vm, workspace, "claude", id);
  await sleep(30);
  assert.deepEqual(opened, ["https://claude.ai/oauth/authorize?code=true"], "el teléfono abre el login del proveedor una vez");
  assert.equal(login.url, "https://claude.ai/oauth/authorize?code=true", "y lo guarda para reabrirlo");
  assert.equal(login.askCode, true, "Claude pide el código");
  assert.equal(login.done, false);

  await submitLoginCode(vm, workspace, id, "abc#123");
  await sleep(20);
  assert.equal(login.done, true);
  assert.equal(login.error, null, "conectada en esa máquina");

  const sent = socket().sent.filter((m) => m.type === "call" && m.command !== "list_accounts");
  assert.deepEqual(
    sent.map((m) => [m.command, m.workspace]),
    [
      ["add_account", "w1"],
      ["login_account", "w1"],
      ["submit_login_code", "w1"],
    ],
    "cada llamada de cuentas lleva su workspace",
  );
  machines.close();
});

test("un final con texto es el error del login", () => {
  const failed = loginStep({ ...LOGIN_START, url: "https://x" }, { account: "a1", kind: "done", text: "El CLI salió con código 1" });
  assert.equal(failed.done, true);
  assert.equal(failed.error, "El CLI salió con código 1");
});
