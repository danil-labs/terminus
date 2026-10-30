import type { Account } from './inbox.ts';

export type AccountSources = { accounts: () => Promise<Account[]>; active: () => Promise<number | null> };

const fold = (value: string) => value.normalize('NFC').trim().toLowerCase();

/**
 * La cuenta de Danil Agents del workspace activo, o `null`: la pantalla entonces no pide
 * ni muestra datos. Único punto que une los dos: se sustituye cuando exista el enlace
 * entre `public.workspaces` y `public.accounts`. Hasta entonces solo cuenta un nombre
 * idéntico, sin ambigüedad, que además sea la cuenta activa de la sesión, porque el BFF
 * ancla sus listas a ella.
 */
export async function resolveWorkspaceAccount(workspace: string | null, sources: AccountSources): Promise<Account | null> {
  if (!workspace?.trim()) return null;
  const [accounts, active] = await Promise.all([sources.accounts(), sources.active()]);
  const same = accounts.filter(row => fold(row.name) === fold(workspace));
  return same.length === 1 && same[0].id === active ? same[0] : null;
}
