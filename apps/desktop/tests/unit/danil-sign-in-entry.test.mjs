/**
 * Las entradas a la cuenta de Danil fuera de Configuración, contra un motor
 * simulado: el paso del alta en el primer arranque y el pie de la barra
 * lateral. Monta `dist/`.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { boot, sleep } from "../helpers/jsdom-app.mjs";

const SPACE = { id: "w", name: "W", context_root: null };
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
  service_poll: { cursor: 0, gap: false, replay: false, runtime: "test-service", reset: false },
};
const FIRST_RUN = {
  ...BASE,
  list_workspaces: { workspaces: [], active: null },
  workspaces_startup: { workspaces: [], active: null },
};
const WITH_SPACE = {
  ...BASE,
  list_workspaces: { workspaces: [SPACE], active: "w" },
  workspaces_startup: { workspaces: [SPACE], active: "w" },
};
const PENDING = {
  state: "pending",
  verification_uri: "https://app.danil.ai/terminus/connect",
  verification_uri_complete: "https://app.danil.ai/terminus/connect?code=WDJB-MJHT",
  user_code: "WDJB-MJHT",
  expires_at: 1792412100000,
  online: false,
};
const unknown = () => Object.assign(new Error("command"), { what: { clave: "shell.service.command" }, detail: "command" });

function danil(initial) {
  let status = initial;
  const calls = [];
  const record = (command, reply) => (args) => {
    calls.push({ command, args });
    return reply(args);
  };
  return {
    calls,
    /** Lo que el motor dice desde ahora, por `danil_connect_status` y por el evento. */
    become: (app, next) => app.emit("danil-connect", (status = next)),
    table: {
      danil_connect_status: record("danil_connect_status", () => status),
      danil_connect_options: record("danil_connect_options", () => [{ workspace: "w", name: "W", email: "alberto@danil.ai" }]),
      danil_connect_start: record("danil_connect_start", () => (status = PENDING)),
      danil_disconnect: record("danil_disconnect", () => (status = { state: "disconnected", name: "alberto-mbp" })),
      open_external: record("open_external", () => null),
    },
  };
}

const heading = (w) => w.document.querySelector("h1")?.textContent ?? "";
const buttons = (w, root = w.document) => [...root.querySelectorAll("button")];
const button = (w, label, root) => buttons(w, root).find((b) => b.textContent.trim() === label);

test("el alta ofrece iniciar sesión con Danil por el navegador, y «Ahora no» sigue sin bloquear", async () => {
  const engine = danil({ state: "disconnected", name: "alberto-mbp" });
  const { w, fallos } = await boot("listo", "danil-onboarding", { ...FIRST_RUN, ...engine.table });
  await sleep(800);
  assert.equal(heading(w), "Inicia sesión con Danil.", w.document.body.textContent);
  assert.ok(!w.document.body.textContent.includes("Continuar como"), "one-click sign-in stays off");
  assert.ok(!engine.calls.some((c) => c.command === "danil_connect_options"));
  assert.ok(button(w, "Ahora no"), "the step can be skipped");

  button(w, "Iniciar sesión con Danil").click();
  await sleep(300);
  assert.equal(engine.calls.find((c) => c.command === "open_external")?.args?.target, PENDING.verification_uri_complete);
  const step = () => w.document.querySelector("[data-danil-onboarding]");
  assert.equal(step()?.dataset.danilOnboarding, "pending");
  assert.ok(step().textContent.includes("Confirma en el navegador · código WDJB-MJHT"), step().textContent);
  assert.ok(button(w, "Abrir de nuevo", step()) && button(w, "Cancelar", step()));

  button(w, "Ahora no").click();
  await sleep(300);
  assert.equal(heading(w), "Elige tus proveedores de IA.", "skipping goes on to the providers");
  assert.deepEqual(fallos, []);
});

test("el alta sigue sola cuando la persona confirma en el navegador", async () => {
  const engine = danil({ state: "disconnected", name: "alberto-mbp" });
  const app = await boot("listo", "danil-onboarding-approved", { ...FIRST_RUN, ...engine.table });
  await sleep(800);
  button(app.w, "Iniciar sesión con Danil").click();
  await sleep(300);
  app.emit("danil-connect", { state: "connected", computer_id: "cmp_1", name: "alberto-mbp", email: "alberto@danil.ai", online: true });
  await sleep(300);
  assert.equal(heading(app.w), "Elige tus proveedores de IA.");
});

test("el alta no muestra el paso con la sesión ya iniciada ni con un motor sin el flujo", async () => {
  const connected = danil({ state: "connected", computer_id: "cmp_1", name: "Mac", email: "alberto@danil.ai", online: true });
  const a = await boot("listo", "danil-onboarding-connected", { ...FIRST_RUN, ...connected.table });
  await sleep(800);
  assert.equal(heading(a.w), "Elige tus proveedores de IA.");

  const b = await boot("listo", "danil-onboarding-old-engine", { ...FIRST_RUN, danil_connect_status: unknown() });
  await sleep(800);
  assert.equal(heading(b.w), "Elige tus proveedores de IA.");
});

test("el pie de la barra lateral dice si hay sesión de Danil y abre su sección", async () => {
  const engine = danil({ state: "disconnected", name: "alberto-mbp" });
  const app = await boot("listo", "danil-footer", { ...WITH_SPACE, ...engine.table });
  const { w } = app;
  await sleep(800);
  const foot = () => w.document.querySelector("[data-danil-foot]");
  assert.equal(foot()?.dataset.danilFoot, "disconnected", w.document.body.innerHTML.slice(0, 400));
  assert.equal(foot().textContent.trim(), "Iniciar sesión");
  assert.equal(foot().getAttribute("title"), "Iniciar sesión con Danil");

  engine.become(app, { state: "connected", computer_id: "cmp_1", name: "Mac", email: "alberto@danil.ai", online: true });
  await sleep(300);
  assert.equal(foot()?.dataset.danilFoot, "connected");
  assert.ok(foot().textContent.includes("alberto@danil.ai"), foot().textContent);
  assert.equal(foot().getAttribute("title"), "alberto@danil.ai · en línea con Danil");
  assert.ok(foot().querySelector(".bg-success"), "the online dot");

  engine.become(app, { state: "connected", computer_id: "cmp_1", name: "Mac", email: "alberto@danil.ai", online: false });
  await sleep(300);
  assert.ok(!foot().querySelector(".bg-success"), "offline drops the dot's color");

  foot().click();
  await sleep(800);
  assert.equal(w.document.querySelector("[data-danil-account]")?.dataset.danilAccount, "connected", "the click opens Settings at the section");
});

test("sin el flujo en el motor el pie no muestra la entrada", async () => {
  const { w } = await boot("listo", "danil-footer-old-engine", { ...WITH_SPACE, danil_connect_status: unknown() });
  await sleep(800);
  assert.equal(w.document.querySelector("[data-danil-foot]"), null);
  assert.ok(w.document.querySelector('[aria-label="Configuración"]'), "the footer's other items stay");
});

test("el pie muestra el nombre y la foto de la cuenta de Danil", async () => {
  const engine = danil({ state: "disconnected", name: "alberto-mbp" });
  const app = await boot("listo", "danil-footer-person", {
    ...WITH_SPACE,
    ...engine.table,
    preview_file: ({ path }) => ({ data_url: path.endsWith("avatar-v1.png") ? "data:image/png;base64,UFJPVg==" : null }),
  });
  const { w } = app;
  await sleep(800);
  const foot = () => w.document.querySelector("[data-danil-foot]");
  const person = { state: "connected", computer_id: "cmp_1", name: "Mac", email: "alberto@danil.ai", account_name: "Alberto Ceballos", online: true };

  engine.become(app, { ...person, avatar: "/data/danil-computers/avatar-v1.png", avatar_source: "provider" });
  await sleep(300);
  assert.ok(foot().textContent.includes("Alberto Ceballos"), foot().textContent);
  assert.equal(foot().getAttribute("title"), "Alberto Ceballos · en línea con Danil");
  assert.equal(foot().querySelector("img")?.getAttribute("src"), "data:image/png;base64,UFJPVg==");
  assert.ok(foot().querySelector(".bg-success"), "the online dot stays over the photo");
  assert.ok(!engine.calls.some((c) => c.command === "danil_account_refresh"), "the footer does not ask the control plane on every start");

  engine.become(app, person);
  await sleep(300);
  assert.equal(foot().querySelector("img"), null);
  assert.equal(foot().querySelector("[data-account-avatar]")?.textContent, "AC", "without a photo, the initials");
  assert.deepEqual(app.fallos, []);
});
