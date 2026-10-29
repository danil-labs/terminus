/**
 * En el navegador, llevar el trabajo de la carpeta de una máquina a otra por el
 * relay: la hoja se abre al enviar, la llave del destino (`work_key`) se fija la
 * primera vez y el archivo sale sellado para ella, las partes son de 512 KiB y la
 * tarea nace en el destino sobre la foto. Monta `dist-web/`.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { engine, fleet } from "../helpers/fake-relay.mjs";
import { boot, sleep } from "../helpers/jsdom-app.mjs";

const SAME = { id: "w", name: "W", context_root: null, provider: "github", remote: "danil/panel" };
const folder = (id, name) => ({ id, name, working_directory: `/lab/${id}`, kind: "git", portfolio: null, sources: [], remote_url: "https://github.com/danil/notas" });
const PAYLOAD = Buffer.alloc(700 * 1024, 7).toString("base64");
const STATUS = {
  branch: "feat/notas", head: "a1", upstream: "origin/feat/notas", remoteBase: "9f", remoteUrl: "https://github.com/danil/notas",
  ahead: 2, changed: 1, untracked: 0, largeUntracked: [], ignored: [{ path: ".env.local", bytes: 812, suggested: true }],
  ignoredSkipped: [], lfs: false, submodules: false, takenAt: 1_760_000_000,
};

function table(projects, extra = {}) {
  return {
    ...engine,
    list_workspaces: { workspaces: [SAME], active: "w" },
    workspaces_startup: { workspaces: [SAME], active: "w" },
    list_projects: projects,
    list_live_sessions: [],
    project_base_branches: { branches: [], selected: null },
    ...extra,
  };
}

async function until(check, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await sleep(100);
  }
  return false;
}

const VM = { computer_id: "cmp_vm", name: "Danil VM", state: "online", provider: "aws-ec2" };
const MAC = { computer_id: "cmp_mac", name: "Mac de Ana", state: "online", provider: "self", kind: "physical" };

test("llevar por el relay: sellado para la VM, partes de 512 KiB y la tarea nace en la VM sobre la foto", async () => {
  const bytes = Buffer.from(PAYLOAD, "base64");
  const f = fleet({
    cmp_mac: { table: table([folder("pm", "Notas")], {
      work_status: STATUS,
      work_export: ({ operation }) => ({ transfer: operation, bytes: bytes.length, sha256: "abc", head: "a1", wip: "w1", base: "9f" }),
      work_read_part: ({ offset, size }) => ({ data: bytes.subarray(offset, offset + size).toString("base64"), eof: offset + size >= bytes.length }),
    }) },
    cmp_vm: { table: table([], {
      work_key: { publicKey: "vm-key" },
      // La VM no tiene la carpeta: se clona con avance antes de copiar, con el mismo id.
      start_project_clone: ({ operation }) => ({ operation }),
      project_clone_status: ({ operation }) => ({ workspace: "w", operation, phase: "done", percent: null, done: true, project: folder("pm", "Notas") }),
      work_write_part: ({ offset, data }) => ({ received: offset + Buffer.from(data, "base64").length }),
      work_import: ({ probe }) => (probe ? { head: "", base: "", branch: null, files: [], snapshot: false } : { head: "a1", base: "w1", branch: null, files: [".env.local"], snapshot: true }),
      send_message: () => "r1",
    }) },
  });
  const app = await boot("listo", "web-carry", {}, undefined, { "harness.layout.machines.run_on": JSON.stringify({ w: "cmp_vm" }) }, {
    web: true,
    antes: (w) => {
      globalThis.WebSocket = f.Socket;
      w.terminusWeb = { endpoint: "https://relay.test", computers: [VM, MAC], getToken: async () => "tok" };
    },
  });
  await sleep(2500);
  const doc = app.w.document;
  const calls = (id, command) => f.relays[id].calls.filter((c) => c.command === command);
  doc.querySelector('[aria-label="Ejecutar en"]').click();
  assert.ok(await until(() => doc.querySelector('[data-machine-option="cmp_mac"]')));
  doc.querySelector('[data-machine-option="cmp_mac"]').click();
  await sleep(300);
  doc.querySelector('[aria-label="Proyecto"]').click();
  assert.ok(await until(() => [...doc.querySelectorAll("button")].some((b) => b.textContent.includes("Notas") && b.textContent.includes("tarea"))));
  [...doc.querySelectorAll("button")].find((b) => b.textContent.includes("Notas") && b.textContent.includes("tarea")).click();
  await sleep(300);
  doc.querySelector('[aria-label="Ejecutar en"]').click();
  assert.ok(await until(() => doc.querySelector('[data-machine-option="cmp_vm"]')));
  doc.querySelector('[data-machine-option="cmp_vm"]').click();
  await sleep(300);
  const field = doc.querySelector("textarea");
  field.value = "sigue en la VM";
  field.dispatchEvent(new app.w.Event("input", { bubbles: true }));
  field.closest("form").dispatchEvent(new app.w.Event("submit", { bubbles: true, cancelable: true }));

  assert.ok(await until(() => doc.querySelector('[data-carry-sheet="carry"]')), "no se abrió la hoja");
  assert.equal(calls("cmp_mac", "work_status").length, 1, "el estado no se pidió a la Mac");
  assert.ok(doc.querySelector("[data-carry-sealed]"), "no dice que viaja sellado");
  assert.equal(app.w.localStorage.getItem("harness.layout.machines.carry_keys"), JSON.stringify({ cmp_vm: "vm-key" }), "la llave no se fijó la primera vez");
  assert.equal(doc.querySelector('[data-carry-ignored=".env.local"]').checked, true, "sellado, el .env puede viajar");
  assert.ok(await until(() => doc.querySelector("[data-carry-confirm]")?.disabled === false));
  assert.equal(calls("cmp_mac", "work_export").at(-1).args.recipientKey, "vm-key", "el export no salió sellado");
  doc.querySelector("[data-carry-confirm]").click();

  assert.ok(await until(() => calls("cmp_vm", "send_message").length === 1), "la tarea no nació en la VM");
  assert.equal(calls("cmp_vm", "start_project_clone")[0]?.args.id, "pm", "no clonó en la VM con el mismo id");
  assert.deepEqual(calls("cmp_mac", "work_read_part").map((c) => c.args.size), [524288, 524288], "las partes no son de 512 KiB");
  assert.equal(calls("cmp_vm", "work_write_part").length, 2);
  const sent = calls("cmp_vm", "send_message")[0].args;
  assert.deepEqual([sent.baseRef, sent.unwrapSnapshot], ["w1", true]);
  assert.equal(calls("cmp_mac", "send_message").length, 0);
  assert.deepEqual(app.fallos, []);
});
