import assert from 'node:assert/strict';
import test from 'node:test';
import { connectionOf, createChannels } from '../src/channels.ts';

const session = (refresh = true) => ({ getToken: async () => 'jwt', unauthorized: async () => refresh });

test('connection follows the Appv2 credential contract, never the AI toggle', () => {
  assert.equal(connectionOf({ connection_status: 'active' }), 'connected');
  assert.equal(connectionOf({ connection_status: 'webhook_pending' }), 'connecting');
  assert.equal(connectionOf({ connection_status: 'revoked' }), 'disconnected');
  assert.equal(connectionOf({ connection_status: 'future_state' }), 'connected');
  assert.equal(connectionOf({ connected: false }), 'disconnected');
  assert.equal(connectionOf({}), 'untracked');
});

test('list keeps only public fields, hides archived/deleted and retries one 401', async () => {
  const calls: string[] = [];
  let first = true;
  const request = (async (url: string) => {
    calls.push(url);
    if (first) { first = false; return new Response('', { status: 401 }); }
    return Response.json({ channels: [
      { id: 1, account_id: 7, name: 'Ventas', provider: 'whatsapp', identity: '+52 55', active: true, connection_status: 'active', token: 'SECRET' },
      { id: 2, name: null, provider: 'web', active: false, archived: true },
      { id: 3, name: 'Old', provider: 'instagram', active: true, deleted: true },
    ] });
  }) as typeof fetch;
  const rows = await createChannels(session(), request).list();
  assert.deepEqual(calls, ['/terminus/alpha-api/api/channels', '/terminus/alpha-api/api/channels']);
  assert.deepEqual(rows, [{ id: 1, account_id: 7, name: 'Ventas', provider: 'whatsapp', identity: '+52 55', active: true, connection: 'connected' }]);
  assert.equal(JSON.stringify(rows).includes('SECRET'), false);
});

test('denied and malformed answers fail instead of looking empty', async () => {
  await assert.rejects(createChannels(session(false), (async () => new Response('', { status: 403 })) as typeof fetch).list(), /HTTP 403/);
  await assert.rejects(createChannels(session(), (async () => Response.json({ items: [] })) as typeof fetch).list(), /invalid_response/);
  await assert.rejects(createChannels(session(), (async () => Response.json({ channels: [{ id: 'x', active: true }] })) as typeof fetch).list(), /invalid_response/);
});
