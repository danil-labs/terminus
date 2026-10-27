import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createInbox } from '../src/inbox.ts';
const session = { getToken: async () => 'user-token', unauthorized: async () => true };
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
test('reads explicit account pages and rejects a response from another account', async () => {
  const requests: string[] = [];
  const api = createInbox(session, async (url, init) => {
    requests.push(String(url));
    assert.equal(init?.method, undefined);
    assert.equal((init?.headers as Record<string,string>).Authorization, 'Bearer user-token');
    return response({ conversations: [{ id: 11, account_id: 2, ai_assistance: true }], hasMore: false });
  });
  assert.equal((await api.conversations(2, 30)).rows[0].account_id, 2);
  assert.match(requests[0], /account_id=2&limit=30&offset=30/);
  await assert.rejects(api.conversations(1), /invalid_scope/);
});
test('a forbidden account stays forbidden and never returns demo data', async () => {
  const api = createInbox(session, async () => response({}, 403));
  await assert.rejects(api.conversations(9), /HTTP 403/);
});
test('refreshes a rejected token once and preserves account scope and message cursor', async () => {
  let calls = 0;
  const api = createInbox(session, async url => {
    assert.match(String(url), /conversations\/7\/messages\?account_id=2&limit=50&before_id=12/);
    return ++calls === 1 ? response({}, 401) : response({ messages: [{ id: 8, conversation_id: 7, content: 'test', direction: 'inbound', sender_type: 'contact' }], hasMore: true });
  });
  assert.equal((await api.messages(2,7,12)).hasMore, true);
  assert.equal(calls, 2);
});
test('validates canonical account IDs and rejects conversation substitution', async () => {
  const api = createInbox(session, async url => String(url) === '/terminus/alpha-api/auth/profile' ? response({ user: { accounts: [{ id: 3, name: 'Account' }] } }) : response({ messages: [{ id: 8, conversation_id: 99, direction: 'outbound' }], hasMore: false }));
  assert.deepEqual(await api.accounts(), [{ id: 3, name: 'Account' }]);
  await assert.rejects(api.messages(3,7), /invalid_scope/);
  await assert.rejects(api.conversations(Number.NaN), /invalid_response/);
});
