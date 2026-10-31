import type { InboxSession } from './inbox.ts';

export const BROADCAST_STATES = ['draft', 'scheduled', 'running', 'paused', 'cancelled', 'completed', 'failed'] as const;
export type BroadcastState = typeof BROADCAST_STATES[number];
export type Broadcast = { id: number; account_id: number; template_id: number | null; channel_id: number | null; name: string; status: BroadcastState };
export type BroadcastTemplate = { id: number; name: string; variables: string[]; supported: boolean };
export type BroadcastChannel = { id: number; name: string; provider: string; active: boolean };
export type BroadcastContact = { id: number; name: string; phone: string };
export type BroadcastPermissions = { permissions: string[]; scoped: { permission: string; scope_type: string; scope_id: number }[] };
export type BroadcastAction = 'start' | 'pause' | 'resume' | 'cancel' | 'schedule';

export class BroadcastError extends Error {
  readonly code: string;
  readonly uncertain: boolean;
  readonly status?: number;
  constructor(code: string, uncertain = false, status?: number) { super(code); this.code = code; this.uncertain = uncertain; this.status = status; }
}

type Operation = { state: 'pending' | 'uncertain' };
// Vive fuera del componente para conservar incertidumbre al cerrar o remontar la vista.
const operations = new WeakMap<InboxSession, Map<string, Operation>>();
const mappingKey = /^[a-zA-Z0-9_.]{1,64}$/;

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) { reject(signal.reason); return; }
    signal.addEventListener('abort', abort, { once: true });
  });
}

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
  return { id: id(row.id), name: text(row.name), variables: bodyVariables, supported: bodyVariables.length <= 50 && bodyVariables.every(key => mappingKey.test(key)) && understood && !outside && all.every(v => bodyVariables.includes(v)) };
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
  const locks = operations.get(session) ?? new Map<string, Operation>();
  operations.set(session, locks);
  const key = (account: number, resource: string) => `${prefix}:${id(account)}:${resource}`;
  // Una lectura iniciada antes del fallo no puede confirmar esa operación.
  const snapshot = (account: number) => [...locks.entries()].filter(([name, operation]) => name.startsWith(`${prefix}:${id(account)}:`) && operation.state === 'uncertain');
  const reconcile = (entries: [string, Operation][], resource?: string) => {
    for (const [name, operation] of entries) {
      if (locks.get(name) === operation && (resource ? name.endsWith(`:${resource}`) : !name.includes(':contacts:'))) locks.delete(name);
    }
  };
  async function call(account: number | null, path: string, method = 'GET', body?: unknown, signal?: AbortSignal, trace?: { sent: boolean }) {
    const query = account === null ? '' : `${path.includes('?') ? '&' : '?'}account_id=${id(account)}`;
    const controller = new AbortController();
    const cancel = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    const timer = setTimeout(() => controller.abort(new Error('timeout')), 30_000);
    const active = controller.signal;
    const send = async () => {
      active.throwIfAborted();
      const token = await abortable(session.getToken(), active);
      active.throwIfAborted();
      if (trace) trace.sent = true;
      return abortable(request(`${prefix}${path}${query}`, {
        method, signal: active, headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), cache: 'no-store',
      }), active);
    };
    try {
      let response = await send();
      if (method === 'GET' && response.status === 401 && await abortable(session.unauthorized(), active)) response = await send();
      if (!response.ok) {
        let code = `HTTP ${response.status}`;
        try {
          const data = object(await abortable(response.json(), active));
          const detail = data.detail && typeof data.detail === 'object' ? object(data.detail) : null;
          const candidate = data.error ?? data.code ?? detail?.error ?? detail?.code ?? data.detail;
          if (typeof candidate === 'string' && /^[a-zA-Z0-9_.-]{1,80}$/.test(candidate)) code = candidate;
        } catch { /* La clasificación HTTP no depende del formato del error. */ }
        throw new BroadcastError(code, response.status >= 500 || response.status === 408, response.status);
      }
      return object(await abortable(response.json(), active));
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    }
  }
  async function write<T>(account: number, resource: string, execute: (trace: { sent: boolean }) => Promise<T>): Promise<T> {
    const name = key(account, resource);
    if (locks.has(name)) throw new BroadcastError('reconcile_required', true);
    const operation: Operation = { state: 'pending' };
    locks.set(name, operation);
    const trace = { sent: false };
    try {
      const value = await execute(trace);
      locks.delete(name);
      return value;
    } catch (cause) {
      const error = cause instanceof BroadcastError ? cause : new BroadcastError(cause instanceof Error ? cause.message : 'request_failed', trace.sent);
      if (error.uncertain) operation.state = 'uncertain'; else locks.delete(name);
      throw error;
    }
  }
  const base = '/api/marketing';
  const result = (data: Record<string, unknown>, expected?: number) => {
    const value = { id: id(data.id), status: state(data.status) };
    if (expected !== undefined && value.id !== expected) throw new Error('invalid_scope');
    return value;
  };
  return {
    async accounts(signal?: AbortSignal): Promise<{ id: number; name: string }[]> {
      const user = object((await call(null, '/auth/profile', 'GET', undefined, signal)).user);
      return array(user.accounts ?? []).map(value => { const row = object(value); return { id: id(row.id), name: text(row.name) }; });
    },
    async activeAccount(signal?: AbortSignal): Promise<number> {
      const controller = new AbortController();
      const cancel = () => controller.abort(signal?.reason);
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) cancel();
      const timer = setTimeout(() => controller.abort(new Error('timeout')), 30_000);
      try {
        controller.signal.throwIfAborted();
        const token = await abortable(session.getToken(), controller.signal);
        controller.signal.throwIfAborted();
        try {
          const payload = object(JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))));
          const account = typeof payload.active_account_id === 'string' && /^[1-9][0-9]*$/.test(payload.active_account_id) ? Number(payload.active_account_id) : payload.active_account_id;
          return id(account);
        } catch { throw new BroadcastError('missing_active_account'); }
      } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
    },
    blocked(account: number, resource: string) { return locks.has(key(account, resource)); },
    async permissions(account: number, signal?: AbortSignal): Promise<BroadcastPermissions> {
      const data = await call(account, '/auth/account/my-permissions', 'GET', undefined, signal);
      text(data.role);
      return { permissions: array(data.permissions).map(text), scoped: array(data.scoped).map(value => {
        const row = object(value); return { permission: text(row.permission), scope_type: text(row.scope_type), scope_id: id(row.scope_id) };
      }) };
    },
    async list(account: number, signal?: AbortSignal, reconcileWrites = false): Promise<Broadcast[]> {
      const before = snapshot(account);
      const rows = array((await call(account, `${base}/campaigns`, 'GET', undefined, signal)).items).map(value => {
        const row = object(value);
        if (row.account_id !== account) throw new Error('invalid_scope');
        return { id: id(row.id), account_id: account, template_id: row.template_id === null ? null : id(row.template_id), channel_id: row.channel_id === null ? null : id(row.channel_id), name: text(row.name), status: state(row.status) };
      });
      signal?.throwIfAborted();
      if (reconcileWrites) reconcile(before);
      return rows;
    },
    async templates(account: number, signal?: AbortSignal): Promise<BroadcastTemplate[]> {
      return array((await call(account, `${base}/templates?status=APPROVED`, 'GET', undefined, signal)).items).filter(value => object(value).status === 'APPROVED').map(broadcastTemplate);
    },
    async channels(account: number, template: number, signal?: AbortSignal): Promise<BroadcastChannel[]> {
      return array((await call(account, `${base}/templates/${id(template)}/channels`, 'GET', undefined, signal)).channels).map(value => {
        const row = object(value);
        if (typeof row.active !== 'boolean') throw new Error('invalid_response');
        return { id: id(row.id), name: row.name == null ? '' : text(row.name), provider: text(row.provider), active: row.active };
      });
    },
    async stats(account: number, campaign: number, signal?: AbortSignal, reconcileWrites = false): Promise<number> {
      const before = snapshot(account);
      const data = await call(account, `${base}/campaigns/${id(campaign)}/stats`, 'GET', undefined, signal);
      if (data.campaign_id !== campaign) throw new Error('invalid_scope');
      if (typeof data.total !== 'number' || !Number.isSafeInteger(data.total) || data.total < 0) throw new Error('invalid_response');
      signal?.throwIfAborted();
      if (reconcileWrites) reconcile(before, `contacts:${campaign}`);
      return data.total;
    },
    async contacts(account: number, signal?: AbortSignal): Promise<BroadcastContact[]> {
      return array((await call(account, '/api/contacts', 'GET', undefined, signal)).items).map(value => {
        const row = object(value); return { id: id(row.id), name: row.name == null ? '' : text(row.name), phone: row.phone == null ? '' : text(row.phone) };
      });
    },
    async create(account: number, input: { name: string; template_id: number; channel_id: number; variable_mapping?: Record<string, string> }, signal?: AbortSignal) {
      const name = input.name.trim();
      if (!name || name.length > 200) throw new Error('invalid_input');
      const mapping = input.variable_mapping;
      if (mapping !== undefined && (!mapping || typeof mapping !== 'object' || Array.isArray(mapping))) throw new Error('invalid_input');
      if (mapping && (Object.keys(mapping).length > 50 || Object.entries(mapping).some(([key, value]) => !mappingKey.test(key) || typeof value !== 'string' || !value.trim() || value.length > 1024))) throw new Error('invalid_input');
      const body = { name, template_id: id(input.template_id), channel_id: id(input.channel_id), ...(mapping ? { variable_mapping: mapping } : {}) };
      return write(account, 'create', async trace => result(await call(account, `${base}/campaigns`, 'POST', body, signal, trace)));
    },
    async addContacts(account: number, campaign: number, contacts: number[], signal?: AbortSignal) {
      if (!contacts.length || contacts.length > 100) throw new Error('invalid_input');
      const body = { contact_account_ids: [...new Set(contacts.map(id))] };
      const campaignId = id(campaign);
      return write(account, `contacts:${campaignId}`, async trace => {
        const data = await call(account, `${base}/campaigns/${campaignId}/contacts`, 'POST', body, signal, trace);
        if (![data.added, data.requested].every(value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)) throw new Error('invalid_response');
        return { added: data.added as number, requested: data.requested as number, rejected: array(data.rejected ?? []).map(value => {
          const row = object(value); return { contact_account_id: row.contact_account_id == null ? null : id(row.contact_account_id), reason: text(row.reason) };
        }) };
      });
    },
    async transition(account: number, campaign: number, action: BroadcastAction, scheduledAt?: string, signal?: AbortSignal) {
      if (!['start', 'pause', 'resume', 'cancel', 'schedule'].includes(action)) throw new Error('invalid_input');
      if (action === 'schedule' && (!scheduledAt || !Number.isFinite(Date.parse(scheduledAt)) || Date.parse(scheduledAt) <= Date.now())) throw new Error('invalid_input');
      const campaignId = id(campaign);
      return write(account, `campaign:${campaignId}`, async trace => result(await call(account, `${base}/campaigns/${campaignId}/${action}`, 'POST', action === 'schedule' ? { scheduled_at: new Date(scheduledAt!).toISOString() } : undefined, signal, trace), campaignId));
    },
  };
}
