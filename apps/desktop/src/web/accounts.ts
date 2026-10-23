/**
 * The Danil accounts of this browser (`docs/web-multi-account.md`). The primary
 * one is the session the Danil app stored on this origin; Terminus only reads
 * it. Each extra account has its own Supabase client under its own storage key
 * (`terminus-auth:<slot>`), added from «Agregar cuenta». The page mounts ONE
 * account (its fleet, its token); the others only lend the workspaces of their
 * registry so the column shows them all. No Solid and no supabase-js here:
 * Node tests import it.
 */
import type { AccountWorkspace } from "@terminus/computers";

/** What this module needs of a browser session (`session.ts` adapts supabase-js). */
export type AuthClient = {
  /** The signed-in person, or `null` without a session. */
  user(): Promise<AccountUser | null>;
  getToken(): Promise<string>;
  /** The API refused the token: refresh once; `false` if the session is gone. */
  unauthorized(): Promise<boolean>;
  /** Ends this session only on this browser (`signOut({ scope: "local" })`). */
  signOutLocal(): Promise<void>;
};

export type AccountUser = { user_id: string; email: string | null; name: string | null };

/** `slot`: `null` is the primary (the Danil app's session). `signedIn: false`: an extra whose session expired. */
export type Account = AccountUser & { slot: string | null; signedIn: boolean; client: AuthClient };

export type StorageLike = { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void };

/** One account's workspaces as its registry said them; `stale`: from the last saved copy. */
export type Listing = { workspaces: AccountWorkspace[]; stale: boolean; refused: boolean };

export type ListAnswer = { kind: "ok"; value: AccountWorkspace[] } | { kind: "unauthorized" } | { kind: string };

export const EXTRAS_KEY = "terminus.web.accounts";
export const LAST_KEY = "terminus.web.account";
const LISTING_KEY = "terminus.web.listing:";
export const SLOT_PREFIX = "terminus-auth:";

type Extra = AccountUser & { slot: string };

function read<T>(storage: StorageLike | null, key: string, fallback: T): T {
  try {
    const raw = storage?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(storage: StorageLike | null, key: string, value: unknown) {
  try {
    storage?.setItem(key, JSON.stringify(value));
  } catch {
    // Full or blocked storage: the account still works for this page.
  }
}

const isExtra = (e: unknown): e is Extra =>
  !!e && typeof e === "object" && typeof (e as Extra).slot === "string" && typeof (e as Extra).user_id === "string" && (e as Extra).user_id !== "";

export function readExtras(storage: StorageLike | null): Extra[] {
  const raw = read<unknown>(storage, EXTRAS_KEY, []);
  return Array.isArray(raw) ? raw.filter(isExtra) : [];
}

/**
 * Every account of this browser, the primary first. An extra with the same
 * person as the primary, or as an earlier extra, is dropped; an extra whose
 * session is gone stays, marked, so its workspaces can say «Vuelve a entrar».
 */
export async function loadAccounts(deps: { storage: StorageLike | null; primary: AuthClient | null; clientFor(slot: string): AuthClient }): Promise<Account[]> {
  const accounts: Account[] = [];
  const primaryUser = deps.primary ? await deps.primary.user().catch(() => null) : null;
  if (deps.primary && primaryUser) accounts.push({ ...primaryUser, slot: null, signedIn: true, client: deps.primary });
  const extras = readExtras(deps.storage);
  const kept: Extra[] = [];
  for (const extra of extras) {
    if (accounts.some((a) => a.user_id === extra.user_id)) continue;
    const client = deps.clientFor(extra.slot);
    const user = await client.user().catch(() => null);
    // A session that now belongs to someone else is not this extra any more.
    if (user && user.user_id !== extra.user_id) continue;
    const fresh = user ? { ...extra, email: user.email ?? extra.email, name: user.name ?? extra.name } : extra;
    kept.push(fresh);
    accounts.push({ ...fresh, slot: extra.slot, signedIn: !!user, client });
  }
  if (kept.length !== extras.length || kept.some((k, i) => k.email !== extras[i]?.email || k.name !== extras[i]?.name)) write(deps.storage, EXTRAS_KEY, kept);
  return accounts;
}

/**
 * Keeps a new extra after its sign-in finished in `slot`. The same person as
 * an account already here signs that new session out and keeps the old one.
 */
export async function addExtra(storage: StorageLike | null, accounts: readonly Account[], slot: string, client: AuthClient): Promise<{ kind: "added" | "duplicate"; user: AccountUser } | { kind: "no_session" }> {
  const user = await client.user().catch(() => null);
  if (!user) return { kind: "no_session" };
  if (accounts.some((a) => a.user_id === user.user_id && a.signedIn && a.slot !== slot)) {
    await client.signOutLocal().catch(() => undefined);
    return { kind: "duplicate", user };
  }
  const extras = readExtras(storage).filter((e) => e.user_id !== user.user_id && e.slot !== slot);
  write(storage, EXTRAS_KEY, [...extras, { ...user, slot }]);
  return { kind: "added", user };
}

/** Forgets an extra on this browser: its session and its saved listing. The primary is the Danil app's to sign out. */
export async function removeExtra(storage: StorageLike | null, account: Account): Promise<void> {
  if (account.slot === null) return;
  await account.client.signOutLocal().catch(() => undefined);
  write(storage, EXTRAS_KEY, readExtras(storage).filter((e) => e.slot !== account.slot));
  try {
    storage?.removeItem(LISTING_KEY + account.user_id);
  } catch {
    // Nothing else to forget.
  }
}

/** Each account's last saved registry, without the network: enough to pick the account and paint the column at once. */
export function savedListings(storage: StorageLike | null, accounts: readonly Account[]): Map<string, Listing> {
  return new Map(
    accounts.map((a) => {
      const saved = read<AccountWorkspace[]>(storage, LISTING_KEY + a.user_id, []);
      return [a.user_id, { workspaces: Array.isArray(saved) ? saved : [], stale: true, refused: !a.signedIn }];
    }),
  );
}

/** Each account's registry, read in parallel; a failed read uses its last saved copy. */
export async function readListings(storage: StorageLike | null, accounts: readonly Account[], list: (token: string) => Promise<ListAnswer>): Promise<Map<string, Listing>> {
  const out = new Map<string, Listing>();
  await Promise.all(
    accounts.map(async (account) => {
      const saved = read<AccountWorkspace[]>(storage, LISTING_KEY + account.user_id, []);
      const fallback = (refused: boolean): Listing => ({ workspaces: Array.isArray(saved) ? saved : [], stale: true, refused });
      if (!account.signedIn) return void out.set(account.user_id, fallback(true));
      try {
        let answer = await list(await account.client.getToken());
        if (answer.kind === "unauthorized" && (await account.client.unauthorized())) answer = await list(await account.client.getToken());
        if (answer.kind === "ok" && "value" in answer) {
          write(storage, LISTING_KEY + account.user_id, answer.value);
          return void out.set(account.user_id, { workspaces: answer.value, stale: false, refused: false });
        }
        out.set(account.user_id, fallback(answer.kind === "unauthorized"));
      } catch {
        out.set(account.user_id, fallback(false));
      }
    }),
  );
  return out;
}

/** The account that owns `workspace`, by the registries. */
export function ownerOf(workspace: string | null, listings: ReadonlyMap<string, Listing>): string | null {
  if (!workspace) return null;
  for (const [user, listing] of listings) if (listing.workspaces.some((w) => w.id === workspace)) return user;
  return null;
}

/**
 * The account the page opens: the owner of `?w=`, else the last one opened,
 * else the primary, else the first extra signed in. `gone`: `?w=` named a
 * workspace no account here has.
 */
export function pickAccount(accounts: readonly Account[], listings: ReadonlyMap<string, Listing>, wanted: string | null, storage: StorageLike | null): { account: Account | null; gone: boolean } {
  const usable = accounts.filter((a) => a.signedIn);
  const owner = ownerOf(wanted, listings);
  const byOwner = owner ? usable.find((a) => a.user_id === owner) : undefined;
  if (byOwner) return { account: byOwner, gone: false };
  const last = read<string | null>(storage, LAST_KEY, null);
  const account = usable.find((a) => a.user_id === last) ?? usable.find((a) => a.slot === null) ?? usable[0] ?? null;
  return { account, gone: !!wanted && !owner };
}

export function rememberLast(storage: StorageLike | null, userId: string) {
  write(storage, LAST_KEY, userId);
}

/** A row of «Elige una cuenta»: open an account signed in here, or sign in again with one that expired. */
export type ChooserRow = AccountUser & { action: "open" | "sign_in_again" };

/** The accounts of this browser as «Agregar cuenta» offers them before signing in with another, as Google does. */
export function chooserRows(accounts: readonly Account[]): ChooserRow[] {
  return accounts.map((a) => ({ user_id: a.user_id, email: a.email, name: a.name, action: a.signedIn ? "open" : "sign_in_again" }));
}

/** A new random slot for an extra's storage key. */
export function newSlot(): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 12);
}
