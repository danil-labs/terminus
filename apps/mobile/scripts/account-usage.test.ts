import assert from "node:assert/strict";
import { test } from "node:test";
import { providerUsage } from "../src/lib/accountUsage.ts";
import type { Host } from "../src/lib/hosts.ts";

function host(id: string, on: boolean, authenticated: boolean, queries: string[]): Host {
  return {
    id,
    power: () => on ? "on" : "off",
    async call(command: string, _workspace: unknown, args: { id?: string }) {
      if (command === "list_accounts") return { value: { accounts: [{ id: `${id}-account`, label: id, plan: "Max", identity: "person@example.com", authenticated_at: authenticated ? 10 : null }] }, cachedAt: null };
      assert.equal(command, "account_limits");
      queries.push(`${id}/${args.id}`);
      return { value: { mode: "read", windows: [{ label: "5h", used_pct: 38, resets_at: null }], plan: "Max", fetched_at: 10 }, cachedAt: on ? null : 10 };
    },
  } as unknown as Host;
}

test("consulta la cuenta autenticada de la máquina encendida aunque la primera fila no tenga sesión", async () => {
  const queries: string[] = [];
  const result = await providerUsage([host("first", false, false, queries), host("second", true, true, queries)], "claude");
  assert.deepEqual(queries, ["second/second-account"]);
  assert.equal(result.groups[0].row.id, "second-account");
  assert.equal(result.groups[0].row.authenticated_at, 10);
  assert.equal(result.limits[result.groups[0].key]?.mode, "read");
});

test("una máquina encendida sin sesión no desplaza a la que sí puede consultar el consumo", async () => {
  const queries: string[] = [];
  const result = await providerUsage([host("first", true, false, queries), host("second", true, true, queries)], "claude");
  assert.deepEqual(queries, ["second/second-account"]);
  assert.equal(result.groups[0].usageFrom.machine, "second");
});

test("leer cuentas apagadas usa su última lectura de consumo", async () => {
  const queries: string[] = [];
  const result = await providerUsage([host("first", false, true, queries), host("second", true, false, queries)], "claude");
  assert.deepEqual(queries, ["first/first-account"]);
  assert.equal(result.limits[result.groups[0].key]?.mode, "read");
  assert.equal(result.cachedAt[result.groups[0].key], 10);
  assert.equal(result.groups[0].row.authenticated_at, 10);
});
