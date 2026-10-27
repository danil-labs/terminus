/**
 * En el navegador, Terminus móvil vive en el mismo origen que la app de Danil
 * (`/terminus/m/`) y usa la sesión que esa app guardó, como la web de
 * escritorio (`apps/desktop/src/web/session.ts`): misma URL de Supabase, mismo
 * almacenamiento y misma clave. Sin sesión abre la entrada web común.
 */
import { createClient } from "@supabase/supabase-js";
import { COMPUTERS_ENDPOINT } from "@terminus/computers";

export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || "https://api.danil.ai";
export const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_KEY || "sb_publishable_IGLsyHHpmaXsHFAeSQg9kA_CoCLCyEd";
export const COMPUTERS = process.env.EXPO_PUBLIC_COMPUTERS_ENDPOINT || COMPUTERS_ENDPOINT;
export const WEB_LOGIN = process.env.EXPO_PUBLIC_TERMINUS_WEB_LOGIN || `${process.env.EXPO_PUBLIC_TERMINUS_WEB_BASE || "/terminus/"}auth`;

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});
