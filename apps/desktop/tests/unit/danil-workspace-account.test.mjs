/**
 * Cada workspace es de una cuenta de Danil, contra un motor simulado con una
 * sesión por cuenta: la sección «Cuenta de este workspace» en Workspaces, sus
 * errores en castellano llano, y el pie de la barra lateral que sigue a la
 * cuenta del workspace abierto. Monta `dist/`.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { boot, sleep } from "../helpers/jsdom-app.mjs";

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
function engine({ sessions = [ALBERTO, FDB], map = { w: "u_alberto", w2: "u_fdb" }, active = "w", setAccount } = {}) {
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
      danil_connect_status: () => ({ state: "connected", computer_id: "cmp_a", account: "u_alberto", email: "alberto@danil.ai", online: true }),
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
  assert.deepEqual(options, ["alberto@danil.ai", "alberto@dondebanco.org", "Conectar otra cuenta…"], "the default first, then the others, then another one");
  assert.ok(section(w).textContent.includes("Se sincroniza con alberto@danil.ai"));

  await choose(w, "u_fdb");
  assert.deepEqual(e.calls.find((c) => c.command === "danil_workspace_set_account")?.args, { workspace: "w", account: "u_fdb" });
  assert.equal(select(w).value, "u_fdb");
  assert.ok(section(w).textContent.includes("Se sincroniza con alberto@dondebanco.org"), section(w).textContent);
  assert.equal(w.document.querySelector("[role=alert]"), null);
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
  assert.ok(foot().textContent.includes("Alberto Ceballos"));
  assert.equal(foot().getAttribute("title"), "Alberto Ceballos · en línea con Danil");

  e.state.active = "w2";
  w.dispatchEvent(new w.CustomEvent("harness:workspace"));
  await sleep(400);
  assert.ok(foot().textContent.includes("Alberto FDB"), foot().textContent);
  assert.equal(foot().getAttribute("title"), "Alberto FDB · sin conexión con Danil por ahora");

  e.state.sessions = [ALBERTO];
  app.emit("danil-sessions", e.state.sessions);
  await sleep(400);
  assert.equal(foot()?.dataset.danilFoot, "signed_out", "its account signed out: not the other account");
  assert.equal(foot().getAttribute("title"), "alberto@dondebanco.org · sin sesión en esta computadora");
  assert.deepEqual(app.fallos, []);
});
