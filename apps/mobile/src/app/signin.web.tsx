import { useEffect } from "react";
import { WEB_LOGIN } from "../lib/supabase.web";

/**
 * Vuelve a la raíz del teléfono (`<base>m/`), no a esta ruta: aquí se manda
 * a iniciar sesión sin preguntar, y regresar a `signin` sería un ciclo. La app
 * de Danil solo acepta un `next` bajo `/terminus/` y del mismo origen. Instalada
 * (PWA), esa vuelta queda dentro de la app porque el `scope` del manifest es `/`.
 */
function loginReturningToPhone(): string {
  const base = process.env.EXPO_PUBLIC_TERMINUS_WEB_BASE?.trim() || "/terminus/";
  const url = new URL(WEB_LOGIN, window.location.origin);
  url.searchParams.set("next", `${base}m/`);
  return url.toString();
}

/** En el navegador la sesión es la de la app de Danil: sin ella se va a su inicio, como la web de escritorio. */
export default function SignIn() {
  useEffect(() => window.location.assign(loginReturningToPhone()), []);
  return null;
}
