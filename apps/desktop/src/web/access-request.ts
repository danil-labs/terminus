/**
 * La solicitud de acceso de quien entra a alfa sin workspace: `/auth/access-request`
 * del BFF de Danil por el proxy de alfa (`<base>alpha-api`), con la sesión de la persona.
 * El correo no viaja: el BFF lo toma del token.
 */
type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
type Session = { getToken: () => Promise<string>; unauthorized: () => Promise<boolean> };

export type AccessRequestDraft = { phone: string; name: string; company: string; locale: "es" | "en" };

export type AccessRequestSource = {
  /** Si esta persona ya envió su solicitud. */
  requested: () => Promise<boolean>;
  send: (draft: AccessRequestDraft) => Promise<void>;
};

/** `isPhone` del BFF: se revisa antes de enviar para dar el error junto al campo. */
export function validPhone(value: string): boolean {
  const phone = value.trim();
  const digits = phone.replace(/\D/g, "").length;
  return /^\+?[\d\s().-]+$/.test(phone) && digits >= 8 && digits <= 15;
}

export function webAccessRequest(session: Session, prefix: string, f: Fetch = (input, init) => fetch(input, init)): AccessRequestSource {
  async function call(body?: Record<string, string>): Promise<Record<string, unknown>> {
    const once = async () =>
      f(`${prefix}/auth/access-request`, {
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
  return {
    requested: async () => (await call()).requested === true,
    async send(draft) {
      const name = draft.name.trim();
      const company = draft.company.trim();
      await call({ phone: draft.phone.trim(), locale: draft.locale, ...(name ? { name } : {}), ...(company ? { company } : {}) });
    },
  };
}
