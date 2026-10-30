import assert from 'node:assert/strict';
import { engine, relay } from './fake-relay.mjs';
import { boot, sleep } from './jsdom-app.mjs';

// La web de alfa real (`TERMINUS_WEB_ALPHA=1 vite build --mode web`): Cuenta › Correos con un BFF de prueba, por clic y por `?settings=emails`.
// Correr con `--unhandled-rejections=warn`: Configuración ya deja un rechazo sin atender con este relay de prueba.
const fixtureFetch = async (input) => {
  const url = String(input?.url ?? input);
  if (url.endsWith('/alpha-api/auth/emails')) return Response.json({ emails: [{ email: 'ana@danil.ai', primary: true, verified: true }, { email: 'ana@gmail.com', primary: false, verified: true }], pending: [] });
  if (url.endsWith('/alpha-api/auth/profile')) return Response.json({ user: { accounts: [{ id: 1, name: 'Uno', role: 'owner' }] } });
  return new Response('{}', { status: 404 });
};
fixtureFetch.__jsdomApp = true;

async function open(name, path) {
  const fake = relay({ table: { ...engine, list_spaces: [{ id: 'space', name: 'Space', folders: ['p1'], created_at: 0, updated_at: 0 }] } });
  return boot('listo', name, {}, undefined, {}, { web: true, antes(w) {
    w.history.replaceState({}, '', path);
    globalThis.WebSocket = fake.Socket;
    globalThis.fetch = fixtureFetch;
    w.terminusWeb = { userId: 'fixture-user', endpoint: 'https://relay.test', computerId: 'cmp_test', getToken: async () => 'tok', refresh: async () => false };
  } });
}
const shown = (w) => {
  const section = w.document.querySelector('#cfg-panel [data-account-emails]');
  assert.ok(section, w.document.querySelector('#cfg-panel')?.textContent ?? 'Configuración no abrió');
  assert.match(section.textContent, /ana@gmail\.com/, 'the BFF list reaches the tab');
  assert.equal(w.document.querySelector('#cfg-sub-emails')?.getAttribute('aria-selected'), 'true', 'Correos is the selected tab');
  assert.equal(w.document.querySelector('#cfg-tab-account')?.getAttribute('aria-selected'), 'true', 'inside Cuenta');
};

const clicked = await open('alpha-emails-click', '/terminus/');
try {
  await sleep(900);
  const { w } = clicked;
  w.document.querySelector('button[aria-label="Configuración"]').click();
  await sleep(400);
  w.document.querySelector('#cfg-tab-account').click();
  await sleep(150);
  assert.equal(w.document.querySelector('#cfg-sub-security')?.getAttribute('aria-disabled'), 'true', 'Seguridad stays «pronto»');
  assert.equal(w.document.querySelector('#cfg-panel [data-account-emails]'), null, 'Correos is not stacked on Perfil');
  assert.equal(w.document.querySelector('[data-account-emails-link]'), null, 'no link to the web where the tab exists');
  w.document.querySelector('#cfg-sub-emails').click();
  await sleep(500);
  shown(w);
} finally { clicked.w.close(); }

const linked = await open('alpha-emails-link', '/terminus/?settings=emails');
try {
  await sleep(1200);
  const { w } = linked;
  shown(w);
  assert.equal(new URL(w.location.href).searchParams.has('settings'), false, 'the param leaves the address bar');
} finally { linked.w.close(); }
console.log('alpha account emails: Correos tab by click and by ?settings=emails passed');
process.exit(0);
