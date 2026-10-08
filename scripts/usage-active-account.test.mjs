/**
 * Que la franja de consumo siga a la cuenta activa cuando cambia sin pasar por
 * Configuración: el reloj de cupo (`runtime/quota.rs`) la cambia y emite
 * `account`. Monta `dist/`.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { arrancar, espera } from "./jsdom-app.mjs";

const AGOTADA = { id: "agotada", label: "Cuenta 2", created_at: 1, email: null };
const CON_CUPO = { id: "con-cupo", label: "Cuenta 1", created_at: 2, email: null };

test("tras el cambio de cuenta por cupo, la franja lee el consumo de la cuenta nueva", async () => {
  let activa = AGOTADA.id;
  const leidas = [];
  const app = await arrancar("listo", "cuenta-activa-por-cupo", {
    window_ready: null,
    window_vitals: null,
    setup_required: false,
    list_agents: [{ id: "claude", label: "Claude Code", available: true, driver: true, limits: true }],
    list_workspaces: { workspaces: [{ id: "w", name: "W", context_root: null }], active: "w" },
    workspaces_startup: { workspaces: [{ id: "w", name: "W", context_root: null }], active: "w" },
    list_projects: [],
    list_sources: [],
    list_live_sessions: [],
    list_live_turns: [],
    list_surfaces: [{ id: "claude", agent: "claude", label: "Claude Code", catalogo: "todo", usable: true, marca: null, porque: null }],
    list_accounts: ({ agent }) => ({ agent, env_var: "", accounts: [AGOTADA, CON_CUPO], active: activa }),
    account_limits: ({ id }) => {
      leidas.push(id);
      return { mode: "read", windows: [], at: Date.now() };
    },
    service_poll: { cursor: 0, gap: false, replay: false, runtime: "test-service", reset: false },
  });
  await espera(500);
  assert.ok(leidas.includes(AGOTADA.id), `la franja no leyó la cuenta activa al abrir; leyó ${JSON.stringify(leidas)}`);

  activa = CON_CUPO.id;
  app.emit("account", "claude");
  await espera(500);

  assert.ok(
    leidas.includes(CON_CUPO.id),
    `la cuenta activa pasó a «${CON_CUPO.label}» y la franja sigue con «${AGOTADA.label}»: leyó ${JSON.stringify(leidas)}`,
  );
});
