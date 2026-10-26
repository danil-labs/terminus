/**
 * La web sobre la flota compartida (`features/machines/router.ts` sin motor
 * propio, `@terminus/fleet`) con sesiones de relay falsas: abre con todo
 * apagado desde lo guardado, una máquina de otro contrato no tumba la lista,
 * actuar en la VM apagada la enciende, en la Mac apagada lo dice con su nombre
 * y los spaces de todas salen juntos.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { INTENT_COMMANDS, type MachineState } from "@terminus/computers";
import { Fleet, type Link, type MachineInfo } from "@terminus/fleet";
import { delegatedOf, flattenTasks } from "@terminus/tasks";
import "../helpers/catalog.ts";
import { createRouter } from "../../src/features/machines/router.ts";

type Args = Record<string, unknown>;
type Call = { command: string; args: Args; workspace: string | null };

/** Una sesión de relay en memoria: una intención enciende la VM; `outdated`, otro contrato. */
function fakeLink(answers: Record<string, unknown>, initial: MachineState = "online", outdated = false) {
  let state = initial;
  const calls: Call[] = [];
  const listeners = new Set<(s: MachineState) => void>();
  const setState = (next: MachineState) => {
    state = next;
    for (const l of listeners) l(next);
  };
  const answer = (command: string, args: Args) => {
    const a = answers[command];
    return typeof a === "function" ? (a as (x: Args) => unknown)(args) : a;
  };
  const link: Link & { calls: Call[]; setState: typeof setState } = {
    calls,
    setState,
    state: () => state,
    call(_id, command, workspace, _folder, args) {
      calls.push({ command, workspace, args: args as Args });
      return new Promise((resolve, reject) => {
        if (outdated) return reject({ code: "version_mismatch" });
        if (state !== "online") {
          if (!INTENT_COMMANDS.has(command)) return reject({ code: "machine_off" });
          setState("starting");
          return void setTimeout(() => {
            setState("online");
            resolve({ value: answer(command, args as Args) ?? null, cached: null });
          }, 10);
        }
        if (answers[command] === undefined) return reject({ code: "command" });
        resolve({ value: answer(command, args as Args), cached: null });
      });
    },
    onState: (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    onEvents: () => () => {},
    subscribe() {},
    start() {},
    close() {},
  };
  return link;
}

const VM: MachineInfo = { id: "cmp_vm", name: "Danil VM", wakes: true };
const MAC: MachineInfo = { id: "cmp_mac", name: "Mac de Ana", wakes: false };
const REGISTRY = [{ id: "w", name: "Producto", computers: ["cmp_vm", "cmp_mac"], projects: [], settings: null, created_at: "2026-10-01T00:00:00Z" }];
const row = (id: string, title = id) => ({ id, title, updated_at: 0 });

function memoryStorage() {
  const items = new Map<string, string>();
  return { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v), removeItem: (k: string) => void items.delete(k) };
}

function web(links: Record<string, ReturnType<typeof fakeLink>>, storage = memoryStorage(), wake?: (id: string) => Promise<boolean>) {
  const fleet = new Fleet({ self: null, connect: (info) => links[info.id], storage, wake, deadlines: { read: 40, action: 200, intent: 400 } });
  const router = createRouter({ self: null, fleet, native: null, registry: async () => REGISTRY as never });
  fleet.setMachines([VM, MAC].filter((m) => links[m.id]));
  return { router, fleet, storage };
}

const on = (machine: string) => ({ headers: { "x-terminus-machine": machine } });

test("with every machine off the page opens at once from the registry and the saved slice of each machine", async () => {
  const answers = (who: string) => ({ list_live_sessions: [row("t1", `de ${who}`)] });
  // Una visita anterior, con las dos encendidas, dejó guardado lo de cada una.
  const before = web({ cmp_vm: fakeLink(answers("vm")), cmp_mac: fakeLink(answers("mac")) });
  await before.router.handle("list_workspaces");
  const args = { project: "", open: [] };
  for (const m of ["cmp_vm", "cmp_mac"]) await before.fleet.read({ machine: m, workspace: "w", command: "list_live_sessions", args });
  before.fleet.flush();

  const vm = fakeLink(answers("vm"), "offline");
  const mac = fakeLink(answers("mac"), "offline");
  const { router } = web({ cmp_vm: vm, cmp_mac: mac }, before.storage);
  const started = Date.now();
  const listed = (await router.handle("list_workspaces")) as { workspaces: { id: string; machines: string[] }[]; active: string };
  assert.deepEqual(listed.workspaces.map((w) => [w.id, w.machines]), [["w", ["cmp_vm", "cmp_mac"]]], "the account's workspace, with its machines");
  assert.equal(listed.active, "w");
  const rows = (await router.handle("list_live_sessions", args)) as { id: string; title: string; machine: string; machine_status: string }[];
  assert.ok(Date.now() - started < 2_000, "under two seconds");
  assert.deepEqual(rows.map((r) => [r.id, r.title, r.machine_status]).sort(), [["cmp_mac~t1", "de mac", "cached"], ["cmp_vm~t1", "de vm", "cached"]], "the saved tasks of each, marked saved");
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(vm.calls.filter((c) => c.command === "list_live_sessions").length + mac.calls.filter((c) => c.command === "list_live_sessions").length, 0, "an off machine with a copy is not asked");
});

test("the web hides a delegated task under its launcher like the desktop, also from an off machine's saved copy", async () => {
  type Row = { id: string; created_at: number; launched_by?: string | null; parent?: string | null; launcher_available?: boolean };
  const rows = (prefix: string) => [
    { ...row("lanzador"), created_at: 3 },
    { ...row("delegada"), created_at: 2, launched_by: "lanzador", launcher_available: true },
    { ...row("huerfana"), created_at: 1, launched_by: "borrado", launcher_available: false },
  ].map((r) => ({ ...r, title: `${prefix} ${r.title}` }));
  const args = { project: "", open: [] };
  const before = web({ cmp_vm: fakeLink({ list_live_sessions: rows("vm") }), cmp_mac: fakeLink({ list_live_sessions: rows("mac") }) });
  await before.router.handle("list_workspaces");
  await before.fleet.read({ machine: "cmp_mac", workspace: "w", command: "list_live_sessions", args });
  before.fleet.flush();

  // La Mac está apagada: sus filas salen de lo guardado y siguen colgando de su lanzador.
  const { router } = web({ cmp_vm: fakeLink({ list_live_sessions: rows("vm") }), cmp_mac: fakeLink({ list_live_sessions: rows("mac") }, "offline") }, before.storage);
  await router.handle("list_workspaces");
  const listed = (await router.handle("list_live_sessions", args)) as Row[];
  const shown = flattenTasks({ "": listed }).map((t) => t.row.id).sort();
  assert.deepEqual(shown, ["cmp_mac~huerfana", "cmp_mac~lanzador", "cmp_vm~huerfana", "cmp_vm~lanzador"], "the delegated ones hang from their launcher; one whose launcher is gone shows loose");
  assert.deepEqual(delegatedOf(listed, "cmp_mac~lanzador").map((r) => r.id), ["cmp_mac~delegada"], "and the launcher's panel finds its own");
});

test("a machine of another contract shows outdated in its slice and the page still answers with the others", async () => {
  const vm = fakeLink({ list_live_sessions: [row("t1")] });
  const mac = fakeLink({}, "online", true);
  const { router, fleet } = web({ cmp_vm: vm, cmp_mac: mac });
  await router.handle("list_workspaces");
  const rows = (await router.handle("list_live_sessions", { project: "", open: [] })) as { id: string }[];
  assert.deepEqual(rows.map((r) => r.id), ["cmp_vm~t1"]);
  assert.equal(fleet.sliceStatuses().cmp_mac.status, "outdated", "its slice says outdated");
  assert.equal(fleet.power("cmp_mac"), "outdated");
  await assert.rejects(router.handle("send_message", { project: "p1", session: "cmp_mac~t1", prompt: "hola" }, on("cmp_mac")), (e: { detail: string; what: string }) => e.detail === "version_mismatch" && e.what.includes("Mac de Ana"));
});

test("a message to a task of the VM that is off wakes it and is delivered; to the Mac that is off it says so by name, showing the last", async () => {
  const vm = fakeLink({ send_message: "t9" }, "offline");
  const mac = fakeLink({ load_session: ({ id }: Args) => ({ id, turns: [{ id: "u1" }] }) }, "online");
  const { router } = web({ cmp_vm: vm, cmp_mac: mac });
  await router.handle("list_workspaces");
  const sent = await router.handle("send_message", { project: "p1", session: "cmp_vm~t1", prompt: "hola" }, on("cmp_vm"));
  assert.equal(sent, "cmp_vm~t9");
  assert.deepEqual(vm.calls.filter((c) => c.command === "send_message").map((c) => [c.args.session, c.workspace]), [["t1", "w"]], "delivered with its own id and the envelope's workspace");

  // La Mac se leyó encendida y después se apagó: su tarea sigue a la vista.
  await router.handle("load_session", { project: "p1", id: "cmp_mac~t2" }, on("cmp_mac"));
  mac.setState("offline");
  const seen = (await router.handle("load_session", { project: "p1", id: "cmp_mac~t2" }, on("cmp_mac"))) as { id: string };
  assert.equal(seen.id, "cmp_mac~t2", "the last it said is still visible");
  await assert.rejects(router.handle("send_message", { project: "p1", session: "cmp_mac~t2", prompt: "hola" }, on("cmp_mac")), (e: { detail: string; what: string }) => {
    assert.equal(e.detail, "machine_off");
    assert.match(e.what, /Mac de Ana está apagada/);
    return true;
  });
  assert.equal(mac.calls.filter((c) => c.command === "send_message").length, 0, "nothing was sent to it");
});

test("the spaces of the Mac and of the VM come out together, each with its machine", async () => {
  const vm = fakeLink({ list_spaces: [{ id: "s1", name: "VM", folders: [] }] });
  const mac = fakeLink({ list_spaces: [{ id: "s1", name: "Mac", folders: [] }] });
  const { router } = web({ cmp_vm: vm, cmp_mac: mac });
  await router.handle("list_workspaces");
  const first = (await router.handle("list_spaces")) as { id: string; name: string }[];
  assert.deepEqual(first.map((s) => [s.id, s.name]), [["cmp_vm~s1", "VM"], ["cmp_mac~s1", "Mac"]]);
  await router.handle("rename_space", { id: "cmp_mac~s1", name: "Mac nueva" }, on("cmp_mac")).catch(() => null);
  assert.deepEqual(mac.calls.filter((c) => c.command === "rename_space").map((c) => c.args.id), ["s1"], "renaming goes only to its machine");
});

test("nobody answering is a named error, never an empty list", async () => {
  const vm = fakeLink({}, "offline");
  const { router } = web({ cmp_vm: vm });
  await router.handle("list_workspaces");
  await assert.rejects(router.handle("list_live_sessions", { project: "", open: [] }), (e: { detail: string }) => e.detail === "machine_off");
});

test("web account creation, listing and login carry the selected workspace", async () => {
  const vm = fakeLink({
    add_account: { id: "a1" },
    list_accounts: { accounts: [{ id: "a1" }], active: "a1" },
    login_account: null,
  });
  const { router } = web({ cmp_vm: vm });
  try {
    await router.handle("list_workspaces");
    const created = await router.handle("add_account", { provider: "codex", label: "" }) as { id: string };
    await router.handle("list_accounts", { provider: "codex" });
    await router.handle("login_account", { provider: "codex", id: created.id, mode: "tuberia" }, on("cmp_vm"));
    const calls = vm.calls.filter((c) => /account/.test(c.command));
    assert.deepEqual(calls.map((c) => [c.command, c.workspace]), [["add_account", "w"], ["list_accounts", "w"], ["login_account", "w"]]);
    assert.equal(calls[2].args.id, "a1");
  } finally {
    router.close();
  }
});

test("on the web a prefixed task id goes to that machine when the call has no machine header", async () => {
  const vm = fakeLink({ task_history: { branch: "vm" } });
  const mac = fakeLink({ task_history: { branch: "mac" } });
  const { router } = web({ cmp_vm: vm, cmp_mac: mac });
  try {
    await router.handle("list_workspaces");
    const seen = await router.handle("task_history", { project: "p1", id: "cmp_mac~t2" }) as { branch: string };
    assert.equal(seen.branch, "mac");
    assert.deepEqual(mac.calls.filter((c) => c.command === "task_history").map((c) => c.args.id), ["t2"]);
    assert.equal(vm.calls.filter((c) => c.command === "task_history").length, 0);
  } finally {
    router.close();
  }
});

test("on the web a login follows the account id's machine, not the workspace lead", async () => {
  const account = (id: string, plan: string) => ({ id, identity: "ana@danil.ai", plan, authenticated_at: 1 });
  const vm = fakeLink({
    list_accounts: { accounts: [account("a1", "personal")], active: null },
    login_account: null,
  });
  const mac = fakeLink({
    list_accounts: { accounts: [account("a2", "team")], active: null },
    login_account: null,
  });
  const { router } = web({ cmp_vm: vm, cmp_mac: mac });
  try {
    await router.handle("list_workspaces");
    const list = await router.handle("list_accounts", { provider: "claude" }) as { accounts: { id: string }[] };
    const team = list.accounts.find((a) => a.id.startsWith("cmp_mac~"));
    assert.ok(team, "the Team card keeps the Mac's id");
    await router.handle("login_account", { provider: "claude", id: team.id, mode: "tuberia" });
    assert.deepEqual(mac.calls.filter((c) => c.command === "login_account").map((c) => c.args.id), ["a2"]);
    assert.equal(vm.calls.filter((c) => c.command === "login_account").length, 0);
  } finally {
    router.close();
  }
});

test("on the web arguments that name two machines are still refused", async () => {
  const vm = fakeLink({ send_message: "x" });
  const mac = fakeLink({ send_message: "x" });
  const { router } = web({ cmp_vm: vm, cmp_mac: mac });
  try {
    await router.handle("list_workspaces");
    await assert.rejects(
      router.handle("send_message", { project: "p1", session: "cmp_mac~t2", space: "cmp_vm~s1", prompt: "hola" }),
      (e: { detail: string }) => e.detail === "cross_machine",
    );
    assert.equal(vm.calls.filter((c) => c.command === "send_message").length, 0);
    assert.equal(mac.calls.filter((c) => c.command === "send_message").length, 0);
  } finally {
    router.close();
  }
});
