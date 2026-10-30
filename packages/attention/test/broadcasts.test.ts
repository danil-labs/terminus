import assert from 'node:assert/strict';
import test from 'node:test';
import { BroadcastError, broadcastActions, broadcastTemplate, canManageBroadcast, createBroadcasts } from '../src/broadcasts.ts';

const freshSession = () => ({ getToken: async () => 'user-jwt', unauthorized: async () => true });
const campaign = { id: 5, account_id: 7, template_id: 11, channel_id: 3, name: 'Test', status: 'draft' };
const fake = (body: unknown) => (async () => Response.json(body)) as typeof fetch;

test('permissions fail closed and channel scope never grants another channel', () => {
  assert.equal(canManageBroadcast(null, 3), false);
  assert.equal(canManageBroadcast({ permissions: [], scoped: [] }, 3), false);
  const scoped = { permissions: ['campaigns.manage'], scoped: [{ permission: 'channels.manage', scope_type: 'channel', scope_id: 3 }] };
  assert.equal(canManageBroadcast(scoped, 3), true);
  assert.equal(canManageBroadcast(scoped, 4), false);
  assert.equal(canManageBroadcast(scoped, null), false);
  assert.equal(canManageBroadcast({ permissions: ['campaigns.manage', 'channels.manage'], scoped: [] }, null), true);
});

test('only approved, understood template bodies support variables', async () => {
  const template = broadcastTemplate({ id: 1, name: 'Hello', components: [{ type: 'BODY', text: 'Hi {{name}} {{name}}' }] });
  assert.deepEqual(template.variables, ['name']);
  assert.equal(template.supported, true);
  assert.equal(broadcastTemplate({ id: 1, name: 'Header', components: [{ type: 'BODY', text: 'Hi' }, { type: 'HEADER', text: '{{title}}' }] }).supported, false);
  assert.equal(broadcastTemplate({ id: 1, name: 'Unknown' }).supported, false);
  const templates = await createBroadcasts(freshSession(), fake({ items: [{ id: 1, name: 'Rejected', status: 'REJECTED' }] })).templates(7);
  assert.deepEqual(templates, []);
});

test('read validates account and lifecycle state, never silently accepts another scope', async () => {
  assert.deepEqual(await createBroadcasts(freshSession(), fake({ items: [campaign] })).list(7), [campaign]);
  await assert.rejects(createBroadcasts(freshSession(), fake({ items: [campaign] })).list(8), /invalid_scope/);
  await assert.rejects(createBroadcasts(freshSession(), fake({ items: [{ ...campaign, status: 'future' }] })).list(7), /invalid_response/);
  await assert.rejects(createBroadcasts(freshSession(), fake({ role: 'owner', permissions: null, scoped: [] })).permissions(7), /invalid_response/);
  await assert.rejects(createBroadcasts(freshSession(), fake({ campaign_id: 9, total: 4 })).stats(7, 5), /invalid_scope/);
});

test('closed route shapes carry user authorization and explicit target account', async () => {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const request = (async (url: string, init: RequestInit) => {
    assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer user-jwt');
    calls.push({ url, method: init.method!, body: init.body ? JSON.parse(init.body as string) : null });
    if (url.includes('/contacts?')) return Response.json({ added: 1, requested: 2, rejected: [{ contact_account_id: 2, reason: 'no_phone' }] });
    return Response.json({ id: 5, status: 'draft' });
  }) as typeof fetch;
  const api = createBroadcasts(freshSession(), request);
  await api.create(7, { name: ' Test ', template_id: 11, channel_id: 3, variable_mapping: { name: 'Hi' } });
  const added = await api.addContacts(7, 5, [1, 2, 1]);
  assert.equal(added.rejected[0].reason, 'no_phone');
  await api.transition(7, 5, 'start');
  const future = new Date(Date.now() + 86400000).toISOString();
  await api.transition(7, 5, 'schedule', future);
  assert.deepEqual(calls, [
    { url: '/alpha-api/api/marketing/campaigns?account_id=7', method: 'POST', body: { name: 'Test', template_id: 11, channel_id: 3, variable_mapping: { name: 'Hi' } } },
    { url: '/alpha-api/api/marketing/campaigns/5/contacts?account_id=7', method: 'POST', body: { contact_account_ids: [1, 2] } },
    { url: '/alpha-api/api/marketing/campaigns/5/start?account_id=7', method: 'POST', body: null },
    { url: '/alpha-api/api/marketing/campaigns/5/schedule?account_id=7', method: 'POST', body: { scheduled_at: future } },
  ]);
});

test('mutations never retry uncertain or unauthorized requests', async () => {
  let count = 0;
  const api = createBroadcasts(freshSession(), (async () => { count++; return new Response('', { status: 401 }); }) as typeof fetch);
  await assert.rejects(api.transition(7, 5, 'start'), /HTTP 401/);
  assert.equal(count, 1);
  await assert.rejects(api.transition(7, 5, 'schedule', '2020-01-01'), /invalid_input/);
  await assert.rejects(api.create(7, { name: '', channel_id: 3, template_id: 11 }), /invalid_input/);
  assert.equal(count, 1);
});

test('terminal campaigns have no controls and malformed write replies fail', async () => {
  assert.deepEqual(broadcastActions('completed'), []);
  assert.deepEqual(broadcastActions('running'), ['pause', 'cancel']);
  await assert.rejects(createBroadcasts(freshSession(), fake({ id: 9, status: 'running' })).transition(7, 5, 'start'), /invalid_scope/);
  await assert.rejects(createBroadcasts(freshSession(), fake({ added: -1, requested: 1 })).addContacts(7, 5, [1]), /invalid_response/);
});

test('read routes preserve filters and refresh authentication only for GET', async () => {
  const calls: string[] = [];
  let first = true;
  const request = (async (url: string) => {
    calls.push(url);
    if (first) { first = false; return new Response('', { status: 401 }); }
    if (url.includes('/my-permissions')) return Response.json({ role: 'viewer', permissions: [], scoped: [] });
    if (url.includes('/channels?')) return Response.json({ channels: [{ id: 3, name: null, provider: 'whatsapp_cloud', active: true }] });
    if (url.includes('/stats?')) return Response.json({ campaign_id: 5, total: 2 });
    return Response.json({ items: [] });
  }) as typeof fetch;
  const api = createBroadcasts(freshSession(), request, '/terminus/alpha-api');
  assert.deepEqual(await api.permissions(7), { permissions: [], scoped: [] });
  await api.templates(7);
  await api.channels(7, 11);
  await api.contacts(7);
  assert.equal(await api.stats(7, 5), 2);
  assert.deepEqual(calls, [
    '/terminus/alpha-api/auth/account/my-permissions?account_id=7',
    '/terminus/alpha-api/auth/account/my-permissions?account_id=7',
    '/terminus/alpha-api/api/marketing/templates?status=APPROVED&account_id=7',
    '/terminus/alpha-api/api/marketing/templates/11/channels?account_id=7',
    '/terminus/alpha-api/api/contacts?account_id=7',
    '/terminus/alpha-api/api/marketing/campaigns/5/stats?account_id=7',
  ]);
});

test('a header variable is unsupported even when its name is also used in the body', () => {
  assert.equal(broadcastTemplate({ id: 1, name: 'Test', components: [{ type: 'BODY', text: '{{name}}' }, { type: 'HEADER', text: '{{name}}' }] }).supported, false);
  assert.equal(broadcastTemplate({ id: 1, name: 'Empty', components: [] }).supported, false);
});

test('aborting while token is pending prevents POST and releases the unsent operation', async () => {
  let resolveToken!: (token: string) => void;
  let posts = 0;
  const session = { getToken: () => new Promise<string>(resolve => { resolveToken = resolve; }), unauthorized: async () => false };
  const api = createBroadcasts(session, (async () => { posts++; return Response.json({ id: 5, status: 'running' }); }) as typeof fetch);
  const controller = new AbortController();
  const pending = api.transition(7, 5, 'start', undefined, controller.signal);
  controller.abort();
  resolveToken('old-user-token');
  await assert.rejects(pending, (cause: unknown) => cause instanceof BroadcastError && !cause.uncertain);
  assert.equal(posts, 0);
  assert.equal(api.blocked(7, 'campaign:5'), false);
});

test('in-flight abort is uncertain across clients and normal navigation reads; only explicit fresh read releases it', async () => {
  const session = freshSession();
  let dispatched!: () => void;
  const started = new Promise<void>(resolve => { dispatched = resolve; });
  const controller = new AbortController();
  const api = createBroadcasts(session, (async (_url: string, init: RequestInit) => {
    assert.ok(init.signal);
    dispatched();
    return new Promise<Response>(() => {});
  }) as typeof fetch);
  const pending = api.transition(7, 5, 'start', undefined, controller.signal);
  await started;
  controller.abort();
  await assert.rejects(pending, (cause: unknown) => cause instanceof BroadcastError && cause.uncertain);
  const remounted = createBroadcasts(session, fake({ items: [campaign] }));
  assert.equal(remounted.blocked(7, 'campaign:5'), true);
  assert.equal(remounted.blocked(8, 'campaign:5'), false);
  assert.equal(createBroadcasts(freshSession()).blocked(7, 'campaign:5'), false);
  await remounted.list(7);
  assert.equal(remounted.blocked(7, 'campaign:5'), true);
  await assert.rejects(remounted.transition(7, 5, 'start'), /reconcile_required/);
  await assert.rejects(createBroadcasts(session, fake({ items: [{ ...campaign, account_id: 8 }] })).list(7, undefined, true), /invalid_scope/);
  assert.equal(remounted.blocked(7, 'campaign:5'), true);
  await remounted.list(7, undefined, true);
  assert.equal(remounted.blocked(7, 'campaign:5'), false);
});

test('ambiguous create and audience writes require their own successful server reread', async () => {
  const session = freshSession();
  const api = createBroadcasts(session, (async () => { throw new TypeError('network failure'); }) as typeof fetch);
  await assert.rejects(api.create(7, { name: 'Test', channel_id: 3, template_id: 11 }), (cause: unknown) => cause instanceof BroadcastError && cause.uncertain);
  await assert.rejects(api.addContacts(7, 5, [1]), (cause: unknown) => cause instanceof BroadcastError && cause.uncertain);
  const fresh = createBroadcasts(session, (async (url: string) => Response.json(url.includes('/stats?') ? { campaign_id: 5, total: 1 } : { items: [campaign] })) as typeof fetch);
  await fresh.list(7, undefined, true);
  assert.equal(fresh.blocked(7, 'create'), false);
  assert.equal(fresh.blocked(7, 'contacts:5'), true);
  await fresh.stats(7, 5);
  assert.equal(fresh.blocked(7, 'contacts:5'), true);
  await fresh.stats(7, 5, undefined, true);
  assert.equal(fresh.blocked(7, 'contacts:5'), false);
});

test('definitive 4xx preserves wallet/template codes and does not require uncertain reconciliation', async () => {
  for (const [status, code] of [[402, 'insufficient_balance'], [422, 'template_not_approved'], [403, 'account_mismatch']] as const) {
    const api = createBroadcasts(freshSession(), (async () => Response.json({ detail: { error: code } }, { status })) as typeof fetch);
    await assert.rejects(api.transition(7, 5, 'start'), (cause: unknown) => cause instanceof BroadcastError && cause.code === code && cause.status === status && !cause.uncertain);
    assert.equal(api.blocked(7, 'campaign:5'), false);
  }
});

test('contacts and mappings enforce proxy bounds before any network request', async () => {
  let calls = 0;
  const api = createBroadcasts(freshSession(), (async () => { calls++; return Response.json({ id: 5, status: 'draft' }); }) as typeof fetch);
  await assert.rejects(api.addContacts(7, 5, Array.from({ length: 101 }, (_, n) => n + 1)), /invalid_input/);
  const input = { name: 'Test', template_id: 11, channel_id: 3 };
  for (const variable_mapping of [Object.fromEntries(Array.from({ length: 51 }, (_, n) => [`key${n}`, 'x'])), { ['a'.repeat(65)]: 'x' }, { 'café': 'x' }, { name: 'x'.repeat(1025) }, { name: '' }]) {
    await assert.rejects(api.create(7, { ...input, variable_mapping }), /invalid_input/);
  }
  assert.equal(calls, 0);
  await api.create(7, { ...input, variable_mapping: { ['a'.repeat(64)]: 'x'.repeat(1024) } });
  assert.equal(calls, 1);
});

test('30-second deadline covers delayed authentication and in-flight transport', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const tokenSession = { getToken: () => new Promise<string>(() => {}), unauthorized: async () => false };
  const unsent = createBroadcasts(tokenSession);
  const first = unsent.transition(7, 5, 'start');
  context.mock.timers.tick(30_000);
  await assert.rejects(first, (cause: unknown) => cause instanceof BroadcastError && !cause.uncertain);
  let dispatched!: () => void;
  const started = new Promise<void>(resolve => { dispatched = resolve; });
  const sent = createBroadcasts(freshSession(), (async () => { dispatched(); return new Promise<Response>(() => {}); }) as typeof fetch);
  const second = sent.transition(7, 5, 'start');
  await started;
  context.mock.timers.tick(30_000);
  await assert.rejects(second, (cause: unknown) => cause instanceof BroadcastError && cause.uncertain);
});

test('active account selection reads only the JWT claim; missing/malformed claim fails closed', async () => {
  const jwt = (claim: unknown) => `x.${btoa(JSON.stringify({ active_account_id: claim }))}.x`;
  assert.equal(await createBroadcasts({ ...freshSession(), getToken: async () => jwt(7) }).activeAccount(), 7);
  assert.equal(await createBroadcasts({ ...freshSession(), getToken: async () => jwt('7') }).activeAccount(), 7);
  for (const claim of [null, 0, -1, '7oops']) await assert.rejects(createBroadcasts({ ...freshSession(), getToken: async () => jwt(claim) }).activeAccount(), /missing_active_account/);
});

test('delivery-unavailable 409 is a definitive rejection and never retried', async () => {
  for (const action of ['start', 'resume', 'schedule'] as const) {
    let calls = 0;
    const api = createBroadcasts(freshSession(), (async () => {
      calls++;
      return Response.json({ error: 'campaign_delivery_unavailable' }, { status: 409 });
    }) as typeof fetch);
    await assert.rejects(api.transition(7, 5, action, new Date(Date.now() + 86400000).toISOString()), (cause: unknown) => cause instanceof BroadcastError && cause.code === 'campaign_delivery_unavailable' && !cause.uncertain);
    assert.equal(calls, 1);
    assert.equal(api.blocked(7, 'campaign:5'), false);
  }
  const api = createBroadcasts(freshSession(), (async () => Response.json({ error: 'campaign_delivery_unavailable' }, { status: 409 })) as typeof fetch);
  await assert.rejects(api.addContacts(7, 5, [1]), (cause: unknown) => cause instanceof BroadcastError && cause.status === 409 && !cause.uncertain);
});

test('a reread started before a failed write cannot release the resulting uncertainty', async () => {
  const session = freshSession();
  let rejectWrite!: (cause: Error) => void;
  let resolveRead!: (response: Response) => void;
  let startedWrite!: () => void;
  let startedRead!: () => void;
  const writeStarted = new Promise<void>(resolve => { startedWrite = resolve; });
  const readStarted = new Promise<void>(resolve => { startedRead = resolve; });
  const api = createBroadcasts(session, (async (_url: string, init: RequestInit) => {
    if (init.method === 'POST') {
      startedWrite();
      return new Promise<Response>((_resolve, reject) => { rejectWrite = reject; });
    }
    startedRead();
    return new Promise<Response>(resolve => { resolveRead = resolve; });
  }) as typeof fetch);
  const pendingWrite = api.transition(7, 5, 'pause');
  await writeStarted;
  const pendingRead = api.list(7, undefined, true);
  await readStarted;
  rejectWrite(new Error('connection lost'));
  await assert.rejects(pendingWrite);
  resolveRead(Response.json({ items: [campaign] }));
  await pendingRead;
  assert.equal(api.blocked(7, 'campaign:5'), true);
});

test('account profile reads use the same cancellation/deadline transport without a target query', async () => {
  const api = createBroadcasts(freshSession(), (async (url: string, init: RequestInit) => {
    assert.equal(url, '/alpha-api/auth/profile');
    assert.ok(init.signal);
    return Response.json({ user: { accounts: [{ id: 7, name: 'Test' }] } });
  }) as typeof fetch);
  assert.deepEqual(await api.accounts(), [{ id: 7, name: 'Test' }]);
});
