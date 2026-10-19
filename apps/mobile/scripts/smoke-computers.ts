/**
 * Recorre la capa de datos de la app (`src/lib/hosts.ts` y `engine.ts`, sin
 * React Native) contra el Danil Computers falso, por HTTP y WebSocket reales:
 *
 *   node apps/mobile/scripts/smoke-computers.ts
 *
 * No prueba pantallas (eso se mira en el simulador); prueba lo que hay debajo:
 * la lista de máquinas, el reparto entre máquinas, la copia del espejo con la
 * VM apagada, que una acción la encienda, que una máquina propia apagada no se
 * intente, permisos y avisos, y la lista cerrada de comandos.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { listComputers } from "@terminus/computers";
import type { EngineEvent } from "@terminus/protocol";
import { type Notice, createTask, defaultsFor, loadTask, mergeSnapshots, noticer, respondPermission, snapshotOf, workspacesOf } from "../src/lib/engine.ts";
import { type Host, HostError, relayHost } from "../src/lib/hosts.ts";

const here = dirname(fileURLToPath(import.meta.url));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fake(port: number, ...flags: string[]) {
  const child = spawn(process.execPath, [join(here, "fake-computers.mjs"), "--port", String(port), ...flags], { stdio: ["ignore", "pipe", "inherit"] });
  await new Promise<void>((done) => child.stdout.once("data", () => done()));
  return child;
}

async function until(what: string, check: () => boolean, ms = 5_000) {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timeout: ${what}`);
    await sleep(50);
  }
}

async function hostsAt(endpoint: string) {
  const answer = await listComputers(endpoint, "fake-jwt");
  assert.equal(answer.kind, "ok");
  const computers = answer.kind === "ok" ? answer.value : [];
  const hosts = computers.map((c) => relayHost(c, { endpoint, getToken: () => "fake-jwt" }));
  const events = new Map<string, EngineEvent[]>();
  for (const h of hosts) h.onEvents((list) => events.set(h.id, [...(events.get(h.id) ?? []), ...list]));
  await sleep(200);
  return { hosts, events, byId: (id: string) => hosts.find((h) => h.id === id) as Host };
}

const steps: string[] = [];
const ok = (step: string) => {
  steps.push(step);
  console.log(`  ok  ${step}`);
};

// --- 1. VM apagada con copia, Mac encendida ---------------------------------------
{
  const port = 18787;
  const child = await fake(port);
  const endpoint = `http://127.0.0.1:${port}`;
  try {
    assert.equal((await listComputers(endpoint, "otro")).kind, "unauthorized");
    const { hosts, events, byId } = await hostsAt(endpoint);
    const vm = byId("cmp_vm");
    const mac = byId("cmp_mac");
    assert.equal(vm.managed, true);
    assert.equal(mac.managed, false);
    assert.equal(vm.power(), "off");
    assert.equal(mac.power(), "on");
    ok("lista de máquinas: VM administrada apagada, Mac propia encendida; abrirlas no enciende nada");

    await assert.rejects(vm.call("delete_workspace" as never, "w", {}), (e: HostError) => e.code === "command_not_allowed");
    ok("la lista cerrada: un comando fuera de APP_COMMANDS ni se envía");

    const [vmWs, macWs] = await Promise.all([workspacesOf(vm), workspacesOf(mac)]);
    assert.deepEqual(vmWs.list.map((w) => w.id), ["w"]);
    assert.ok(vmWs.cachedAt !== null, "la VM contesta desde el espejo");
    assert.equal(macWs.cachedAt, null);
    const parts = await Promise.all([snapshotOf(vm, "w"), snapshotOf(mac, "w")]);
    const merged = mergeSnapshots(parts, (id) => ({ machine: byId(id).label, on: byId(id).power() === "on" }));
    assert.deepEqual(merged.folders.map((f) => [f.id, f.hosts.length]), [["p1", 2], ["p2", 1]]);
    assert.equal(merged.tasks.length, 3);
    assert.ok(merged.tasks.every((t) => t.machine));
    assert.equal(merged.tasks.find((t) => t.id === "t-vm-1")?.machine_on, false);
    assert.deepEqual(merged.agents.map((a) => a.name), ["Ada"]);
    assert.ok(merged.cachedAt !== null);
    assert.equal(vm.power(), "off", "leer no enciende la VM");
    ok("reparto: el workspace de las dos máquinas, tareas etiquetadas con su máquina, copia del espejo con la VM apagada");

    const cached = await loadTask(vm, "w", "p1", "t-vm-1");
    assert.ok(cached.cachedAt !== null);
    assert.equal(cached.session.turns.length, 2);
    ok("una tarea de la VM apagada se lee de la copia, con su hora");

    const vmNotices = noticer("cmp_vm");
    const defaults = await defaultsFor(vm, "w", merged.tasks, null);
    assert.equal(defaults.provider, "codex");
    const created = createTask(vm, "w", { folder: "p1", prompt: "Escribe el changelog", ...defaults, agent: null, space: null });
    await until("la VM se enciende", () => vm.power() === "starting" || vm.power() === "on");
    const id = await created;
    assert.equal(vm.power(), "on");
    await until("el turno termina", () => (events.get("cmp_vm") ?? []).some((e) => e.name === "chat" && (e.payload as { kind: string; session: string }).kind === "done" && (e.payload as { session: string }).session === id));
    const live = await loadTask(vm, "w", "p1", id);
    assert.equal(live.cachedAt, null);
    assert.equal(live.session.turns.at(-1)?.text, "Listo.");
    const notices: Notice[] = (events.get("cmp_vm") ?? []).flatMap((e) => vmNotices.take(e));
    assert.ok(notices.some((n) => n.state === "finished" && n.session === id));
    ok("Nueva tarea en la VM apagada: la enciende el relay, el turno corre y llega el aviso de terminada");

    const macNotices = noticer("cmp_mac");
    const pid = await createTask(mac, "w", { folder: "p2", prompt: "Pide permiso para borrar build", provider: "claude", model: null, agent: null, space: null });
    await until("pide permiso", () => (events.get("cmp_mac") ?? []).some((e) => e.name === "chat" && (e.payload as { kind: string }).kind === "permission"));
    const waiting = await loadTask(mac, "w", "p2", pid);
    assert.equal(waiting.permissions.length, 1);
    assert.equal(waiting.running, true);
    await respondPermission(mac, "w", pid, waiting.permissions[0].request_id, true);
    await until("termina tras aprobar", () => (events.get("cmp_mac") ?? []).some((e) => e.name === "chat" && (e.payload as { kind: string; session: string }).kind === "done" && (e.payload as { session: string }).session === pid));
    const after = (events.get("cmp_mac") ?? []).flatMap((e) => macNotices.take(e));
    assert.ok(after.some((n) => n.state === "approving" && n.session === pid));
    assert.ok(after.some((n) => n.state === "finished" && n.session === pid));
    assert.equal((await loadTask(mac, "w", "p2", pid)).permissions.length, 0);
    ok("en la Mac: la tarea pide permiso, se aprueba desde el teléfono y termina; avisos de aprobación y de terminada");

    for (const h of hosts) h.close();
  } finally {
    child.kill();
  }
}

// --- 2. La Mac apagada no se intenta despertar ------------------------------------
{
  const port = 18788;
  const child = await fake(port, "--mac-off");
  const endpoint = `http://127.0.0.1:${port}`;
  try {
    const { hosts, byId } = await hostsAt(endpoint);
    const mac = byId("cmp_mac");
    assert.equal(mac.power(), "off");
    assert.equal(mac.canAct(), "asleep");
    const ws = await workspacesOf(mac);
    assert.deepEqual(ws.list, [], "sin copia, una lectura apagada es vacía, no un error");
    await assert.rejects(
      createTask(mac, "w", { folder: "p2", prompt: "hola", provider: "claude", model: null, agent: null, space: null }),
      (e: HostError) => e.code === "machine_asleep",
    );
    assert.equal(mac.power(), "off");
    ok("una máquina propia apagada: lecturas vacías sin error y la acción no se manda (machine_asleep)");
    for (const h of hosts) h.close();
  } finally {
    child.kill();
  }
}

console.log(`\n${steps.length} pasos comprobados.`);
process.exit(0);
