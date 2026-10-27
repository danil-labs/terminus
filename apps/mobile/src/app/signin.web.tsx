import { useEffect } from "react";
import { WEB_LOGIN } from "../lib/supabase.web";

/** La entrada común conserva el destino del teléfono durante el inicio de sesión. */
export default function SignIn() {
  useEffect(() => {
    const base = process.env.EXPO_PUBLIC_TERMINUS_WEB_BASE || "/terminus/";
    const url = new URL(WEB_LOGIN, window.location.origin);
    const target = window.sessionStorage.getItem("terminus.web.return") || `${base}m/${window.location.search}`;
    url.searchParams.set("next", target);
    window.location.assign(url.toString());
  }, []);
  return null;
}
