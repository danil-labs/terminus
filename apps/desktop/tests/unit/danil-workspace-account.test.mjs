/**
 * Cada workspace es de una cuenta de Danil, contra un motor simulado con una
 * sesión por cuenta: la sección «Cuenta de este workspace» en Workspaces, sus
 * errores en castellano llano, y el pie de la barra lateral que sigue a la
 * cuenta del workspace abierto. Monta `dist/`.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { boot, sleep } from "../helpers/jsdom-app.mjs";
import { engine as relayEngine, fleet as relayFleet } from "../helpers/fake-relay.mjs";

const W = { id: "w", name: "Danil", context_root: null };
const W2 = { id: "w2", name: "Fundación Donde Banco", context_root: null };
const BASE = {
  window_ready: null,
  window_vitals: null,
  setup_required: false,
  list_providers: [],
  list_projects: [],
  list_sources: [],
  list_live_sessions: [],
  list_live_turns: [],
  list_surfaces: [],
  set_active_workspace: null,
  service_poll: { cursor: 0, gap: false, replay: false, runtime: "test-service", reset: false },
};

const ALBERTO = {
  account: "u_alberto",
  email: "alberto@danil.ai",
  name: "Alberto Ceballos",
  photo: null,
  computer_id: "cmp_a",
  computer_name: "Mac de Alberto",
  default: true,
  workspaces: ["w"],
  status: "connected",
  online: true,
};
const FDB = { ...ALBERTO, account: "u_fdb", email: "alberto@dondebanco.org", name: "Alberto FDB", computer_id: "cmp_b", default: false, workspaces: ["w2"], online: false };
const unknown = () => Object.assign(new Error("command"), { what: { clave: "shell.service.command" }, detail: "command" });

/** El motor: sesiones, el mapa workspace → cuenta y el workspace abierto. */
function engine({ sessions = [ALBERTO, FDB], map = { w: "u_alberto", w2: "u_fdb" }, active = "w", setAccount, status } = {}) {
  const state = { sessions, map, active };
  const calls = [];
  const record = (command, reply) => (args) => {
    calls.push({ command, args });
    return reply(args ?? {});
  };
  const of = (workspace) => {
    const account = state.map[workspace ?? state.active] ?? null;
    const s = state.sessions.find((x) => x.account === account && x.status === "connected");
    const emails = { u_alberto: "alberto@danil.ai", u_fdb: "alberto@dondebanco.org", u_ytw: "alberto@yucatantechweek.mx" };
    return { account, email: emails[account] ?? null, signed_in: Boolean(s), linked: Boolean(s) };
  };
  const workspaces = { workspaces: [W, W2], active: state.active };
  return {
    state,
    calls,
    table: {
      list_workspaces: () => ({ ...workspaces, active: state.active }),
      workspaces_startup: () => ({ ...workspaces, active: state.active }),
      set_active_workspace: record("set_active_workspace", ({ id }) => {
        state.active = id;
        return null;
      }),
      danil_connect_status: () =>
        status ?? (state.sessions.length ? { state: "connected", computer_id: "cmp_a", account: "u_alberto", email: "alberto@danil.ai", online: true } : { state: "disconnected", name: "Mac de Alberto" }),
      danil_sessions: record("danil_sessions", () => state.sessions),
      danil_workspace_account: record("danil_workspace_account", ({ workspace }) => of(workspace)),
      danil_workspace_set_account: record(
        "danil_workspace_set_account",
        setAccount ??
          (({ workspace, account }) => {
            state.map[workspace] = account;
            return of(workspace);
          }),
      ),
      danil_connect_start: record("danil_connect_start", () => ({ state: "pending", user_code: "WDJB-MJHT", verification_uri_complete: "https://app.danil.ai/terminus/connect?code=WDJB-MJHT" })),
      open_external: record("open_external", () => null),
    },
  };
}

async function openWorkspaces(name, e) {
  const app = await boot("listo", name, { ...BASE, ...e.table });
  app.w.dispatchEvent(new app.w.CustomEvent("harness:open-settings", { detail: "workspaces" }));
  await sleep(1000);
  return app;
}

const section = (w) => w.document.querySelector("[data-workspace-account]");
const select = (w) => w.document.querySelector("[data-workspace-account-select]");
const choose = async (w, value) => {
  const s = select(w);
  s.value = value;
  s.dispatchEvent(new w.Event("change", { bubbles: true }));
  await sleep(300);
};

test("the workspace shows its account, syncs with it, and moves to another signed-in account", async () => {
  const e = engine();
  const app = await openWorkspaces("danil-workspace-account", e);
  const { w } = app;
  assert.ok(section(w), w.document.body.textContent.slice(0, 300));
  assert.ok(section(w).textContent.includes("Cuenta de este workspace"));
  assert.equal(select(w).value, "u_alberto", "the open workspace's account is chosen");
  const options = [...select(w).options].map((o) => o.textContent);
  assert.deepEqual(
    options,
    ["alberto@danil.ai", "alberto@dondebanco.org", "Sin cuenta (no se sincroniza)", "Conectar otra cuenta…"],
    "the default first, then the others, no account, then another one",
  );
  assert.ok(section(w).textContent.includes("Se sincroniza con alberto@danil.ai"));

  await choose(w, "u_fdb");
  assert.deepEqual(e.calls.find((c) => c.command === "danil_workspace_set_account")?.args, { workspace: "w", account: "u_fdb" });
  assert.equal(select(w).value, "u_fdb");
  assert.ok(section(w).textContent.includes("Se sincroniza con alberto@dondebanco.org"), section(w).textContent);
  assert.equal(w.document.querySelector("[role=alert]"), null);
  assert.deepEqual(app.fallos, []);
});

test("a workspace nobody chose an account for says so, and the sidebar footer shows nobody", async () => {
  const e = engine({ map: { w2: "u_fdb" } });
  const app = await openWorkspaces("danil-workspace-account-none", e);
  const { w } = app;
  assert.equal(section(w)?.dataset.workspaceAccount, "none");
  assert.ok(section(w).textContent.includes("Este workspace no es de ninguna cuenta: no se ve en la web ni en el teléfono."), section(w).textContent);
  assert.equal(select(w).value, "", "the picker says «Sin cuenta»");
  assert.equal(w.document.querySelector("[data-danil-foot]"), null, "the sidebar footer shows nobody for a workspace without an account");

  await choose(w, "u_alberto");
  assert.deepEqual(e.calls.find((c) => c.command === "danil_workspace_set_account")?.args, { workspace: "w", account: "u_alberto" });
  assert.ok(section(w).textContent.includes("Se sincroniza con alberto@danil.ai"), section(w).textContent);
  assert.deepEqual(app.fallos, []);
});

test("«Sin cuenta» asks first and then takes the workspace out of its account only", async () => {
  const e = engine();
  const app = await openWorkspaces("danil-workspace-account-leave", e);
  const { w } = app;
  await choose(w, "");
  const ask = () => w.document.querySelector("[data-workspace-leave]");
  assert.ok(ask(), "it asks before leaving the account");
  assert.ok(ask().textContent.includes("Se quita de alberto@danil.ai: deja de verse en su web y su teléfono."), ask().textContent);
  assert.equal(select(w).value, "u_alberto", "nothing changed yet");
  assert.ok(!e.calls.some((c) => c.command === "danil_workspace_set_account"));
  [...ask().querySelectorAll("button")].find((b) => b.textContent === "Cancelar").click();
  await sleep(200);
  assert.equal(ask(), null);
  assert.ok(!e.calls.some((c) => c.command === "danil_workspace_set_account"), "cancel keeps it in its account");

  await choose(w, "");
  ask().querySelector("[data-workspace-leave-yes]").click();
  await sleep(300);
  assert.deepEqual(e.calls.find((c) => c.command === "danil_workspace_set_account")?.args, { workspace: "w", account: null });
  assert.ok(!e.calls.some((c) => c.command === "danil_disconnect"), "the account stays signed in");
  assert.equal(select(w).value, "");
  assert.ok(section(w).textContent.includes("no es de ninguna cuenta"), section(w).textContent);
  assert.deepEqual(app.fallos, []);
});

test("«Conectar otra cuenta…» starts another sign-in and leaves the workspace where it was", async () => {
  const e = engine();
  const app = await openWorkspaces("danil-workspace-account-add", e);
  const { w } = app;
  await choose(w, "+other");
  assert.deepEqual(e.calls.find((c) => c.command === "danil_connect_start")?.args, { add: true });
  assert.equal(e.calls.find((c) => c.command === "open_external")?.args?.target, "https://app.danil.ai/terminus/connect?code=WDJB-MJHT");
  assert.equal(select(w).value, "u_alberto", "the picker stays on the current account");
  assert.ok(!e.calls.some((c) => c.command === "danil_workspace_set_account"), "nothing moves until the new account is chosen");
  assert.deepEqual(app.fallos, []);
});

test("«Conectar otra cuenta…» on a workspace with an account does not move it when the new one signs in", async () => {
  const e = engine();
  const app = await openWorkspaces("danil-workspace-account-add-keep", e);
  const { w } = app;
  await choose(w, "+other");
  const YTW = { ...ALBERTO, account: "u_ytw", email: "alberto@yucatantechweek.mx", computer_id: "cmp_c", default: false, workspaces: [] };
  e.state.sessions = [...e.state.sessions, YTW];
  app.emit("danil-sessions", e.state.sessions);
  await sleep(400);
  assert.ok(!e.calls.some((c) => c.command === "danil_workspace_set_account"), "it already had an account: it stays there");
  assert.deepEqual(app.fallos, []);
});

async function openDanilAccounts(name, e, antes, panel = "cuenta-danil") {
  const app = await boot("listo", name, { ...BASE, ...e.table }, undefined, {}, { antes });
  app.w.dispatchEvent(new app.w.CustomEvent("harness:open-settings", { detail: panel }));
  await sleep(1000);
  return app;
}
const here = (w) => w.document.querySelector("[data-danil-here]");
const buttonIn = (root, label) => [...(root?.querySelectorAll("button") ?? [])].find((b) => b.textContent.trim() === label);

test("a workspace without an account reveals account choices only when asked", async () => {
  const e = engine({ map: {} });
  const app = await openDanilAccounts("danil-accounts-here-none", e);
  const { w } = app;
  assert.ok(here(w), w.document.body.textContent.slice(0, 400));
  assert.ok(here(w).textContent.includes("Este workspace: Danil"), here(w).textContent);
  assert.ok(here(w).textContent.includes("Este workspace no es de ninguna cuenta"), here(w).textContent);
  assert.ok(here(w).textContent.includes("Cuenta de este workspace"));
  assert.equal(here(w).querySelector("[data-workspace-account-select]"), null);
  here(w).querySelector("[data-danil-manage]").click();
  await sleep(300);
  buttonIn(here(w), "Usar alberto@danil.ai").click();
  await sleep(400);
  assert.deepEqual(
    e.calls.filter((c) => c.command === "danil_workspace_set_account").map((c) => c.args),
    [{ workspace: "w", account: "u_alberto" }],
    "one click, only the open workspace",
  );
  assert.ok(here(w).textContent.includes("Se sincroniza con alberto@danil.ai"), here(w).textContent);
  assert.equal(buttonIn(here(w), "Usar alberto@danil.ai"), undefined, "with an account, no more «Usar…»");
  assert.deepEqual(app.fallos, []);
});

test("signing in another account from a workspace without one links that workspace, and no other", async () => {
  const e = engine({ map: { w2: "u_fdb" } });
  const app = await openDanilAccounts("danil-accounts-add-claims", e);
  const { w } = app;
  here(w).querySelector("[data-danil-manage]").click();
  await sleep(300);
  await choose(w, "+other");
  await sleep(300);
  assert.deepEqual(e.calls.find((c) => c.command === "danil_connect_start")?.args, { add: true });
  assert.ok(!e.calls.some((c) => c.command === "danil_workspace_set_account"), "nothing until it signs in");

  const YTW = { ...ALBERTO, account: "u_ytw", email: "alberto@yucatantechweek.mx", computer_id: "cmp_c", default: false, workspaces: [] };
  e.state.sessions = [...e.state.sessions, YTW];
  app.emit("danil-sessions", e.state.sessions);
  await sleep(400);
  assert.deepEqual(
    e.calls.filter((c) => c.command === "danil_workspace_set_account").map((c) => c.args),
    [{ workspace: "w", account: "u_ytw" }],
    "the open workspace goes to the account that signed in; the others are left alone",
  );
  app.emit("danil-sessions", e.state.sessions);
  await sleep(200);
  assert.equal(e.calls.filter((c) => c.command === "danil_workspace_set_account").length, 1, "only once");
  assert.deepEqual(app.fallos, []);
});

test("the first sign-in on this computer, from a workspace, links that workspace", async () => {
  const e = engine({ sessions: [], map: {} });
  e.table.danil_connect_start = (args) => {
    e.calls.push({ command: "danil_connect_start", args });
    return { state: "pending", user_code: "WDJB-MJHT", verification_uri_complete: "https://app.danil.ai/terminus/connect?code=WDJB-MJHT" };
  };
  const app = await openDanilAccounts("danil-accounts-first-claims", e);
  const { w } = app;
  assert.ok(here(w)?.textContent.includes("Este workspace no es de ninguna cuenta"), w.document.body.textContent.slice(0, 400));
  here(w).querySelector("[data-danil-manage]").click();
  await sleep(300);
  buttonIn(w.document.querySelector("[data-danil-account]"), "Iniciar sesión con Danil").click();
  await sleep(300);
  assert.ok(e.calls.some((c) => c.command === "danil_connect_start"));

  e.state.sessions = [ALBERTO];
  app.emit("danil-connect", { state: "connected", computer_id: "cmp_a", account: "u_alberto", email: "alberto@danil.ai", online: true });
  await sleep(500);
  assert.deepEqual(
    e.calls.filter((c) => c.command === "danil_workspace_set_account").map((c) => c.args),
    [{ workspace: "w", account: "u_alberto" }],
  );
  assert.deepEqual(app.fallos, []);
});

test("a workspace the control plane keeps with the other account says what to do", async () => {
  const e = engine({
    setAccount: ({ account }) => ({ account, email: "alberto@dondebanco.org", signed_in: true, linked: false, error: "workspace_id_taken" }),
  });
  const app = await openWorkspaces("danil-workspace-account-taken", e);
  const { w } = app;
  await choose(w, "u_fdb");
  const alert = w.document.querySelector("[data-workspace-account] [role=alert]");
  assert.equal(
    alert?.textContent,
    "Este workspace sigue siendo de la otra cuenta. Inicia sesión con esa cuenta en esta computadora para moverlo.",
  );
  assert.ok(section(w).textContent.includes("Todavía no se sincroniza con alberto@dondebanco.org."), "not called synced while not joined");
  assert.deepEqual(app.fallos, []);
});

test("an account that is no longer signed in is refused in plain words and the picker goes back", async () => {
  const e = engine({
    setAccount: () => {
      throw Object.assign(new Error("account_not_found"), { what: { clave: "danil.error.account_not_found" }, detail: "account_not_found" });
    },
  });
  const app = await openWorkspaces("danil-workspace-account-gone", e);
  const { w } = app;
  await choose(w, "u_fdb");
  assert.equal(
    w.document.querySelector("[data-workspace-account] [role=alert]")?.textContent,
    "Esa cuenta ya no tiene sesión en esta computadora. Vuelve a iniciar sesión con ella.",
  );
  assert.equal(select(w).value, "u_alberto");
  assert.deepEqual(app.fallos, []);
});

test("a workspace whose account signed out says it is not synced", async () => {
  const e = engine({ sessions: [ALBERTO], map: { w: "u_ytw", w2: "u_alberto" } });
  const app = await openWorkspaces("danil-workspace-account-signed-out", e);
  const { w } = app;
  assert.equal(section(w)?.dataset.workspaceAccount, "unsynced");
  assert.ok(section(w).textContent.includes("Sin sincronizar: alberto@yucatantechweek.mx no tiene sesión en esta computadora."), section(w).textContent);
  const signedOut = [...select(w).options].find((o) => o.value === "u_ytw");
  assert.equal(signedOut?.textContent, "alberto@yucatantechweek.mx · sin sesión");
  assert.ok(signedOut.disabled, "it cannot be chosen until it signs in again");
  assert.equal(select(w).value, "u_ytw", "the picker still says whose it is");
  assert.deepEqual(app.fallos, []);
});

test("with an engine without sessions per account, the workspace has no account section", async () => {
  const e = engine();
  const app = await openWorkspaces("danil-workspace-account-old-engine", {
    table: { ...e.table, danil_sessions: unknown(), danil_workspace_account: unknown() },
  });
  assert.equal(section(app.w), null);
  assert.ok(app.w.document.body.textContent.includes("Fundación Donde Banco"), "the workspaces screen is there");
  assert.deepEqual(app.fallos, []);
});

test("the sidebar footer shows the open workspace's account and follows a switch", async () => {
  const e = engine();
  const app = await boot("listo", "danil-footer-workspace-account", { ...BASE, ...e.table });
  const { w } = app;
  await sleep(900);
  const foot = () => w.document.querySelector("[data-danil-foot]");
  assert.equal(foot()?.dataset.danilFoot, "connected", w.document.body.innerHTML.slice(0, 300));
  assert.equal(foot().getAttribute("title"), "Alberto Ceballos · en línea con Danil");

  e.state.active = "w2";
  w.dispatchEvent(new w.CustomEvent("harness:workspace"));
  await sleep(400);
  assert.equal(foot().getAttribute("title"), "Alberto FDB · sin conexión con Danil por ahora");

  e.state.sessions = [ALBERTO];
  app.emit("danil-sessions", e.state.sessions);
  await sleep(400);
  assert.equal(foot(), null, "its account signed out: nobody, and not the other account");
  assert.deepEqual(app.fallos, []);
});

test("settings follows the workspace account and reads only its registry's machines", async () => {
  const e = engine();
  const asked = [];
  const peers = relayFleet({ "not-linked": { table: relayEngine, state: "offline" } });
  let app;
  e.table.account_relay_token = ({ account }) => {
    if (!account) throw unknown();
    asked.push(account);
    return { token: account, endpoint: "https://settings.test" };
  };
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const account = new Headers(init.headers).get("authorization")?.replace("Bearer ", "");
    const id = account === "u_fdb" ? "cmp_b" : "cmp_a";
    if (String(url).endsWith("/v1/workspaces")) return Response.json({ workspaces: [{ id: account === "u_fdb" ? "w2" : "w", computers: [id] }] });
    if (String(url).endsWith("/v1/computers")) return Response.json([
      { computer_id: id, name: `Machine ${account}`, state: "online" },
      { computer_id: "not-linked", name: "Other workspace machine", state: "online" },
    ]);
    return new Response("{}", { status: 404 });
  };
  globalThis.fetch.__jsdomApp = true;
  try {
    app = await openDanilAccounts("danil-settings-machines-scope", e, () => { globalThis.WebSocket = peers.Socket; }, "machines");
    const { w } = app;
    const panel = () => w.document.querySelector("[data-danil-account]");
    const rows = () => [...panel().querySelectorAll("[data-account-computer]")].map((el) => el.dataset.accountComputer);
    assert.deepEqual(rows(), ["cmp_a"]);
    assert.ok(!panel().textContent.includes(FDB.email));
    assert.ok(asked.every((account) => account === "u_alberto"));
    e.state.active = "w2";
    w.dispatchEvent(new w.CustomEvent("harness:workspace"));
    await sleep(800);
    assert.deepEqual(rows(), ["cmp_b"]);
    assert.ok(!panel().textContent.includes(ALBERTO.email));
    assert.ok(asked.includes("u_fdb"));
    assert.deepEqual(app.fallos, []);
  } finally {
    if (app) app.w.dispatchEvent(new app.w.Event("pagehide"));
    globalThis.fetch = previous;
  }
});

test("a failed account lookup does not show the default account or its computers", async () => {
  const e = engine();
  e.table.danil_workspace_account = () => { throw Object.assign(new Error("unauthorized"), { detail: "unauthorized" }); };
  const app = await openDanilAccounts("danil-settings-failed-authority", e);
  const panel = app.w.document.querySelector("[data-danil-account]");
  assert.ok(panel.textContent.includes("No se pudo verificar la cuenta de este workspace."));
  assert.equal(panel.querySelector("[data-danil-session]"), null);
  assert.equal(panel.querySelector("[data-account-computers]"), null);
  assert.ok(buttonIn(panel, "Reintentar"));
  assert.deepEqual(app.fallos, []);
});

test("same-account workspace switches discard old machine reads, controls and connection polling", async () => {
  const e = engine({ map: { w: "u_alberto", w2: "u_alberto" } });
  e.table.account_relay_token = ({ account }) => {
    if (!account) throw unknown();
    return { token: account, endpoint: "https://same-account.test" };
  };
  let releaseOld;
  const oldRegistry = new Promise((resolve) => { releaseOld = resolve; });
  let delayed = false;
  let inventories = 0;
  const registry = { workspaces: [{ id: "w", computers: ["cmp_a"] }, { id: "w2", computers: [] }] };
  const previous = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/v1/workspaces")) {
      if (!delayed && globalThis.document.querySelector("[data-account-computers]")) {
        delayed = true;
        await oldRegistry;
      }
      return Response.json(registry);
    }
    if (String(url).endsWith("/v1/computers")) {
      inventories++;
      return Response.json([{ computer_id: "cmp_a", name: "W1 machine", state: "online" }]);
    }
    return new Response("{}", { status: 404 });
  };
  globalThis.fetch.__jsdomApp = true;
  try {
    const app = await openDanilAccounts("danil-settings-same-account-late", e, undefined, "machines");
    const { w } = app;
    const panel = () => w.document.querySelector("[data-danil-account]");
    const connect = panel().querySelector("[data-connect-machine-open]");
    assert.ok(connect, panel().textContent + JSON.stringify(app.fallos));
    connect.click();
    await sleep(200);
    assert.ok(panel().querySelector("[data-connect-machine]"));
    assert.ok(delayed, "W1 machine membership is still pending when switching");
    e.state.active = "w2";
    w.dispatchEvent(new w.CustomEvent("harness:workspace"));
    await sleep(700);
    assert.deepEqual([...panel().querySelectorAll("[data-account-computer]")].map((el) => el.dataset.accountComputer), []);
    assert.equal(panel().querySelector("[data-connect-machine]"), null, "W1's connection watcher was unmounted");
    releaseOld();
    await sleep(300);
    const count = inventories;
    await sleep(2300);
    assert.equal(inventories, count, "the old connection watcher stopped polling");
    assert.deepEqual([...panel().querySelectorAll("[data-account-computer]")].map((el) => el.dataset.accountComputer), [], "late W1 authority cannot restore W1 rows");
    assert.deepEqual(app.fallos, []);
  } finally {
    releaseOld();
    globalThis.fetch = previous;
  }
});

test("a delayed account change from W1 cannot overwrite W2's account", async () => {
  let release;
  const result = new Promise((resolve) => { release = resolve; });
  const e = engine({ setAccount: () => result });
  const app = await openDanilAccounts("danil-settings-late-account-change", e);
  const { w } = app;
  here(w).querySelector("[data-danil-manage]").click();
  await sleep(100);
  const picker = select(w);
  picker.value = "u_fdb";
  picker.dispatchEvent(new w.Event("change", { bubbles: true }));
  await sleep(100);
  e.state.active = "w2";
  w.dispatchEvent(new w.CustomEvent("harness:workspace"));
  await sleep(500);
  release({ account: "u_alberto", email: ALBERTO.email, signed_in: true, linked: true });
  await sleep(300);
  const panel = w.document.querySelector("[data-danil-account]");
  assert.ok(panel.querySelector('[data-danil-session="u_fdb"]'));
  assert.equal(panel.querySelector('[data-danil-session="u_alberto"]'), null);
  assert.ok(here(w).textContent.includes(W2.name));
  assert.deepEqual(app.fallos, []);
});

test("workspace-list errors offer retry and recover instead of loading forever", async () => {
  const e = engine();
  let failed = true;
  const read = e.table.list_workspaces;
  e.table.list_workspaces = () => {
    if (failed) throw Object.assign(new Error("unauthorized"), { detail: "unauthorized" });
    return read();
  };
  const app = await openDanilAccounts("danil-settings-workspace-list-failure", e);
  const panel = () => app.w.document.querySelector("[data-danil-account]");
  assert.equal(panel().dataset.danilAccount, "failed");
  failed = false;
  buttonIn(panel(), "Reintentar").click();
  await sleep(500);
  assert.equal(panel().dataset.danilAccount, "workspace");
  assert.ok(here(app.w).textContent.includes(W.name));
  assert.deepEqual(app.fallos, []);
});

test("a returned account-link error remains visible after the account action closes", async () => {
  const e = engine();
  e.table.danil_workspace_set_account = ({ workspace, account }) => {
    e.state.map[workspace] = account;
    return { account, email: FDB.email, signed_in: true, linked: false, error: "workspace_id_taken" };
  };
  const read = e.table.danil_workspace_account;
  e.table.danil_workspace_account = (args) => ({ ...read(args), linked: false });
  const app = await openDanilAccounts("danil-settings-returned-link-error", e);
  here(app.w).querySelector("[data-danil-manage]").click();
  await choose(app.w, "u_fdb");
  const panel = app.w.document.querySelector("[data-danil-account]");
  assert.equal(panel.querySelector("[data-workspace-account-select]"), null);
  assert.ok(panel.querySelector("[role=alert]")?.textContent.includes("Este workspace sigue siendo de la otra cuenta."));
  assert.deepEqual(app.fallos, []);
});
