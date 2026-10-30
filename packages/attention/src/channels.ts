import type { InboxSession } from './inbox.ts';
import { sessionFetch } from './request.ts';

export type ConnectionState = 'connected' | 'connecting' | 'expired' | 'disconnected' | 'replaced' | 'failed' | 'untracked';
export type Channel = { id: number; account_id: number | null; name: string; provider: string; identity: string; active: boolean; connection: ConnectionState };

// Mismo contrato que Appv2 (`features/channels/status.ts`): conectado = active, pending o webhook_pending.
const STATES: Record<string, ConnectionState> = {
  active: 'connected', pending: 'connecting', webhook_pending: 'connecting',
  expired: 'expired', revoked: 'disconnected', superseded: 'replaced', failed: 'failed',
};

export function connectionOf(row: { connection_status?: unknown; connected?: unknown }): ConnectionState {
  if (typeof row.connection_status === 'string' && row.connection_status) return STATES[row.connection_status] ?? 'connected';
  if (row.connected === true) return 'connected';
  if (row.connected === false) return 'disconnected';
  return 'untracked';
}

const text = (value: unknown) => typeof value === 'string' ? value : '';

/** Solo lectura: `GET /api/channels` del BFF, anclado por el servidor a la cuenta activa. Nunca credenciales. */
export function createChannels(session: InboxSession, request: typeof fetch = fetch, prefix = '/terminus/alpha-api') {
  const send = sessionFetch(session, request);
  return {
    async list(): Promise<Channel[]> {
      const response = await send(`${prefix}/api/channels`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data: unknown = await response.json();
      const rows = data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>).channels : null;
      if (!Array.isArray(rows)) throw new Error('invalid_response');
      return rows.flatMap(value => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_response');
        const row = value as Record<string, unknown>;
        if (typeof row.id !== 'number' || !Number.isSafeInteger(row.id) || row.id <= 0 || typeof row.active !== 'boolean') throw new Error('invalid_response');
        if (row.deleted === true || row.archived === true) return [];
        const account = typeof row.account_id === 'number' && Number.isSafeInteger(row.account_id) ? row.account_id : null;
        return [{ id: row.id, account_id: account, name: text(row.name), provider: text(row.provider), identity: text(row.identity), active: row.active, connection: connectionOf(row) }];
      });
    },
  };
}
