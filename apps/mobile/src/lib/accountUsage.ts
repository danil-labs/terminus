import { type AccountGroup, groupAccounts } from "@terminus/computers";
import type { AccountLimits, AiAccount } from "@terminus/protocol";
import { accountWorkspace, accountsOf, limitsSnapshotOf } from "./engine.ts";
import type { Host } from "./hosts.ts";

export type ProviderUsage = { groups: AccountGroup<AiAccount>[]; limits: Record<string, AccountLimits | null>; cachedAt: Record<string, number | null> };

/** La sesión y el consumo se leen de la misma máquina; las consultas se escalonan por proveedor. */
export async function providerUsage(hosts: Host[], provider: string, scopeOf: (host: Host) => string | null = (host) => accountWorkspace(host, null)): Promise<ProviderUsage> {
  const lists = await Promise.all(hosts.map(async (host) => ({
    machine: host.id,
    on: host.power() === "on",
    accounts: scopeOf(host) || host.linked == null ? (await accountsOf(host, scopeOf(host), provider).catch(() => null))?.accounts ?? [] : [],
  })));
  const readings = new Map<string, Awaited<ReturnType<typeof limitsSnapshotOf>>>();
  for (const list of lists) {
    const host = hosts.find((host) => host.id === list.machine)!;
    for (const row of list.accounts) {
      const snapshot = row.authenticated_at ? await limitsSnapshotOf(host, scopeOf(host), provider, row.id) : { value: null, cachedAt: null };
      const reading = snapshot.value;
      readings.set(JSON.stringify([list.machine, row.id]), snapshot);
      const plan = reading?.mode === "read" ? reading.plan : reading?.mode === "waiting" ? reading.last?.plan : null;
      if (plan) Object.assign(row, { plan });
    }
  }
  const groups = groupAccounts(provider, lists);
  const limits: Record<string, AccountLimits | null> = {};
  const cachedAt: Record<string, number | null> = {};
  for (const group of groups) {
    const authenticated = group.members.filter((member) => lists.find((list) => list.machine === member.machine)?.accounts.find((row) => row.id === member.id)?.authenticated_at);
    const source = authenticated.find((member) => member.on) ?? authenticated[0] ?? group.usageFrom;
    group.usageFrom = source;
    group.row = lists.find((list) => list.machine === source.machine)!.accounts.find((row) => row.id === source.id)!;
    const host = hosts.find((host) => host.id === source.machine);
    const snapshot = host && group.row.authenticated_at ? readings.get(JSON.stringify([source.machine, source.id])) : null;
    limits[group.key] = snapshot?.value ?? null;
    cachedAt[group.key] = snapshot?.cachedAt ?? null;
  }
  return { groups, limits, cachedAt };
}
