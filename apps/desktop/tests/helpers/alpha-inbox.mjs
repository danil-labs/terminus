import assert from 'node:assert/strict';
import { boot, sleep } from './jsdom-app.mjs';

globalThis.BroadcastChannel = undefined;
const session = JSON.stringify({ access_token: 'fixture-token', refresh_token: 'fixture-refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now()/1000)+3600, user: { id:'fixture-user', aud:'authenticated', email:'test@example.test', app_metadata:{}, user_metadata:{}, created_at:'2026-01-01T00:00:00Z' } });
const pending = [];
const calls = [];
let deferred = false;
const fixtureFetch = async (input, init) => {
  const url = String(input?.url ?? input);
  calls.push({url, method: init?.method ?? 'GET'});
  if (url.endsWith('/auth/profile')) return Response.json({user:{accounts:[{id:1,name:'Account One'},{id:2,name:'Account Two'}]}});
  if (url.includes('/auth/v1/logout')) return Response.json({});
  if (url.includes('/messages?')) return new Promise(resolve => pending.push(resolve));
  if (url.includes('/api/inbox/conversations?')) {
    const account = Number(new URL(url,'http://localhost').searchParams.get('account_id'));
    const data = { conversations:[{id:account*10,account_id:account,contact_name:`Contact ${account}`,ai_assistance:true}],hasMore:false };
    return deferred ? new Promise(resolve => pending.push(() => resolve(Response.json(data)))) : Response.json(data);
  }
  return new Response('');
};
fixtureFetch.__jsdomApp = true;
const app = await boot('listo','alpha-inbox-fixtures',{},undefined,{'sb-sqonjbpvairwfksotadj-auth-token':session},{web:true,antes(w){
  w.history.replaceState({},'', '/terminus/inbox');
  globalThis.fetch = fixtureFetch;
}});
const {w} = app;
const text = () => w.document.body.textContent;
const button = label => [...w.document.querySelectorAll('button')].find(b=>b.textContent.trim()===label);
const click = async label => { const node=button(label); assert.ok(node,`button ${label}`);node.click();await sleep(80); };
const choose = async id => {const select=w.document.querySelector('select');assert.ok(select);select.value=String(id);select.dispatchEvent(new w.Event('change',{bubbles:true}));await sleep(80);};
try {
  assert.ok(w.document.querySelector('[data-alpha]'),'build must use TERMINUS_WEB_ALPHA=1');
  await click('Conectar lectura real');
  await choose(1);assert.match(text(),/Contact 1/);
  await choose(2);assert.doesNotMatch(text(),/Contact 1/);assert.match(text(),/Contact 2/);
  deferred=true;
  await choose(1);
  await choose(2);
  pending.shift()();await sleep(80);assert.doesNotMatch(text(),/Contact 1/,'late account reply discarded');
  pending.shift()();await sleep(80);assert.match(text(),/Contact 2/);
  const contact=[...w.document.querySelectorAll('button')].find(b=>b.textContent.includes('Contact 2'));
  contact.click();await sleep(80);
  await click('Cambiar modo');await click('Explorar demo');
  pending.shift()(Response.json({messages:[{id:99,conversation_id:20,content:'SECRET STALE RESPONSE',direction:'inbound',sender_type:'contact'}],hasMore:false}));
  await sleep(80);assert.doesNotMatch(text(),/SECRET STALE RESPONSE/);assert.match(text(),/datos de ejemplo/);
  const before=calls.length;await click('Configuración');await click('Agentes');assert.equal(calls.length,before,'demo configuration sends no requests');
  await click('Cambiar modo');deferred=false;await click('Conectar lectura real');await choose(1);
  const oldContact=[...w.document.querySelectorAll('button')].find(b=>b.textContent.includes('Contact 1'));oldContact.click();await sleep(80);
  await click('Cerrar sesión');
  pending.shift()(Response.json({messages:[{id:98,conversation_id:10,content:'SECRET SIGNED OUT',direction:'inbound',sender_type:'contact'}],hasMore:false}));
  await sleep(80);assert.doesNotMatch(text(),/SECRET SIGNED OUT/);assert.doesNotMatch(text(),/Contact 1/);
  assert.equal(calls.filter(c=>c.url.includes('alpha-api') && c.method!=='GET').length,0);
  assert.equal(app.fallos.filter(e=>!e.includes('navigation')).length,0,app.fallos.join('\n'));
  console.log('alpha inbox UI fixtures: account, pending response, live/demo and sign-out isolation passed');
} finally { w.close(); }
process.exit(0);
