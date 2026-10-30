import assert from 'node:assert/strict';
import test from 'node:test';
import { inboxDraft } from '../../src/web/attention/inbox-drafts.ts';

test('draft and uncertain result survive navigation but are isolated by session and target', () => {
  let clear!: () => void;
  const session = { getToken: async () => '', unauthorized: async () => false, subscribe: (callback: () => void) => { clear = callback; return () => {}; } };
  const first = inboxDraft(session, 7, 12);
  first.set({ text: 'preserved', pending: false, notice: 'uncertain', uncertain: true, error: true });
  assert.equal(inboxDraft(session, 7, 13).value().text, '');
  assert.equal(inboxDraft(session, 8, 12).value().text, '');
  assert.equal(inboxDraft({ ...session }, 7, 12).value().text, '');
  assert.equal(inboxDraft(session, 7, 12), first);
  assert.equal(first.value().uncertain, true);
  // El registro de la otra sesión no sustituye la invalidación de la primera.
  let end!: () => void;
  const scopedSession = { ...session, subscribe: (callback: () => void) => { end = callback; return () => {}; } };
  const scoped = inboxDraft(scopedSession, 7, 12);
  scoped.set(value => ({ ...value, text: 'secret', pending: true }));
  end();
  assert.equal(scoped.signal.aborted, true);
  assert.equal(scoped.value().text, '');
  assert.equal(inboxDraft(scopedSession, 7, 12).signal.aborted, false);
  assert.equal(typeof clear, 'function');
});
