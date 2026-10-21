import { useEffect } from "react";
import { WEB_LOGIN } from "../lib/supabase.web";

/** En el navegador la sesión es la de la app de Danil: sin ella se va a su inicio, como la web de escritorio. */
export default function SignIn() {
  useEffect(() => window.location.assign(WEB_LOGIN), []);
  return null;
}
