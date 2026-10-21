/**
 * The person's Supabase session, the one the Danil app already stored on this
 * same origin. Terminus never signs in: without a session it sends the person
 * to the app's login.
 */
import { createClient } from "@supabase/supabase-js";

export type Session = {
  /** A current access token; supabase-js refreshes it near expiry. */
  getToken(): Promise<string>;
  /** The API or the relay refused the token: refresh once, else leave for the login. */
  unauthorized(): Promise<boolean>;
};

export function supabaseSession(url: string, key: string, leave: () => void): Session {
  const client = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  // Signing out in another tab of the app ends this page too.
  client.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") leave();
  });
  return {
    async getToken() {
      const { data } = await client.auth.getSession();
      if (!data.session) {
        leave();
        throw new Error("no session");
      }
      return data.session.access_token;
    },
    async unauthorized() {
      const { data, error } = await client.auth.refreshSession();
      if (error || !data.session) {
        leave();
        return false;
      }
      return true;
    },
  };
}
