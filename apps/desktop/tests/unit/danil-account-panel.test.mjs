/**
 * Configuración → Cuenta de Danil contra un motor simulado: entrar con el
 * correo de un workspace, con el navegador, cancelar y cerrar sesión. Monta `dist/`.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { boot, sleep } from "../helpers/jsdom-app.mjs";

const BASE = {
  window_ready: null,
  window_vitals: null,
  setup_required: false,
  list_providers: [],
  list_workspaces: { workspaces: [{ id: "w", name: "W", context_root: null }], active: "w" },
  workspaces_startup: { workspaces: [{ id: "w", name: "W", context_root: null }], active: "w" },
  list_projects: [],
  list_sources: [],
  list_live_sessions: [],
  list_live_turns: [],
  list_surfaces: [],
  service_poll: { cursor: 0, gap: false, replay: false, runtime: "test-service", reset: false },
};

test("la cuenta de Danil entra con un correo conocido o con el navegador, y cierra sesión", async () => {
  let status = { state: "disconnected", name: "alberto-mbp" };
  const calls = [];
  const record = (command, reply) => (args) => {
    calls.push({ command, args });
    return reply(args);
  };
  const app = await boot("listo", "danil-account", {
    ...BASE,
    danil_connect_status: record("danil_connect_status", () => status),
    danil_connect_options: record("danil_connect_options", () => [
      { workspace: "w-ok", name: "Danil", email: "alberto@danil.ai" },
      { workspace: "w-sin", name: "Cliente", email: "sin@cuenta.mx" },
    ]),
    danil_connect_start: record("danil_connect_start", (args) => {
      if (args?.workspace === "w-sin") throw Object.assign(new Error("no_danil_account"), { what: { clave: "danil.error.no_danil_account" }, detail: "no_danil_account" });
      if (args?.workspace === "w-ok") {
        status = { state: "connected", computer_id: "cmp_1", name: args.name, email: "alberto@danil.ai", online: true };
        return status;
      }
      status = {
        state: "pending",
        verification_uri: "https://app.danil.ai/terminus/connect",
        verification_uri_complete: "https://app.danil.ai/terminus/connect?code=WDJB-MJHT",
        user_code: "WDJB-MJHT",
        expires_at: 1792412100000,
        online: false,
      };
      return status;
    }),
    danil_disconnect: record("danil_disconnect", () => {
      status = { state: "disconnected", name: "alberto-mbp", online: false };
      return status;
    }),
    open_external: record("open_external", () => null),
  });
  const { w } = app;
  const panel = () => w.document.querySelector("[data-danil-account]");
  const text = () => panel()?.textContent ?? "";
  const button = (label) => [...(panel()?.querySelectorAll("button") ?? [])].find((b) => b.textContent.trim() === label);
  const settle = () => sleep(300);

  w.dispatchEvent(new w.CustomEvent("harness:open-settings", { detail: "cuenta-danil" }));
  await sleep(800);
  assert.ok(w.document.getElementById("cfg-tab-cuenta-danil")?.textContent.includes("Cuenta de Danil"), "the rail shows the section");
  assert.equal(panel()?.dataset.danilAccount, "disconnected");
  assert.equal(panel().querySelector("input")?.value, "alberto-mbp", "the name defaults to the hostname the engine suggests");
  assert.ok(button("Continuar como alberto@danil.ai") && button("Continuar como sin@cuenta.mx"), "one button per email");
  assert.ok(button("Iniciar sesión con otra cuenta"), "the browser stays as the other way in");

  button("Continuar como sin@cuenta.mx").click();
  await settle();
  assert.ok(text().includes("Ese correo no tiene cuenta de Danil"), text());
  assert.equal(panel()?.dataset.danilAccount, "disconnected");

  const input = panel().querySelector("input");
  input.value = "Mac de Alberto";
  input.dispatchEvent(new w.Event("input", { bubbles: true }));
  button("Iniciar sesión con otra cuenta").click();
  await settle();
  assert.deepEqual(calls.find((c) => c.command === "danil_connect_start" && !c.args?.workspace)?.args, { name: "Mac de Alberto" });
  assert.equal(calls.find((c) => c.command === "open_external")?.args?.target, "https://app.danil.ai/terminus/connect?code=WDJB-MJHT");
  assert.ok(text().includes("Confirma en el navegador · código WDJB-MJHT"), text());

  button("Cancelar").click();
  await settle();
  assert.equal(panel()?.dataset.danilAccount, "disconnected");

  button("Continuar como alberto@danil.ai").click();
  await settle();
  assert.equal(calls.filter((c) => c.command === "open_external").length, 1, "a known email does not open the browser");
  assert.ok(text().includes("alberto@danil.ai · esta computadora: Mac de Alberto"), text());
  assert.ok(text().includes("En línea con Danil."));

  app.emit("danil-connect", { state: "error", error: "revoked", online: false });
  await settle();
  assert.equal(panel()?.dataset.danilAccount, "error", "the event carries the whole state");
  assert.ok(text().includes("Esta computadora se quitó de tu cuenta de Danil"), text());
  assert.ok(button("Iniciar sesión con otra cuenta"), "from an error the person can sign in again");

  // Por el navegador el motor no conoce el correo.
  app.emit("danil-connect", { state: "connected", computer_id: "cmp_1", name: "Mac", online: false });
  await settle();
  assert.ok(text().includes("Tu cuenta de Danil · esta computadora: Mac"), text());
  assert.ok(text().includes("Sin conexión con Danil por ahora."));
  button("Cerrar sesión").click();
  await settle();
  assert.equal(calls.at(-1)?.command, "danil_disconnect");
  assert.equal(panel()?.dataset.danilAccount, "disconnected");
});

test("con un motor que no trae el flujo, la sección lo dice en vez de fallar", async () => {
  // Lo que contesta el proxy de la ventana a un nombre que su contrato no trae.
  const unknown = () => Object.assign(new Error("command"), { what: { clave: "shell.service.command" }, detail: "command" });
  const app = await boot("listo", "danil-account-old-engine", { ...BASE, danil_connect_status: unknown(), danil_connect_options: unknown() });
  const { w } = app;
  w.dispatchEvent(new w.CustomEvent("harness:open-settings", { detail: "cuenta-danil" }));
  await sleep(800);
  const panel = w.document.querySelector("[data-danil-account]");
  assert.equal(panel?.dataset.danilAccount, "unavailable", panel?.outerHTML);
});
