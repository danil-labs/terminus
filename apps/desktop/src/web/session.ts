/**
 * A Supabase session in the browser. The primary one is what the Danil app
 * already stored on this same origin (the default storage key): Terminus reads
 * it and never signs it in or out. An extra account (`accounts.ts`) has its own
 * key, `terminus-auth:<slot>`, and signs in from «Agregar cuenta».
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AccountUser, AuthClient } from "./accounts";

export type Session = {
  /** A current access token; supabase-js refreshes it near expiry. */
  getToken(): Promise<string>;
  /** The API or the relay refused the token: refresh once, else `onGone`. */
  unauthorized(): Promise<boolean>;
};

export type BrowserSession = Session & AuthClient & { client: SupabaseClient };

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
  // Signing out in another tab of the app ends this session here too; so does
  // signing in there as someone else, which writes the same key.
  client.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") options.onGone?.();
    else if (known && session?.user?.id && session.user.id !== known) {
      known = session.user.id;
      options.onGone?.();
    }
  });
  const gone = () => options.onGone?.();
  return {
    client,
    async getToken() {
      const { data } = await client.auth.getSession();
      if (!data.session) {
        gone();
        throw new Error("no session");
      }
      return data.session.access_token;
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
      const { data } = await client.auth.getSession();
      const user = userOf(data.session?.user);
      known ??= user?.user_id ?? null;
      return user;
    },
    async signOutLocal() {
      await client.auth.signOut({ scope: "local" });
    },
  };
}
