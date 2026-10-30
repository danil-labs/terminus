import assert from 'node:assert/strict';
import test from 'node:test';
import { broadcastActions, broadcastTemplate, canManageBroadcast, createBroadcasts } from '../src/broadcasts.ts';

const session = { getToken: async () => 'user-jwt', unauthorized: async () => true };
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
  const templates = await createBroadcasts(session, fake({ items: [{ id: 1, name: 'Rejected', status: 'REJECTED' }] })).templates(7);
  assert.deepEqual(templates, []);
});

test('read validates account and lifecycle state, never silently accepts another scope', async () => {
  assert.deepEqual(await createBroadcasts(session, fake({ items: [campaign] })).list(7), [campaign]);
  await assert.rejects(createBroadcasts(session, fake({ items: [campaign] })).list(8), /invalid_scope/);
  await assert.rejects(createBroadcasts(session, fake({ items: [{ ...campaign, status: 'future' }] })).list(7), /invalid_response/);
  await assert.rejects(createBroadcasts(session, fake({ role: 'owner', permissions: null, scoped: [] })).permissions(7), /invalid_response/);
  await assert.rejects(createBroadcasts(session, fake({ campaign_id: 9, total: 4 })).stats(7, 5), /invalid_scope/);
});

test('closed route shapes carry user authorization and explicit target account', async () => {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const request = (async (url: string, init: RequestInit) => {
    assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer user-jwt');
    calls.push({ url, method: init.method!, body: init.body ? JSON.parse(init.body as string) : null });
    if (url.includes('/contacts?')) return Response.json({ added: 1, requested: 2, rejected: [{ contact_account_id: 2, reason: 'no_phone' }] });
    return Response.json({ id: 5, status: 'draft' });
  }) as typeof fetch;
  const api = createBroadcasts(session, request);
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
  const api = createBroadcasts(session, (async () => { count++; return new Response('', { status: 401 }); }) as typeof fetch);
  await assert.rejects(api.transition(7, 5, 'start'), /HTTP 401/);
  assert.equal(count, 1);
  await assert.rejects(api.transition(7, 5, 'schedule', '2020-01-01'), /invalid_input/);
  await assert.rejects(api.create(7, { name: '', channel_id: 3, template_id: 11 }), /invalid_input/);
  assert.equal(count, 1);
});

test('terminal campaigns have no controls and malformed write replies fail', async () => {
  assert.deepEqual(broadcastActions('completed'), []);
  assert.deepEqual(broadcastActions('running'), ['pause', 'cancel']);
  await assert.rejects(createBroadcasts(session, fake({ id: 9, status: 'running' })).transition(7, 5, 'start'), /invalid_scope/);
  await assert.rejects(createBroadcasts(session, fake({ added: -1, requested: 1 })).addContacts(7, 5, [1]), /invalid_response/);
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
  const api = createBroadcasts(session, request, '/terminus/alpha-api');
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
