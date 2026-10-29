import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { createInbox, type Account, type Conversation, type InboxSession, type Message } from '../../../../../packages/attention/src/inbox.ts';
import { t } from '../../lib/i18n';
import { Button } from '../../ui/Button';
import { Badge } from '../../ui/Badge';
import { Textarea } from '../../ui/Textarea';

export function Attention(props: { demo: boolean; session?: InboxSession & { subscribe?: (clear: () => void) => () => void } }) {
  const [accounts, setAccounts] = createSignal<Account[]>([]);
  const [account, setAccount] = createSignal<number>();
  const [rows, setRows] = createSignal<Conversation[]>([]);
  const [selected, setSelected] = createSignal<Conversation>();
  const [messages, setMessages] = createSignal<Message[]>([]);
  const [more, setMore] = createSignal(false);
  const [older, setOlder] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [consent, setConsent] = createSignal(false);
  const [detail, setDetail] = createSignal(false);
  const [draft, setDraft] = createSignal('');
  const api = props.session ? createInbox(props.session) : null;
  let epoch = 0;
  let thread = 0;
  const clear = () => { epoch++; thread++; setRows([]); setSelected(undefined); setMessages([]); setMore(false); setOlder(false); setError(''); setDraft(''); setDetail(false); };
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
    if(!previous){thread++;setSelected(row);setMessages([]);setOlder(false);setDraft('');setDetail(false);}
    if(props.demo){setMessages([{id:1,conversation_id:row.id,content:row.last_message,direction:'inbound',sender_type:'contact'},{id:2,conversation_id:row.id,content:t("web.alpha.sample_reply"),direction:'outbound',sender_type:'ai-agent'}]);return;}
    const request=epoch, selectedThread=thread;setBusy(true);setError('');
    try{if(!api||!account())return;const page=await api.messages(account()!,row.id,previous?messages()[0]?.id:undefined);if(request===epoch&&selectedThread===thread){setMessages(previous?[...page.rows,...messages()]:page.rows);setOlder(page.hasMore);}}
    catch(cause){if(request===epoch&&selectedThread===thread)setError(cause instanceof Error?cause.message:t("web.alpha.error"));}
    finally{if(request===epoch&&selectedThread===thread)setBusy(false);}
  }
  const label=(key:string)=>t(`web.alpha.${key}`);
  const assistance = (row: Conversation) => (row.ai_assistance === true ? t("customize.ai_enabled") : row.ai_assistance === false ? t("customize.ai_paused") : t("customize.unknown"));
  return <section class="flex h-full min-h-0 min-w-0 flex-col overflow-hidden" data-alpha-inbox="">
    <Show when={props.demo}><p class="m-0 border-b border-border px-4 py-2 text-xs text-neutral-500">{label('demo_badge')} · {label('external_only')} <a class="ml-2 underline" href={`${import.meta.env.BASE_URL}inbox`}>{label('change_mode')}</a></p></Show>
    {/* Alfa: sin selector de cuenta; abre «Danil Workspace» si existe y si no la primera. */}
    <Show when={error()}><div role="alert" class="flex flex-wrap items-center gap-2 border-b border-border p-3"><p class="m-0 text-sm text-error-strong">{label('error')} {error()}</p><Button size="sm" variant="secondary" disabled={busy()} onClick={() => selected() ? void open(selected()!) : account() ? void load(account()!) : void connect()}>{t("customize.retry")}</Button></div></Show>
    <Show when={!props.demo && consent() && !busy() && !error() && accounts().length === 0}><p role="status" class="px-4 text-sm text-neutral-500">{t("customize.no_accounts")}</p></Show>
    <Show when={busy()}><p role="status" class="px-4 py-1 text-xs text-neutral-500">{label('loading')}</p></Show>
    <div class="flex min-h-0 flex-1 overflow-hidden">
      <div aria-label={t("customize.conversations")} class={`w-full shrink-0 overflow-y-auto border-r border-border md:w-72 ${selected()?'hidden md:block':''}`}>
        <div class="flex items-center justify-between border-b border-border px-3 py-2"><h2 class="m-0 text-xs font-semibold">{t("customize.conversations")}</h2><Badge forma="dato">{t("customize.read_only")}</Badge></div>
        <Show when={!busy() && !error() && (props.demo || account()) && rows().length === 0}><p role="status" class="p-4 text-sm text-neutral-500">{t("customize.page_empty")}</p></Show>
        <For each={rows()}>{row=><button type="button" aria-current={selected()?.id === row.id ? 'true' : undefined} class={`flex w-full items-start gap-3 border-b border-border px-3 py-3 text-left hover:bg-surface-muted focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary ${selected()?.id===row.id?'bg-surface-muted':''}`} onClick={()=>void open(row)}><span aria-hidden="true" class="grid size-8 shrink-0 place-items-center rounded-full bg-neutral-200 text-xs">{row.contact_name.slice(0,2).toUpperCase()}</span><span class="grid min-w-0 gap-1"><strong class="truncate text-sm">{row.contact_name}</strong><span class="truncate text-xs text-neutral-500">{row.last_message}</span><span class="flex flex-wrap items-center gap-1.5"><Badge forma="dato">{row.channel_name}</Badge><span class="text-xs text-neutral-500">{assistance(row)}</span></span></span><Show when={row.unread_count > 0}><Badge forma="dato" class="ml-auto shrink-0" aria-label={`${t("customize.unread")}: ${row.unread_count}`}>{row.unread_count}</Badge></Show></button>}</For>
        <Show when={more()}><Button class="m-3" size="sm" variant="secondary" disabled={busy()} onClick={()=>void load(account()!,true)}>{label('more')}</Button></Show>
      </div>
      <div class={`min-w-0 flex-1 flex-col ${selected()?'flex':'hidden md:flex'}`}><Show when={selected()} fallback={<p class="m-auto p-5 text-sm text-neutral-500">{label('select_conversation')}</p>}>{row=><>
        <div class="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2"><Button size="sm" variant="ghost" onClick={()=>{thread++;setSelected(undefined);setMessages([]);setOlder(false);setError('');setBusy(false);setDraft('');}}>{label('back')}</Button><div class="min-w-0 flex-1"><strong class="block truncate text-sm">{row().contact_name}</strong><span class="text-xs text-neutral-500">{row().channel_name} · {assistance(row())}</span></div><Button size="sm" variant="ghost" onClick={()=>setDetail(!detail())}>{label('details')}</Button></div>
        <Show when={detail()}><div class="border-b border-border bg-surface-muted p-4 text-sm"><p>{label('channel')}: {row().channel_name}</p><p>{label('notes_unavailable')}</p></div></Show>
        <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto bg-surface p-4"><Show when={older()}><Button size="sm" variant="ghost" onClick={()=>void open(row(),true)}>{label('older')}</Button></Show><For each={messages()}>{message=><div class={`max-w-[85%] rounded-xl border border-border p-3 ${message.direction==='outbound'?'ml-auto bg-surface-muted':'bg-surface'}`}><span class="text-xs text-neutral-500">{message.direction==='inbound'?row().contact_name:message.sender_type==='human-agent'?label('public_human'):message.sender_type==='ai-agent'?label('public_agent'):t("customize.unknown")}</span><p class="whitespace-pre-wrap text-sm">{message.deleted_at?label('deleted'):message.content||label('attachment')}</p></div>}</For></div>
        <div class="border-t border-border p-4"><p class="mb-2 text-xs text-neutral-500">{label('writes_unavailable')}</p><Show when={props.demo}><Textarea aria-label={label('draft')} placeholder={label('draft')} value={draft()} onInput={event=>setDraft(event.currentTarget.value)}/></Show><div class="mt-2 flex gap-2"><Button size="sm" disabled>{label('takeover')}</Button><Button size="sm" variant="secondary" disabled>{label('send')}</Button></div></div>
      </>}</Show></div>
    </div>
  </section>;
}
