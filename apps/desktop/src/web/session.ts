/**
 * A Supabase session in the browser. The primary one is what the Danil app
 * already stored on this same origin (the default storage key): Terminus reads
 * it; the common auth entry signs it in. An extra account (`accounts.ts`) has its own
 * key, `terminus-auth:<slot>`, and signs in from «Agregar cuenta».
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AccountUser, AuthClient } from "./accounts";

export type Session = {
  /** A current access token; supabase-js refreshes it near expiry. */
  getToken(): Promise<string>;
  /** The API or the relay refused the token: refresh once, else `onGone`. */
  unauthorized(): Promise<boolean>;
  email?(): Promise<string | null>;
  signOut?(): Promise<void>;
};

/** `watch`: calls `clear` once the session ends or passes to someone other than `userId`. */
export type WatchedSession = Session & AuthClient & { watch(userId: string, clear: () => void): () => void };

export type BrowserSession = WatchedSession & { client: SupabaseClient };

type Options = {
  /** `undefined`: the Danil app's own key. */
  storageKey?: string;
  /** The session ended (signed out here or in another tab, or the refresh failed). */
  onGone?: () => void;
};

const userOf = (user: { id: string; email?: string | null; user_metadata?: Record<string, unknown> } | null | undefined): AccountUser | null => {
  if (!user?.id) return null;
  const meta = user.user_metadata ?? {};
  const name = [meta.full_name, meta.name].find((v): v is string => typeof v === "string" && v.trim() !== "") ?? null;
  return { user_id: user.id, email: user.email ?? null, name };
};

export function supabaseSession(url: string, key: string, options: Options = {}): BrowserSession {
  const client = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // The OAuth return of an extra account is exchanged by hand in its own slot (`AddAccount.tsx`).
      detectSessionInUrl: false,
      flowType: "pkce",
      ...(options.storageKey ? { storageKey: options.storageKey } : {}),
    },
  });
  /** The person this session belonged to when the page read it. */
  let known: string | null = null;
  let invalidated = false;
  const gone = () => {
    invalidated = true;
    options.onGone?.();
  };
  // Signing out in another tab of the app ends this session here too; so does
  // signing in there as someone else, which writes the same key.
  client.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") gone();
    else if (known && session?.user?.id && session.user.id !== known) gone();
    else known ??= session?.user?.id ?? null;
  });
  const checkedSession = async () => {
    const { data } = await client.auth.getSession();
    if (invalidated || (known && data.session?.user.id !== known)) {
      if (!invalidated) gone();
      throw new Error("session changed");
    }
    known ??= data.session?.user.id ?? null;
    return data.session;
  };
  const signOutLocal = async () => {
    await checkedSession();
    const { error } = await client.auth.signOut({ scope: "local" });
    if (error) throw error;
  };
  return {
    client,
    async email() {
      return (await checkedSession())?.user.email ?? null;
    },
    signOut: signOutLocal,
    async getToken() {
      const session = await checkedSession();
      if (!session) {
        gone();
        throw new Error("no session");
      }
      return session.access_token;
    },
    async unauthorized() {
      const { data, error } = await client.auth.refreshSession();
      if (error || !data.session) {
        gone();
        return false;
      }
      return true;
    },
    async user() {
      const user = userOf((await checkedSession())?.user);
      known ??= user?.user_id ?? null;
      return user;
    },
    signOutLocal,
    watch(userId, clear) {
      const { data } = client.auth.onAuthStateChange((event, value) => {
        if (event === "SIGNED_OUT" || (value && value.user.id !== userId)) clear();
      });
      return () => data.subscription.unsubscribe();
    },
  };
}
