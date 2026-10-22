/**
 * Llevar el trabajo de una carpeta de esta Mac a la VM elegida en «Ejecutar en»:
 * al enviar se abre la hoja con lo que hay sin subir, «Llevar y enviar» copia
 * por partes con la máquina en la cabecera y la tarea nace en la VM sobre la
 * foto. Si la copia se corta, el mensaje vuelve a la caja y «Reintentar» sigue
 * desde la parte que faltaba. El proxy (`fleet.rs`) se simula con sus
 * respuestas por máquina. Monta `dist/`.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { boot, sleep } from "../helpers/jsdom-app.mjs";

const PAYLOAD = Buffer.from("bundle y archivos de la foto").toString("base64");
const STATUS = {
  branch: "feat/run-on-bundle", head: "a1", upstream: "origin/feat/run-on-bundle", remoteBase: "9f",
  remoteUrl: "https://github.com/danil-labs/p1.git", ahead: 3, changed: 5, untracked: 2,
  largeUntracked: [{ path: "data/big.csv", bytes: 300 * 1024 * 1024 }],
  ignored: [{ path: ".env.local", bytes: 812, suggested: true }, { path: ".claude/settings.local.json", bytes: 1100, suggested: false }],
  ignoredSkipped: ["node_modules/"], lfs: false, submodules: true, takenAt: 1_760_000_000,
};

const machineOf = (options) => new Headers(options?.headers).get("x-terminus-machine") ?? "local";

function responses(log, overrides = {}) {
  const at = (name, fn) => (args, options) => {
    log.push({ name, machine: machineOf(options), args });
    return fn(args, options);
  };
  return {
    window_ready: null,
    window_vitals: null,
    setup_required: false,
    list_providers: [{ id: "codex", label: "Codex", available: true, driver: true }],
    list_workspaces: { workspaces: [{ id: "w", name: "W", context_root: null }], active: "w" },
    workspaces_startup: { workspaces: [{ id: "w", name: "W", context_root: null }], active: "w" },
    list_projects: () => [{ id: "p1", name: "P1", working_directory: "/lab/p1", kind: "git", portfolio: null, sources: [] }],
    list_portfolios: [],
    list_sources: [],
    list_agents: { agents: [], rechazados: [] },
    list_agent_status: [],
    list_mentions: { fuentes: [], archivos: [] },
    list_models: { provider: "codex", models: [{ id: "gpt-5.6", label: "GPT-5.6", gratis: null, note: null, efforts: [], default_effort: null }], fallback: false },
    list_surfaces: [{ id: "codex", provider: "codex", label: "Codex", catalogo: "todo", usable: true, marca: null, porque: null }],
    session_folder: "/tmp",
    list_task_trees: [],
    list_live_sessions: [],
    watch_task_tree: "watch",
    unwatch_task_tree: null,
    task_history: { history: { archived: false, events: [], recovery: null }, branch: null, path: "/lab", available: true, owned: false, restorable: false, recreatable: false, incomplete: false },
    list_live_turns: [],
    list_active_turns: [],
    load_queue: [],
    save_queue: null,
    session_usage: null,
    list_session_git: {},
    turn_authors: { person: null, agent: null },
    service_filter: null,
    project_base_branches: { branches: [], selected: null },
    load_session: ({ id }) => ({ id, provider: "codex", sources: [], model: "gpt-5.6", effort: null, permission_mode: null, turns: [] }),
    service_poll: () => sleep(40).then(() => ({ cursor: 1, gap: false, replay: false, runtime: "lab", reset: false })),
    machine_list: [
      { id: "local", local: true, active: true, on: true, hosts: true },
      { id: "vm", local: false, active: false, on: true, hosts: true },
    ],
    work_status: at("work_status", () => STATUS),
    work_export: at("work_export", ({ operation }) => ({ transfer: `t-${operation}`, bytes: Buffer.from(PAYLOAD, "base64").length, sha256: "abc", head: "a1", wip: "w1", base: "9f" })),
    work_read_part: at("work_read_part", () => ({ data: PAYLOAD, eof: true })),
    work_write_part: at("work_write_part", () => ({ received: 1 })),
    work_import: at("work_import", ({ probe }) => (probe ? { head: "", base: "", branch: null, files: [], snapshot: false } : { head: "a1", base: "w1", branch: null, files: [".env.local"], snapshot: true })),
    work_cancel: at("work_cancel", () => null),
    send_message: at("send_message", () => "r1"),
    ...overrides,
  };
}

const until = async (check, ms = 4000) => {
  for (let waited = 0; waited < ms; waited += 50) {
    if (check()) return true;
    await sleep(50);
  }
  return false;
};

async function start(name, log, overrides) {
  const app = await boot("listo", name, responses(log, overrides), undefined, { "harness.layout.machines.run_on": JSON.stringify({ w: "vm" }) });
  await sleep(600);
  const doc = app.w.document;
  const button = (label) => [...doc.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith(label));
  doc.querySelector('button[aria-label="Proyecto"]').click();
  assert.ok(await until(() => [...doc.querySelectorAll("button")].some((b) => b.textContent?.includes("P1"))), "no se abre el selector de proyecto");
  [...doc.querySelectorAll("[role=menu] button, [role=dialog] button, button")].find((b) => b.textContent?.trim().startsWith("P1")).click();
  await sleep(300);
  return { app, doc, button };
}

async function write(app, message) {
  const field = app.w.document.querySelector("textarea");
  field.value = message;
  field.dispatchEvent(new app.w.Event("input", { bubbles: true }));
  field.closest("form").dispatchEvent(new app.w.Event("submit", { bubbles: true, cancelable: true }));
}

test("enviar a la VM con trabajo sin subir abre la hoja, copia por partes y la tarea nace en la foto", async () => {
  const log = [];
  const { app, doc } = await start("carry-window", log);
  await write(app, "arregla el login");
  assert.ok(await until(() => doc.querySelector("[data-carry-sheet]")), "no se abrió la hoja de llevar");
  const sheet = doc.querySelector("[data-carry-sheet]");
  assert.ok(sheet.textContent.includes("3 commits sin push en feat/run-on-bundle"), sheet.textContent);
  assert.equal(doc.querySelector('[data-carry-ignored=".env.local"]').checked, true, "el .env no sale marcado");
  assert.equal(doc.querySelector('[data-carry-ignored=".claude/settings.local.json"]').checked, false);
  assert.equal(doc.querySelector('[data-carry-large="data/big.csv"]').checked, false, "el archivo nuevo grande sale marcado (D2)");
  assert.ok(doc.querySelector('[data-carry-notice="submodules"]'), "no avisa de los submódulos");
  assert.equal(doc.querySelector("textarea").value, "arregla el login", "el mensaje no espera en la caja");
  assert.equal(log.filter((c) => c.name === "send_message").length, 0, "se envió antes de decidir");
  assert.deepEqual(log.find((c) => c.name === "work_status"), { name: "work_status", machine: "local", args: { project: "p1", task: null } });

  assert.ok(await until(() => doc.querySelector("[data-carry-confirm]")?.disabled === false), "la hoja no supo el tamaño");
  const exported = log.filter((c) => c.name === "work_export").at(-1);
  assert.equal(exported.machine, "local");
  assert.deepEqual([exported.args.files, exported.args.exclude, exported.args.includeWork], [[".env.local"], ["data/big.csv"], true]);
  doc.querySelector("[data-carry-confirm]").click();

  assert.ok(await until(() => log.some((c) => c.name === "send_message")), "la tarea no se creó");
  const order = log.filter((c) => c.name !== "work_status" && c.name !== "work_export").map((c) => `${c.name}@${c.machine}${c.args.probe ? ":probe" : ""}`);
  assert.deepEqual(order, ["work_import@vm:probe", "work_read_part@local", "work_write_part@vm", "work_import@vm", "send_message@vm"]);
  const sent = log.find((c) => c.name === "send_message").args;
  assert.deepEqual([sent.baseRef, sent.unwrapSnapshot, sent.prompt], ["w1", true, "arregla el login"]);
  assert.equal(log.find((c) => c.name === "work_write_part").args.transfer, exported.args.operation ? `t-${exported.args.operation}` : undefined, "se copió otra transferencia");
  assert.equal(doc.querySelector("[data-carry-sheet]"), null);
  assert.ok(await until(() => doc.querySelector("[data-carry-origin]")?.textContent.includes("feat/run-on-bundle")), "la tarea no dice que es una copia");
  assert.deepEqual(app.fallos, []);
});

test("si la copia se corta el mensaje vuelve a la caja y reintentar sigue sin volver a exportar", async () => {
  const log = [];
  let fail = true;
  const { app, doc } = await start("carry-window-retry", log, {
    work_write_part: (args, options) => {
      log.push({ name: "work_write_part", machine: machineOf(options), args });
      if (fail) {
        fail = false;
        return Promise.reject({ what: { clave: "shell.service.unreachable" }, detail: "io" });
      }
      return { received: 1 };
    },
  });
  await write(app, "sigue");
  assert.ok(await until(() => doc.querySelector("[data-carry-confirm]")?.disabled === false));
  doc.querySelector("[data-carry-confirm]").click();
  assert.ok(await until(() => doc.querySelector("[data-carry-failure]")), "no dice que se cortó");
  assert.equal(doc.querySelector("[data-carry-failure]").textContent, "Se cortó la copia en 1 de 1 partes.");
  assert.equal(doc.querySelector("textarea").value, "sigue", "el mensaje no volvió a la caja");
  assert.equal(log.filter((c) => c.name === "send_message").length, 0);
  const exports = log.filter((c) => c.name === "work_export").length;

  doc.querySelector("[data-carry-fix]").click();
  assert.ok(await until(() => log.some((c) => c.name === "send_message")), "reintentar no creó la tarea");
  assert.equal(log.filter((c) => c.name === "work_export").length, exports, "reintentar volvió a exportar");
  assert.equal(log.filter((c) => c.name === "work_write_part").length, 2);
  assert.equal(doc.querySelector("[data-carry-progress]"), null, "el avance sigue a la vista");
  assert.deepEqual(app.fallos, []);
});

test("sin nada sin subir y con el proyecto en la VM se manda como siempre, sin hoja", async () => {
  const log = [];
  const { app, doc } = await start("carry-window-clean", log, {
    work_status: (args, options) => {
      log.push({ name: "work_status", machine: machineOf(options), args });
      return { ...STATUS, ahead: 0, changed: 0, untracked: 0 };
    },
    list_projects: (_args, options) => [{ id: "p1", name: "P1", working_directory: machineOf(options) === "vm" ? "/home/vm/p1" : "/lab/p1", kind: "git", portfolio: null, sources: [] }],
  });
  await write(app, "hola");
  assert.ok(await until(() => log.some((c) => c.name === "send_message")), "no se mandó");
  assert.equal(doc.querySelector("[data-carry-sheet]"), null);
  const sent = log.find((c) => c.name === "send_message");
  assert.equal(sent.machine, "vm");
  assert.equal(sent.args.unwrapSnapshot, undefined);
  assert.equal(log.filter((c) => c.name.startsWith("work_") && c.name !== "work_status").length, 0, "copió algo sin hoja");
  assert.deepEqual(app.fallos, []);
});
