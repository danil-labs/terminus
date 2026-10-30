/**
 * Los correos de la cuenta en el navegador: las rutas `/auth/emails` del BFF de
 * Danil por el proxy de alfa (`/terminus/alpha-api`), con la sesión de la persona.
 */
import { AccountEmailsError, type AccountEmails, type AccountEmailsSource } from "../features/settings/account-emails.ts";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
type Session = { getToken: () => Promise<string>; unauthorized: () => Promise<boolean> };

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const str = (v: unknown) => (typeof v === "string" ? v : "");

export function webAccountEmails(session: Session, f: Fetch = (input, init) => fetch(input, init), prefix = "/terminus/alpha-api"): AccountEmailsSource {
  async function send(path: string, body?: Record<string, string>): Promise<Record<string, unknown>> {
    const once = async () =>
      f(`${prefix}${path}`, {
        method: body ? "POST" : "GET",
        cache: "no-store",
        headers: { Authorization: `Bearer ${await session.getToken()}`, ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    let response = await once();
    if (response.status === 401 && (await session.unauthorized())) response = await once();
    const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok) {
      throw new AccountEmailsError(
        str(data?.error) || `http_${response.status}`,
        typeof data?.attempts_left === "number" ? data.attempts_left : null,
        typeof data?.resend_after === "number" ? data.resend_after : null,
      );
    }
    return data ?? {};
  }

  return {
    async list(): Promise<AccountEmails> {
      const data = await send("/auth/emails");
      const emails = Array.isArray(data.emails) ? data.emails : [];
      const pending = Array.isArray(data.pending) ? data.pending : [];
      return {
        emails: emails.flatMap((e: Record<string, unknown>) => (str(e?.email) ? [{ email: str(e.email), primary: e.primary === true, verified: e.verified === true }] : [])),
        pending: pending.flatMap((p: Record<string, unknown>) => (str(p?.email) ? [{ email: str(p.email), resendAfter: num(p.resend_after, 0) }] : [])),
      };
    },
    async requestCode(email) {
      const data = await send("/auth/emails", { email });
      return { email: str(data.email) || email, expiresIn: num(data.expires_in, 900), resendAfter: num(data.resend_after, 60) };
    },
    async confirmCode(email, code) {
      await send("/auth/emails/verify", { email, code });
    },
    async makePrimary(email) {
      await send("/auth/emails/primary", { email });
      // El JWT trae el correo anterior hasta que se refresca.
      await session.unauthorized().catch(() => false);
    },
    async remove(email) {
      await send("/auth/emails/remove", { email });
    },
  };
}
