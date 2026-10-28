import assert from 'node:assert/strict';
import { createRoot, createSignal } from 'solid-js';
import { createCustomization } from '../../src/lib/customization.ts';
import { contextKey } from '../../../../packages/attention/src/customization.ts';

const values=new Map([['unrelated','sentinel']]);
let blocked=false;
globalThis.localStorage={getItem:key=>{if(blocked)throw Error('blocked');return values.get(key)??null;},setItem:(key,value)=>{if(blocked)throw Error('blocked');values.set(key,value);}};
const key=context=>`harness.layout.${contextKey(context)}`;
const first={user:'user-1',workspace:'workspace-1',space:'space-1'};
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
let setContext, model, clearSession, dispose;
createRoot(stop=>{dispose=stop;const [context,set]=createSignal(first);setContext=set;model=createCustomization(context,clear=>{clearSession=clear;return()=>{};});});
await tick();
assert.equal(model.ready(),true);assert.deepEqual(model.selection().enabled,[]);
model.toggle('inbox');assert.deepEqual(JSON.parse(values.get(key(first))).enabled,['inbox']);
for(const other of [{...first,user:'user-2'},{...first,workspace:'workspace-2'},{...first,space:'space-2'}]){
 setContext(other);await tick();assert.deepEqual(model.selection().enabled,[]);model.toggle('broadcasts');
 assert.deepEqual(JSON.parse(values.get(key(other))).enabled,['broadcasts']);
}
setContext(first);await tick();assert.deepEqual(model.selection().enabled,['inbox']);
model.toggle('inbox');assert.deepEqual(model.selection().enabled,[]);
const future={...first,space:'future'};const raw='{"version":99,"enabled":["inbox"]}';values.set(key(future),raw);
setContext(future);await tick();model.toggle('inbox');assert.equal(model.selection().writable,false);assert.equal(values.get(key(future)),raw);
setContext({...first,space:'corrupt'});values.set(key({...first,space:'corrupt'}),'{broken');await tick();assert.deepEqual(model.selection().enabled,[]);
blocked=true;setContext({...first,space:'blocked'});await tick();model.toggle('inbox');assert.equal(model.temporary(),true);assert.equal(model.enabled('inbox'),true);blocked=false;
setContext(first);await tick();model.toggle('inbox');clearSession();await tick();assert.deepEqual(model.selection().enabled,[]);assert.equal(model.temporary(),true);
assert.equal(values.get('unrelated'),'sentinel');dispose();
console.log('production desktop preferences: contexts, identity, remove, future, corruption, blocked storage and session invalidation passed');
