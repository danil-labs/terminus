import assert from 'node:assert/strict';
import { engine, relay } from './fake-relay.mjs';
import { boot, sleep } from './jsdom-app.mjs';

// La web de alfa real (`TERMINUS_WEB_ALPHA=1 vite build --mode web`): Configuración → Bitácora de cambios con un PostgREST de prueba.
// Correr con `--unhandled-rejections=warn`: Configuración ya deja un rechazo sin atender con este relay de prueba.
// Correr con `--unhandled-rejections=warn`: Configuración ya deja un rechazo sin atender con este relay de prueba.
const fake = relay({ table: { ...engine, list_spaces: [{ id: 'space', name: 'Space', folders: ['p1'], created_at: 0, updated_at: 0 }] } });
const b64url = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
const token = `${b64url({ alg: 'ES256' })}.${b64url({ sub: 'u', role: 'authenticated', active_account_id: 7 })}.firma`;
const row = (id, actor, extra = {}) => ({ id, created_at: '2026-10-30T12:00:00Z', event_type: 'agents.update', entity_type: 'agents', entity_id: '1', action: 'update', changed_fields: ['assistant_name'], details: {}, actor_type: actor, actor_name: null, actor_email: null, on_behalf_of_name: null, on_behalf_of_email: null, support_grant_id: null, ...extra });
const calls = [];
const page = Array.from({ length: 50 }, (_, i) => row(200 - i, 'member', { actor_name: 'Ana', actor_email: 'ana@ejemplo.com' }));
page[0] = row(200, 'ai', { on_behalf_of_name: 'Ana', on_behalf_of_email: 'ana@ejemplo.com', entity_type: 'account_variables', event_type: 'account_variables.update', changed_fields: ['value'] });
page[1] = row(199, 'danil_support', { actor_email: 'soporte@danil.ai', event_type: 'support_access.entered', entity_type: null, action: null, changed_fields: null, support_grant_id: 3 });
page[2] = row(198, 'user', { actor_name: 'Yo' });
const fixtureFetch = async (input, init) => {
  const url = String(input?.url ?? input);
  if (url === 'https://api.danil.test/rest/v1/rpc/audit_log_list') {
    const body = JSON.parse(init.body);
    calls.push({ body, auth: init.headers.authorization, apikey: init.headers.apikey });
    return Response.json(body.p_before_id ? [row(10, 'system', { action: 'delete', changed_fields: null })] : page);
  }
  return new Response('{}', { status: 404 });
};
fixtureFetch.__jsdomApp = true;
const app = await boot('listo', 'alpha-audit-log', {}, undefined, {}, { web: true, antes(w) {
  w.history.replaceState({}, '', '/terminus/');
  globalThis.WebSocket = fake.Socket;
  globalThis.fetch = fixtureFetch;
  w.terminusWeb = { userId: 'fixture-user', endpoint: 'https://relay.test', computerId: 'cmp_test', supabaseUrl: 'https://api.danil.test', supabaseKey: 'sb_publishable_fixture', getToken: async () => token };
} });
const { w } = app;
const text = () => w.document.body.textContent;
const button = (label) => [...w.document.querySelectorAll('button')].find((node) => node.textContent.trim() === label || node.getAttribute('aria-label') === label);
const click = async (label) => { const node = button(label); assert.ok(node, label); node.click(); await sleep(150); };
try {
  await sleep(900);
  await click('Configuración');
  await click('Bitácora de cambios');
  await sleep(200);
  const log = w.document.querySelector('[data-audit-log]');
  assert.ok(log, 'the panel mounts inside Settings');
  assert.equal(calls[0].body.p_account_id, 7, 'the account is the JWT active account');
  assert.equal(calls[0].apikey, 'sb_publishable_fixture');
  assert.equal(log.querySelectorAll('[data-audit-entry]').length, 50);
  assert.match(text(), /Variable o secreto: se cambió/);
  assert.match(text(), /En nombre de Ana \(ana@ejemplo\.com\)/);
  assert.match(text(), /El soporte de Danil entró al workspace/);
  assert.match(text(), /Por soporte@danil\.ai/);
  await click('IA');
  assert.equal(log.querySelectorAll('[data-audit-entry]').length, 1, 'the filter keeps only AI rows');
  assert.match(text(), /El filtro solo revisa los cambios cargados/);
  await click('Todos');
  await click('Ver anteriores');
  assert.equal(calls.at(-1).body.p_before_id, 151, 'the next page asks before the oldest shown');
  assert.equal(log.querySelectorAll('[data-audit-entry]').length, 51);
  assert.equal(button('Ver anteriores'), undefined, 'a short page ends the list');
  console.log('alpha audit log: settings entry, active account, actor labels, filter and earlier page passed');
} finally { w.close(); }
process.exit(0);
