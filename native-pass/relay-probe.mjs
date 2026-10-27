import fs from 'node:fs';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
const {RelaySession}=await import(pathToFileURL(process.cwd()+'/packages/computers/src/relay.ts'));
const base='[QA-LAB]/dual-lab-v8';const ready=JSON.parse(fs.readFileSync(base+'/ready.json'));const t=JSON.parse(fs.readFileSync(base+'/tasks.json')).b;
const relay=new RelaySession({endpoint:ready.origin,computerId:'cmp_'+'b'.repeat(26),getToken:()=> 'qa-synthetic-client'});
relay.start();
const checks=[];
try {
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('link timeout')),10000);relay.onLink(open=>{if(open){clearTimeout(timer);resolve()}})});
 const commands=['load_session','list_live_sessions','list_projects','list_active_turns'];
 await Promise.all(Array.from({length:20},async(_,i)=>{const command=commands[i%4],args=command==='load_session'?{project:t.project,id:t.task}:command==='list_live_sessions'?{project:t.project,open:[]}:command==='list_active_turns'?{workspace:'keep0001'}:{};const id='probe-'+i;try{const r=await relay.call(id,command,'keep0001',null,args,15000);const v=r.value;if(command==='load_session'){assert.equal(v.id,t.task);assert(v.turns.some(t=>t.text.includes('::terminus-visual')))}else{assert(Array.isArray(v));if(command==='list_projects')assert(v.some(p=>p.id===t.project));if(command==='list_live_sessions')assert(v.some(s=>s.id===t.task));}checks.push({id,command,pass:true,session:v?.id??null});}catch(error){checks.push({id,command,pass:false,error:String(error),detail:error});throw error;}}));
 console.log(JSON.stringify({pass:true,checks},null,2));
} catch(error){console.log(JSON.stringify({pass:false,checks,error:String(error)},null,2));process.exitCode=1;} finally{relay.close();}
