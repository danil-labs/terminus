#!/usr/bin/env node
/** Configuración: proveedores, integraciones, plugins, Radiant, lengua, agentes y workspaces. */
import assert from "node:assert/strict";
import { sleep } from "../../tests/helpers/jsdom-app.mjs";
import { RESPUESTAS, boot } from "../../tests/helpers/mount-guard.mjs";

let providerWorkspace = "ws-a";
let available = [{ key: "acme", name: "acme" }];
const selections = new Map([["ws-a", [{ key: "acme", installation_id: 42 }]]]);
let pendingAreas = null;
const providerCalls = [];
let authentications = 0;
const providerInfo = (scope) => ({
  id: "github", name: "GitHub", fields: [], browser_login: true,
  select_area: true, setup_url: "https://github.com/apps/terminus-app/installations/new",
  token_label: "Token", token_help: "", token_url: "", login_help: "",
  area_label: "organización", areas_label: "organizaciones", area_help: "",
  connected: { data: {}, workspace: "person", identity: { user: "person", name: "Person" },
    selected_area: null, selected_areas: selections.get(scope) ?? [], connected_at: 1 }, unverified: null,
});
const providers = await boot("listo", "provider-workspaces", {
  ...RESPUESTAS,
  list_workspaces: () => ({ ...RESPUESTAS.list_workspaces, active: providerWorkspace }),
  list_git_hosts: ({ scope }) => [providerInfo(scope)],
  check_git_host: ({ scope }) => providerInfo(scope),
  git_host_areas: ({ scope }) => (selections.get(scope) ?? []).map(({ key }) => ({ key, name: key })),
  git_host_available_areas: ({ scope }) => { providerCalls.push(scope); return scope === "ws-a" && pendingAreas ? pendingAreas : available; },
  select_git_host_area: ({ scope, area, enabled }) => {
    const next = (selections.get(scope) ?? []).filter(({ key }) => key !== area);
    if (enabled) next.push({ key: area, installation_id: area === "acme" ? 42 : 43 });
    selections.set(scope, next);
    return providerInfo(scope);
  },
  git_host_projects: ({ scope, area }) => {
    assert.ok(selections.get(scope)?.some(({ key }) => key === area));
    return [];
  },
  start_browser_login: () => {
    authentications += 1;
    return { code: "ABCD", url: "https://github.com/login/device", expires_at: 9999999999999 };
  },
  finish_browser_login: ({ scope }) => providerInfo(scope),
  git_host_pending_setup: null,
  open_external: ({ target }) => {
    assert.ok(["https://github.com/login/device", "https://github.com/apps/terminus-app/installations/new"].includes(target));
    if (target.endsWith("/installations/new")) available = [{ key: "acme", name: "acme" }, { key: "other", name: "other" }];
  },
});
const providerButton = (text) => [...providers.w.document.querySelectorAll("button")]
  .find((button) => button.textContent?.trim() === text || button.getAttribute("aria-label") === text);
const providerAction = async (text) => {
  providerButton("Más acciones de GitHub").dispatchEvent(new providers.w.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  await sleep(50);
  const item = [...providers.w.document.querySelectorAll('[role="menuitem"]')].find(el => el.textContent?.trim() === text);
  assert.ok(item, text);
  item.dispatchEvent(new providers.w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
};
const areaButton = (key) => [...providers.w.document.querySelectorAll("li")]
  .find((li) => li.textContent?.startsWith(key))
  ?.querySelectorAll("button");
const clickArea = (key, text) => [...(areaButton(key) ?? [])]
  .find((button) => button.textContent?.trim() === text)?.click();
const selectedKeys = (scope) => (selections.get(scope) ?? []).map(({ key }) => key);
providers.w.document.querySelector('button[aria-label="Configuración"]')?.click();
await sleep(100);
providers.w.document.querySelector("#cfg-tab-projects")?.click();
await sleep(50);
providers.w.document.querySelector("#cfg-sub-fuentes")?.click();
await sleep(100);
assert.equal(providerButton("Quitar del workspace"), undefined, "la conexión previa muestra solo el resumen");
assert.ok(providers.w.document.body.textContent.includes("acme"));
assert.equal(providerButton("Usar en este workspace"), undefined, "agregar requiere abrir el selector");
await providerAction("Administrar permisos en GitHub");
await sleep(30);
providerButton("Actualizar acceso")?.click();
await sleep(100);
assert.equal(authentications, 0);
assert.ok(providerButton("Usar en este workspace"), "GitHub permite elegir las instalaciones disponibles");
assert.deepEqual(selectedKeys("ws-a"), ["acme"], "ampliar GitHub no cambia la selección");
clickArea("other", "Usar en este workspace");
await sleep(100);
assert.deepEqual(selectedKeys("ws-a"), ["acme", "other"]);
providerButton("Listo")?.click();
await sleep(50);
assert.equal(providerButton("Quitar del workspace"), undefined, "Listo oculta las acciones de selección");
providerButton("Cambiar acceso")?.click();
await sleep(50);
clickArea("acme", "Quitar del workspace");
await sleep(100);
assert.deepEqual(selectedKeys("ws-a"), ["other"]);
providerButton("Listo")?.click();
await sleep(50);
assert.equal(providerButton("Usar en este workspace"), undefined, "Listo conserva la selección y oculta las opciones");
await providerAction("Administrar permisos en GitHub");
await sleep(30);
providerButton("Actualizar acceso")?.click();
await sleep(100);
let finishOldAreas;
pendingAreas = new Promise((resolve) => { finishOldAreas = resolve; });
providerButton("Cambiar acceso")?.click();
await sleep(50);
providerWorkspace = "ws-b";
providers.w.dispatchEvent(new providers.w.CustomEvent("harness:workspace"));
await sleep(100);
assert.ok(providers.w.document.body.textContent.includes("Sin acceso seleccionado"));
await providerAction("Administrar permisos en GitHub");
await sleep(30);
providerButton("Actualizar acceso")?.click();
await sleep(100);
clickArea("acme", "Usar en este workspace");
await sleep(100);
finishOldAreas([{ key: "stale", name: "stale" }]);
await sleep(50);
assert.ok(!providers.w.document.body.textContent.includes("stale"), "una respuesta vieja no cruza de workspace");
assert.deepEqual(selectedKeys("ws-b"), ["acme"]);
assert.deepEqual(selectedKeys("ws-a"), ["other"]);
assert.equal(authentications, 0);
assert.ok(providerCalls.includes("ws-a") && providerCalls.includes("ws-b"));
assert.deepEqual(providers.fallos, []);
let integrationStatus = { installed: true, enabled: false };
let pendingIntegration = null;
const integration = await boot("listo", 9, {
  ...RESPUESTAS,
  agentsview_status: () => pendingIntegration ?? integrationStatus,
});
const integrationButton = () => integration.w.document.querySelector('button[aria-label="Analytics"]');
const workspaceChanged = () => integration.w.dispatchEvent(new integration.w.CustomEvent("harness:workspace"));
assert.equal(integrationButton(), null);
integrationStatus = { installed: true, enabled: true };
workspaceChanged();
await sleep(30);
assert.ok(integrationButton(), "switching to an enabled workspace reveals AgentsView");
let finishIntegration;
pendingIntegration = new Promise(resolve => { finishIntegration = resolve; });
workspaceChanged();
assert.equal(integrationButton(), null);
pendingIntegration = null;
integrationStatus = { installed: true, enabled: false };
workspaceChanged();
await sleep(30);
finishIntegration({ installed: true, enabled: true });
await sleep(30);
assert.equal(integrationButton(), null, "a late response cannot enable AgentsView in another workspace");
integration.emit("agentsview-changed", true);
await sleep(30);
assert.equal(integrationButton(), null, "integration events must read the active workspace");
integrationStatus = { installed: true, enabled: true };
integration.emit("agentsview-changed", true);
await sleep(30);
assert.ok(integrationButton());
assert.deepEqual(integration.fallos, []);
let pluginWorkspace = "w";
let officeInstalled = false;
let officeEnabled = false;
let pendingCatalog = null;
const pluginCalls = [];
const catalog = () => ({ workspace: pluginWorkspace, plugins: [
  { id: "agentsview", installed: true, enabled: true, version: "0.39.0", bytes: 1000, supported: true },
  { id: "libreoffice", installed: officeInstalled, enabled: officeEnabled, version: officeInstalled ? "26.2.6" : null, bytes: officeInstalled ? 800000000 : null, supported: true },
] });
const plugins = await boot("listo", "plugins", {
  ...RESPUESTAS,
  list_integrations: () => pendingCatalog ?? catalog(),
  install_integration: ({ id }) => { pluginCalls.push(["install", id]); officeInstalled = true; },
  set_integration_enabled: ({ id, workspace, enabled }) => {
    pluginCalls.push(["enable", id, workspace, enabled]); officeEnabled = enabled;
  },
  uninstall_integration: ({ id }) => { pluginCalls.push(["uninstall", id]); officeInstalled = false; officeEnabled = false; },
  list_language_packs: [], list_bundled_language_packs: [],
});
plugins.w.document.querySelector('button[aria-label="Configuración"]')?.click();
await sleep(100);
plugins.w.document.querySelector('#cfg-tab-connections')?.click();
await sleep(50);
plugins.w.document.querySelector('#cfg-sub-operation')?.click();
await sleep(100);
const officeCard = () => [...plugins.w.document.querySelectorAll("div")].find(d => d.textContent === "LibreOffice")?.parentElement?.parentElement?.parentElement;
const officeButton = (text) => [...officeCard().querySelectorAll("button")].find(b => b.textContent?.trim() === text);
const officeSwitch = () => officeCard().querySelector('button[role="switch"][aria-label="Activar en este espacio"]');
assert.ok(officeCard(), "Connections offers LibreOffice alongside AgentsView");
officeButton("Instalar").click();
await sleep(50);
assert.deepEqual(pluginCalls, [["install", "libreoffice"]]);
assert.equal(officeSwitch()?.getAttribute("aria-checked"), "false");
officeSwitch().click();
await sleep(50);
assert.equal(officeSwitch()?.getAttribute("aria-checked"), "true");
assert.deepEqual(pluginCalls.at(-1), ["enable", "libreoffice", "w", true]);
officeButton("Desinstalar").click();
await sleep(30);
const removalDialog = () => [...plugins.w.document.querySelectorAll('[role="dialog"]')].find(d => d.textContent.includes("Desinstalar") && d.textContent.includes("Cancelar"));
assert.ok(removalDialog(), "uninstall requires a visible confirmation");
[...removalDialog().querySelectorAll("button")].find(b => b.textContent?.trim() === "Cancelar").click();
await sleep(30);
assert.equal(pluginCalls.length, 2, "cancelling uninstall changes nothing");
officeButton("Desinstalar").click();
await sleep(50);
[...removalDialog().querySelectorAll("button")].find(b => b.textContent?.trim() === "Desinstalar").click();
await sleep(50);
assert.deepEqual(pluginCalls.at(-1), ["uninstall", "libreoffice"]);
assert.ok(officeButton("Instalar"));
let finishCatalog;
pendingCatalog = new Promise(resolve => { finishCatalog = resolve; });
plugins.w.dispatchEvent(new plugins.w.CustomEvent("harness:workspace"));
assert.equal(officeCard(), undefined);
pendingCatalog = null;
pluginWorkspace = "other";
plugins.w.dispatchEvent(new plugins.w.CustomEvent("harness:workspace"));
await sleep(30);
finishCatalog({ workspace: "w", plugins: [{ id: "libreoffice", installed: true, enabled: true, supported: true, version: "stale", bytes: 10 }] });
await sleep(30);
assert.ok(officeButton("Instalar"), "an old catalog cannot replace the new workspace");
assert.deepEqual(plugins.fallos, []);
/**
 * Configuración › Radiant: Cloud se confirma con un botón, el código del login se
 * ve mientras se espera al navegador, la cuenta sale de `/v1/me`, una URL HTTP no
 * entra y cambiar de workspace de Terminus no deja nada del anterior.
 */
const CLOUD = "https://radiant.danil.ai";
const radiantCalls = [];
const radiant = { server: null, signed_in: false, workspace: null, login: null };
const radiantCuenta = {
  status: "ok", email: "ana@example.test", organization: "Danil", organizations: [], note: null,
  workspaces: [{ id: "eng", name: "Ingeniería" }, { id: "ops", name: "Operación" }], revocada: false,
};
let radiantIdentityPending = null;
let radiantWorkspacesPending = null;
const radiantStatus = () => ({ cloud_server: CLOUD, ...radiant });
const radiantIdentity = () => ({
  status: radiantCuenta.status, email: radiantCuenta.email, name: null,
  organization: radiantCuenta.organization, organizations: radiantCuenta.organizations, note: radiantCuenta.note,
});
const SIN_GOBIERNO = { governed: null, stale: false, notice: null, summary: null };
const GOBERNADO = () => ({
  governed: {
    workspace_id: "eng", workspace_name: "Ingeniería", server: CLOUD, mode: "managed",
    locked: ["context_sources", "mcp_servers", "skills", "agents", "models"],
    policy_revision: "b".repeat(64), expires_at: 1_900_000_300, last_ok: 1_900_000_000,
  },
  stale: false,
  notice: null,
  summary: {
    sources: [{ id: "gov", name: "gobierno", role: "governance_root", files: 1 }],
    skills: ["revisar"],
    agents: ["revisor"],
    mcp: [
      { id: "radiant", name: "Radiant", url: "https://radiant.example.test/mcp", auth: "radiant", tailnet: false, active: true },
      { id: "interno", name: "Interno", url: "https://interno.example.ts.net/mcp", auth: "none", tailnet: true,
        active: false, reason: "radiant.governance.tailscale.missing" },
    ],
    models: { providers: ["Claude"], allowed: [], default: "sonnet" },
    connections: [{ id: "jira", provider: "jira", name: "Jira", owner: "user", purpose: "work_tracking", status: "not_connected" }],
    tailnet: { tailnet: "example.ts.net", required: true, state: { kind: "missing" } },
    issued_at: 1_900_000_000,
  },
});
let gobierno = SIN_GOBIERNO;
const radiantSesiones = [];
const radiantApp = await boot("listo", "settings-radiant", {
  radiant_governance_status: () => structuredClone(gobierno),
  radiant_govern_enable: () => {
    radiantCalls.push(["govern"]);
    gobierno = GOBERNADO();
    return structuredClone(gobierno);
  },
  radiant_govern_disable: () => {
    radiantCalls.push(["ungovern"]);
    gobierno = SIN_GOBIERNO;
    return structuredClone(gobierno);
  },
  radiant_govern_refresh: () => {
    throw { what: { clave: "radiant.error.unreachable" }, detail: "connection_failed" };
  },
  list_radiant_connections: () => structuredClone(GOBERNADO().summary.connections),
  list_governed_mcp_logins: () =>
    gobierno.governed ? [{ id: "atlassian", name: "Atlassian", sesiones: radiantSesiones.slice() }] : [],
  list_mcp_providers: () => [
    { id: "claude", label: "Claude Code", recibe: true, instalado: true, login: true },
    { id: "grok", label: "Grok", recibe: true, instalado: true, login: false,
      sin_login: { clave: "mcp.session.cli_has_none" } },
    { id: "codex", label: "Codex", recibe: false, instalado: false, login: true },
  ],
  mcp_login: ({ provider: agent, id }) => {
    radiantCalls.push(["mcp_login", agent, id]);
    return { clave: "mcp.login.opened_browser", datos: { service: "Atlassian" } };
  },
  radiant_connect_account: ({ id }) => {
    radiantCalls.push(["connect", id]);
    return null;
  },
  ...RESPUESTAS,
  list_language_packs: [], list_bundled_language_packs: [],
  radiant_status: () => radiantStatus(),
  radiant_set_server: ({ server }) => {
    radiantCalls.push(["server", server]);
    if (server.startsWith("http://")) {
      throw { what: { clave: "radiant.error.http_not_allowed" }, detail: server };
    }
    radiant.server = server;
    return radiantStatus();
  },
  radiant_login: () => {
    radiantCalls.push(["login"]);
    radiant.login = { server: radiant.server, running: true, failure: null,
      prompt: { uri: "https://auth.example.test/activate", code: "WDJB-MJHT" } };
    return radiantStatus();
  },
  get_radiant_identity: () => radiantIdentityPending ?? radiantIdentity(),
  // Objetos nuevos en cada llamada, como por IPC: el `For` del selector recrea sus opciones.
  list_radiant_workspaces: () => radiantWorkspacesPending ?? structuredClone(radiantCuenta.workspaces),
  radiant_select_workspace: ({ id }) => {
    radiantCalls.push(["workspace", id]);
    if (radiantCuenta.revocada) {
      Object.assign(radiant, { signed_in: false, workspace: null });
      throw { what: { clave: "radiant.error.no_session" }, detail: "HTTP 401 session_revoked" };
    }
    radiant.workspace = { id, name: id === "eng" ? "Ingeniería" : "Operación" };
    if (id === "ops") radiantCuenta.organization = "Danil Operación";
    return radiantStatus();
  },
  radiant_select_organization: ({ id }) => {
    radiantCalls.push(["organization", id]);
    Object.assign(radiantCuenta, { status: "ok", organization: id === "org_otra" ? "Otra" : "Danil", note: null });
    return radiantStatus();
  },
  radiant_logout: () => {
    radiantCalls.push(["logout"]);
    Object.assign(radiant, { signed_in: false, workspace: null });
    return radiantStatus();
  },
});
const rDoc = radiantApp.w.document;
const rPanel = () => rDoc.querySelector("#cfg-panel");
const rBoton = (texto) => [...rPanel().querySelectorAll("button")].find((b) => b.textContent?.trim() === texto);
const rElegir = async (select, valor) => {
  select.value = valor;
  select.dispatchEvent(new radiantApp.w.Event("change", { bubbles: true }));
  await sleep(120);
};
const completarLogin = async () => {
  Object.assign(radiant, { signed_in: true, login: null });
  radiantApp.emit("radiant", null);
  await sleep(120);
};
rDoc.querySelector('button[aria-label="Configuración"]')?.click();
await sleep(100);
rDoc.querySelector("#cfg-tab-connections")?.click();
await sleep(50);
rDoc.querySelector("#cfg-sub-operation")?.click();
await sleep(100);
assert.ok(rPanel().textContent.includes(CLOUD), "Radiant Cloud enseña su origen");
assert.equal(rBoton("Iniciar sesión"), undefined, "sin servidor elegido no hay sesión que iniciar");
rBoton("Usar este servidor").click();
await sleep(80);
assert.deepEqual(radiantCalls.at(-1), ["server", CLOUD]);
assert.ok(rPanel().textContent.includes(`Sin sesión en ${CLOUD}.`));
assert.ok(rBoton("Iniciar sesión"), "una instalación sin la CLI de Radiant ofrece iniciar sesión");
rBoton("Iniciar sesión").click();
await sleep(80);
assert.ok(rPanel().textContent.includes("WDJB-MJHT"), "el código se ve mientras se espera al navegador");
assert.ok(rBoton("Cancelar"));
assert.ok(rBoton("Servidor propio").disabled, "no se cambia de servidor con un login en vuelo");
await completarLogin();
assert.ok(
  rPanel().textContent.includes(`Sesión iniciada como ana@example.test · Danil en ${CLOUD}.`),
  "la cuenta y la organización salen del servidor",
);
const rSelect = rPanel().querySelector('select[aria-label="Workspace de Danil Teams"]');
assert.ok(rSelect, "con sesión se elige workspace remoto");
await rElegir(rSelect, "ops");
assert.deepEqual(radiantCalls.at(-1), ["workspace", "ops"]);
assert.ok(
  rPanel().textContent.includes("ana@example.test · Danil Operación"),
  "elegir workspace cambia de organización y la cuenta se relee",
);
const rMostrado = () => {
  const select = rPanel().querySelector('select[aria-label="Workspace de Danil Teams"]');
  return [select.value, select.selectedOptions[0]?.textContent];
};
assert.deepEqual(rMostrado(), ["ops", "Operación"], "tras elegir, el selector enseña el workspace elegido");
rBoton("Actualizar").click();
await sleep(80);
assert.deepEqual(rMostrado(), ["ops", "Operación"], "y lo sigue enseñando al actualizar la lista");
radiantCuenta.organization = "Danil";
rBoton("Servidor propio").click();
await sleep(50);
const rUrl = rPanel().querySelector('input[aria-label="Dirección del servidor"]');
rUrl.value = "http://radiant.example.com";
rUrl.dispatchEvent(new radiantApp.w.Event("input", { bubbles: true }));
rBoton("Usar este servidor").click();
await sleep(80);
assert.ok(rPanel().textContent.includes("El servidor necesita HTTPS."), "una URL HTTP se rechaza con su motivo");
assert.equal(radiant.server, CLOUD, "y el servidor elegido no cambia");
rBoton("Cerrar sesión").click();
await sleep(80);
assert.deepEqual(radiantCalls.at(-1), ["logout"]);
assert.ok(!rPanel().textContent.includes("ana@example.test"), "cerrar sesión borra la cuenta de la pantalla");
// Cuenta A, la sesión se revoca en el servidor y entra la cuenta B: nada de A se queda.
rBoton("Iniciar sesión").click();
await sleep(80);
await completarLogin();
assert.ok(rPanel().textContent.includes("ana@example.test · Danil"));
radiantCuenta.revocada = true;
await rElegir(rPanel().querySelector('select[aria-label="Workspace de Danil Teams"]'), "eng");
assert.ok(rPanel().textContent.includes(`Sin sesión en ${CLOUD}.`), "la revocación se ve como sesión cerrada");
assert.ok(!rPanel().textContent.includes("ana@example.test"), "sin sesión no se enseña la cuenta anterior");
Object.assign(radiantCuenta, { email: "bea@example.test", organization: "Otra", workspaces: [{ id: "legal", name: "Legal" }], revocada: false });
rBoton("Iniciar sesión").click();
await sleep(80);
await completarLogin();
assert.ok(rPanel().textContent.includes("bea@example.test · Otra"), "el login nuevo enseña su propia cuenta");
assert.ok(!rPanel().textContent.includes("ana@example.test"));
const opciones = [...rPanel().querySelectorAll('select[aria-label="Workspace de Danil Teams"] option')].map((o) => o.value).filter(Boolean);
assert.deepEqual(opciones, ["legal"], "y los workspaces de su cuenta, no los de la anterior");
// Cloud con la cuenta y la lista en camino, y se pasa a un servidor propio que ya tiene sesión de otra cuenta.
const PROPIO = "https://radiant.example.com";
const rWorkspaces = () => rPanel().querySelector('select[aria-label="Workspace de Danil Teams"]');
const rOpciones = () => [...rWorkspaces().querySelectorAll("option")].map((o) => o.value).filter(Boolean);
const rPedirCuentaYLista = async (id) => {
  const pedidas = {};
  radiantIdentityPending = new Promise((entregar, fallar) => Object.assign(pedidas, { cuenta: { entregar, fallar } }));
  radiantWorkspacesPending = new Promise((entregar, fallar) => Object.assign(pedidas, { lista: { entregar, fallar } }));
  await rElegir(rWorkspaces(), id);
  rBoton("Actualizar").click();
  await sleep(50);
  radiantIdentityPending = null;
  radiantWorkspacesPending = null;
  return pedidas;
};
const deCloud = { cuenta: radiantIdentity(), lista: radiantCuenta.workspaces };
const tardias = await rPedirCuentaYLista("legal");
radiant.workspace = null;
Object.assign(radiantCuenta, { email: "dora@example.test", organization: "Propia", workspaces: [{ id: "casa", name: "Casa" }] });
rBoton("Servidor propio").click();
await sleep(50);
const rPropio = rPanel().querySelector('input[aria-label="Dirección del servidor"]');
rPropio.value = PROPIO;
rPropio.dispatchEvent(new radiantApp.w.Event("input", { bubbles: true }));
rBoton("Usar este servidor").click();
await sleep(120);
assert.deepEqual(radiantCalls.at(-1), ["server", PROPIO]);
assert.ok(rPanel().textContent.includes(`Sesión iniciada como dora@example.test · Propia en ${PROPIO}.`));
tardias.cuenta.entregar(deCloud.cuenta);
tardias.lista.entregar(deCloud.lista);
await sleep(80);
assert.ok(!rPanel().textContent.includes("bea@example.test"), "la cuenta de Cloud que llega tarde no entra en el servidor propio");
assert.ok(rPanel().textContent.includes("dora@example.test · Propia"));
assert.deepEqual(rOpciones(), ["casa"], "ni sus workspaces");
// Cuenta A con sus peticiones en camino, cierra sesión y entra la cuenta B: el fallo tardío de A no borra a B.
const fallidas = await rPedirCuentaYLista("casa");
rBoton("Cerrar sesión").click();
await sleep(80);
Object.assign(radiantCuenta, { email: "eva@example.test", workspaces: [{ id: "taller", name: "Taller" }] });
rBoton("Iniciar sesión").click();
await sleep(80);
await completarLogin();
assert.ok(rPanel().textContent.includes("eva@example.test · Propia"));
const caducada = { what: { clave: "radiant.error.no_session" }, detail: "HTTP 401 session_revoked" };
fallidas.cuenta.fallar(caducada);
fallidas.lista.fallar(caducada);
await sleep(80);
assert.ok(rPanel().textContent.includes("eva@example.test · Propia"), "el fallo tardío de la cuenta anterior no borra la nueva");
assert.deepEqual(rOpciones(), ["taller"]);
assert.ok(!rPanel().textContent.includes("No hay sesión en este servidor"), "ni enseña su error");
rBoton("Danil Cloud").click();
await sleep(120);
assert.deepEqual(radiantCalls.at(-1), ["server", CLOUD]);
// Una cuenta en varias organizaciones elige una antes de ver workspaces.
rBoton("Cerrar sesión").click();
await sleep(80);
Object.assign(radiantCuenta, {
  status: "organization_selection_required", email: "carla@example.test", organization: null,
  organizations: [{ id: "org_danil", name: "Danil" }, { id: "org_otra", name: "Otra" }],
  note: { clave: "radiant.identity.organization_selection_required" },
});
rBoton("Iniciar sesión").click();
await sleep(80);
await completarLogin();
assert.ok(rPanel().textContent.includes("Tu cuenta pertenece a varias organizaciones."), "lo que falta sale del catálogo");
assert.equal(rPanel().querySelector('select[aria-label="Workspace de Danil Teams"]'), null, "sin organización no se ofrecen workspaces");
const rOrganizacion = rPanel().querySelector('select[aria-label="Organización"]');
assert.deepEqual([...rOrganizacion.querySelectorAll("option")].map((o) => o.value).filter(Boolean), ["org_danil", "org_otra"]);
await rElegir(rOrganizacion, "org_otra");
assert.deepEqual(radiantCalls.at(-1), ["organization", "org_otra"]);
assert.ok(rPanel().textContent.includes("carla@example.test · Otra"), "la organización elegida queda en la cuenta");
assert.equal(rPanel().querySelector('select[aria-label="Organización"]'), null);
assert.ok(rPanel().querySelector('select[aria-label="Workspace de Danil Teams"]'));
// Gobernar el workspace con el remoto elegido: lo instalado se resume y lo que falta se dice.
const rGobierno = () => rPanel().querySelector('button[aria-label="Administrar este workspace con Danil Teams"]');
assert.ok(rGobierno()?.disabled, "sin workspace remoto elegido no se gobierna");
radiant.workspace = { id: "eng", name: "Ingeniería" };
radiantApp.emit("radiant", null);
await sleep(120);
assert.ok(rPanel().textContent.includes("Administrar este workspace con Danil Teams (Ingeniería)."));
rGobierno().click();
await sleep(120);
assert.deepEqual(radiantCalls.at(-1), ["govern"]);
assert.ok(rPanel().textContent.includes("Lo administra Danil Teams · workspace Ingeniería."), "el interruptor queda puesto");
assert.ok(rPanel().textContent.includes("gobierno (raíz)"), "la raíz de gobierno sale en el resumen");
assert.ok(rPanel().textContent.includes("revisar") && rPanel().textContent.includes("revisor"));
assert.ok(rPanel().textContent.includes("Tailscale no está instalado en este equipo."), "un MCP de tailnet dice por qué no se activa");
assert.ok(rPanel().textContent.includes("No instalado"), "y el estado de Tailscale se ve");
rBoton("Conectar").click();
await sleep(80);
assert.deepEqual(radiantCalls.at(-1), ["connect", "jira"], "Conectar pide la URL de Pipes al backend");
// El MCP gobernado con OAuth: el login lo hace la CLI de cada agente que recibe servidores.
assert.ok(rPanel().textContent.includes("Inicio de sesión de los servidores MCP"));
assert.ok(rPanel().textContent.includes("Esta CLI no inicia sesión en servidores MCP · su CLI no la ofrece"),
  "el agente sin login MCP lo dice con su motivo");
assert.ok(!rPanel().textContent.includes("Codex"), "un agente que no recibe servidores no sale");
rBoton("Iniciar sesión con Claude Code").click();
await sleep(80);
assert.deepEqual(radiantCalls.at(-1), ["mcp_login", "claude", "atlassian"]);
assert.ok(rPanel().textContent.includes("Se abrió tu navegador para autorizar Atlassian."));
radiantSesiones.push("claude");
radiantApp.emit("mcp", null);
await sleep(120);
assert.equal(rBoton("Iniciar sesión con Claude Code"), undefined, "con sesión ya no se ofrece");
assert.ok(rPanel().textContent.includes("Sesión iniciada"));
gobierno = { ...GOBERNADO(), stale: true };
gobierno.governed.last_error = "radiant.error.unreachable";
rBoton("Renovar").click();
await sleep(60);
radiantApp.emit("radiant", null);
await sleep(120);
assert.ok(rPanel().textContent.includes("Vencido"), "un gobierno sin renovar se marca vencido");
assert.ok(rPanel().textContent.includes("No se pudo renovar."), "y se dice que lo instalado sigue");
rGobierno().click();
await sleep(120);
assert.deepEqual(radiantCalls.at(-1), ["ungovern"]);
assert.ok(!rPanel().textContent.includes("Lo administra Danil Teams"), "desactivar quita el gobierno de la pantalla");
gobierno = { ...SIN_GOBIERNO, notice: "radiant.governance.notice.denied" };
radiantApp.emit("radiant", null);
await sleep(120);
assert.ok(rPanel().textContent.includes("Danil Teams dejó de conceder este workspace"), "un 403 se avisa");
gobierno = SIN_GOBIERNO;
radiant.workspace = null;
// Cambiar de workspace de Terminus borra lo mostrado, y la respuesta tardía del anterior no entra.
const cambiarDeWorkspace = () => radiantApp.w.dispatchEvent(new radiantApp.w.CustomEvent("harness:workspace"));
const carla = radiantIdentity();
let entregarIdentidad;
radiantIdentityPending = new Promise((resolve) => { entregarIdentidad = resolve; });
rBoton("Cerrar sesión").click();
await sleep(80);
rBoton("Iniciar sesión").click();
await sleep(80);
await completarLogin();
assert.ok(rPanel().textContent.includes(`Sesión iniciada en ${CLOUD}.`), "la identidad del primer workspace sigue en camino");
radiantIdentityPending = null;
Object.assign(radiant, { server: CLOUD, signed_in: true, workspace: null, login: null });
Object.assign(radiantCuenta, { status: "ok", email: "bea@example.test", organization: "Otra", organizations: [], note: null, workspaces: [{ id: "legal", name: "Legal" }] });
cambiarDeWorkspace();
assert.ok(!rPanel().textContent.includes("Sesión iniciada"), "el cambio borra la sesión mostrada sin esperar al servicio");
await sleep(120);
assert.ok(rPanel().textContent.includes("bea@example.test · Otra"), "el workspace nuevo enseña su propia cuenta");
entregarIdentidad(carla);
await sleep(80);
assert.ok(!rPanel().textContent.includes("carla@example.test"), "la respuesta tardía del workspace anterior se descarta");
assert.ok(rPanel().textContent.includes("bea@example.test · Otra"));
Object.assign(radiant, { server: null, signed_in: false, workspace: null, login: null });
cambiarDeWorkspace();
await sleep(80);
assert.equal(rBoton("Iniciar sesión"), undefined, "un workspace sin servidor elegido no hereda el del anterior");
assert.equal(rPanel().querySelector("select"), null, "ni su cuenta ni sus workspaces remotos");
assert.ok(!rPanel().textContent.includes("bea@example.test"));
assert.deepEqual(radiantApp.fallos, []);
/**
 * El selector de lengua dice la lengua que se acaba de poner, también
 * mientras el disco no ha terminado de guardarla. Si cambiar de lengua
 * remonta General, el selector nuevo relee la anterior y queda un paso atrás.
 */
let savedLanguage = null;
const languageSaves = [];
const languageApp = await boot("listo", "language-select", {
  ...RESPUESTAS,
  list_workspaces: () => ({ workspaces: [{ id: "w", name: "W", context_root: null, lengua: savedLanguage }], active: "w" }),
  list_language_packs: [], list_bundled_language_packs: [],
  set_workspace_language: ({ lengua }) =>
    new Promise((resolve) => languageSaves.push(() => { savedLanguage = lengua; resolve(null); })),
});
const languageDoc = languageApp.w.document;
languageDoc.querySelector('button[aria-label="Configuración"]')?.click();
await sleep(100);
languageDoc.querySelector("#cfg-tab-preferences")?.click();
await sleep(50);
const languageSelect = () =>
  [...languageDoc.querySelectorAll("select")].find((s) => s.querySelector('option[value="en"]') && s.querySelector('option[value=""]'));
const pickLanguage = async (code) => {
  const select = languageSelect();
  select.value = code;
  select.dispatchEvent(new languageApp.w.Event("change", { bubbles: true }));
  await sleep(80);
};
assert.ok(languageSelect(), "General shows the language select");
await pickLanguage("en");
assert.equal(languageDoc.documentElement.lang, "en");
assert.equal(languageSelect().value, "en", "the select names the language just applied");
await pickLanguage("es");
assert.equal(languageDoc.documentElement.lang, "es");
assert.equal(languageSelect().value, "es");
languageSaves.splice(0).forEach((save) => save());
assert.deepEqual(languageApp.fallos, []);
/**
 * Configuración › Agentes contra un catálogo con estado: crear en otra
 * carpeta, agregar con mudanza, rechazo dentro del diálogo, quitar de
 * «todas», deshacer, y un deshacer que choca con un cambio hecho desde fuera.
 */
const carpetasDelCatalogo = [
  { id: "app", name: "Terminus App", kind: "folder", sources: [], portfolio: null },
  { id: "rad", name: "Radiant", kind: "folder", sources: [], portfolio: null },
  { id: "kn", name: "kn", kind: "folder", sources: [], portfolio: null },
];
const idsDelCatalogo = carpetasDelCatalogo.map((p) => p.id);
const nombreDeCarpeta = (id) => carpetasDelCatalogo.find((p) => p.id === id)?.name ?? id;
const qaDelRepositorio = "/repo/app/.agents/agents/qa/agent.md";
const qaDeRadiant = "/repo/rad/.agents/agents/qa/agent.md";
let radiantDeclaraQa = false;
const agentesPropios = [
  { name: "giskard-po", scope: { kind: "project", id: "app" }, list: ["app"], display: "Giskard Product Owner", description: "Product Owner de Terminus." },
  { name: "notas-de-version", scope: { kind: "workspace" }, list: null, display: null, description: "Escribe las notas de versión." },
  { name: "qa", scope: { kind: "project", id: "kn" }, list: ["kn"], display: "QA de kn", description: "Prueba los flujos de kn." },
];
const declaracion = (a) => {
  const base = a.scope.kind === "project" ? `/ws/projects/${a.scope.id}/agents/${a.name}` : `/ws/agents/${a.name}`;
  return { name: a.name, description: a.description, instructions: "Trabaja.", tools: [], model: null, origin: `${base}/agent.md`, folder: base, providers: ["claude"], own: true, own_scope: a.scope };
};
const perfilDe = (display) => ({ display_name: display, body: null, background: null, veil: 0.82, provider: null, model: null, effort: null, hidden: false });
const cambiosDeCarpetas = [];
const creados = [];
const agentesApp = await boot("listo", "settings-agents", {
  ...RESPUESTAS,
  list_projects: () => structuredClone(carpetasDelCatalogo),
  list_language_packs: [], list_bundled_language_packs: [],
  list_agent_profiles: {},
  // Clonado como lo entrega el IPC: el front reconcilia sobre lo que recibe.
  list_machine_agents: () => structuredClone({
    own: agentesPropios
      .map((a) => ({
        agent: declaracion(a),
        profile: perfilDe(a.display),
        folders: a.list === null ? idsDelCatalogo : idsDelCatalogo.filter((id) => a.list.includes(id)),
        all_folders: a.list === null,
        blocked: a.name === "qa" ? [{ folder: "app", origin: qaDelRepositorio, repository: true }] : [],
        catalog_taken: null,
      }))
      .sort((x, y) => x.agent.name.localeCompare(y.agent.name)),
    repository: [{
      agent: { name: "qa", description: "Verifica que un cambio funcione.", instructions: "", tools: [], model: null, origin: qaDelRepositorio, folder: "/repo/app/.agents/agents/qa", providers: ["claude"], own: false, own_scope: null },
      profile: perfilDe(null),
      folders: ["app"],
    }],
  }),
  change_agent_folders: ({ scope, name, change }) => {
    cambiosDeCarpetas.push([name, scope, change]);
    const a = agentesPropios.find((x) => x.name === name && JSON.stringify(x.scope) === JSON.stringify(scope));
    const niega = (codigo, origin = "") => Promise.reject({
      what: { clave: `settings.agents.error.${codigo}`, datos: { name, folder: change.folder ? nombreDeCarpeta(change.folder) : "", origin } },
      detail: codigo,
    });
    if (!a) return niega("missing");
    const actual = a.list ?? idsDelCatalogo;
    if (change.kind === "add") {
      if (actual.includes(change.folder)) return niega("already_active");
      if (name === "qa" && change.folder === "app") return niega("shadowed_repository", qaDelRepositorio);
      if (name === "qa" && change.folder === "rad" && radiantDeclaraQa) return niega("shadowed_repository", qaDeRadiant);
      a.scope = { kind: "workspace" };
      a.list = [...actual, change.folder];
      return [...a.list];
    }
    if (change.kind === "remove") {
      const quedan = actual.filter((id) => id !== change.folder);
      if (quedan.length === 0) return niega("last_folder");
      a.list = quedan;
      return [...quedan];
    }
    if (JSON.stringify(change.expected) !== JSON.stringify(a.list)) return niega("conflict");
    a.list = change.folders;
    return structuredClone(a.list);
  },
  create_agent: ({ name, description, scope }) => {
    creados.push([name, scope]);
    const a = { name, scope, list: [scope.id], display: null, description };
    agentesPropios.push(a);
    return { agent: declaracion(a), eclipsado_por: null };
  },
  save_agent_profile: ({ name, displayName }) => {
    const a = agentesPropios.find((x) => x.name === name);
    if (a) a.display = displayName;
    return null;
  },
});
const agDoc = agentesApp.w.document;
let avisosAlRiel = 0;
agentesApp.w.addEventListener("harness:encargados", () => avisosAlRiel++);
let avisosDePerfiles = 0;
agentesApp.w.addEventListener("harness:profiles", () => avisosDePerfiles++);
const tecla = (key) =>
  agDoc.activeElement.dispatchEvent(new agentesApp.w.KeyboardEvent("keydown", { key, bubbles: true }));
const botonCon = (raiz, texto) => [...raiz.querySelectorAll("button")].find((b) => b.textContent?.trim() === texto);
const propia = (name) =>
  [...agDoc.querySelectorAll('section[aria-labelledby="agents-own"] [role="list"] > [role="listitem"]')]
    .find((li) => [...li.querySelectorAll("span")].some((s) => s.textContent === name));
const rotuloDeCarpetas = (name) => propia(name).querySelector('[role="group"] > span').textContent;
const chips = (name) => [...propia(name).querySelectorAll('[role="group"] > span')].slice(1).map((s) => s.textContent);
const quitarDe = (name, carpeta) => propia(name).querySelector(`button[aria-label="Quitar ${name} de ${carpeta}"]`);
const menuDe = (name) => agDoc.querySelector(`[role="menu"][aria-label="Agregar ${name} a un proyecto"]`);
const abrirMenuDe = async (name) => {
  botonCon(propia(name), "Agregar a proyecto…").click();
  await sleep(60);
  return menuDe(name);
};
const renglones = (menu) => [...menu.querySelectorAll('[role="menuitem"]')];
const renglon = (menu, carpeta) => renglones(menu).find((r) => r.textContent.startsWith(carpeta));
const dialogoDeMudanza = (name) =>
  [...agDoc.querySelectorAll('[role="dialog"],[role="alertdialog"]')]
    .find((d) => d.textContent.includes(`¿Pasar ${name} al catálogo del workspace?`));
const panelDeAjustes = () => agDoc.querySelector("#cfg-panel");

agDoc.querySelector('button[aria-label="Configuración"]')?.click();
await sleep(100);
const pestanas = [...agDoc.querySelectorAll('[role="tab"][id^="cfg-tab-"]')].map((b) => b.id);
const proyectos = pestanas.indexOf("cfg-tab-projects");
assert.deepEqual(pestanas.slice(proyectos, proyectos + 2), ["cfg-tab-projects", "cfg-tab-agents-skills"]);
agDoc.querySelector("#cfg-tab-projects").click();
// La página llega en su propio trozo: se espera a que pinte sus filas.
for (let i = 0; i < 120 && !agDoc.querySelector("#cfg-panel [data-settings-project]"); i++) await sleep(25);
const filasDeProyectos = [...agDoc.querySelectorAll("#cfg-panel [data-settings-project]")];
assert.deepEqual(filasDeProyectos.map((f) => f.getAttribute("data-settings-project")), idsDelCatalogo, "Ajustes › Proyectos lista las carpetas del espacio");
assert.ok(filasDeProyectos.every((f) => f.textContent.includes("Archivos") && f.textContent.includes("sin tareas")), "cada fila dice su tipo en palabras y que no tiene tareas");
assert.doesNotMatch(panelDeAjustes().textContent, /\bgit\b/i, "la página no le habla de git a la persona");
agDoc.querySelector("#cfg-tab-agents-skills").click();
// Agentes llega en su propio trozo: se espera a que pinte sus filas.
for (let i = 0; i < 120 && !propia("giskard-po"); i++) await sleep(25);

assert.ok(propia("giskard-po"), "la sección lista los agentes propios");
assert.deepEqual(chips("giskard-po"), ["Terminus App"]);
assert.equal(quitarDe("giskard-po", "Terminus App"), null, "la última carpeta no lleva ×");
assert.equal(rotuloDeCarpetas("notas-de-version"), "Activo en todos los proyectos:");
assert.deepEqual(chips("notas-de-version"), ["Terminus App", "Radiant", "kn"]);
assert.ok(quitarDe("notas-de-version", "kn"), "«todas» se ve carpeta por carpeta, cada una con ×");
assert.equal(botonCon(propia("notas-de-version"), "Agregar a proyecto…"), undefined);
const delRepo = agDoc.querySelector('section[aria-labelledby="agents-repository"]');
assert.ok(delRepo?.textContent.includes("Declarado en:"), "los del repositorio se ven aparte y solo se leen");
assert.equal(botonCon(delRepo, "Agregar a proyecto…"), undefined);

// Crear desde Configuración: el formulario del riel, con la carpeta elegible.
botonCon(panelDeAjustes(), "Agregar nuevo agente").click();
await sleep(80);
const nuevo = [...agDoc.querySelectorAll('[role="dialog"]')].find((d) => d.textContent.includes("Nuevo agente"));
assert.ok(nuevo, "«Agregar nuevo agente» abre el formulario de siempre");
const carpetaNueva = nuevo.querySelector("select");
assert.equal(carpetaNueva.value, "app", "sin carpeta abierta, nace en la primera");
carpetaNueva.value = "rad";
carpetaNueva.dispatchEvent(new agentesApp.w.Event("change", { bubbles: true }));
const escribir = (campo, texto) => {
  campo.value = texto;
  campo.dispatchEvent(new agentesApp.w.InputEvent("input", { bubbles: true }));
};
const [campoNombre, campoQueHace] = nuevo.querySelectorAll("input");
escribir(campoNombre, "Revisor");
escribir(campoQueHace, "Revisa antes de que aterrice.");
escribir(nuevo.querySelector("textarea"), "Con criterio.");
botonCon(nuevo, "Crear").click();
await sleep(150);
assert.deepEqual(creados, [["revisor", { kind: "project", id: "rad" }]], "nace de proyecto en la carpeta elegida");
assert.equal([...agDoc.querySelectorAll('[role="dialog"]')].some((d) => d.textContent.includes("Nuevo agente")), false);
assert.deepEqual(chips("revisor"), ["Radiant"], "aparece en la lista sin reabrir Configuración");

// Menú: marcadas, deshabilitadas con su razón, flechas, y Esc devuelve el foco.
let menu = await abrirMenuDe("giskard-po");
assert.ok(menu, "«Agregar a proyecto…» abre el menú de carpetas");
assert.equal(renglon(menu, "Terminus App").getAttribute("aria-disabled"), "true");
assert.ok(renglon(menu, "Terminus App").textContent.includes("Ya está aquí"));
assert.equal(agDoc.activeElement, renglon(menu, "Radiant"), "el foco entra al primer renglón elegible");
tecla("ArrowDown");
assert.equal(agDoc.activeElement, renglon(menu, "kn"));
tecla("Escape");
await sleep(60);
assert.equal(menuDe("giskard-po"), null, "Esc cierra el menú");
assert.ok(panelDeAjustes(), "y no se lleva Configuración");
assert.equal(agDoc.activeElement, botonCon(propia("giskard-po"), "Agregar a proyecto…"), "el foco vuelve al botón");

// Agregar uno de proyecto a otra carpeta pide la mudanza; Cancelar va primero.
menu = await abrirMenuDe("giskard-po");
renglon(menu, "Radiant").click();
await sleep(80);
assert.ok(dialogoDeMudanza("giskard-po"), "uno de proyecto pide pasar al catálogo");
assert.equal(agDoc.activeElement?.textContent?.trim(), "Cancelar", "el foco empieza en Cancelar");
tecla("Escape");
await sleep(80);
assert.equal(dialogoDeMudanza("giskard-po"), undefined);
assert.ok(panelDeAjustes(), "Esc en el diálogo no cierra Configuración");
assert.deepEqual(cambiosDeCarpetas, [], "cancelar no cambia nada");
assert.equal(agDoc.activeElement, botonCon(propia("giskard-po"), "Agregar a proyecto…"));
menu = await abrirMenuDe("giskard-po");
renglon(menu, "Radiant").click();
await sleep(80);
const avisosAntes = avisosAlRiel;
botonCon(dialogoDeMudanza("giskard-po"), "Pasar al catálogo y agregar").click();
await sleep(150);
assert.deepEqual(cambiosDeCarpetas.at(-1), ["giskard-po", { kind: "project", id: "app" }, { kind: "add", folder: "rad" }]);
assert.equal(dialogoDeMudanza("giskard-po"), undefined);
assert.deepEqual(chips("giskard-po"), ["Terminus App", "Radiant"]);
assert.ok(quitarDe("giskard-po", "Radiant"), "ya en el catálogo, cada carpeta se puede quitar");
assert.ok(panelDeAjustes().textContent.includes("giskard-po pasó al catálogo del workspace."));
assert.ok(panelDeAjustes().textContent.includes("Ya está activo en Terminus App y en Radiant."));
assert.ok(avisosAlRiel > avisosAntes, "el riel se entera");

// Rechazo: en el menú, con la razón; y el que llega del backend, dentro del diálogo.
menu = await abrirMenuDe("qa");
assert.equal(renglon(menu, "Terminus App").getAttribute("aria-disabled"), "true");
assert.ok(renglon(menu, "Terminus App").textContent.includes("Gana el qa del repositorio de Terminus App"));
const cambiosAntes = cambiosDeCarpetas.length;
renglon(menu, "Terminus App").click();
await sleep(40);
assert.equal(cambiosDeCarpetas.length, cambiosAntes, "un renglón deshabilitado no pide nada");
tecla("Escape");
await sleep(60);
radiantDeclaraQa = true;
menu = await abrirMenuDe("qa");
renglon(menu, "Radiant").click();
await sleep(80);
botonCon(dialogoDeMudanza("qa"), "Pasar al catálogo y agregar").click();
await sleep(120);
const rechazo = dialogoDeMudanza("qa")?.querySelector('[role="alert"]');
assert.equal(
  rechazo?.textContent,
  `No se agregó qa a Radiant. Ahí gana el qa del repositorio, que se declara en ${qaDeRadiant}.`,
  "el rechazo se lee dentro del diálogo, con quién gana y dónde",
);
botonCon(dialogoDeMudanza("qa"), "Cancelar").click();
await sleep(80);
assert.deepEqual(chips("qa"), ["kn"]);

// Quitar de «todas» la vuelve lista fija; Deshacer la devuelve a «todas».
const perfilesAntes = avisosDePerfiles;
quitarDe("notas-de-version", "kn").click();
await sleep(120);
assert.deepEqual(cambiosDeCarpetas.at(-1), ["notas-de-version", { kind: "workspace" }, { kind: "remove", folder: "kn" }]);
assert.equal(rotuloDeCarpetas("notas-de-version"), "Activo en:");
assert.deepEqual(chips("notas-de-version"), ["Terminus App", "Radiant"]);
assert.ok(botonCon(propia("notas-de-version"), "Agregar a proyecto…"), "vuelve «Agregar a proyecto…»");
assert.ok(panelDeAjustes().textContent.includes("notas-de-version ya no está en kn."));
assert.ok(panelDeAjustes().textContent.includes("Ahora está en una lista fija de proyectos: los nuevos no lo tendrán."));
assert.equal(agDoc.activeElement?.getAttribute("aria-label"), "Quitar notas-de-version de Radiant", "el foco pasa a la vecina");
botonCon(panelDeAjustes(), "Deshacer").click();
await sleep(150);
assert.deepEqual(cambiosDeCarpetas.at(-1)[2], { kind: "restore", expected: ["app", "rad"], folders: null });
assert.equal(
  avisosDePerfiles - perfilesAntes,
  2,
  "quitar y deshacer releen las caras: el riel las lee por carpeta, y el que vuelve a una se pintaría sin su cara ni su fondo",
);
assert.equal(rotuloDeCarpetas("notas-de-version"), "Activo en todos los proyectos:");
assert.deepEqual(chips("notas-de-version"), ["Terminus App", "Radiant", "kn"]);

// Un deshacer que choca con un cambio hecho desde fuera no lo pisa.
quitarDe("giskard-po", "Radiant").click();
await sleep(120);
assert.ok(panelDeAjustes().textContent.includes("giskard-po ya no aparece en Radiant."));
assert.equal(quitarDe("giskard-po", "Terminus App"), null);
agentesPropios.find((a) => a.name === "giskard-po").list = ["app", "kn"];
botonCon(panelDeAjustes(), "Deshacer").click();
await sleep(150);
assert.deepEqual(cambiosDeCarpetas.at(-1)[2], { kind: "restore", expected: ["app"], folders: ["app", "rad"] });
assert.deepEqual(agentesPropios.find((a) => a.name === "giskard-po").list, ["app", "kn"], "no pisa el cambio de fuera");
assert.ok(
  [...panelDeAjustes().querySelectorAll('[role="alert"]')].some((a) =>
    a.textContent.includes("giskard-po cambió mientras tanto. Revisa la lista y vuelve a intentarlo.")),
  "el conflicto se enseña",
);
assert.deepEqual(chips("giskard-po"), ["Terminus App", "kn"], "y la lista se relee");

// Abrir perfil cierra Configuración y lo abre en su primera carpeta.
botonCon(propia("giskard-po"), "Abrir perfil").click();
await sleep(100);
assert.equal(agentesApp.comandos.includes("send_message"), false, "abrir el perfil no crea un chat persistente");
assert.equal(panelDeAjustes(), null);
assert.deepEqual(agentesApp.fallos, []);
/**
 * Renombrar un workspace es un gesto con nombre, vale para el que no está
 * activo, y cancelar cancela: Escape cierra el campo sin guardar y sin
 * llevarse por delante el diálogo de Configuración.
 */
let espacios = {
  workspaces: [
    { id: "w", name: "Acme", context_root: null, sessions: 0 },
    { id: "w2", name: "Beta", context_root: null, sessions: 0 },
  ],
  active: "w",
};
const renombres = [];
const cambiosDeWorkspace = [];
const renombrar = await boot("listo", "workspace-rename", {
  ...RESPUESTAS,
  list_workspaces: () => espacios,
  workspaces_startup: () => espacios,
  list_language_packs: [], list_bundled_language_packs: [],
  set_active_workspace: ({ id }) => { cambiosDeWorkspace.push(id); },
  rename_workspace: ({ id, name }) => {
    renombres.push([id, name]);
    espacios = { ...espacios, workspaces: espacios.workspaces.map((w) => (w.id === id ? { ...w, name } : w)) };
    return espacios.workspaces.find((w) => w.id === id);
  },
});
await sleep(300);
renombrar.w.document.querySelector('[data-workspace-column] [data-workspace-tile="w"]')
  ?.dispatchEvent(new renombrar.w.MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
await sleep(80);
[...renombrar.w.document.querySelectorAll('[role="menuitem"]')]
  .find((b) => b.textContent?.trim() === "Administrar workspaces")?.click();
await sleep(100);
const lapiz = (name) =>
  renombrar.w.document.querySelector(`button[aria-label="Cambiarle el nombre a «${name}»"]`);
const campoDeNombre = (name) =>
  renombrar.w.document.querySelector(`input[aria-label="Nuevo nombre de «${name}»"]`);
assert.ok(lapiz("Beta"), "renombrar el workspace que no es el activo tiene que ser un gesto visible");
assert.ok(lapiz("Acme"), "y el activo también");
lapiz("Beta").click();
await sleep(50);
assert.deepEqual(cambiosDeWorkspace, [], "pedir renombrar no cambia de cliente");
const cancelado = campoDeNombre("Beta");
assert.ok(cancelado, "el gesto abre el campo del nombre");
cancelado.value = "Gamma";
cancelado.dispatchEvent(new renombrar.w.InputEvent("input", { bubbles: true }));
cancelado.dispatchEvent(new renombrar.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
await sleep(50);
assert.deepEqual(renombres, [], "Escape cancela sin guardar");
assert.ok(lapiz("Beta"), "y Escape no se lleva por delante Configuración");
lapiz("Beta").click();
await sleep(50);
const escrito = campoDeNombre("Beta");
escrito.value = "Gamma";
escrito.dispatchEvent(new renombrar.w.InputEvent("input", { bubbles: true }));
escrito.dispatchEvent(new renombrar.w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
await sleep(150);
assert.deepEqual(renombres, [["w2", "Gamma"]], "Enter guarda el que no es el activo");
assert.deepEqual(cambiosDeWorkspace, [], "renombrar no cambia de cliente");
assert.ok(lapiz("Gamma"), "la lista se relee con el nombre nuevo");
assert.deepEqual(renombrar.fallos, []);

// Los árboles montados conservan sus relojes: el proceso no termina solo.
process.exit(0);
