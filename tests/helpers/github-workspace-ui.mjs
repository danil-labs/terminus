import assert from "node:assert/strict";
import { boot as arrancar, sleep as espera } from "./jsdom-app.mjs";

const base = {
  launcher_state: { phase: "ready", blank_0274: false },
  check_environment: () => ({ ready: true, blocked: false, reason: null, items: [], githubCli: { available: true, version: "gh version 2.102.0", managed_supported: true, installable: true } }),
  list_language_packs: [], list_bundled_language_packs: [], window_ready: null,
  window_vitals: null, setup_required: false, list_agents: [],
  list_workspaces: { workspaces: [{ id: "fixture-a", name: "A" }], active: "fixture-a" },
  workspaces_startup: { workspaces: [{ id: "fixture-a", name: "A" }], active: "fixture-a" },
  list_projects: [], list_sources: [], list_surfaces: [], list_live_sessions: [],
  list_live_turns: [], list_models: { models: [], fallback: false },
  service_poll: { cursor: 0, gap: false, replay: false, runtime: "fixture", reset: false },
};
const install = "https://github.com/apps/terminus-app/installations/new";
for (const scenario of ["connected-workspace", "existing-installation", "no-installation", "cancel-login"]) {
  let connected = scenario === "connected-workspace";
  let loginCount = 0;
  let selected = connected ? [{ key: "acme", installation_id: 42, repository_ids: [1] }] : [];
  let available = connected || scenario === "existing-installation" ? [{ key: "acme", name: "acme" }] : [];
  let finishLogin;
  const opens = [];
  const info = () => ({ id: "github", name: "GitHub", fields: [], browser_login: true,
    select_area: true, setup_url: install, token_label: "Token", token_help: "",
    token_url: "", login_help: "", area_label: "cuenta", areas_label: "cuentas", area_help: "",
    connected: connected ? { data: {}, workspace: "person", identity: { user: "person", name: "Person" },
      selected_area: null, selected_areas: selected, connected_at: 1 } : null, unverified: null });
  const app = await arrancar("listo", `github-${scenario}`, { ...base,
    list_providers: () => [info()], check_provider: () => info(),
    start_browser_login: () => { loginCount++; return { code: "ABCD", url: "https://github.com/login/device", expires_at: 9999999999999 }; },
    finish_browser_login: () => scenario === "cancel-login" ? new Promise((_resolve, reject) => { finishLogin = reject; }) : (connected = true, info()),
    cancel_browser_login: () => { if (finishLogin) finishLogin(new Error("cancelled")); },
    provider_pending_setup: null,
    provider_available_areas: () => available,
    provider_areas: () => selected.map(({ key }) => ({ key, name: key })),
    select_provider_area: ({ scope, area, enabled }) => {
      assert.equal(scope, "fixture-a");
      selected = selected.filter(({ key }) => key !== area);
      if (enabled) selected.push({ key: area, installation_id: 42, repository_ids: [1] });
      return info();
    },
    open_external: ({ target }) => { opens.push(target); },
  });
  const button = text => [...app.w.document.querySelectorAll("button")].find(b => b.textContent?.trim() === text || b.getAttribute("aria-label") === text);
  button("Configuración")?.click(); await espera(100);
  button("Control de Fuentes")?.click(); await espera(100);
  if (scenario === "connected-workspace") {
    const rows = () => app.w.document.querySelectorAll("section li");
    assert.ok(app.w.document.body.textContent.includes("Acceso de este workspace"));
    assert.ok(app.w.document.body.textContent.includes("acme"));
    assert.equal(rows().length, 0, "el acceso guardado se resume sin desplegar organizaciones");
    app.w.dispatchEvent(new app.w.Event("focus")); await espera(100);
    button("comprobar").click(); await espera(100);
    assert.equal(rows().length, 0, "comprobar o volver al foco conserva el resumen");
    available.push({ key: "other", name: "other" });
    button("Cambiar").click(); await espera(100);
    assert.equal(rows().length, 2);
    assert.equal(button("Cambiar").getAttribute("aria-expanded"), "true");
    button("Usar en este workspace").click(); await espera(100);
    assert.deepEqual(selected.map(({ key }) => key), ["acme", "other"]);
    button("Listo").click(); await espera(100);
    assert.equal(rows().length, 0, "Listo oculta el selector");
    assert.equal(button("Cambiar").getAttribute("aria-expanded"), "false");
    assert.ok(app.w.document.body.textContent.includes("acme y other"));
    button("ver qué alcanza").click(); await espera(100);
    assert.equal(rows().length, 2, "la consulta de repositorios sigue disponible");
    assert.equal(button("Quitar del workspace"), undefined, "editar acceso requiere Cambiar");
    button("Cambiar").click(); await espera(100);
    button("Quitar del workspace").click(); await espera(100);
    button("Listo").click(); await espera(100);
    assert.deepEqual(selected.map(({ key }) => key), ["other"]);
    assert.equal(rows().length, 0);
    assert.equal(loginCount, 0);
    assert.deepEqual(opens, []);
    assert.deepEqual(app.fallos, []);
    console.log("PASS connected-workspace: resumen, edición, cierre y consulta");
    continue;
  }
  assert.ok(button("Conectar con GitHub"));
  button("Conectar con GitHub").click(); await espera(150);
  if (scenario === "cancel-login") {
    button("cancelar").click(); await espera(100);
    assert.equal(connected, false);
    assert.deepEqual(opens, ["https://github.com/login/device"]);
  } else {
    assert.ok(opens.includes(install), "todo primer login abre el selector oficial");
    assert.ok(button("Actualizar acceso"));
    button("cancelar").click(); await espera(100);
    assert.equal(connected, true);
    assert.equal(selected.length, 0);
    assert.ok(app.w.document.body.textContent.includes("Sin acceso seleccionado"));
    assert.equal(button("Usar en este workspace"), undefined);
    assert.ok(button("Administrar permisos en GitHub"));
    button("Administrar permisos en GitHub").click(); await espera(100);
    assert.equal(loginCount, 1, "configurar no repite login");
    available = [{ key: "acme", name: "acme" }, { key: "other", name: "other" }];
    app.w.dispatchEvent(new app.w.Event("focus")); await espera(100);
    assert.equal(button("Actualizar acceso"), undefined);
    assert.equal(selected.length, 0, "volver no incorpora organizaciones");
    button("Usar en este workspace").click(); await espera(100);
    assert.equal(selected.length, 1);
    assert.ok(button("Confirmar repositorios disponibles"));
    button("Listo").click(); await espera(100);
    assert.deepEqual(selected.map(({ key }) => key), ["acme"]);
    assert.equal(button("Usar en este workspace"), undefined, "Listo oculta las opciones disponibles");
    assert.equal(button("Confirmar repositorios disponibles"), undefined);
  }
  assert.deepEqual(app.fallos, []);
  console.log(`PASS ${scenario}: selector, regreso, cancelación y confirmación local`);
}
process.exit(0);
