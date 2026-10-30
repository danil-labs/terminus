import type { InboxSession } from './inbox.ts';
import { sessionFetch } from './request.ts';

export type SupportLevel = 'read' | 'write';
export type SupportStatus = 'active' | 'expired' | 'revoked';
/** Una concesión de acceso de soporte de Danil a un workspace de Danil (Appv2 `support_access_grants`). */
export type SupportGrant = {
  id: number; account_id: number; operator_email: string; level: SupportLevel; reason: string; ticket: string | null;
  created_at: string; expires_at: string; revoked_at: string | null; revoked_by_kind: string | null; status: SupportStatus;
};
export type SupportWorkspace = { id: number; name: string };
/** Un workspace de Danil al que la persona entra como miembro, con su rol; organización y plan solo si el BFF los manda. */
export type Membership = SupportWorkspace & { role: string; organization: string | null; plan: string | null };

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_response');
  return value as Record<string, unknown>;
};
const id = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new Error('invalid_response');
  return value;
};
const text = (value: unknown): string => {
  if (typeof value !== 'string') throw new Error('invalid_response');
  return value;
};
const nullable = (value: unknown): string | null => value === null || value === undefined ? null : text(value);
const STATUSES: readonly string[] = ['active', 'expired', 'revoked'];
/** Quién puede ver y revocar lo decide el BFF (`members.manage`); aquí solo se listan los workspaces donde la persona es owner o admin. */
const MANAGERS: readonly string[] = ['owner', 'admin'];
export const isManager = (role: string) => MANAGERS.includes(role);

export function grantOf(value: unknown, account: number): SupportGrant {
  const row = object(value);
  if (row.account_id !== account) throw new Error('invalid_scope');
  const status = text(row.status);
  if (!STATUSES.includes(status)) throw new Error('invalid_response');
  // BFF antiguos no mandan `level`: lo da el rol de la concesión.
  const level = row.level === 'read' || row.level === 'write' ? row.level : row.role === 'support_read' ? 'read' : 'write';
  return {
    id: id(row.id), account_id: account, operator_email: text(row.operator_email), level, reason: text(row.reason),
    ticket: nullable(row.ticket), created_at: text(row.created_at), expires_at: text(row.expires_at),
    revoked_at: nullable(row.revoked_at), revoked_by_kind: nullable(row.revoked_by_kind), status: status as SupportStatus,
  };
}

/** Los workspaces de Danil que la persona administra, sus accesos de soporte y su revocación. */
export function createSupportAccess(session: InboxSession, request: typeof fetch = fetch, prefix = '/terminus/alpha-api') {
  const send = sessionFetch(session, request);
  async function get(path: string) {
    const response = await send(`${prefix}${path}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return object(await response.json());
  }
  async function memberships(): Promise<Membership[]> {
    const rows = object((await get('/auth/profile')).user).accounts ?? [];
    if (!Array.isArray(rows)) throw new Error('invalid_response');
    return rows.flatMap(value => {
      const row = object(value);
      // Una cuenta a la que se entra por soporte no se administra desde aquí.
      if (row.access === 'support') return [];
      const organization = row.organization && typeof row.organization === 'object' ? (row.organization as Record<string, unknown>).name : row.organization_name;
      return [{
        id: id(row.id), name: typeof row.name === 'string' ? row.name : '', role: String(row.role ?? ''),
        organization: typeof organization === 'string' && organization ? organization : null,
        plan: typeof row.plan === 'string' && row.plan ? row.plan : null,
      }];
    });
  }
  return {
    memberships,
    async workspaces(): Promise<SupportWorkspace[]> {
      return (await memberships()).filter(m => isManager(m.role)).map(m => ({ id: m.id, name: m.name }));
    },
    async list(account: number): Promise<{ grants: SupportGrant[]; canRevokeAll: boolean }> {
      const workspace = id(account);
      const data = await get(`/auth/account/support-access?account_id=${workspace}`);
      if (!Array.isArray(data.grants) || typeof data.can_revoke_all !== 'boolean') throw new Error('invalid_response');
      return { grants: data.grants.map(row => grantOf(row, workspace)), canRevokeAll: data.can_revoke_all };
    },
    /** La única escritura: revocar una concesión. La entrada alfa todavía no la deja pasar. */
    async revoke(account: number, grant: number): Promise<string> {
      const path = `${prefix}/auth/account/support-access/${id(grant)}/revoke?account_id=${id(account)}`;
      const response = await send(path, { method: 'POST' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const status = object(await response.json()).status;
      if (!['revoked', 'already_revoked', 'expired', 'not_found'].includes(String(status))) throw new Error('invalid_response');
      return String(status);
    },
  };
}
