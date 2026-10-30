import assert from 'node:assert/strict';
import test from 'node:test';
import { createInbox } from '../src/inbox.ts';
import { createMessaging, ReplyError } from '../src/messaging.ts';

const session = { getToken: async () => 'person', unauthorized: async () => true };
const clientId = 'ea6db9df-1c8c-4b53-9b36-0d60575ef400';

test('permissions come from the selected account and fail closed on malformed grants', async () => {
  const api = createInbox(session, async url => {
    assert.match(String(url), /my-permissions\?account_id=7$/);
    return Response.json({ role: 'custom', permissions: ['inbox.respond'], scoped: [] });
  });
  assert.deepEqual((await api.permissions(7)).permissions, ['inbox.respond']);
  for (const value of [{ role: 'owner' }, { role: 'owner', permissions: [true], scoped: [] }, { role: 'owner', permissions: [], scoped: [{}] }]) {
    await assert.rejects(createInbox(session, async () => Response.json(value)).permissions(7));
  }
});

test('reply sends only the real text contract and reports queue acceptance separately from delivery', async () => {
  const api = createMessaging(session, async (url, init) => {
    assert.equal(url, '/alpha-api/api/messaging/reply');
    assert.equal(init?.method, 'POST');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer person');
    assert.deepEqual(JSON.parse(String(init?.body)), { conversation_id: 12, text: 'hola', client_message_id: clientId });
    return Response.json({ outgoing_id: 123, status: 'pending', requires_template: true }, { status: 201 });
  }, '/alpha-api');
  assert.deepEqual(await api.reply(12, ' hola ', clientId), { requiresTemplate: true, duplicate: false });
});

test('ambiguous writes and rejected tokens are never automatically retried', async () => {
  for (const status of [401, 403, 402, 502]) {
    let calls = 0;
    const api = createMessaging(session, async () => { calls++; return Response.json({ error: 'denied' }, { status }); });
    await assert.rejects(api.reply(12, 'hola', clientId), (error: unknown) => error instanceof ReplyError && error.status === status && (status !== 502 || error.code === 'uncertain'));
    assert.equal(calls, 1);
  }
  await assert.rejects(createMessaging(session, async () => { throw new Error('timeout'); }).reply(12, 'hola', clientId), /uncertain/);
  await assert.rejects(createMessaging(session, async () => Response.json({ ok: true })).reply(12, 'hola', clientId), /uncertain/);
});
