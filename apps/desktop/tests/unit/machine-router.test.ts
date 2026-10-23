/**
 * El escritorio con la cuenta de Danil, local primero (`features/machines/router.ts`)
 * con la flota de verdad (`@terminus/fleet`), sesiones de relay falsas y un IPC
 * nativo simulado: lo de aquí nunca espera a otra máquina, la máquina sale solo
 * del sobre y nadie contestando nunca es una lista vacía.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeferrable } from "@terminus/computers";
import { Fleet, type Link, type MachineInfo, classOf } from "@terminus/fleet";
import "../helpers/catalog.ts";
import { createRouter } from "../../src/features/machines/router.ts";

type Args = Record<string, unknown>;
type Call = { command: string; args: Args; workspace: string | null; id: string };

/** Una sesión de relay en memoria; `silent` no contesta nunca, como una VM colgada. */
function fakeLink(answers: Record<string, unknown>, state: "online" | "offline" | "stopped" = "online", silent = false) {
  const calls: Call[] = [];
  const link: Link & { calls: Call[] } = {
    calls,
    state: () => state,
    call(id, command, workspace, _folder, args, timeout) {
      calls.push({ id, command, workspace, args: args as Args });
      return new Promise((resolve, reject) => {
        // Como el relay: una acción ligera con la máquina apagada se guarda en su cola.
        if (state !== "online" && isDeferrable(command)) return resolve({ value: null, cached: null, deferred: { queued_at: "2026-10-23T00:00:00Z" } });
        if (state !== "online") return reject({ code: "machine_off" });
        if (silent) return void setTimeout(() => reject({ code: "io", detail: "timeout" }), timeout ?? 50);
        const answer = answers[command];
        if (answer === undefined) return reject({ code: "command" });
        resolve({ value: typeof answer === "function" ? (answer as (a: Args) => unknown)(args as Args) : answer, cached: null });
      });
    },
    onState: () => () => {},
    onEvents: () => () => {},
    subscribe() {},
    start() {},
    close() {},
  };
  return link;
}

const row = (id: string, title = id) => ({ id, title, updated_at: 0 });
const VM: MachineInfo = { id: "cmp_vm", name: "Danil VM", wakes: true };
const MAC: MachineInfo = { id: "cmp_mac", name: "Mac de Ana", wakes: false };

function setup(links: Record<string, ReturnType<typeof fakeLink>>, local: Record<string, unknown> = {}, picked: string | null = null) {
  const native: { command: string; args: Args; options: unknown }[] = [];
  const changes: string[][] = [];
  const fleet = new Fleet({ self: "cmp_home", connect: (info) => links[info.id], deadlines: { read: 40, action: 200, intent: 400 } });
  const answers: Record<string, unknown> = {
    list_workspaces: { workspaces: [{ id: "w", name: "W" }], active: "w" },
    list_live_sessions: [row("t1", "local")],
    list_projects: [{ id: "p1", name: "P1" }],
    danil_sessions: [],
    list_accounts: { accounts: [], active: null },
    send_message: "t9",
    set_active_workspace: null,
    ...local,
  };
  const router = createRouter({
    self: "cmp_home",
    fleet,
    native: async (command, args = {}, options) => {
      native.push({ command, args, options });
      if (!(command in answers)) throw { what: { clave: "shell.service.command" }, detail: "command" };
      return answers[command];
    },
    onSlices: (c) => changes.push(c),
    pickedFor: () => picked,
  });
  fleet.setMachines([VM, MAC].filter((m) => links[m.id]));
  return { router, fleet, native, changes };
}

const on = (machine: string) => ({ headers: { "x-terminus-machine": machine } });
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

test("the machine comes only from the envelope: a VM id in the args of this computer's call is refused before sending", async () => {
  const vm = fakeLink({ load_session: ({ id }: Args) => ({ id }) });
  const { router, native } = setup({ cmp_vm: vm });
  await router.handle("list_workspaces");
  // Llegar al candado es un bug: se registra y la persona ve el fallo genérico, sin la frase de «dos máquinas».
  const logged: unknown[][] = [];
  const error = console.error;
  console.error = (...args: unknown[]) => void logged.push(args);
  try {
    await assert.rejects(router.handle("load_session", { project: "p1", id: "cmp_vm~t1" }), (e: { detail: string; what: unknown }) => {
      assert.equal(e.detail, "cross_machine");
      assert.deepEqual(e.what, { clave: "shell.service.failed" });
      return true;
    });
  } finally {
    console.error = error;
  }
  assert.ok(String(logged[0]?.[0]).includes("cross_machine"), "registered as a failure");
  assert.equal(native.filter((c) => c.command === "load_session").length, 0, "the local engine never got another machine's id");
  assert.equal(vm.calls.length, 0, "and the id did not pick the VM either");
  assert.deepEqual(await router.handle("load_session", { project: "p1", id: "cmp_vm~t1" }, on("cmp_vm")), { id: "cmp_vm~t1" });
  assert.deepEqual(vm.calls.map((c) => [c.command, c.args.id, c.workspace]), [["load_session", "t1", "w"]]);
  console.error = () => {};
  try {
    await assert.rejects(router.handle("send_message", { session: "t1", prompt: "x" }, on("cmp_vm")), (e: { detail: string }) => e.detail === "cross_machine", "a bare id is this computer's");
  } finally {
    console.error = error;
  }
});

test("moving a VM task to this window's space goes to the VM with the same id, after sharing it; no window memory", async () => {
  const vm = fakeLink({ move_task_to_space: ({ space }: Args) => ({ id: space, name: "Trabajo" }) });
  const { router, fleet, native } = setup({ cmp_vm: vm }, { share_space: { id: "s1", name: "Trabajo", folders: [], created_at: 1, updated_at: 1, account: true } });
  fleet.setRegistry([{ id: "w", name: "W", projects: [], computers: ["cmp_vm"] }]);
  await router.handle("list_workspaces");
  const moved = await router.handle("move_task_to_space", { project: "p1", id: "cmp_vm~t1", space: "s1" }, on("cmp_vm"));
  assert.deepEqual(moved, { id: "s1", name: "Trabajo" });
  assert.deepEqual(native.find((c) => c.command === "share_space")?.args, { id: "s1" });
  assert.deepEqual(vm.calls.find((c) => c.command === "move_task_to_space")?.args, { project: "p1", id: "t1", space: "s1" });
});

test("this computer's list answers at once with its own rows; the VM's slice is added when it arrives", async () => {
  const vm = fakeLink({ list_live_sessions: [row("t1", "vm")] });
  const { router, changes } = setup({ cmp_vm: vm });
  await router.handle("list_workspaces");
  const first = (await router.handle("list_live_sessions", { project: "p1", open: ["t1", "cmp_vm~t1"] })) as { id: string }[];
  assert.deepEqual(first.map((r) => r.id), ["t1"], "nothing waited on the VM");
  await sleep(300);
  assert.deepEqual(changes, [["sessions"]], "the window is told to read again");
  const second = (await router.handle("list_live_sessions", { project: "p1", open: ["t1", "cmp_vm~t1"] })) as { id: string; machine?: string; machine_status?: string }[];
  assert.deepEqual(second.map((r) => [r.id, r.machine ?? null, r.machine_status ?? null]), [["t1", null, null], ["cmp_vm~t1", "cmp_vm", "ok"]]);
  assert.deepEqual(vm.calls[0].args.open, ["t1"], "the VM gets only its own open tab");
});

test("a workspace only other machines have, with nobody answering, is a named error and never an empty list", async () => {
  const vm = fakeLink({}, "online", true);
  const { router, fleet, native } = setup({ cmp_vm: vm });
  fleet.setRegistry([{ id: "w2", name: "Producto", projects: [], computers: ["cmp_vm"] }]);
  await router.handle("list_workspaces");
  assert.equal(await router.handle("set_active_workspace", { id: "w2" }), null);
  assert.equal(native.filter((c) => c.command === "set_active_workspace").length, 0, "this computer's engine is not moved to a workspace it lacks");
  const started = Date.now();
  await assert.rejects(router.handle("list_live_sessions", { project: "p1" }), (e: { detail: string }) => e.detail === "machine_timeout");
  assert.ok(Date.now() - started < 1_000, "bounded");
});

test("a workspace only other machines have answers at once from their last slice, and reads again behind", async () => {
  let title = "vieja";
  let slow = false;
  const vm = fakeLink({ list_live_sessions: () => (slow ? new Promise(() => {}) : [row("t1", title)]) });
  const { router, fleet } = setup({ cmp_vm: vm });
  fleet.setRegistry([{ id: "w2", name: "Producto", projects: [], computers: ["cmp_vm"] }]);
  await router.handle("list_workspaces");
  await router.handle("set_active_workspace", { id: "w2" });
  const first = (await router.handle("list_live_sessions", { project: "p1" })) as { title: string }[];
  assert.deepEqual(first.map((r) => r.title), ["vieja"], "with nothing kept, the first read waits for the VM");
  await sleep(1_600);
  title = "nueva";
  slow = true;
  const started = Date.now();
  const again = (await router.handle("list_live_sessions", { project: "p1" })) as { title: string }[];
  assert.ok(Date.now() - started < 30, "with a slice kept, nothing waits on the VM");
  assert.deepEqual(again.map((r) => r.title), ["vieja"]);
  assert.equal(vm.calls.length, 2, "and the VM is asked again behind");
});

test("the account and danil_* always stay on this computer, whatever the header says", async () => {
  const vm = fakeLink({ danil_sessions: [{ account: "x" }], list_accounts: { accounts: [{ id: "a" }] } });
  const { router, native } = setup({ cmp_vm: vm });
  assert.deepEqual(await router.handle("danil_sessions", {}, on("cmp_vm")), []);
  assert.deepEqual(await router.handle("list_accounts", {}), { accounts: [], active: null });
  assert.equal(vm.calls.length, 0);
  assert.deepEqual(native.map((c) => c.command), ["danil_sessions", "list_accounts"]);
});

test("without a pick something new is born on the window's machine; «Ejecutar en» decides only when set", async () => {
  const vm = fakeLink({});
  const plain = setup({ cmp_vm: vm });
  await plain.router.handle("list_workspaces");
  assert.deepEqual(plain.router.createsOn("w"), { machine: "cmp_home", lead: true });
  const list = (await plain.router.handle("machine_list")) as { id: string; active: boolean }[];
  assert.deepEqual(list.map((m) => [m.id, m.active]), [["cmp_home", true], ["cmp_vm", false]], "«Ejecutar en» starts on this computer");
  const picked = setup({ cmp_vm: fakeLink({}) }, {}, "cmp_vm");
  await picked.router.handle("list_workspaces");
  assert.deepEqual(picked.router.createsOn("w"), { machine: "cmp_vm", lead: false });
});

test("an action to the person's own machine that is off says so plainly, without trying to start it", async () => {
  const mac = fakeLink({ send_message: "x" }, "offline");
  const { router } = setup({ cmp_mac: mac });
  await assert.rejects(router.handle("send_message", { project: "p1", session: "cmp_mac~t1", prompt: "hola" }, on("cmp_mac")), (e: { what: string; detail: string }) => {
    assert.equal(e.what, "Mac de Ana está apagada. Enciéndela para seguir.");
    assert.equal(e.detail, "machine_off");
    return true;
  });
  assert.equal(mac.calls.length, 0);
});

test("the workspace listing adds the account's workspaces that live elsewhere, with their machines", async () => {
  const { router, fleet } = setup({ cmp_vm: fakeLink({}) });
  fleet.setRegistry([{ id: "w2", name: "Producto", projects: [], computers: ["cmp_vm"] }]);
  const listed = (await router.handle("list_workspaces")) as { workspaces: { id: string; machines: string[] }[]; active: string };
  assert.deepEqual(listed.workspaces.map((w) => [w.id, w.machines]), [["w", ["cmp_home"]], ["w2", ["cmp_vm"]]]);
  assert.equal(listed.active, "w");
});

test("a file of another machine's task does not open on this computer", async () => {
  const { router, native } = setup({ cmp_vm: fakeLink({}) }, { open_file_external: null });
  await assert.rejects(router.handle("open_file_external", { target: "/x" }, on("cmp_vm")), (e: { detail: string }) => e.detail === "machine_files");
  await assert.rejects(router.handle("tree_open_external", { session: "cmp_vm~t1", path: "a" }), (e: { detail: string }) => e.detail === "machine_files");
  assert.equal(await router.handle("open_file_external", { target: "/x" }), null, "this computer's own opens");
  assert.deepEqual(native.map((c) => c.command), ["open_file_external"]);
});

test("an action on a machine stopped by the license says so by name", async () => {
  const vm = fakeLink({ send_message: "x" });
  Object.assign(vm, { blocked: () => "license_required" as const });
  const { router } = setup({ cmp_vm: vm });
  await assert.rejects(router.handle("send_message", { project: "p1", session: "cmp_vm~t1", prompt: "hola" }, on("cmp_vm")), (e: { what: string; detail: string }) => {
    assert.equal(e.detail, "license_required");
    assert.equal(e.what, "Usar tus otras computadoras desde aquí es parte de Terminus de pago.");
    return true;
  });
  assert.equal(vm.calls.length, 0);
});

test("by the relay every call says its workspace: making one its own included; the engine's refusals are named", async () => {
  const vm = fakeLink({ materialize_workspace: null, send_message: "r1", rename_session: null });
  const { router, fleet } = setup({ cmp_vm: vm });
  fleet.setRegistry([{ id: "w", name: "W", projects: [], computers: ["cmp_home"] }]);
  await router.handle("list_workspaces");
  assert.equal(await router.handle("send_message", { project: "p1", session: null, prompt: "hola" }, on("cmp_vm")), "cmp_vm~r1");
  assert.deepEqual(vm.calls.map((c) => [c.command, c.workspace]), [["materialize_workspace", "w"], ["send_message", "w"]], "never without a workspace");

  const refusing = (code: string, detail: unknown) => {
    const link = fakeLink({});
    link.call = (id, command, workspace) => {
      link.calls.push({ id, command, workspace, args: {} });
      return Promise.reject({ code, detail });
    };
    return link;
  };
  const mismatch = setup({ cmp_vm: refusing("workspace_mismatch", null) });
  await mismatch.router.handle("list_workspaces");
  await assert.rejects(mismatch.router.handle("rename_session", { project: "p1", id: "cmp_vm~t1", title: "x" }, on("cmp_vm")), (e: { what: string; detail: string }) => {
    assert.equal(e.detail, "workspace_mismatch");
    assert.equal(e.what, "Danil VM no deja hacer esto desde aquí: es de otro workspace o de otra cuenta.");
    return true;
  });
  const failed = setup({ cmp_vm: refusing("command_failed", "Por el relay, la llamada tiene que decir de qué workspace es.") });
  await failed.router.handle("list_workspaces");
  await assert.rejects(failed.router.handle("rename_session", { project: "p1", id: "cmp_vm~t1", title: "x" }, on("cmp_vm")), (e: { what: string }) => e.what === "Por el relay, la llamada tiene que decir de qué workspace es.");
  const scoped = setup({ cmp_vm: refusing("command_not_allowed", { command: "rename_session", scope: "machine" }) });
  await scoped.router.handle("list_workspaces");
  await assert.rejects(scoped.router.handle("rename_session", { project: "p1", id: "cmp_vm~t1", title: "x" }, on("cmp_vm")), (e: { what: { clave: string } }) => e.what.clave === "shell.service.command");
});

test("CASE 3: a task created on the VM from this window's space lands in THAT space, shared first with the account", async () => {
  const vm = fakeLink({
    send_message: "t9",
    list_live_sessions: [{ ...row("t9", "vm"), space: "s1" }],
  });
  const { router, fleet, native } = setup(
    { cmp_vm: vm },
    {
      share_space: { id: "s1", name: "Trabajo", folders: [], created_at: 1, updated_at: 1, account: true },
      list_live_sessions: [],
    },
  );
  fleet.setRegistry([{ id: "w", name: "W", projects: [], computers: ["cmp_vm"] }]);
  await router.handle("list_workspaces");
  const task = await router.handle("send_message", { provider: "claude", project: "p1", session: null, prompt: "hola", space: "s1" }, on("cmp_vm"));
  assert.equal(task, "cmp_vm~t9");
  const shared = native.findIndex((c) => c.command === "share_space");
  assert.ok(shared >= 0, "this computer shares its space with the account before");
  assert.deepEqual(native[shared].args, { id: "s1" });
  const sent = vm.calls.find((c) => c.command === "send_message");
  assert.equal(sent?.args.space, "s1", "the VM gets the same space id");

  // The VM's row names that same space, bare: the window paints it in that space.
  await router.handle("list_live_sessions", { project: "p1" });
  await sleep(300);
  const rows = (await router.handle("list_live_sessions", { project: "p1" })) as { id: string; space: string }[];
  assert.deepEqual(rows.map((r) => [r.id, r.space]), [["cmp_vm~t9", "s1"]]);

  // Once shared, the next one does not ask again.
  await router.handle("send_message", { provider: "claude", project: "p1", session: null, prompt: "otra", space: "s1" }, on("cmp_vm"));
  assert.equal(native.filter((c) => c.command === "share_space").length, 1);
});

test("a space that cannot be shared (workspace without account, older engine) is not sent: the task is born as before", async () => {
  const vm = fakeLink({ send_message: "t9" });
  const { router, fleet } = setup({ cmp_vm: vm });
  fleet.setRegistry([{ id: "w", name: "W", projects: [], computers: ["cmp_vm"] }]);
  await router.handle("list_workspaces");
  await router.handle("send_message", { provider: "claude", project: "p1", session: null, prompt: "hola", space: "s1" }, on("cmp_vm"));
  assert.equal(vm.calls.find((c) => c.command === "send_message")?.args.space, null);
});

test("archiving or deleting a task of an off machine (Mac or VM) is queued by the relay: no error, no wake, and the list rereads", async () => {
  const mac = fakeLink({}, "offline");
  const vm = fakeLink({}, "stopped");
  const { router, changes } = setup({ cmp_mac: mac, cmp_vm: vm });
  assert.equal(await router.handle("set_task_archived", { project: "p1", id: "cmp_mac~t1", archived: true }, on("cmp_mac")), null);
  assert.equal(await router.handle("delete_session", { project: "p1", id: "cmp_vm~t2", force: false }, on("cmp_vm")), null);
  assert.deepEqual(mac.calls.map((c) => [c.command, c.args]), [["set_task_archived", { project: "p1", id: "t1", archived: true }]]);
  assert.deepEqual(vm.calls.map((c) => c.command), ["delete_session"], "the VM is not started first");
  await sleep(300);
  assert.ok(changes.flat().includes("sessions"), "the task list reads again");
  // Lo que corre un agente sigue diciendo que la Mac está apagada.
  await assert.rejects(router.handle("send_message", { project: "p1", session: "cmp_mac~t1", prompt: "hola" }, on("cmp_mac")), (e: { detail: string }) => e.detail === "machine_off");
});

/**
 * Una VM apagada que enciende de verdad: el plano de control (`wake`) la pone
 * `starting` y luego `online`; mientras, como el relay, una intención espera
 * guardada y se entrega una vez al conectar, y cualquier otra acción contesta `machine_off`.
 */
function bootingVm(answers: Record<string, unknown>, starts: (() => boolean) = () => true) {
  let state: "stopped" | "starting" | "online" = "stopped";
  const listeners = new Set<(s: string) => void>();
  const delivered: Call[] = [];
  const waiting: (() => void)[] = [];
  const set = (next: typeof state) => {
    state = next;
    for (const l of [...listeners]) l(next);
    if (next === "online") for (const deliver of waiting.splice(0)) deliver();
  };
  const woken: string[] = [];
  const link: Link = {
    state: () => state,
    call(id, command, workspace, _folder, args) {
      return new Promise((resolve, reject) => {
        const deliver = () => {
          delivered.push({ id, command, workspace, args: args as Args });
          resolve({ value: answers[command] ?? null, cached: null });
        };
        if (state === "online") return deliver();
        if (classOf(command) === "intent") {
          waiting.push(deliver);
          if (state === "stopped") {
            set("starting");
            setTimeout(() => set("online"), 20);
          }
          return;
        }
        reject({ code: "machine_off" });
      });
    },
    onState: (l) => {
      listeners.add(l as (s: string) => void);
      return () => listeners.delete(l as (s: string) => void);
    },
    onEvents: () => () => {},
    subscribe() {},
    start() {},
    close() {},
  };
  const wake = async (machine: string) => {
    woken.push(machine);
    if (!starts()) return false;
    set("starting");
    setTimeout(() => set("online"), 20);
    return true;
  };
  return { link, wake, woken, delivered };
}

function bootSetup(vm: ReturnType<typeof bootingVm>) {
  const fleet = new Fleet({ self: "cmp_home", connect: () => vm.link, wake: vm.wake, deadlines: { read: 40, action: 200, intent: 400 } });
  const router = createRouter({
    self: "cmp_home",
    fleet,
    native: async (command) => (command === "list_workspaces" ? { workspaces: [{ id: "w", name: "W" }], active: "w" } : null),
  });
  fleet.setMachines([VM]);
  return router;
}

test("a new task on an off VM: the carry key wakes it once through the control plane, and the first message is delivered exactly once there", async () => {
  const vm = bootingVm({ work_key: { publicKey: "k" }, send_message: "t9" });
  const router = bootSetup(vm);
  await router.handle("list_workspaces");
  // Antes del primer mensaje en otra máquina el escritorio pide la llave del destino: es una acción, no una intención.
  assert.deepEqual(await router.handle("work_key", {}, on("cmp_vm")), { publicKey: "k" });
  assert.deepEqual(vm.woken, ["cmp_vm"], "the control plane is asked to start it, once");
  const task = await router.handle("send_message", { provider: "claude", project: "p1", session: null, prompt: "hola" }, on("cmp_vm"));
  assert.equal(task, "cmp_vm~t9");
  assert.deepEqual(vm.delivered.map((c) => c.command), ["work_key", "send_message"], "each one reaches the engine once");
  assert.deepEqual(vm.woken, ["cmp_vm"], "an awake VM is not started again");
});

test("an off VM that is only sent a message is started by the relay: no control-plane call, delivered once when it connects", async () => {
  const vm = bootingVm({ send_message: "t9" });
  const router = bootSetup(vm);
  await router.handle("list_workspaces");
  assert.equal(await router.handle("send_message", { provider: "claude", project: "p1", session: null, prompt: "hola" }, on("cmp_vm")), "cmp_vm~t9");
  assert.deepEqual(vm.woken, []);
  assert.equal(vm.delivered.filter((c) => c.command === "send_message").length, 1);
});

test("when the control plane refuses to start the VM (the 401 of 2026-10-23) the window says it could not start, and nothing is sent", async () => {
  const vm = bootingVm({ work_key: { publicKey: "k" } }, () => false);
  const router = bootSetup(vm);
  await router.handle("list_workspaces");
  await assert.rejects(router.handle("work_key", {}, on("cmp_vm")), (e: { detail: string }) => e.detail === "start_failed");
  assert.deepEqual(vm.delivered, []);
});
