import assert from 'node:assert/strict';
import { engine, relay } from './fake-relay.mjs';
import { boot, sleep } from './jsdom-app.mjs';

// El App real y su pestaña Inbox, con relay y BFF de prueba independientes.
const workspace={id:'w',name:'Dos',context_root:null};
const fake = relay({table:{...engine,list_workspaces:{workspaces:[workspace],active:'w'},workspaces_startup:{workspaces:[workspace],active:'w'},list_spaces:[{id:'space',name:'Space',folders:['p1'],created_at:0,updated_at:0}]}});
const pending=[];
let rejectOnce=true, refreshes=0;const invalidate=new Set();
const fixtureFetch=async input=>{
 const url=String(input?.url??input);
 if(url.endsWith('/auth/profile')){
  if(rejectOnce){rejectOnce=false;return new Response('',{status:401});}
  return Response.json({user:{accounts:[{id:1,name:'One'},{id:2,name:'Dos'}]}});
 }
 if(url.includes('/messages?'))return new Promise(resolve=>pending.push(resolve));
 if(url.includes('/api/inbox/conversations?')){
  const id=Number(new URL(url,'http://localhost').searchParams.get('account_id'));
  const page={conversations:[{id:id*10,account_id:id,contact_name:`Contact ${id}`,ai_assistance:true}],hasMore:false};
  return Response.json(page);
 }
 return new Response('{}',{status:404});
};
fixtureFetch.__jsdomApp=true;
const app=await boot('listo','alpha-real-shell',{},undefined,{}, {web:true,antes(w){
 w.history.replaceState({},'','/terminus/inbox?live=1');
 globalThis.WebSocket=fake.Socket;
 globalThis.fetch=fixtureFetch;
 w.terminusWeb={userId:'fixture-user',endpoint:'https://relay.test',computerId:'cmp_test',getToken:async()=>`x.${btoa(JSON.stringify({active_account_id:2}))}.y`,refresh:async()=>{refreshes++;await sleep(30);return true;},subscribe:clear=>{invalidate.add(clear);return()=>invalidate.delete(clear);}};
}});
const {w}=app;
const text=()=>w.document.body.textContent;
const button=label=>[...w.document.querySelectorAll('button')].find(node=>node.textContent.trim()===label||node.getAttribute('aria-label')===label);
const click=async label=>{const node=button(label);assert.ok(node,label);node.click();await sleep(100);};
try{
 await sleep(900);
 assert.equal(w.document.querySelector('[data-alpha-inbox]'),null,'deep link never opts in');
 await click('Personalizar');
 const add=w.document.querySelector('[role="switch"][aria-label="Inbox"]');assert.ok(add);assert.equal(add.getAttribute('aria-checked'),'false');add.click();await sleep(100);
 assert.equal(add.getAttribute('aria-checked'),'true','the switch turns Inbox on');
 add.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await sleep(150);
 assert.equal(w.document.querySelector('[role="switch"][aria-label="Inbox"]'),null,'Escape closes Customize');
 await click('Inbox');
 assert.ok(w.document.querySelector('[data-alpha-inbox]'),'enabled Inbox mounts inside App Paneles');
 assert.ok(w.document.querySelector('[data-sesion]'),'real Sidebar still mounts');
 await sleep(150);
 assert.equal(refreshes,1,'401 awaits refresh and retries the GET once');
 // Sin selector de cuenta: abre la cuenta del workspace activo aunque no sea la primera.
 assert.equal(w.document.querySelector('[data-alpha-inbox] select'),null,'Inbox has no account picker');
 assert.match(text(),/Contact 2/,'the active workspace account opens by itself');
 assert.doesNotMatch(text(),/Contact 1/,'and the first account is not read');
 const contact=[...w.document.querySelectorAll('[data-alpha-inbox] button')].find(node=>node.textContent.includes('Contact 2'));
 contact.click();await sleep(50);
 w.document.querySelector('[data-sesion]').click();await sleep(100);
 assert.ok(invalidate.size>0);for(const clear of [...invalidate])clear();
 pending.shift()(Response.json({messages:[{id:99,conversation_id:20,content:'SECRET STALE',direction:'inbound',sender_type:'contact'}],hasMore:false}));
 await sleep(150);
 assert.equal(w.document.querySelector('[data-alpha-inbox]'),null,'hidden Inbox unmounts on session change and discards pending messages');
 assert.doesNotMatch(text(),/Contact 2|SECRET STALE/);
 console.log('alpha real shell: 401 refresh/retry, workspace account and hidden-tab session invalidation passed');
}finally{w.close();}
process.exit(0);
