import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { contextKey, decodeSelection, emptySelection, encodeSelection, toggleFeature, FEATURES, type Selection } from '../../../../packages/attention/src/customization.ts';
import { ALPHA_DEMO } from './alpha-mode';
import { useMachines } from './machines';
import { useAccount } from './account';
import { store } from './store';
import { useWorkspaces } from './workspaces';
import { t } from './i18n';

function useModel() {
  const account = useAccount();
  const { current, space, list, loading, selectionReady, snapshot } = useWorkspaces();
  const machines=useMachines();
  const resolving=!selectionReady || Boolean(current && !snapshot) || !account.ready || !machines.ready || Boolean(account.session && machines.fleet==='loading') || loading || (list.length>0&&!current);
  const scope = JSON.stringify([ALPHA_DEMO ? 'demo' : account.session?.user.id ?? null, current?.id ?? null, space?.id ?? null]);
  const key = process.env.EXPO_PUBLIC_TERMINUS_ALPHA === '1' ? contextKey({user:ALPHA_DEMO?'demo':account.session?.user.id,workspace:current?.id,space:space?.id}) : null;
  const storageKey = key ? `harness.layout.${key}` : null;
  const active = useRef(scope); active.current = scope;
  const memory = useRef(new Map<string, Selection>());
  const latest = useRef({scope,selection:emptySelection()});
  const [state, setState] = useState({scope:'',selection:emptySelection(),temporary:true});
  useEffect(() => {
    let valid = true;
    const publish = (selection: Selection, temporary: boolean) => {
      if (!valid || active.current !== scope) return;
      latest.current = {scope,selection}; setState({scope,selection,temporary});
    };
    const cached = memory.current.get(scope);
    if (cached) publish(cached,ALPHA_DEMO || !storageKey);
    else if (!storageKey) publish(emptySelection(),true);
    else void store.get(storageKey).then(raw=>publish(decodeSelection(raw),ALPHA_DEMO)).catch(()=>publish(emptySelection(),true));
    return () => {valid=false;};
  },[scope,storageKey]);
  const selection = state.scope === scope ? state.selection : emptySelection();
  async function toggle(id: string) {
    if (process.env.EXPO_PUBLIC_TERMINUS_ALPHA !== '1' || resolving || state.scope!==scope) return;
    if (latest.current.scope !== scope || active.current !== scope) return;
    let temporary = ALPHA_DEMO || !storageKey;
    if (storageKey) {
      try {
        const stored=decodeSelection(await store.get(storageKey));
        if (active.current !== scope) return;
        if (!stored.writable) {memory.current.set(scope,stored);latest.current={scope,selection:stored};setState({scope,selection:stored,temporary});return;}
      } catch {temporary=true;}
    }
    if (active.current !== scope || latest.current.scope !== scope) return;
    const next=toggleFeature(latest.current.selection,id);
    latest.current={scope,selection:next};memory.current.set(scope,next);setState({scope,selection:next,temporary});
    const encoded=encodeSelection(next);
    if (storageKey && encoded !== null && !temporary) {
      try {await store.set(storageKey,encoded);} catch {if(active.current===scope)setState({scope,selection:next,temporary:true});}
    }
  }
  const labels = {
    inbox:[t('attention.inbox'),t('attention.inbox_description')],broadcasts:[t('attention.broadcasts'),t('attention.broadcasts_description')],
    agents:[t('attention.agents'),t('attention.agents_description')],channels:[t('attention.channels'),t('attention.channels_description')],
    contacts:[t('attention.contacts'),t('attention.contacts_description')],funnels:[t('attention.funnels'),t('attention.funnels_description')],
    calendar:[t('attention.calendar'),t('attention.calendar_description')],inventory:[t('attention.inventory'),t('attention.inventory_description')],
  };
  return {scope,selection,temporary:state.temporary,ready:state.scope===scope&&!resolving,toggle,enabled:(id:string)=>selection.enabled.some(value=>value===id),entries:FEATURES.map(row=>({...row,title:labels[row.id][0],description:labels[row.id][1],available:row.available&&selection.writable,selected:selection.enabled.some(id=>id===row.id)}))};
}
const Context=createContext<ReturnType<typeof useModel>|null>(null);
export function CustomizationProvider({children}:{children:ReactNode}){const value=useModel();return <Context.Provider value={value}>{children}</Context.Provider>;}
export function useCustomization(){const value=useContext(Context);if(!value)throw new Error('CustomizationProvider missing');return value;}
