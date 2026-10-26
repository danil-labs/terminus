import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTask, answerQuestion } from '../src/lib/engine.ts';
import type { Host } from '../src/lib/hosts.ts';

function fixture(live = false, answered = false) {
  const calls: { command: string; args: any }[] = [];
  const question = { id: 'scope', question: '¿Cuál?', options: [], multiple: false, free_text: true };
  const host = { label: 'test', call: async (command: string, _workspace: string, args: any) => {
    calls.push({ command, args });
    const value = command === 'load_session' ? { id: 's', provider: 'codex', model: 'm', turns: [
      { id: 't', role: 'assistant', text: '', questions: [question] },
      ...(answered ? [{ id: 'a', role: 'user', text: 'uno', answers: [{ turn: 't', question: 'scope', chosen: [], free_text: 'uno' }] }] : []),
    ] } : command === 'pending_requests' ? { permissions: [], questions: live ? [{ request_id: 'r', turn: 't' }] : [] } : command === 'list_active_turns' ? [] : 's';
    return { value, cachedAt: null };
  } } as unknown as Host;
  return { host, calls };
}

test('recupera preguntas de archivo sin proceso y las responde como turno', async () => {
  const { host, calls } = fixture();
  const view = await loadTask(host, 'w', 'f', 's');
  assert.equal(view.questions.length, 1);
  assert.equal(view.questions[0].request_id, null);
  await answerQuestion(host, 'w', 'f', 's', view.questions[0], {}, { scope: 'uno' });
  const sent = calls.find((c) => c.command === 'send_message');
  assert.equal(sent?.args.project, 'f');
  assert.deepEqual(sent?.args.respuestas, [{ turn: 't', question: 'scope', chosen: [], free_text: 'uno' }]);
});

test('mantiene el canal de preguntas vivas', async () => {
  const { host, calls } = fixture(true);
  const view = await loadTask(host, 'w', 'f', 's');
  await answerQuestion(host, 'w', 'f', 's', view.questions[0], {}, { scope: 'uno' });
  assert.equal(calls.find((c) => c.command === 'answer_question')?.args.requestId, 'r');
  assert.equal(calls.some((c) => c.command === 'send_message'), false);
});

test('una pregunta contestada no vuelve a aparecer aunque quede la solicitud viva', async () => {
  const { host } = fixture(true, true);
  assert.deepEqual((await loadTask(host, 'w', 'f', 's')).questions, []);
});
