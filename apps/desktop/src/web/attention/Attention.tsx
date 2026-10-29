import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { createInbox, type Account, type Conversation, type InboxSession, type Message } from '../../../../../packages/attention/src/inbox.ts';
import { t } from '../../lib/i18n';
import { Button } from '../../ui/Button';
import { Skeleton } from '../../ui/Skeleton';
import { ChannelFilter, ContactDetails, ConversationHeader, ConversationRow, ConversationSearch, InboxComposer, MessageBubble, senderLabel, SelectConversation } from './inbox-view';

export function Attention(props: { demo: boolean; session?: InboxSession & { subscribe?: (clear: () => void) => () => void } }) {
  const [accounts, setAccounts] = createSignal<Account[]>([]);
  const [account, setAccount] = createSignal<number>();
  const [rows, setRows] = createSignal<Conversation[]>([]);
  const [selected, setSelected] = createSignal<Conversation>();
  const [messages, setMessages] = createSignal<Message[]>([]);
  const [more, setMore] = createSignal(false);
  const [older, setOlder] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [loadingThread, setLoadingThread] = createSignal(false);
  const [error, setError] = createSignal('');
  const [consent, setConsent] = createSignal(false);
  const [detail, setDetail] = createSignal(false);
  const [query, setQuery] = createSignal('');
  const [channel, setChannel] = createSignal<string | null>(null);
  const api = props.session ? createInbox(props.session) : null;
  let epoch = 0;
  let thread = 0;
  const clear = () => { epoch++; thread++; setRows([]); setSelected(undefined); setMessages([]); setMore(false); setOlder(false); setError(''); setDetail(false); setLoadingThread(false); setQuery(''); setChannel(null); };
  onCleanup(() => { epoch++; thread++; });
  onMount(() => {
    const stop = props.session?.subscribe?.(() => { clear(); setAccounts([]); setAccount(undefined); setConsent(false); setBusy(false); });
    if (stop) onCleanup(stop);
    if (!props.demo) void connect();
    if (props.demo) setRows([1,2,3].map(id => ({ id, account_id:1, contact_name:t(`web.alpha.contact${id}`), channel_name:id === 2 ? 'Web':'WhatsApp', last_message:t(`web.alpha.preview${id}`), ai_assistance:id !== 1, unread_count:id === 1 ? 2:0 })));
  });
  async function connect() {
    clear(); setAccounts([]); setAccount(undefined); const request = epoch; setConsent(true); setBusy(true);
    try { if (!api) throw new Error(t("web.alpha.session_required")); const value = await api.accounts(); if (request === epoch) { setAccounts(value); const first = value.find(row => /danil workspace/i.test(row.name)) ?? value[0]; if (first) void load(first.id); } }
    catch (cause) { if (request === epoch) setError(cause instanceof Error ? cause.message : t("web.alpha.error")); }
    finally { if (request === epoch) setBusy(false); }
  }
  async function load(id: number, append = false) {
    if (!append) { clear(); setAccount(id); }
    const request=epoch; setBusy(true); setError('');
    try { if (!api) return; const page=await api.conversations(id,append?rows().length:0); if(request===epoch){setRows(append?[...rows(),...page.rows]:page.rows);setMore(page.hasMore);} }
    catch(cause){if(request===epoch)setError(cause instanceof Error?cause.message:t("web.alpha.error"));}
    finally{if(request===epoch)setBusy(false);}
  }
  async function open(row: Conversation, previous=false) {
    if(!previous){thread++;setSelected(row);setMessages([]);setOlder(false);setDetail(false);}
    if(props.demo){setMessages([{id:1,conversation_id:row.id,content:row.last_message,direction:'inbound',sender_type:'contact'},{id:2,conversation_id:row.id,content:t("web.alpha.sample_reply"),direction:'outbound',sender_type:'ai-agent'}]);return;}
    const request=epoch, selectedThread=thread;setBusy(true);setLoadingThread(true);setError('');
    try{if(!api||!account())return;const page=await api.messages(account()!,row.id,previous?messages()[0]?.id:undefined);if(request===epoch&&selectedThread===thread){setMessages(previous?[...page.rows,...messages()]:page.rows);setOlder(page.hasMore);}}
    catch(cause){if(request===epoch&&selectedThread===thread)setError(cause instanceof Error?cause.message:t("web.alpha.error"));}
    finally{if(request===epoch&&selectedThread===thread){setBusy(false);setLoadingThread(false);}}
  }
  function close() { thread++; setSelected(undefined); setMessages([]); setOlder(false); setError(''); setBusy(false); setLoadingThread(false); setDetail(false); }
  // Un tramo se corta al cambiar de lado o de remitente, como en Danil Agents.
  const position = (index: number) => {
    const list = messages();
    const same = (a?: Message, b?: Message) => !!a && !!b && a.direction === b.direction && senderLabel(a) === senderLabel(b);
    const prev = same(list[index - 1], list[index]);
    const next = same(list[index + 1], list[index]);
    return prev && next ? 'middle' : prev ? 'last' : next ? 'first' : 'single';
  };
  // La lista de alfa no admite `q` ni `channel_id`: se filtra lo ya cargado, páginas extra incluidas.
  const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const channels = () => [...new Set(rows().map(row => row.channel_name.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const visible = () => {
    const needle = fold(query().trim());
    return rows().filter(row => (!channel() || row.channel_name.trim() === channel()) && (!needle || fold(`${row.contact_name} ${row.last_message} ${row.channel_name}`).includes(needle)));
  };
  const filtering = () => !!query().trim() || !!channel();
  const listLoading = () => busy() && rows().length === 0 && !selected();
  return <section class="@container flex h-full min-h-0 min-w-0 flex-col overflow-hidden" data-alpha-inbox="">
    <Show when={props.demo}><p class="m-0 border-b border-border px-4 py-2 text-xs text-neutral-500">{t("web.alpha.demo_badge")} · {t("web.alpha.external_only")} <a class="ml-2 underline" href={`${import.meta.env.BASE_URL}inbox`}>{t("web.alpha.change_mode")}</a></p></Show>
    {/* Alfa: sin selector de cuenta; abre «Danil Workspace» si existe y si no la primera. */}
    <Show when={error()}><div role="alert" class="flex flex-wrap items-center gap-2 border-b border-border p-3"><p class="m-0 text-sm text-error-strong">{t("web.alpha.error")} {error()}</p><Button size="sm" variant="secondary" disabled={busy()} onClick={() => selected() ? void open(selected()!) : account() ? void load(account()!) : void connect()}>{t("customize.retry")}</Button></div></Show>
    <div class="flex min-h-0 flex-1 overflow-hidden @[46rem]:grid @[46rem]:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
      <section aria-label={t("customize.conversations")} class={`min-h-0 w-full min-w-0 flex-col overflow-hidden dark:bg-surface @[46rem]:flex @[46rem]:border-r @[46rem]:border-border ${selected() ? 'hidden' : 'flex'}`}>
        <header class="flex min-h-11 w-full min-w-0 shrink-0 items-center gap-2 border-b border-border px-3 py-1">
          <span class="min-w-0 flex-1 truncate text-[0.85rem] font-semibold text-neutral-950">{t("web.alpha.inbox")}</span>
          <span class="shrink-0 rounded-full border border-border px-2 py-[3px] text-[0.68rem] font-medium text-neutral-500">{t("customize.read_only")}</span>
          <Show when={channels().length > 1}><ChannelFilter channels={channels()} value={channel()} onChange={setChannel}/></Show>
        </header>
        <div class="grid w-full min-w-0 shrink-0 gap-2 border-b border-border px-3 py-2"><ConversationSearch value={query()} onChange={setQuery}/></div>
        <div class="min-h-0 flex-1 overflow-y-auto">
          <Show when={!props.demo && consent() && !busy() && !error() && accounts().length === 0}><p role="status" class="p-4 text-center text-[0.85rem] text-neutral-500">{t("customize.no_accounts")}</p></Show>
          <Show when={listLoading()}><div class="p-3"><Skeleton class="h-14 rounded-md" filas={6}/></div></Show>
          <Show when={!busy() && !error() && (props.demo || account()) && rows().length === 0}><p role="status" class="p-4 text-center text-[0.85rem] text-neutral-500">{t("customize.page_empty")}</p></Show>
          <Show when={rows().length > 0 && visible().length === 0}><p role="status" class="p-4 text-center text-[0.85rem] text-neutral-500">{query().trim() ? t("web.alpha.search_empty", { query: query().trim() }) : t("web.alpha.channel_empty", { channel: channel() ?? '' })}</p></Show>
          <ul class="m-2 grid min-w-0 list-none gap-0.5 p-0">
            <For each={visible()}>{row => <li class="min-w-0"><ConversationRow conversation={row} active={selected()?.id === row.id} onSelect={() => void open(row)}/></li>}</For>
          </ul>
          <Show when={more() && filtering()}><p class="m-0 px-4 pb-2 text-center text-[0.72rem] text-neutral-500">{t("web.alpha.filter_loaded_only")}</p></Show>
          <Show when={more()}><div class="flex justify-center pb-3"><Button size="sm" variant="secondary" disabled={busy()} onClick={() => void load(account()!, true)}>{t("web.alpha.more")}</Button></div></Show>
        </div>
      </section>
      <div class={`min-h-0 min-w-0 flex-1 flex-col overflow-hidden @[46rem]:flex ${selected() ? 'flex' : 'hidden'}`}>
        <Show when={selected()} fallback={<SelectConversation/>}>{row => <section class="@container/detail flex h-full min-h-0 min-w-0 flex-col" aria-label={t("web.alpha.conversation_with", { name: row().contact_name || t("web.alpha.contact_fallback") })}>
          <ConversationHeader conversation={row()} detailsOpen={detail()} onBack={close} onToggleDetails={() => setDetail(!detail())}/>
          <div class="relative min-h-0 min-w-0 flex-1 overflow-hidden @[40rem]/detail:flex @[40rem]/detail:flex-row">
            <div class="@container relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden dark:bg-surface-muted @[40rem]/detail:min-w-0 @[40rem]/detail:flex-1">
              <div aria-label={t("web.alpha.messages")} class="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-4 pt-4 pb-[112px] [overscroll-behavior:contain] @[32rem]:px-6 @[48rem]:px-8 @[64rem]:px-12">
                <div class="grid min-h-full min-w-0 content-end gap-0">
                  <Show when={loadingThread() && messages().length === 0}><div class="grid gap-3 p-3" aria-label={t("web.alpha.loading_messages")}><Skeleton class="h-[72px] w-[min(72%,360px)] rounded-[18px]"/><div class="w-[min(72%,360px)] justify-self-end"><Skeleton class="h-[72px] w-full rounded-[18px]"/></div><Skeleton class="h-[52px] w-[min(48%,260px)] rounded-[18px]"/></div></Show>
                  <Show when={older()}><div class="flex justify-center py-1"><Button size="sm" variant="secondary" disabled={busy()} class="text-[0.8rem] font-semibold text-primary-dark" onClick={() => void open(row(), true)}>{busy() ? t("web.alpha.loading") : t("web.alpha.older")}</Button></div></Show>
                  <For each={messages()}>{(message, index) => <MessageBubble message={message} position={position(index())}/>}</For>
                  <Show when={!loadingThread() && !error() && messages().length === 0}><p class="m-0 p-3 text-center text-[0.85rem] text-neutral-500">{t("web.alpha.no_messages")}</p></Show>
                </div>
              </div>
              <InboxComposer/>
            </div>
            <Show when={detail()}>
              <button type="button" class="absolute inset-0 z-10 bg-neutral-950/30 @[40rem]/detail:hidden" aria-label={t("web.alpha.close_details")} onClick={() => setDetail(false)}/>
              <ContactDetails conversation={row()} onClose={() => setDetail(false)}/>
            </Show>
          </div>
        </section>}</Show>
      </div>
    </div>
  </section>;
}
