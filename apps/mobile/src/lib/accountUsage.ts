import { type AccountGroup, groupAccounts } from "@terminus/computers";
import type { AccountLimits, AiAccount } from "@terminus/protocol";
import { accountsOf, limitsOf } from "./engine.ts";
import type { Host } from "./hosts.ts";

export type ProviderUsage = { groups: AccountGroup<AiAccount>[]; limits: Record<string, AccountLimits | null> };

/** La sesión y el consumo se leen de la misma máquina; las consultas se escalonan por proveedor. */
export async function providerUsage(hosts: Host[], provider: string): Promise<ProviderUsage> {
  const lists = await Promise.all(hosts.map(async (host) => ({
    machine: host.id,
    on: host.power() === "on",
    accounts: (await accountsOf(host, provider).catch(() => null))?.accounts ?? [],
  })));
  const groups = groupAccounts(provider, lists);
  const limits: Record<string, AccountLimits | null> = {};
  for (const group of groups) {
    const authenticated = group.members.filter((member) => lists.find((list) => list.machine === member.machine)?.accounts.find((row) => row.id === member.id)?.authenticated_at);
    const source = authenticated.find((member) => member.on) ?? authenticated[0] ?? group.usageFrom;
    group.usageFrom = source;
    group.row = lists.find((list) => list.machine === source.machine)!.accounts.find((row) => row.id === source.id)!;
    const host = hosts.find((host) => host.id === source.machine);
    limits[group.key] = host && source.on && group.row.authenticated_at ? await limitsOf(host, provider, source.id) : null;
  }
  return { groups, limits };
}
