/**
 * La flota con sesiones de relay falsas: la máquina sale solo del sobre, toda
 * espera tiene tope, una máquina que no contesta conserva su rebanada y nunca
 * se inventa una lista vacía.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { type CallResult, type EventsPage, INTENT_COMMANDS, type MachineState } from "../../computers/src/index.ts";
import { Fleet, type FleetError, type Link, type MachineInfo, type Slice, SLICES_KEY, classOf } from "../src/index.ts";

type Answer = unknown | ((args: Record<string, unknown>) => unknown);
/** `errors`: what the relay answers the next calls, in order, before answering normally. */
type FakeOptions = { state?: MachineState; answers?: Record<string, Answer>; delay?: number; cachedAt?: string | null; error?: string; errors?: string[] };

/** Una sesión de relay en memoria: contesta de `answers`, tarda `delay` y vence como `RelaySession` (`io/timeout`). */
function fakeLink(options: FakeOptions = {}) {
  let state: MachineState = options.state ?? "online";
  const calls: { id: string; command: string; workspace: string | null; args: Record<string, unknown>; timeout?: number }[] = [];
  const stateListeners = new Set<(s: MachineState) => void>();
  const eventListeners = new Set<(p: EventsPage) => void>();
  const engineListeners = new Set<(e: { contract: string | null; host_version: string | null }) => void>();
  let closed = false;
  const subscribed: (number | null)[] = [];
  const link: Link & { calls: typeof calls; setState(s: MachineState): void; push(p: EventsPage): void; hello(contract: string): void; closed(): boolean; subscribed: typeof subscribed; options: FakeOptions } = {
    calls,
    subscribed,
    options,
    state: () => state,
    setState(s) {
      state = s;
      for (const l of stateListeners) l(s);
    },
    push(p) {
      for (const l of eventListeners) l(p);
    },
    hello(contract) {
      for (const l of engineListeners) l({ contract, host_version: null });
    },
    onEngine(l) {
      engineListeners.add(l);
      return () => void engineListeners.delete(l);
    },
    closed: () => closed,
    call(id, command, workspace, _folder, args, timeout) {
      calls.push({ id, command, workspace, args: args as Record<string, unknown>, timeout });
      return new Promise<CallResult>((resolve, reject) => {
        const answer = options.answers?.[command];
        const value = typeof answer === "function" ? (answer as (a: Record<string, unknown>) => unknown)(args as Record<string, unknown>) : answer;
        if (state !== "online") {
          // Como el relay: un intent enciende la VM y se entrega con su `hello`.
          if (INTENT_COMMANDS.has(command)) {
            link.setState("starting");
            return void setTimeout(() => {
              link.setState("online");
              resolve({ value: value ?? null, cached: null });
            }, 20);
          }
          if (options.cachedAt && answer !== undefined) return resolve({ value, cached: { updated_at: options.cachedAt } });
          return reject({ code: "machine_off" });
        }
        const once = options.errors?.shift();
        if (once) return reject({ code: once });
        if (options.error) return reject({ code: options.error });
        const delay = options.delay ?? 0;
        if (timeout !== undefined && delay > timeout) return void setTimeout(() => reject({ code: "io", detail: "timeout" }), timeout);
        setTimeout(() => resolve({ value: value ?? null, cached: null }), delay);
      });
    },
    onState(l) {
      stateListeners.add(l);
      return () => void stateListeners.delete(l);
    },
    onEvents(l) {
      eventListeners.add(l);
      return () => void eventListeners.delete(l);
    },
    subscribe(after) {
      subscribed.push(after);
    },
    start() {},
    close() {
      closed = true;
    },
  };
  return link;
}

type FakeLink = ReturnType<typeof fakeLink>;

const VM: MachineInfo = { id: "cmp_vm", name: "Danil VM", wakes: true };
const MAC: MachineInfo = { id: "cmp_mac", name: "Mac de Ana", wakes: false };
const row = (id: string, title = `Tarea ${id}`) => ({ id, title, updated_at: 0 });

function memoryStorage(seed: Record<string, string> = {}) {
  const items = new Map(Object.entries(seed));
  return { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v), removeItem: (k: string) => void items.delete(k), items };
}

function setup(links: Record<string, FakeOptions>, machines: MachineInfo[] = [VM, MAC], extra: Partial<ConstructorParameters<typeof Fleet>[0]> = {}) {
  const made: Record<string, FakeLink[]> = {};
  const changes: string[] = [];
  const fleet = new Fleet({
    self: "cmp_home",
    connect: (info) => {
      const link = fakeLink(links[info.id] ?? {});
      (made[info.id] ??= []).push(link);
      return link;
    },
    deadlines: { read: 40, action: 200, intent: 400 },
    onChange: (m) => changes.push(m),
    ...extra,
  });
  fleet.setMachines(machines);
  const link = (id: string) => made[id]?.at(-1) as FakeLink;
  return { fleet, made, link, changes };
}

const local = (value: unknown): Slice => ({ machine: "cmp_home", status: "ok", has: true, value, at: Date.now() });

test("the machine comes only from the envelope: an id of another machine in the args is refused before sending", async () => {
  const { fleet, link } = setup({ cmp_vm: { answers: { load_session: ({ id }: Record<string, unknown>) => ({ id }) } }, cmp_mac: {} });
  await assert.rejects(fleet.call({ machine: "cmp_vm", workspace: "w", command: "load_session", args: { project: "p1", id: "cmp_mac~t1" } }), (e: FleetError) => {
    assert.equal(e.code, "cross_machine");
    assert.equal(e.machine, "cmp_mac");
    return true;
  });
  // A bare task id is the window's own: it never travels to the VM.
  await assert.rejects(fleet.call({ machine: "cmp_vm", workspace: "w", command: "send_message", args: { session: "t1", prompt: "hola" } }), (e: FleetError) => e.code === "cross_machine" && e.machine === "cmp_home");
  await assert.rejects(fleet.call({ machine: "cmp_vm", workspace: "w", command: "send_message", args: { project: "p1", session: null, space: "cmp_mac~s1" } }), (e: FleetError) => e.code === "cross_machine");
  assert.equal(link("cmp_vm").calls.length + link("cmp_mac").calls.length, 0, "nothing was sent anywhere");

  const own = await fleet.call({ machine: "cmp_vm", workspace: "w", command: "load_session", args: { project: "p1", id: "cmp_vm~t1" } });
  assert.deepEqual(own, { id: "cmp_vm~t1" }, "its own id goes bare and comes back with its prefix");
  assert.deepEqual(link("cmp_vm").calls.map((c) => [c.command, c.args.id, c.workspace]), [["load_session", "t1", "w"]]);
});

test("a tab of another machine's task never moves a read: each machine gets only its own open ids", async () => {
  const { fleet, link } = setup({ cmp_vm: { answers: { list_live_sessions: [row("t1")] } }, cmp_mac: { answers: { list_live_sessions: [row("t1")] } } });
  const args = { project: "p1", open: ["t1", "cmp_vm~t1", "cmp_mac~t9"] };
  await fleet.read({ machine: "cmp_vm", workspace: "w", command: "list_live_sessions", args });
  await fleet.read({ machine: "cmp_mac", workspace: "w", command: "list_live_sessions", args });
  assert.deepEqual(link("cmp_vm").calls[0].args.open, ["t1"]);
  assert.deepEqual(link("cmp_mac").calls[0].args.open, ["t9"]);
  assert.deepEqual(fleet.argsFor("cmp_home", args).open, ["t1"], "the window's engine gets only its own");
});

test("a slow VM is cut at the read deadline, retried once and left as no answer with its previous slice", async () => {
  let slow = false;
  const { fleet, link } = setup({ cmp_vm: { answers: { list_live_sessions: () => [row("t1", slow ? "nueva" : "vieja")] } } });
  const envelope = { machine: "cmp_vm", workspace: "w", command: "list_live_sessions", args: { project: "p1" } };
  const first = await fleet.read(envelope);
  assert.equal(first.status, "ok");
  slow = true;
  link("cmp_vm").options.delay = 10_000;
  const started = Date.now();
  const second = await fleet.read(envelope);
  assert.ok(Date.now() - started < 1_000, "the wait is bounded");
  assert.equal(second.status, "no_answer");
  assert.equal(second.error, "machine_timeout");
  assert.deepEqual(second.value, [row("t1", "vieja")], "the previous slice stays");
  assert.equal(link("cmp_vm").calls.length, 3, "one read, then the slow one and a single retry");
  assert.deepEqual(link("cmp_vm").calls.map((c) => c.timeout), [40, 40, 40]);
});

test("a VM off with no copy adds nothing, and nobody answering is no answer, never an empty list", async () => {
  const { fleet } = setup({ cmp_vm: { state: "stopped" }, cmp_mac: { delay: 10_000, answers: { list_live_sessions: [row("t2")] } } });
  const read = (machine: string) => fleet.read({ machine, workspace: "w", command: "list_live_sessions", args: { project: "p1" } });
  const [vm, mac] = await Promise.all([read("cmp_vm"), read("cmp_mac")]);
  assert.deepEqual([vm.status, vm.has], ["off", false]);
  assert.deepEqual([mac.status, mac.has], ["no_answer", false]);
  assert.equal(fleet.merge("list_live_sessions", [vm, mac], "w"), undefined, "nothing to show is not []");
  assert.equal(fleet.merge("list_projects", [vm, mac], "w"), undefined);
  assert.deepEqual(fleet.merge("list_live_sessions", [local([row("t1")]), vm, mac], "w"), [row("t1")], "the window's own slice still paints");
});

test("a VM off answers from the relay's copy with its time; a copy kept here survives a restart as cached", async () => {
  const storage = memoryStorage();
  const { fleet } = setup({ cmp_vm: { state: "stopped", cachedAt: "2026-10-18T21:30:00Z", answers: { list_live_sessions: [row("t1")] } } }, [VM], { storage });
  const slice = await fleet.read({ machine: "cmp_vm", workspace: "w", command: "list_live_sessions", args: { project: "p1" } });
  assert.equal(slice.status, "cached");
  assert.equal(slice.at, Date.parse("2026-10-18T21:30:00Z"));
  fleet.flush();
  assert.ok(storage.items.get(SLICES_KEY));

  const later = setup({ cmp_vm: { state: "stopped" } }, [VM], { storage });
  const kept = later.fleet.peek({ machine: "cmp_vm", workspace: "w", command: "list_live_sessions", args: { project: "p1" } });
  assert.equal(kept?.status, "cached");
  assert.deepEqual(kept?.value, [row("t1")]);
  const again = await later.fleet.read({ machine: "cmp_vm", workspace: "w", command: "list_live_sessions", args: { project: "p1" } });
  assert.deepEqual([again.status, again.value], ["cached", [row("t1")]], "machine_off keeps the copy instead of emptying it");
});

test("merged rows say their machine and the state of its slice; the window's rows stay as they are", async () => {
  const { fleet } = setup({ cmp_vm: { answers: { list_live_sessions: [{ ...row("t1"), updated_at: 5 }] } } }, [VM]);
  const vm = await fleet.read({ machine: "cmp_vm", workspace: "w", command: "list_live_sessions", args: { project: "p1" } });
  const merged = fleet.merge("list_live_sessions", [local([{ ...row("t1"), updated_at: 1 }]), vm], "w") as Record<string, unknown>[];
  assert.deepEqual(merged.map((r) => [r.id, r.machine ?? null, r.machine_status ?? null, r.machine_on ?? null]), [["cmp_vm~t1", "cmp_vm", "ok", true], ["t1", null, null, null]]);
});

test("workspace members come from the account registry, not from whoever answered last", () => {
  const { fleet } = setup({}, [VM, MAC]);
  fleet.setRegistry([{ id: "w", name: "W", projects: [], computers: ["cmp_home", "cmp_vm"] } as never]);
  assert.deepEqual(fleet.membersOf("w"), ["cmp_vm"]);
  assert.deepEqual(fleet.membersOf("w9"), [], "a workspace the account does not have has no remote members");
  fleet.setRegistry(null);
  fleet.setMachines([{ ...VM, linked: new Set(["w"]) }, { ...MAC, linked: new Set(["w2"]) }]);
  assert.deepEqual(fleet.membersOf("w"), ["cmp_vm"], "without a registry, the links say it");
});

test("machines are added, removed and renamed live without reconnecting the others", async () => {
  const { fleet, made, changes } = setup({ cmp_vm: { answers: { list_live_sessions: [row("t1")] } } }, [VM, MAC]);
  await fleet.read({ machine: "cmp_vm", workspace: "w", command: "list_live_sessions", args: { project: "p1" } });
  fleet.setMachines([{ ...VM, name: "VM renombrada" }, MAC]);
  assert.equal(fleet.name("cmp_vm"), "VM renombrada");
  assert.equal(made.cmp_vm.length, 1, "a rename does not reconnect");
  assert.equal(made.cmp_vm[0].closed(), false);
  assert.ok(fleet.peek({ machine: "cmp_vm", workspace: "w", command: "list_live_sessions", args: { project: "p1" } })?.has, "its slice stays");
  fleet.setMachines([{ ...VM, name: "VM renombrada" }, { id: "cmp_vm2", name: "VM 2", wakes: true }]);
  assert.equal(made.cmp_mac[0].closed(), true, "a machine that left is closed");
  assert.equal(fleet.has("cmp_mac"), false);
  assert.equal(made.cmp_vm2.length, 1, "a new one connects");
  assert.equal(made.cmp_vm.length, 1, "the others are untouched");
  assert.ok(changes.includes("cmp_vm") && changes.includes("cmp_mac") && changes.includes("cmp_vm2"));
});

test("an action to an own machine that is off fails at once with machine_off; to a VM it wakes it first", async () => {
  const woken: string[] = [];
  const { fleet, link } = setup({ cmp_vm: { state: "stopped", answers: { rename_session: null, send_message: "t1" } }, cmp_mac: { state: "offline" } }, [VM, MAC], {
    wake: async (machine) => {
      woken.push(machine);
      setTimeout(() => link(machine).setState("online"), 20);
      return true;
    },
  });
  await assert.rejects(fleet.call({ machine: "cmp_mac", workspace: "w", command: "send_message", args: { project: "p1" } }), (e: FleetError) => e.code === "machine_off" && !e.canWake);
  assert.equal(link("cmp_mac").calls.length, 0, "nothing tries to start the person's own machine");

  await fleet.call({ machine: "cmp_vm", workspace: "w", command: "rename_session", args: { project: "p1", id: "cmp_vm~t1", title: "x" } });
  assert.deepEqual(woken, ["cmp_vm"], "a non-intent action starts the VM through the control plane first");
  assert.equal(link("cmp_vm").calls.at(-1)?.timeout, 200);
});

test("an intent to an off VM goes to the relay, which starts it, with the intent deadline", async () => {
  const { fleet, link } = setup({ cmp_vm: { state: "stopped", answers: { send_message: "r7" } } }, [VM]);
  assert.equal(await fleet.call({ machine: "cmp_vm", workspace: "w", command: "send_message", args: { project: "p1", session: null } }), "cmp_vm~r7");
  assert.equal(link("cmp_vm").calls.length, 1, "sent once");
  assert.equal(link("cmp_vm").calls[0].timeout, 400);
  assert.equal(fleet.power("cmp_vm"), "on");
});

test("a machine whose engine speaks another contract is marked outdated and cleared by its next compatible hello", async () => {
  const { fleet, link } = setup({ cmp_vm: { error: "version_mismatch" } }, [VM], { compatible: (c) => (c ? c === "mine" : null) });
  const slice = await fleet.read({ machine: "cmp_vm", workspace: "w", command: "list_projects", args: {} });
  assert.equal(slice.status, "outdated");
  assert.equal(fleet.power("cmp_vm"), "outdated");
  await assert.rejects(fleet.call({ machine: "cmp_vm", workspace: "w", command: "send_message", args: {} }), (e: FleetError) => e.code === "version_mismatch");
  link("cmp_vm").setState("online");
  assert.equal(fleet.power("cmp_vm"), "outdated", "coming online alone says nothing about its contract");
  link("cmp_vm").hello("theirs");
  assert.equal(fleet.power("cmp_vm"), "outdated");
  link("cmp_vm").hello("mine");
  assert.equal(fleet.power("cmp_vm"), "on", "the engine caught up");
});

test("a contract the control plane listed as old is cleared by the engine's hello, and a new hello can mark it again", () => {
  const { fleet, link } = setup({}, [{ ...VM, outdated: true }], { compatible: (c) => (c ? c === "mine" : null) });
  assert.equal(fleet.power("cmp_vm"), "outdated");
  link("cmp_vm").hello("mine");
  assert.equal(fleet.power("cmp_vm"), "on");
  link("cmp_vm").hello("theirs");
  assert.equal(fleet.power("cmp_vm"), "outdated");
});

test("the relay's machine_timeout and machine_lost are named states, retried once and never waited past", async () => {
  const { fleet, link } = setup({ cmp_vm: { answers: { list_projects: [{ id: "p1" }], send_message: "r1" } } }, [VM]);
  const envelope = { machine: "cmp_vm", workspace: "w", command: "list_projects", args: {} };
  await fleet.read(envelope);
  link("cmp_vm").options.errors = ["machine_timeout", "machine_timeout"];
  const late = await fleet.read(envelope);
  assert.deepEqual([late.status, late.error, late.value], ["no_answer", "machine_timeout", [{ id: "p1" }]], "a read the relay cut keeps the previous slice");
  link("cmp_vm").options.errors = ["machine_lost"];
  const again = await fleet.read(envelope);
  assert.equal(again.status, "ok", "a lost connector is retried once");

  link("cmp_vm").options.errors = ["machine_lost"];
  const before = link("cmp_vm").calls.length;
  assert.equal(await fleet.call({ machine: "cmp_vm", workspace: "w", command: "send_message", args: { project: "p1", session: null } }), "cmp_vm~r1");
  const sent = link("cmp_vm").calls.slice(before);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].id, sent[1].id, "an intent retried keeps its id: the relay never delivers it twice");
  link("cmp_vm").options.errors = ["machine_timeout"];
  await assert.rejects(fleet.call({ machine: "cmp_vm", workspace: "w", command: "send_message", args: { project: "p1", session: null } }), (e: FleetError) => e.code === "machine_timeout", "an intent the relay timed out is not resent");
});

test("events of another machine arrive with the panel's ids; a machine that comes on asks for a reread", () => {
  const seen: [string, unknown[], boolean][] = [];
  const { fleet, link } = setup({ cmp_vm: { state: "offline" } }, [VM], { onEvents: (m, events, gap) => seen.push([m, events, gap]) });
  fleet.subscribeEvents();
  assert.deepEqual(link("cmp_vm").subscribed, [null]);
  link("cmp_vm").push({ cursor: 1, events: [{ name: "turn", payload: { session: "t1" } }] });
  link("cmp_vm").setState("online");
  assert.deepEqual(seen, [["cmp_vm", [{ name: "turn", payload: { session: "cmp_vm~t1" } }], false], ["cmp_vm", [], true]]);
});

test("projects keep one row per id with the machines that have them, and the registry fills the rest", async () => {
  const { fleet } = setup({ cmp_vm: { answers: { list_projects: [{ id: "p1", name: "P1" }, { id: "p2", name: "P2", materialized: false, remote_url: "https://x/p2" }] } } }, [VM]);
  fleet.setRegistry([{ id: "w", name: "W", computers: ["cmp_vm"], projects: [{ id: "p3", name: "P3", remote_url: null, home_computer_id: "cmp_vm" }] } as never]);
  const vm = await fleet.read({ machine: "cmp_vm", workspace: "w", command: "list_projects", args: {} });
  const merged = fleet.merge("list_projects", [local([{ id: "p1", name: "P1" }]), vm], "w") as Record<string, unknown>[];
  assert.deepEqual(merged.map((p) => [p.id, p.machines]), [["p1", ["cmp_home", "cmp_vm"]], ["p2", []], ["p3", ["cmp_vm"]]]);
});

test("carry: a bare task id never travels to another machine, work_export wakes like an intent, and the fleet can wake a VM on request", async () => {
  const woken: string[] = [];
  const { fleet, link } = setup({ cmp_vm: { state: "stopped", answers: { work_status: { ahead: 0 } } }, cmp_mac: { state: "offline" } }, [VM, MAC], {
    wake: async (machine) => {
      woken.push(machine);
      setTimeout(() => link(machine).setState("online"), 20);
      return true;
    },
  });
  assert.equal(classOf("work_export"), "intent");
  await assert.rejects(fleet.call({ machine: "cmp_vm", workspace: "w", command: "work_status", args: { project: "p1", task: "t1" } }), (e: FleetError) => e.code === "cross_machine");
  assert.deepEqual(fleet.argsFor("cmp_vm", { task: "cmp_vm~t1", transfer: "tx-1" }), { task: "t1", transfer: "tx-1" }, "its own task goes bare; the client's transfer id is never touched");
  await assert.rejects(fleet.wake("cmp_mac"), (e: FleetError) => e.code === "machine_off" && !e.canWake, "the person's own machine is not started");
  await fleet.wake("cmp_vm");
  assert.deepEqual(woken, ["cmp_vm"]);
  assert.equal(fleet.power("cmp_vm"), "on");
  await fleet.wake("cmp_vm");
  assert.deepEqual(woken, ["cmp_vm"], "an awake machine is not started again");
});
