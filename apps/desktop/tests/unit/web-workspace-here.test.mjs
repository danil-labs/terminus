/**
 * «Usar este workspace aquí»: with a workspace on only one of two machines, the
 * «Ejecutar en» picker offers it on the other; the action wakes that machine,
 * creates the workspace with the same name so the panel joins them, copies
 * what carries no credentials, signs in to Radiant there for an organization
 * workspace, and leaves the machine picked with no note left behind. Logos are read on their own
 * machine, and the chat background is the one the engine remembers. Mounts
 * `dist-web/`.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { engine, fleet } from "../helpers/fake-relay.mjs";
import { boot, sleep } from "../helpers/jsdom-app.mjs";

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const BG = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
const DANIL = { id: "d", name: "Danil", context_root: "c1", logo: "/Users/ana/ws/d/logo.png", lengua: "es", terminal_theme: "nord", worktrees_root: "/Users/ana/trees" };
const VM = { computer_id: "cmp_vm", name: "vm-alberto", state: "offline", provider: "aws-ec2" };
const MAC = { computer_id: "cmp_mac", name: "MacBook Air", state: "online", provider: "self", kind: "physical" };

const signedOut = { cloud_server: "https://radiant.test", server: "https://radiant.test", signed_in: false, workspace: null, login: null };

function mac(extra = {}) {
  return {
    ...engine,
    list_workspaces: { workspaces: [DANIL], active: "d" },
    workspaces_startup: { workspaces: [DANIL], active: "d" },
    preview_file: ({ path }) => (path === DANIL.logo ? { data_url: PNG } : { data_url: null }),
    radiant_status: signedOut,
    chat_background: { data_url: BG },
    list_known_mcp: [{ id: "figma", clave: "figma", name: "Figma", conectado: true }],
    list_mcp_servers: [{ name: "figma", detalle: "https://mcp.figma.com" }, { name: "interno", detalle: "node server.js" }],
    list_skill_sources: { fuentes: [{ id: "s1", rotulo: "organizacion", nombre: "danil-skills", location: "https://github.com/danil/skills", branch: "main", path: "/x", missing: false, managed: false, enabled: true }], rotas: [] },
    ...extra,
  };
}

/** A managed VM with no workspace: what `add_workspace` creates is what it lists next. */
function vm(extra = {}) {
  const workspaces = [];
  const listing = () => ({ workspaces: [...workspaces], active: workspaces[0]?.id ?? null });
  return {
    ...engine,
    list_workspaces: listing,
    workspaces_startup: listing,
    add_workspace: ({ name }) => {
      const w = { id: "v1", name, context_root: null, logo: null };
      workspaces.push(w);
      return w;
    },
    set_active_workspace: null,
    set_workspace_language: ({ id }) => ({ ...workspaces[0], id }),
    set_workspace_terminal_theme: ({ id }) => ({ ...workspaces[0], id }),
    set_workspace_logo_png: () => ({ path: "/home/vm/ws/v1/logo.png" }),
    list_known_mcp: [{ id: "figma", clave: "figma", name: "Figma", conectado: false }],
    connect_known_mcp: null,
    list_skill_sources: { fuentes: [], rotas: [] },
    add_skill_source: () => ({ id: "s9" }),
    chat_background: null,
    import_chat_background_data: () => "/home/vm/appearance/backgrounds/x/background.jpg",
    radiant_status: signedOut,
    ...extra,
  };
}

async function open(name, relays) {
  const f = fleet(relays);
  const app = await boot("listo", name, {}, undefined, {}, {
    web: true,
    antes: (w) => {
      globalThis.WebSocket = f.Socket;
      w.terminusWeb = { endpoint: "https://relay.test", computers: [VM, MAC], getToken: async () => "tok" };
    },
  });
  await sleep(2500);
  const invoke = (command, args, options) => app.w.__TAURI_INTERNALS__.invoke(command, args, options);
  const calls = (id, command) => f.relays[id].calls.filter((c) => c.command === command);
  return { app, f, invoke, calls, doc: app.w.document };
}

async function until(check, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await sleep(100);
  }
  return false;
}

async function openPicker(doc) {
  const trigger = doc.querySelector('[aria-label="Ejecutar en"]');
  assert.ok(trigger, "the «Ejecutar en» picker is in the composer");
  trigger.click();
  assert.ok(await until(() => doc.querySelector("[data-workspace-here]")), "the picker opens");
}

test("a personal workspace is created on the machine that lacks it, joined and picked there", async () => {
  const { app, invoke, calls, doc } = await open("web-workspace-here", { cmp_vm: { table: vm() }, cmp_mac: { table: mac() } });

  assert.equal(doc.querySelector('[data-workspace-here="cmp_mac"]'), null, "the machine that has it offers nothing");
  const before = await invoke("machine_list");
  assert.equal(before.find((m) => m.id === "cmp_vm").linked, false);
  const list = await invoke("list_workspaces");
  assert.equal(list.workspaces[0].logo, `cmp_mac~${DANIL.logo}`, "a logo path carries its machine");
  const logo = await invoke("preview_file", { path: list.workspaces[0].logo, rel: list.workspaces[0].logo });
  assert.equal(logo.data_url, PNG, "the logo is read on the Mac, whatever leads");
  assert.equal(calls("cmp_vm", "preview_file").length, 0);

  const painted = [...doc.querySelectorAll("[style]")].some((e) => (e.getAttribute("style") ?? "").includes(BG));
  assert.ok(painted, "the chat background the Mac's engine remembers is painted in the web");

  await openPicker(doc);
  const row = doc.querySelector('[data-machine-unlinked="cmp_vm"]');
  assert.ok(row.querySelector("[title]")?.getAttribute("title").includes("no tiene este workspace"), "«sin este workspace» explains itself on hover");
  doc.querySelector('[data-workspace-here="cmp_vm"]').click();
  const picked = () => (doc.querySelector('[aria-label="Ejecutar en"]')?.textContent ?? "").includes("vm-alberto");
  assert.ok(await until(() => picked() && !doc.querySelector("[data-workspace-here-state]"), 15000), "the action finishes and its panel closes");

  assert.deepEqual(calls("cmp_vm", "add_workspace").map((c) => c.args.name), ["Danil"], "the VM, woken by the action, creates it with the same name");
  const merged = await invoke("list_workspaces");
  assert.equal(merged.workspaces.length, 1, "the two are one workspace");
  assert.equal(merged.workspaces[0].id, "cmp_mac~d", "the open workspace keeps its id");
  assert.deepEqual([...merged.workspaces[0].machines].sort(), ["cmp_mac", "cmp_vm"]);
  assert.equal(merged.workspaces[0].context_root, "c1", "and its row");

  assert.deepEqual(calls("cmp_vm", "set_workspace_language").map((c) => [c.args.id, c.args.lengua, c.workspace]), [["v1", "es", "v1"]]);
  assert.deepEqual(calls("cmp_vm", "set_workspace_terminal_theme").map((c) => c.args.theme), ["nord"]);
  assert.deepEqual(calls("cmp_vm", "set_workspace_logo_png").map((c) => c.args.pngBase64), ["iVBORw0KGgo="], "the logo travels as bytes");
  assert.deepEqual(calls("cmp_vm", "import_chat_background_data").map((c) => c.args.dataUrl), [BG], "the chat background travels as bytes");
  assert.deepEqual(calls("cmp_vm", "connect_known_mcp").map((c) => c.args.id), ["figma"]);
  assert.deepEqual(calls("cmp_vm", "add_skill_source").map((c) => c.args.url), ["https://github.com/danil/skills"]);
  assert.equal(calls("cmp_vm", "radiant_login").length, 0, "a personal workspace does not sign in to Radiant");

  assert.ok(!doc.body.textContent.includes("interno"), "a hand-written MCP server is neither copied nor listed");

  const after = await invoke("machine_list");
  assert.equal(after.find((m) => m.id === "cmp_vm").linked, true, "the VM is available for this workspace");
  assert.deepEqual(app.fallos, []);
});

test("an organization workspace signs in to Radiant on the other machine with the same organization", async () => {
  const org = { ...signedOut, signed_in: true, workspace: { id: "rw1", name: "Danil Labs" } };
  let polls = 0;
  const prompt = { uri: "https://radiant.test/device?code=WXYZ-1234", code: "WXYZ-1234" };
  const vmTable = vm({
    radiant_status: () => (++polls > 3 ? { ...signedOut, signed_in: true, workspace: null } : { ...signedOut, login: { server: signedOut.server, running: true, prompt, failure: null } }),
    radiant_login: { ...signedOut, login: { server: signedOut.server, running: true, prompt: null, failure: null } },
    get_radiant_identity: { status: "organization_selection_required", email: "a@danil.ai", name: null, organization: null, organizations: [{ id: "o2", name: "Otra" }, { id: "o1", name: "Danil Labs" }], note: null },
    radiant_select_organization: () => ({ ...signedOut, signed_in: true, workspace: null }),
    radiant_select_workspace: ({ id }) => ({ ...signedOut, signed_in: true, workspace: { id, name: "Danil Labs" } }),
  });
  const macTable = mac({
    radiant_status: org,
    get_radiant_identity: { status: "ok", email: "a@danil.ai", name: null, organization: "Danil Labs", organizations: [], note: null },
  });
  const { app, calls, doc } = await open("web-workspace-here-org", { cmp_vm: { table: vmTable }, cmp_mac: { table: macTable } });

  await openPicker(doc);
  doc.querySelector('[data-workspace-here="cmp_vm"]').click();
  assert.ok(await until(() => doc.querySelector("[data-radiant-code]")?.textContent.includes("WXYZ-1234")), "the code and link show as in onboarding");
  assert.ok(doc.querySelector('[data-radiant-code] a[href="https://radiant.test/device?code=WXYZ-1234"]'));
  assert.ok(await until(() => !doc.querySelector("[data-workspace-here-state]"), 15000), "it finishes once signed in");

  assert.equal(calls("cmp_vm", "radiant_login").length, 1, "Radiant sign-in starts on the VM");
  assert.equal(calls("cmp_mac", "radiant_login").length, 0);
  assert.deepEqual(calls("cmp_vm", "radiant_select_organization").map((c) => c.args.id), ["o1"], "the same organization");
  assert.deepEqual(calls("cmp_vm", "radiant_select_workspace").map((c) => [c.args.id, c.workspace]), [["rw1", "v1"]], "the same organization workspace, on the new one");
  assert.deepEqual(app.fallos, []);
});
