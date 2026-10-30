import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contactDisplayName, contactSubIdentifier, conversationLabels, createInbox, matchesFilter, needsHuman } from '../src/inbox.ts';
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
test('keeps the list fields Appv2 already sends and the account totals for the filters', async () => {
  const api = createInbox(session, async () => response({
    hasMore: true, total_assistance: 4, total_ai_disabled: 2,
    conversations: [{ id: 5, account_id: 2, ai_assistance: false, contact_name: '', active_provider: 'whatsapp_cloud', contact_phone: '5219991234567', last_message_at: '2026-10-29T15:42:00Z', assistance_requested_at: '2026-10-29T15:00:00Z', assistance_state: 'active', assist_status: { reason_code: 'loop' }, contact_ai_blocked: true, last_message_direction: 'inbound', last_message_sender_type: 'contact' }],
  }));
  const page = await api.conversations(2);
  assert.deepEqual(page.counts, { assistance: 4, aiDisabled: 2 });
  const row = page.rows[0];
  assert.equal(row.last_message_at, '2026-10-29T15:42:00Z');
  assert.equal(row.assist_reason, 'loop');
  assert.equal(row.contact_ai_blocked, true);
  assert.equal(contactDisplayName(row, 'Contacto'), '+521 999 123 4567');
  assert.deepEqual(conversationLabels(row), ['ai_paused_loop', 'human_required']);
});
test('labels and filters follow Appv2', () => {
  const base = { id: 1, account_id: 1, contact_name: 'Ana', channel_name: 'WhatsApp', last_message: '', ai_assistance: true, unread_count: 0 };
  assert.deepEqual(conversationLabels(base), []);
  assert.deepEqual(conversationLabels({ ...base, ai_assistance: false }), ['ai_off']);
  const answered = { ...base, assistance_state: 'abandoned', assistance_requested_at: 'x', last_message_direction: 'outbound', last_message_sender_type: 'human-agent' };
  assert.equal(needsHuman(answered), false);
  assert.equal(matchesFilter(answered, 'assistance'), true);
  assert.equal(matchesFilter({ ...base, ai_assistance: false, contact_ai_blocked: true }, 'ai_disabled'), false);
  assert.equal(matchesFilter({ ...base, ai_assistance: false, contact_ai_blocked: true }, 'ai_blocked'), true);
  assert.equal(contactSubIdentifier({ ...base, active_provider: 'web', contact_handle: '1329' }), null);
  assert.equal(contactSubIdentifier({ ...base, active_provider: 'messenger', contact_handle: '42' }), 'PSID 42');
  assert.equal(contactSubIdentifier({ ...base, active_provider: 'instagram', contact_handle: 'ana.mx' }), '@ana.mx');
});
