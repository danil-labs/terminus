import { createEffect, createSignal, onCleanup, onMount, type Accessor } from 'solid-js';
import { contextKey, decodeSelection, emptySelection, encodeSelection, toggleFeature, type Context, type Selection } from '../../../../packages/attention/src/customization.ts';

export function createCustomization(context: Accessor<Context>, subscribe?: (clear: () => void) => () => void) {
  const [validIdentity, setValidIdentity] = createSignal(true);
  const [ready, setReady] = createSignal(false);
  const [scope, setScope] = createSignal('');
  const [selection, setSelection] = createSignal<Selection>(emptySelection());
  const [temporary, setTemporary] = createSignal(true);
  const memory = new Map<string, Selection>();
  let persistent: string | null = null;
  onMount(() => {
    const stop = subscribe?.(() => { memory.clear(); setValidIdentity(false); setSelection(emptySelection()); });
    if (stop) onCleanup(stop);
  });
  createEffect(() => {
    setReady(false);
    const value = context();
    const current = { ...value, user: validIdentity() ? value.user : null };
    const scope = JSON.stringify([current.user, current.workspace, current.space]);
    persistent = current.user === 'demo' ? null : contextKey(current);
    setScope(scope);
    setTemporary(!persistent || current.user === 'demo');
    let state = memory.get(scope);
    if (!state) {
      try { state = persistent ? decodeSelection(localStorage.getItem(`harness.layout.${persistent}`)) : emptySelection(); }
      catch { persistent = null; setTemporary(true); state = emptySelection(); }
    }
    setSelection(state);
    setReady(Boolean(current.workspace && current.space));
  });
  function toggle(id: string) {
    if (persistent) {
      try {
        const stored = decodeSelection(localStorage.getItem(`harness.layout.${persistent}`));
        if (!stored.writable) { memory.set(scope(), stored); setSelection(stored); return; }
      } catch { persistent = null; setTemporary(true); }
    }
    const next = toggleFeature(selection(), id);
    if (next === selection()) return;
    setSelection(next);
    memory.set(scope(), next);
    if (persistent) {
      const encoded = encodeSelection(next);
      if (encoded !== null) {
        try { localStorage.setItem(`harness.layout.${persistent}`, encoded); }
        catch { persistent = null; setTemporary(true); }
      }
    }
  }
  return { ready, scope, selection, temporary, toggle, enabled: (id: string) => selection().enabled.some(value => value === id) };
}
