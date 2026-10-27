import assert from 'node:assert/strict';
import { boot, sleep } from './jsdom-app.mjs';

globalThis.BroadcastChannel = undefined;
const stored = {access_token:'fixture-token',refresh_token:'fixture-refresh',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)-10,user:{id:'fixture-user',aud:'authenticated',email:'qa@example.test',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'}};
const refreshes=[];
const domain=[];
const fixtureFetch=async(input)=>{
 const url=String(input?.url??input);
 if(url.includes('/auth/v1/token')) return new Promise(resolve=>refreshes.push(resolve));
 if(url.includes('/alpha-api/')){domain.push(url);return Response.json({user:{accounts:[]}});}
 return new Response('');
};
fixtureFetch.__jsdomApp=true;
const {w}=await boot('listo','alpha-auth-race',{},undefined,{'sb-sqonjbpvairwfksotadj-auth-token':JSON.stringify(stored)},{web:true,antes(win){win.history.replaceState({},'', '/terminus/inbox');globalThis.fetch=fixtureFetch;}});
const button=label=>[...w.document.querySelectorAll('button')].find(b=>b.textContent.trim()===label);
try{
 assert.ok(w.document.querySelector('[data-alpha]'));
 assert.ok(refreshes.length,'expired fixture is waiting for auth refresh');
 button('Conectar lectura real').click();
 await sleep(30);
 button('Explorar demo').click();
 const fresh={...stored,expires_at:Math.floor(Date.now()/1000)+3600};
 for(const resolve of refreshes)resolve(Response.json(fresh));
 await sleep(200);
 assert.match(w.document.body.textContent,/datos de ejemplo/);
 assert.equal(domain.length,0,'late getSession never reconnects after demo selection');
 console.log('alpha auth UI fixture: pending session cannot override explicit demo mode');
}finally{w.close();}
process.exit(0);
