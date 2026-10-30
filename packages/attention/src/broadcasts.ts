import type { InboxSession } from './inbox.ts';

export const BROADCAST_STATES = ['draft', 'scheduled', 'running', 'paused', 'cancelled', 'completed', 'failed'] as const;
export type BroadcastState = typeof BROADCAST_STATES[number];
export type Broadcast = { id: number; account_id: number; template_id: number | null; channel_id: number | null; name: string; status: BroadcastState };
export type BroadcastTemplate = { id: number; name: string; variables: string[]; supported: boolean };
export type BroadcastChannel = { id: number; name: string; provider: string; active: boolean };
export type BroadcastContact = { id: number; name: string; phone: string };
export type BroadcastPermissions = { permissions: string[]; scoped: { permission: string; scope_type: string; scope_id: number }[] };
export type BroadcastAction = 'start' | 'pause' | 'resume' | 'cancel' | 'schedule';

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
const array = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) throw new Error('invalid_response');
  return value;
};
const state = (value: unknown): BroadcastState => {
  if (!BROADCAST_STATES.includes(value as BroadcastState)) throw new Error('invalid_response');
  return value as BroadcastState;
};
const variables = (value: string) => [...new Set([...value.matchAll(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g)].map(match => match[1]))];

export function broadcastTemplate(value: unknown): BroadcastTemplate {
  const row = object(value);
  const components = row.components;
  let body = '';
  let understood = false;
  let outside = false;
  if (Array.isArray(components)) {
    understood = components.some(c => text(object(c).type).toUpperCase() === 'BODY' && typeof object(c).text === 'string');
    body = components.filter(c => text(object(c).type).toUpperCase() === 'BODY').map(c => text(object(c).text ?? '')).join(' ');
    outside = components.some(c => text(object(c).type).toUpperCase() !== 'BODY' && variables(JSON.stringify(c)).length > 0);
  } else if (components && typeof components === 'object') {
    const source = object(components);
    if (source.body && typeof source.body === 'object') { body = text(object(source.body).text); understood = true; }
    outside = Object.entries(source).some(([key, value]) => key !== 'body' && variables(JSON.stringify(value) ?? '').length > 0);
  }
  const bodyVariables = variables(body);
  const all = variables(JSON.stringify(components ?? ''));
  return { id: id(row.id), name: text(row.name), variables: bodyVariables, supported: understood && !outside && all.every(v => bodyVariables.includes(v)) };
}

export function canManageBroadcast(perms: BroadcastPermissions | null, channel: number | null): boolean {
  return !!perms && perms.permissions.includes('campaigns.manage') && (perms.permissions.includes('channels.manage') || (channel !== null && perms.scoped.some(grant => grant.permission === 'channels.manage' && grant.scope_type === 'channel' && grant.scope_id === channel)));
}

export function broadcastActions(status: BroadcastState): BroadcastAction[] {
  if (status === 'draft') return ['start', 'schedule', 'cancel'];
  if (status === 'scheduled') return ['start', 'cancel'];
  if (status === 'running') return ['pause', 'cancel'];
  if (status === 'paused') return ['resume', 'cancel'];
  return [];
}

/** Rutas cerradas del frontend Appv2; presupuesto y validación final pertenecen al servidor. */
export function createBroadcasts(session: InboxSession, request: typeof fetch = fetch, prefix = '/alpha-api') {
  async function call(account: number, path: string, method = 'GET', body?: unknown) {
    const query = `${path.includes('?') ? '&' : '?'}account_id=${id(account)}`;
    const send = async () => request(`${prefix}${path}${query}`, {
      method, headers: { Authorization: `Bearer ${await session.getToken()}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), cache: 'no-store',
    });
    let response = await send();
    // Una escritura no se reintenta automáticamente: el resultado puede ser incierto.
    if (method === 'GET' && response.status === 401 && await session.unauthorized()) response = await send();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return object(await response.json());
  }
  const base = '/api/marketing';
  const result = (data: Record<string, unknown>, expected?: number) => {
    const value = { id: id(data.id), status: state(data.status) };
    if (expected !== undefined && value.id !== expected) throw new Error('invalid_scope');
    return value;
  };
  return {
    async permissions(account: number): Promise<BroadcastPermissions> {
      const data = await call(account, '/auth/account/my-permissions');
      text(data.role);
      return { permissions: array(data.permissions).map(text), scoped: array(data.scoped).map(value => {
        const row = object(value); return { permission: text(row.permission), scope_type: text(row.scope_type), scope_id: id(row.scope_id) };
      }) };
    },
    async list(account: number): Promise<Broadcast[]> {
      return array((await call(account, `${base}/campaigns`)).items).map(value => {
        const row = object(value);
        if (row.account_id !== account) throw new Error('invalid_scope');
        return { id: id(row.id), account_id: account, template_id: row.template_id === null ? null : id(row.template_id), channel_id: row.channel_id === null ? null : id(row.channel_id), name: text(row.name), status: state(row.status) };
      });
    },
    async templates(account: number): Promise<BroadcastTemplate[]> {
      return array((await call(account, `${base}/templates?status=APPROVED`)).items).filter(value => object(value).status === 'APPROVED').map(broadcastTemplate);
    },
    async channels(account: number, template: number): Promise<BroadcastChannel[]> {
      return array((await call(account, `${base}/templates/${id(template)}/channels`)).channels).map(value => {
        const row = object(value);
        if (typeof row.active !== 'boolean') throw new Error('invalid_response');
        return { id: id(row.id), name: row.name == null ? '' : text(row.name), provider: text(row.provider), active: row.active };
      });
    },
    async stats(account: number, campaign: number): Promise<number> {
      const data = await call(account, `${base}/campaigns/${id(campaign)}/stats`);
      if (data.campaign_id !== campaign) throw new Error('invalid_scope');
      if (typeof data.total !== 'number' || !Number.isSafeInteger(data.total) || data.total < 0) throw new Error('invalid_response');
      return data.total;
    },
    async contacts(account: number): Promise<BroadcastContact[]> {
      return array((await call(account, '/api/contacts')).items).map(value => {
        const row = object(value); return { id: id(row.id), name: row.name == null ? '' : text(row.name), phone: row.phone == null ? '' : text(row.phone) };
      });
    },
    async create(account: number, input: { name: string; template_id: number; channel_id: number; variable_mapping?: Record<string, string> }) {
      const name = input.name.trim();
      if (!name || name.length > 200) throw new Error('invalid_input');
      const mapping = input.variable_mapping;
      if (mapping && Object.values(mapping).some(value => typeof value !== 'string' || !value.trim())) throw new Error('invalid_input');
      return result(await call(account, `${base}/campaigns`, 'POST', { name, template_id: id(input.template_id), channel_id: id(input.channel_id), ...(mapping ? { variable_mapping: mapping } : {}) }));
    },
    async addContacts(account: number, campaign: number, contacts: number[]) {
      if (!contacts.length) throw new Error('invalid_input');
      const data = await call(account, `${base}/campaigns/${id(campaign)}/contacts`, 'POST', { contact_account_ids: [...new Set(contacts.map(id))] });
      if (![data.added, data.requested].every(value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)) throw new Error('invalid_response');
      return { added: data.added as number, requested: data.requested as number, rejected: array(data.rejected ?? []).map(value => {
        const row = object(value); return { contact_account_id: row.contact_account_id == null ? null : id(row.contact_account_id), reason: text(row.reason) };
      }) };
    },
    async transition(account: number, campaign: number, action: BroadcastAction, scheduledAt?: string) {
      if (!['start', 'pause', 'resume', 'cancel', 'schedule'].includes(action)) throw new Error('invalid_input');
      if (action === 'schedule' && (!scheduledAt || !Number.isFinite(Date.parse(scheduledAt)) || Date.parse(scheduledAt) <= Date.now())) throw new Error('invalid_input');
      return result(await call(account, `${base}/campaigns/${id(campaign)}/${action}`, 'POST', action === 'schedule' ? { scheduled_at: new Date(scheduledAt!).toISOString() } : undefined), campaign);
    },
  };
}
