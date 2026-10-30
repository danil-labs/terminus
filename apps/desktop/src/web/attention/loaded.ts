import { createSignal } from 'solid-js';
import type { Conversation } from '../../../../../packages/attention/src/inbox.ts';

// Lo que el Inbox montado ya leyó, para el buscador global: sin lecturas nuevas.
const [loaded, setLoaded] = createSignal<Conversation[]>([]);
const [requested, setRequested] = createSignal<number | null>(null);

export const loadedConversations = loaded;
export const publishConversations = (rows: Conversation[]) => setLoaded(rows);
export const requestedConversation = requested;
export const requestConversation = (id: number | null) => setRequested(id);
