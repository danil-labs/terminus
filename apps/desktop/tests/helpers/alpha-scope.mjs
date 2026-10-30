import assert from 'node:assert/strict';
import { engine, relay } from './fake-relay.mjs';
import { boot, sleep } from './jsdom-app.mjs';

// El App real de alfa: cambiar de workspace o de sesión no deja nada del ámbito anterior.
// Necesita `dist-web` construido con TERMINUS_WEB_ALPHA=1 y TERMINUS_WEB_BASE=/terminus/.
const workspaces=[{id:'w1',name:'Uno',context_root:null},{id:'w2',name:'Dos',context_root:null}];
const fake=relay({table:{...engine,list_workspaces:{workspaces,active:'w1'},workspaces_startup:{workspaces,active:'w1'},set_active_workspace:null,list_spaces:[{id:'space',name:'Space',folders:['p1'],created_at:0,updated_at:0}]}});
const held=[];let active=1;const invalidate=new Set();
const json=value=>Response.json(value);
const fixtureFetch=async(input,init)=>{
 const url=new URL(String(input?.url??input),'http://localhost');const path=url.pathname.replace(/^.*alpha-api/,'');
 if(path==='/auth/profile')return json({user:{accounts:[{id:1,name:'Uno',role:'owner'},{id:2,name:'Otro',role:'owner'}]}});
 if(path==='/api/agents')return json({agents:[{id:7,name:'Sofía',agent_type:'pessoa'}]});
 if(path==='/api/agents/7'||path==='/api/agents/7/connections')return new Promise(resolve=>held.push(()=>resolve(json({id:7,name:'Sofía',model:'SECRET-MODEL',description:'SECRET-ROLE',channels:[]}))));
 if(path==='/auth/account/my-permissions')return json({role:'owner',permissions:['campaigns.manage'],scoped:[]});
 if(path==='/auth/account/features')return json({features:['campaigns']});
 if(path.startsWith('/api/marketing/'))return json({campaigns:[],templates:[],items:[]});
 if(path.startsWith('/api/'))return json({});
 return new Response('{}',{status:404});
};
fixtureFetch.__jsdomApp=true;
const app=await boot('listo','alpha-scope',{},undefined,{},{web:true,antes(w){
 w.history.replaceState({},'','/terminus/?live=1');
 globalThis.WebSocket=fake.Socket;globalThis.fetch=fixtureFetch;
 w.terminusWeb={userId:'fixture-user',endpoint:'https://relay.test',computerId:'cmp_test',getToken:async()=>`x.${btoa(JSON.stringify({active_account_id:active}))}.y`,refresh:async()=>true,subscribe:clear=>{invalidate.add(clear);return()=>invalidate.delete(clear);}};
}});
const {w}=app;const doc=w.document;
const q=s=>doc.querySelector(s);
const text=()=>doc.body.textContent;
const byText=(label,root=doc)=>[...root.querySelectorAll('button')].find(b=>b.textContent.trim()===label||b.getAttribute('aria-label')===label);
const until=async(check,label)=>{for(let i=0;i<60;i++){if(check())return;await sleep(50);}assert.fail(`${label}: ${q('[data-broadcasts]')?.textContent.slice(0,200)??doc.body.textContent.slice(0,200)}`);};
const enter=async name=>{const b=[...doc.querySelectorAll('button')].find(n=>n.getAttribute('aria-label')?.includes(name)||n.title?.includes(name));assert.ok(b,`workspace ${name}`);b.click();await sleep(250);};
const openAgents=async()=>{w.dispatchEvent(new w.CustomEvent('harness:open-settings',{detail:'agentes'}));await until(()=>q('[data-service-agents]'),'agents section');};
try{
 await sleep(900);
 await openAgents();
 await until(()=>byText('Ver',q('[data-service-agents]')),'agent row');
 byText('Ver',q('[data-service-agents]')).click();
 await until(()=>q('[data-service-agent]'),'detail opens');
 await until(()=>held.length===2,'detail reads pending');
 await enter('Dos');
 await until(()=>q('[data-service-unresolved]'),'unresolved after the change');
 assert.equal(q('[data-service-agent]'),null,'the open agent leaves with its workspace');
 for(const release of held.splice(0))release();
 await sleep(150);
 assert.doesNotMatch(text(),/SECRET-MODEL|SECRET-ROLE|Sofía/,'a late answer of the previous workspace stays out');

 await enter('Uno');
 await until(()=>byText('Ver',q('[data-service-agents]')),'row again');
 byText('Ver',q('[data-service-agents]')).click();
 await until(()=>q('[data-service-agent]'),'detail opens again');
 active=2;for(const clear of [...invalidate])clear();
 await until(()=>q('[data-service-unresolved]'),'unresolved after the session change');
 assert.equal(q('[data-service-agent]'),null,'the open agent leaves with its session');
 active=1;for(const release of held.splice(0))release();
 await sleep(100);
 assert.doesNotMatch(text(),/SECRET-MODEL/);
 // Difusiones: un formulario abierto no sobrevive al cambio de ámbito.
 byText('Cerrar configuración',doc)?.click();
 for(const clear of [...invalidate])clear();await sleep(200);
 await enter('Dos');await enter('Uno');
 if(q('[role="dialog"]'))q('[role="dialog"]').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await sleep(200);
 byText('Personalizar').click();await sleep(150);
 const add=q('[role="switch"][aria-label="Difusiones"]');assert.ok(add,'Broadcasts in Customize');add.click();await sleep(100);
 add.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await sleep(150);
 byText('Difusiones').click();
 await until(()=>q('[data-broadcasts]'),'Broadcasts mounts');
 await until(()=>{const b=[...q('[data-broadcasts]').querySelectorAll('button')].find(n=>/Nueva/.test(n.textContent));return b&&!b.disabled;},'new campaign enabled');
 [...q('[data-broadcasts]').querySelectorAll('button')].find(n=>/Nueva/.test(n.textContent)).click();
 await until(()=>q('[data-broadcasts] input'),'campaign form opens');
 const field=q('[data-broadcasts] input');field.value='BORRADOR';field.dispatchEvent(new w.Event('input',{bubbles:true}));await sleep(50);
 await enter('Dos');
 await until(()=>!q('[data-broadcasts] input'),'the form leaves with its workspace');
 assert.doesNotMatch(text(),/BORRADOR/);
 await enter('Uno');
 await sleep(300);byText('Difusiones')?.click();
 await until(()=>q('[data-broadcasts]')&&[...q('[data-broadcasts]').querySelectorAll('button')].some(n=>/Nueva/.test(n.textContent)),'Broadcasts back');
 assert.equal([...doc.querySelectorAll('[data-broadcasts] input')].some(n=>n.value==='BORRADOR'),false,'and the draft does not come back');
 console.log('alpha scope: detail cleared on workspace and session change, late answers dropped, Broadcasts form cleared');
}finally{w.close();}
process.exit(0);
