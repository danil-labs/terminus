/**
 * La sesión de alfa con WorkOS en el navegador. Como la web de escritorio
 * (`apps/desktop/src/web/workos-session.ts`): el navegador no guarda ningún
 * token de WorkOS ni de refresco; la entrada de alfa los tiene en una cookie
 * HttpOnly y `POST <base>auth/session` devuelve el token corto de Supabase de
 * esa persona. Sin sesión, `session` queda en `null` y la app abre la entrada.
 */
import type { Session } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useRef, useState, type Context, type ReactNode } from "react";
import type { Account } from "./account";

type Answer = { access_token: string; expires_at: number; user: { user_id: string; email: string | null } };
const BASE = process.env.EXPO_PUBLIC_TERMINUS_WEB_BASE || "/terminus/";
/** Pide otro token este tiempo antes de que venza el actual. */
const EARLY_SECONDS = 60;

/** Lo que la app lee de la sesión: la persona y su correo. */
const sessionOf = (answer: Answer) => ({ access_token: answer.access_token, user: { id: answer.user.user_id, email: answer.user.email ?? undefined } }) as unknown as Session;

export function WorkosAccountProvider({ children, context: Provided }: { children: ReactNode; context: Context<Account | null> }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const current = useRef<Answer | null>(null);
  const pending = useRef<Promise<Answer | null> | null>(null);

  /** `null`: no hay sesión (cerrada, vencida o rechazada). Una caída lanza y no cierra la sesión. */
  const ask = useCallback(() => pending.current ??= (async () => {
    try {
      const response = await fetch(`${BASE}auth/session`, { method: "POST", credentials: "same-origin", headers: { Accept: "application/json" } });
      if (response.status === 401 || response.status === 403) return null;
      if (!response.ok) throw new Error(`sign_in_unavailable_${response.status}`);
      const answer = (await response.json()) as Answer;
      if (typeof answer?.access_token !== "string" || !Number.isFinite(answer.expires_at) || typeof answer.user?.user_id !== "string") throw new Error("sign_in_unavailable");
      return answer;
    } finally {
      pending.current = null;
    }
  })(), []);

  const settle = useCallback((answer: Answer | null) => {
    const before = current.current;
    current.current = answer;
    if (!answer) setSession(null);
    else if (before?.user.user_id !== answer.user.user_id) setSession(sessionOf(answer));
    return answer;
  }, []);

  useEffect(() => {
    void ask().then(settle, () => null).finally(() => setReady(true));
  }, [ask, settle]);

  const getToken = useCallback(async () => {
    const now = current.current;
    if (now && now.expires_at - EARLY_SECONDS > Date.now() / 1000) return now.access_token;
    const answer = settle(await ask());
    if (!answer) throw new Error("no session");
    return answer.access_token;
  }, [ask, settle]);

  const unauthorized = useCallback(async () => {
    try {
      return !!settle(await ask());
    } catch {
      // Sin red no se cierra la sesión: el próximo intento lo vuelve a probar.
      return true;
    }
  }, [ask, settle]);

  const signOut = useCallback(async () => {
    const response = await fetch(`${BASE}auth/logout`, { method: "POST", credentials: "same-origin", headers: { Accept: "application/json" } }).catch(() => null);
    const body = response?.ok ? ((await response.json().catch(() => null)) as { location?: string } | null) : null;
    settle(null);
    // Cierra también la sesión de WorkOS; si no se pudo, la entrada de alfa la vuelve a ofrecer.
    if (body?.location) window.location.assign(body.location);
  }, [settle]);

  // La entrada es la de la web (AuthKit): aquí no se inicia sesión con contraseña ni proveedor.
  const elsewhere = useCallback(async () => "sign_in_on_web", []);

  const value = useMemo<Account>(
    () => ({ ready, session, email: session?.user.email ?? null, signInWithPassword: elsewhere, signInWithProvider: elsewhere, signOut, getToken, unauthorized }),
    [ready, session, elsewhere, signOut, getToken, unauthorized],
  );
  return <Provided.Provider value={value}>{children}</Provided.Provider>;
}
