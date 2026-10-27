import { type AccountGroup, groupAccounts } from "@terminus/computers";
import type { AccountLimits, AiAccount } from "@terminus/protocol";
import { accountWorkspace, accountsOf, limitsOf } from "./engine.ts";
import type { Host } from "./hosts.ts";

export type ProviderUsage = { groups: AccountGroup<AiAccount>[]; limits: Record<string, AccountLimits | null> };

/** La sesión y el consumo se leen de la misma máquina; las consultas se escalonan por proveedor. */
export async function providerUsage(hosts: Host[], provider: string, scopeOf: (host: Host) => string | null = (host) => accountWorkspace(host, null)): Promise<ProviderUsage> {
  const lists = await Promise.all(hosts.map(async (host) => ({
    machine: host.id,
    on: host.power() === "on",
    accounts: (await accountsOf(host, scopeOf(host), provider).catch(() => null))?.accounts ?? [],
  })));
  const readings = new Map<string, AccountLimits | null>();
  for (const list of lists) {
    const host = hosts.find((host) => host.id === list.machine)!;
    for (const row of list.accounts) {
      const reading = list.on && row.authenticated_at ? await limitsOf(host, scopeOf(host), provider, row.id) : null;
      readings.set(JSON.stringify([list.machine, row.id]), reading);
      const plan = reading?.mode === "read" ? reading.plan : reading?.mode === "waiting" ? reading.last?.plan : null;
      if (plan) Object.assign(row, { plan });
    }
  }
  const groups = groupAccounts(provider, lists);
  const limits: Record<string, AccountLimits | null> = {};
  for (const group of groups) {
    const authenticated = group.members.filter((member) => lists.find((list) => list.machine === member.machine)?.accounts.find((row) => row.id === member.id)?.authenticated_at);
    const source = authenticated.find((member) => member.on) ?? authenticated[0] ?? group.usageFrom;
    group.usageFrom = source;
    group.row = lists.find((list) => list.machine === source.machine)!.accounts.find((row) => row.id === source.id)!;
    const host = hosts.find((host) => host.id === source.machine);
    limits[group.key] = host && source.on && group.row.authenticated_at ? readings.get(JSON.stringify([source.machine, source.id])) ?? null : null;
  }
  return { groups, limits };
}
