/**
 * El escritorio con la cuenta de Danil, local primero (`features/machines/router.ts`)
 * con la flota de verdad (`@terminus/fleet`), sesiones de relay falsas y un IPC
 * nativo simulado: lo de aquí nunca espera a otra máquina, la máquina sale solo
 * del sobre y nadie contestando nunca es una lista vacía.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Fleet, type Link, type MachineInfo } from "@terminus/fleet";
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
  await assert.rejects(router.handle("load_session", { project: "p1", id: "cmp_vm~t1" }), (e: { detail: string; what: string }) => {
    assert.equal(e.detail, "cross_machine");
    assert.equal(e.what, "Esto junta cosas de dos máquinas distintas y no se puede hacer.");
    return true;
  });
  assert.equal(native.filter((c) => c.command === "load_session").length, 0, "the local engine never got another machine's id");
  assert.equal(vm.calls.length, 0, "and the id did not pick the VM either");
  assert.deepEqual(await router.handle("load_session", { project: "p1", id: "cmp_vm~t1" }, on("cmp_vm")), { id: "cmp_vm~t1" });
  assert.deepEqual(vm.calls.map((c) => [c.command, c.args.id, c.workspace]), [["load_session", "t1", "w"]]);
  await assert.rejects(router.handle("send_message", { session: "t1", prompt: "x" }, on("cmp_vm")), (e: { detail: string }) => e.detail === "cross_machine", "a bare id is this computer's");
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
