import { createClient } from "@supabase/supabase-js";

/** Same storage key and implicit email flow as the Danil browser session. */
export function authClient(url: string, key: string) {
  return createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
}

export function authFailure(error: { code?: string; status?: number } | null): string {
  if (error?.status === 429 || error?.code === "over_email_send_rate_limit" || error?.code === "over_request_rate_limit") return "rate_limit";
  if (error?.code === "invalid_credentials") return "invalid_credentials";
  if (error?.code === "email_not_confirmed") return "email_not_confirmed";
  if (error?.code === "weak_password") return "weak_password";
  if (error?.code === "user_already_exists" || error?.code === "email_exists") return "account_exists";
  return "failed";
}
