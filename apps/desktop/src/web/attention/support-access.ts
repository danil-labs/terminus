import { createSupportAccess, type SupportGrant } from '../../../../../packages/attention/src/support-access.ts';
import type { InboxSession } from '../../../../../packages/attention/src/inbox.ts';
import type { SupportAccessSource } from '../../features/settings/SupportAccess';

/** Con la sesión de la página, por la entrada alfa (solo lectura). */
export function supportAccessCapability(session: InboxSession): SupportAccessSource {
  const api = createSupportAccess(session, fetch, `${import.meta.env.BASE_URL}alpha-api`);
  return { demo: false, workspaces: api.workspaces, list: api.list };
}

const hours = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();
const DEMO: SupportGrant[] = [
  { id: 3, account_id: 1, operator_email: 'soporte@danil.ai', level: 'write', reason: 'Revisar por qué el canal de WhatsApp no recibe mensajes', ticket: 'SUP-120', created_at: hours(-2), expires_at: hours(22), revoked_at: null, revoked_by_kind: null, status: 'active' },
  { id: 2, account_id: 1, operator_email: 'soporte@danil.ai', level: 'read', reason: 'Diagnóstico de la configuración del agente', ticket: null, created_at: hours(-72), expires_at: hours(-48), revoked_at: null, revoked_by_kind: null, status: 'expired' },
  { id: 1, account_id: 1, operator_email: 'cit@danil.ai', level: 'write', reason: 'Alta de la campaña de bienvenida', ticket: null, created_at: hours(-200), expires_at: hours(-176), revoked_at: hours(-190), revoked_by_kind: 'client', status: 'revoked' },
];

/** Datos de ejemplo para `?demo=1`; revocar solo cambia el ejemplo en esta página. */
export function supportAccessDemo(workspace: string): SupportAccessSource {
  let grants = DEMO;
  return {
    demo: true,
    workspaces: async () => [{ id: 1, name: workspace }],
    list: async () => ({ grants, canRevokeAll: true }),
    revoke: async (_account, id) => {
      grants = grants.map((g) => (g.id === id && g.status === 'active' ? { ...g, status: 'revoked', revoked_at: new Date().toISOString(), revoked_by_kind: 'client' } : g));
      return 'revoked';
    },
  };
}
