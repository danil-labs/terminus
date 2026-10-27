import assert from 'node:assert/strict';
import { engine, relay } from './fake-relay.mjs';
import { boot, sleep } from './jsdom-app.mjs';

// El App real y su pestaña Inbox, con relay y BFF de prueba independientes.
const fake = relay({table:{...engine,list_spaces:[{id:'space',name:'Space',folders:['p1'],created_at:0,updated_at:0}]}});
const pending=[];
let deferred=false, rejectOnce=true, refreshes=0, invalidate;
const fixtureFetch=async input=>{
 const url=String(input?.url??input);
 if(url.endsWith('/auth/profile')){
  if(rejectOnce){rejectOnce=false;return new Response('',{status:401});}
  return Response.json({user:{accounts:[{id:1,name:'One'},{id:2,name:'Two'}]}});
 }
 if(url.includes('/messages?'))return new Promise(resolve=>pending.push(resolve));
 if(url.includes('/api/inbox/conversations?')){
  const id=Number(new URL(url,'http://localhost').searchParams.get('account_id'));
  const page={conversations:[{id:id*10,account_id:id,contact_name:`Contact ${id}`,ai_assistance:true}],hasMore:false};
  return deferred?new Promise(resolve=>pending.push(()=>resolve(Response.json(page)))):Response.json(page);
 }
 return new Response('{}',{status:404});
};
fixtureFetch.__jsdomApp=true;
const app=await boot('listo','alpha-real-shell',{},undefined,{}, {web:true,antes(w){
 const append=w.document.head.appendChild.bind(w.document.head);
 w.document.head.appendChild=node=>{const value=append(node);if(node.tagName==='LINK')setTimeout(()=>node.dispatchEvent(new w.Event('load')),0);return value;};
 w.history.replaceState({},'','/terminus/inbox?live=1');
 globalThis.WebSocket=fake.Socket;
 globalThis.fetch=fixtureFetch;
 w.terminusWeb={endpoint:'https://relay.test',computerId:'cmp_test',getToken:async()=>'fixture',refresh:async()=>{refreshes++;await sleep(30);return true;},subscribe:clear=>{invalidate=clear;return()=>{invalidate=undefined;};}};
}});
const {w}=app;
const text=()=>w.document.body.textContent;
const button=label=>[...w.document.querySelectorAll('button')].find(node=>node.textContent.trim()===label);
const click=async label=>{const node=button(label);assert.ok(node,label);node.click();await sleep(100);};
const choose=async id=>{const select=w.document.querySelector('[data-alpha-inbox] select');assert.ok(select);select.value=String(id);select.dispatchEvent(new w.Event('change',{bubbles:true}));await sleep(100);};
try{
 await sleep(900);
 assert.ok(w.document.querySelector('[data-alpha-inbox]'),'Inbox must be inside App Paneles');
 assert.ok(w.document.querySelector('[data-sesion]'),'real Sidebar still mounts');
 await click('Conectar lectura real');
 assert.equal(refreshes,1,'401 awaits refresh and retries the GET once');
 await choose(1);assert.match(text(),/Contact 1/);
 await choose(2);assert.doesNotMatch(text(),/Contact 1/);assert.match(text(),/Contact 2/);
 deferred=true;await choose(1);await choose(2);
 pending.shift()();await sleep(100);assert.doesNotMatch(text(),/Contact 1/);
 pending.shift()();await sleep(100);assert.match(text(),/Contact 2/);
 const contact=[...w.document.querySelectorAll('[data-alpha-inbox] button')].find(node=>node.textContent.includes('Contact 2'));
 contact.click();await sleep(50);
 w.document.querySelector('[data-sesion]').click();await sleep(100);
 assert.equal(typeof invalidate,'function');invalidate();
 pending.shift()(Response.json({messages:[{id:99,conversation_id:20,content:'SECRET STALE',direction:'inbound',sender_type:'contact'}],hasMore:false}));
 await sleep(150);
 assert.doesNotMatch(w.document.querySelector('[data-alpha-inbox]').textContent,/Contact 2|SECRET STALE/,'hidden Inbox clears on session change and discards pending messages');
 assert.match(w.document.querySelector('[data-alpha-inbox]').textContent,/Conectar lectura real/);
 console.log('alpha real shell: 401 refresh/retry, accounts, pending responses and hidden-tab session invalidation passed');
}finally{w.close();}
process.exit(0);
