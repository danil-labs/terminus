import { Redirect, useGlobalSearchParams } from "expo-router";
import * as Linking from "expo-linking";
import { useEffect, useState } from "react";
import { finishOAuth } from "../../lib/account";

/**
 * La vuelta del navegador del inicio con Google o Microsoft, si el sistema la
 * abre como enlace en vez de devolverla a `openAuthSessionAsync`.
 */
export default function AuthCallback() {
  const params = useGlobalSearchParams<{ code?: string }>();
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!params.code) return setDone(true);
    void finishOAuth(Linking.createURL("auth/callback", { queryParams: { code: params.code } })).finally(() => setDone(true));
  }, [params.code]);
  return done ? <Redirect href="/" /> : null;
}
