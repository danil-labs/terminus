/**
 * La solicitud de acceso de quien entra a alfa sin workspace, por el proxy de alfa
 * (como `apps/desktop/src/web/access-request.ts`). El correo lo pone el BFF, del token.
 */
import { ALPHA_API } from "./alpha-mode";

type Session = { getToken: () => Promise<string>; unauthorized: () => Promise<boolean> };
export type AccessRequestDraft = { phone: string; name: string; company: string; locale: "es" | "en" };

export function validPhone(value: string): boolean {
  const phone = value.trim();
  const digits = phone.replace(/\D/g, "").length;
  return /^\+?[\d\s().-]+$/.test(phone) && digits >= 8 && digits <= 15;
}

async function call(session: Session, body?: Record<string, string>): Promise<Record<string, unknown>> {
  const once = async () =>
    fetch(`${ALPHA_API}/auth/access-request`, {
      method: body ? "POST" : "GET",
      cache: "no-store",
      headers: { Authorization: `Bearer ${await session.getToken()}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  let response = await once();
  if (response.status === 401 && (await session.unauthorized())) response = await once();
  if (!response.ok) throw new Error(`access_request_${response.status}`);
  return ((await response.json().catch(() => null)) as Record<string, unknown> | null) ?? {};
}

export const accessRequested = async (session: Session) => (await call(session)).requested === true;

export async function sendAccessRequest(session: Session, draft: AccessRequestDraft) {
  const name = draft.name.trim();
  const company = draft.company.trim();
  await call(session, { phone: draft.phone.trim(), locale: draft.locale, ...(name ? { name } : {}), ...(company ? { company } : {}) });
}
