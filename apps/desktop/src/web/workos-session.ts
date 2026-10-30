/**
 * The alfa session with WorkOS. The browser holds no WorkOS token: the entry
 * Worker keeps the session in an HttpOnly cookie and `POST <base>auth/session`
 * returns a short access token that the API, the relay and the database accept
 * like a Supabase one. Same interface as `supabaseSession`.
 */
import type { AccountUser } from "./accounts";
import type { WatchedSession } from "./session";

type Answer = { access_token: string; expires_at: number; user: AccountUser };

const CHANNEL = "terminus-workos-session";
/** Asks for a new token this long before the current one expires. */
const EARLY_SECONDS = 60;

export class SignInUnavailable extends Error {}

export function workosSession(options: { base?: string; onGone?: () => void; fetch?: typeof fetch } = {}): WatchedSession {
  const base = options.base ?? import.meta.env.BASE_URL;
  const request = options.fetch ?? ((input, init) => fetch(input, init));
  let current: Answer | null = null;
  /** The person this page signed in as; another one behind the cookie ends the session. */
  let known: string | null = null;
  let pending: Promise<Answer | null> | null = null;
  let invalidated = false;
  const watchers = new Set<(ended: boolean, userId?: string) => void>();
  const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel(CHANNEL) : null;
  const gone = () => {
    if (invalidated) return;
    invalidated = true;
    current = null;
    channel?.postMessage({ ended: true });
    for (const watch of watchers) watch(true);
    options.onGone?.();
  };
  channel?.addEventListener("message", (event: MessageEvent<{ ended?: boolean; userId?: string }>) => {
    if (event.data?.ended) gone();
    else if (event.data?.userId && known && event.data.userId !== known) gone();
  });

  /** `null`: there is no session (signed out, ended or refused). Throws when sign-in is unavailable. */
  const ask = () => pending ??= (async () => {
    try {
      const response = await request(`${base}auth/session`, { method: "POST", credentials: "same-origin", headers: { Accept: "application/json" } });
      if (response.status === 401 || response.status === 403) return null;
      if (!response.ok) throw new SignInUnavailable(String(response.status));
      const answer = (await response.json()) as Answer;
      if (typeof answer?.access_token !== "string" || !Number.isFinite(answer.expires_at) || typeof answer.user?.user_id !== "string") throw new SignInUnavailable("shape");
      if (known && known !== answer.user.user_id) {
        gone();
        return null;
      }
      known = answer.user.user_id;
      current = answer;
      channel?.postMessage({ userId: answer.user.user_id });
      return answer;
    } finally {
      pending = null;
    }
  })();

  const fresh = async () => {
    if (invalidated) throw new Error("session ended");
    if (current && current.expires_at - EARLY_SECONDS > Date.now() / 1000) return current;
    const answer = await ask();
    if (!answer) gone();
    return answer;
  };

  const signOutLocal = async () => {
    const response = await request(`${base}auth/logout`, { method: "POST", credentials: "same-origin", headers: { Accept: "application/json" } });
    const body = response.ok ? ((await response.json().catch(() => null)) as { location?: string } | null) : null;
    gone();
    return body?.location ?? null;
  };

  return {
    async getToken() {
      const answer = await fresh();
      if (!answer) throw new Error("no session");
      return answer.access_token;
    },
    async unauthorized() {
      if (invalidated) return false;
      current = null;
      const answer = await ask().catch(() => undefined);
      if (answer === null) gone();
      return !!answer;
    },
    async user() {
      const answer = await fresh().catch((error) => {
        if (error instanceof SignInUnavailable) throw error;
        return null;
      });
      return answer?.user ?? null;
    },
    async email() {
      return (await fresh())?.user.email ?? null;
    },
    async signOut() {
      const location = await signOutLocal();
      if (location) window.location.assign(location);
    },
    async signOutLocal() {
      await signOutLocal();
    },
    watch(userId, clear) {
      const watch = (ended: boolean, other?: string) => {
        if (ended || (other && other !== userId)) clear();
      };
      watchers.add(watch);
      return () => watchers.delete(watch);
    },
  };
}
