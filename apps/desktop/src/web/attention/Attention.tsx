import ArrowLeft from 'lucide-solid/icons/arrow-left';
import ChevronDown from 'lucide-solid/icons/chevron-down';
import Inbox from 'lucide-solid/icons/inbox';
import Settings from 'lucide-solid/icons/settings';
import { createSignal, For, onCleanup, Show } from 'solid-js';
import { type Account, type Conversation, createInbox, type Message } from '../../../../../packages/attention/src/inbox.ts';
import AgentDock from '../../features/shell/AgentDock';
import { t } from '../../lib/i18n';
import { Button } from '../../ui/Button';
import { supabaseSession } from '../session';

type View = 'inbox' | 'settings' | 'agent' | 'spaces' | 'integrations';
export function Attention(props: { settings: { supabaseUrl: string; supabaseKey: string; login: string } }) {
  const [mode, setMode] = createSignal<'none' | 'demo' | 'live'>('none');
  const [view, setView] = createSignal<View>('inbox');
  const [accounts, setAccounts] = createSignal<Account[]>([]);
  const [account, setAccount] = createSignal<number>();
  const [rows, setRows] = createSignal<Conversation[]>([]);
  const [selected, setSelected] = createSignal<Conversation>();
  const [messages, setMessages] = createSignal<Message[]>([]);
  const [more, setMore] = createSignal(false);
  const [older, setOlder] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [notice, setNotice] = createSignal('');
  const [draft, setDraft] = createSignal('');
  const [detail, setDetail] = createSignal(false);
  const [plugins, setPlugins] = createSignal(false);
  let epoch = 0;
  let threadEpoch = 0;
  const reset = () => {
    epoch++; threadEpoch++; setAccount(undefined); setRows([]); setSelected(undefined); setMessages([]); setMore(false); setOlder(false); setError(''); setBusy(false); setDraft(''); setDetail(false); setPlugins(false); setView('inbox');
  };
  const session = supabaseSession(props.settings.supabaseUrl, props.settings.supabaseKey, { onGone: () => { reset(); setAccounts([]); setMode('none'); } });
  const api = createInbox(session);
  let userId: string | undefined;
  const subscription = session.client.auth.onAuthStateChange((event, value) => {
    const next = value?.user.id;
    if (event === 'SIGNED_OUT' || (userId && next !== userId)) { reset(); setAccounts([]); setMode('none'); }
    userId = next;
  });
  onCleanup(() => { epoch++; threadEpoch++; subscription.data.subscription.unsubscribe(); });
  async function connect() {
    const attempt = ++epoch;
    const current = await session.client.auth.getSession();
    if (attempt !== epoch) return;
    if (!current.data.session) { reset(); setMode('none'); setNotice(t('web.alpha.session_required')); return; }
    setNotice('');
    reset(); setMode('live'); setAccounts([]); setBusy(true);
    const request = epoch;
    try { const value = await api.accounts(); if (request === epoch) setAccounts(value); }
    catch (err) { if (request === epoch) setError(err instanceof Error ? err.message : t('web.alpha.error')); }
    finally { if (request === epoch) setBusy(false); }
  }
  function demo() {
    reset(); setNotice(''); setAccounts([]); setMode('demo');
    setRows([1, 2, 3].map((id) => ({ id, account_id: 1, contact_name: t(`web.alpha.contact${id}`), channel_name: id === 2 ? 'Web' : 'WhatsApp', last_message: t(`web.alpha.preview${id}`), ai_assistance: id !== 1, unread_count: id === 1 ? 2 : 0 })));
  }
  async function load(id: number, append = false) {
    if (!append) { reset(); setAccount(id); }
    const request = epoch; setBusy(true); setError('');
    try { const page = await api.conversations(id, append ? rows().length : 0); if (request === epoch) { setRows(append ? [...rows(), ...page.rows] : page.rows); setMore(page.hasMore); } }
    catch (err) { if (request === epoch) setError(err instanceof Error ? err.message : t('web.alpha.error')); }
    finally { if (request === epoch) setBusy(false); }
  }
  async function open(row: Conversation, previous = false) {
    if (!previous) { threadEpoch++; setSelected(row); setMessages([]); setDraft(''); setOlder(false); setDetail(false); }
    if (mode() === 'demo') { setMessages([{ id: 1, conversation_id: row.id, content: row.last_message, direction: 'inbound', sender_type: 'contact' }, { id: 2, conversation_id: row.id, content: t('web.alpha.sample_reply'), direction: 'outbound', sender_type: 'ai-agent' }]); return; }
    const request = epoch; const thread = threadEpoch; setError(''); setBusy(true);
    try { const page = await api.messages(account() as number, row.id, previous ? messages()[0]?.id : undefined); if (request === epoch && thread === threadEpoch) { setMessages(previous ? [...page.rows, ...messages()] : page.rows); setOlder(page.hasMore); } }
    catch (err) { if (request === epoch && thread === threadEpoch) setError(err instanceof Error ? err.message : t('web.alpha.error')); }
    finally { if (request === epoch && thread === threadEpoch) setBusy(false); }
  }
  const label = (name: string) => t(`web.alpha.${name}`);
  return <main class="flex h-dvh min-h-0 flex-col bg-bg text-neutral-950" data-alpha="">
    <header class="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3">
      <a href={import.meta.env.BASE_URL} class="font-display text-xl font-bold">Terminus</a>
      <span class="rounded-md bg-surface-muted px-2 py-1 text-xs text-warning-strong">{label('alpha')}</span>
      <span class="text-xs text-neutral-500">{mode() === 'demo' ? label('demo_badge') : mode() === 'live' ? label('live_badge') : label('choose_mode')}</span>
      <Show when={mode() === 'live'}><Button size="sm" variant="ghost" onClick={() => { reset(); setAccounts([]); setMode('none'); void session.client.auth.signOut({scope: 'local'}).catch(() => setError(label('error'))); }}>{label('signout')}</Button></Show>
      <Button class="ml-auto" size="sm" variant="ghost" onClick={() => { reset(); setAccounts([]); setMode('none'); }}>{label('change_mode')}</Button>
      <a class="text-xs text-primary" href={`${import.meta.env.BASE_URL}m/inbox`}>{t('web.phone_layout')}</a>
    </header>
    <div class="flex min-h-0 flex-1">
      <aside class="hidden w-60 shrink-0 flex-col border-r border-border bg-surface-muted md:flex" aria-label={label('workspace_navigation')}>
        <div class="border-b border-border p-4">
          <p class="truncate text-sm font-semibold">{mode() === 'demo' ? label('demo_workspace') : label('no_workspace')}</p>
          <Show when={mode() === 'demo'} fallback={<p class="mt-2 text-xs text-neutral-500">{label('engine_context')}</p>}>
            <Button class="mt-2 w-full justify-between" size="sm" variant="ghost" onClick={() => setView('spaces')}>{label('demo_space')}<ChevronDown size={14}/></Button>
          </Show>
        </div>
        <div class="flex min-h-0 flex-1 flex-col gap-1 p-3">
          <Button class="justify-start" size="sm" variant={view() === 'inbox' ? 'secondary' : 'ghost'} onClick={() => setView('inbox')}><Inbox size={16}/>{label('inbox')}</Button>
          <a class="rounded-md px-3 py-2 text-sm text-neutral-500 hover:bg-neutral-200 focus-visible:outline-2 focus-visible:outline-primary" href={import.meta.env.BASE_URL}>{label('tasks')}</a>
          <p class="mt-3 px-3 text-xs text-neutral-500">{label('private_context')}</p>
        </div>
        <Show when={mode() === 'demo'}>
          <div class="border-t border-border p-3"><p class="mb-2 text-xs text-neutral-500">{label('demo_dock')}</p><AgentDock agents={[{name: 'atencion-demo', status: 'asleep', liveTasks: 0}]} selected={null} foldersOf={() => [{ id: 'demo', name: label('demo_space') }]} currentFolder="demo" onTalk={() => setView('agent')} onShowTasks={() => setView('inbox')} onProfile={() => setView('agent')} onSeeAll={() => setView('settings')}/></div>
        </Show>
        <Button class="m-3 justify-start" size="sm" variant="ghost" onClick={() => setView('settings')}><Settings size={16}/>{label('settings')}</Button>
      </aside>
      <div class="flex min-w-0 flex-1 flex-col">
        <div class="flex items-center gap-2 border-b border-border px-4 py-2 md:hidden"><Button size="sm" variant="ghost" onClick={() => setView('inbox')}>{label('inbox')}</Button><Button size="sm" variant="ghost" onClick={() => setView('settings')}>{label('settings')}</Button></div>
    <Show when={mode() !== 'none'} fallback={<section class="mx-auto flex max-w-2xl flex-col gap-5 p-8"><h1 class="font-display text-3xl font-bold">{label('welcome')}</h1><p>{label('intro')}</p><Show when={notice()}><p role="status" class="text-sm text-warning-strong">{notice()}</p></Show><p class="text-sm text-warning-strong">{label('validation_warning')}</p><p class="text-sm text-warning-strong">{label('production_warning')}</p><div class="flex flex-wrap gap-3"><Button onClick={() => void connect()}>{label('connect')}</Button><Button variant="secondary" onClick={demo}>{label('demo')}</Button><Button as="a" href={props.settings.login} variant="ghost">{label('signin')}</Button></div></section>}>
      <Show when={mode() === 'live'}><div class="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3"><label class="text-sm">{label('account')} <select class="ml-2 rounded-md border border-border bg-surface px-2 py-1" value={account() ?? ''} onChange={e => { if (e.currentTarget.value) void load(Number(e.currentTarget.value)); }}><option value="">{label('select_account')}</option><For each={accounts()}>{a => <option value={a.id}>{a.name || String(a.id)} · {a.id}</option>}</For></select></label><Show when={account()}><Button size="sm" variant="secondary" disabled={busy()} onClick={() => void load(account() as number)}>{label('refresh')}</Button></Show><Show when={!busy() && accounts().length === 0 && !error()}><p class="text-sm">{label('no_accounts')}</p></Show></div></Show>
      <Show when={error()}><div role="alert" class="border-b border-border px-5 py-3 text-sm text-error-strong">{label('error')} {error()} <Button size="sm" variant="ghost" onClick={() => void connect()}>{label('retry')}</Button><a class="ml-3 underline" href={props.settings.login}>{label('signin')}</a></div></Show>
      <Show when={busy()}><p role="status" class="px-5 py-2 text-xs text-neutral-500">{label('loading')}</p></Show>
      <Show when={view() === 'inbox'}>
        <div class="flex min-h-0 flex-1 overflow-hidden">
          <aside class={`w-full shrink-0 overflow-y-auto border-r border-border md:w-80 ${selected() ? 'hidden md:block' : ''}`}>
            <h1 class="px-5 py-4 text-lg font-semibold">{label('inbox')}</h1><p class="px-5 pb-4 text-xs text-neutral-500">{label('external_only')}</p>
            <For each={rows()}>{row => <button type="button" class={`flex w-full flex-col gap-2 border-b border-border px-5 py-4 text-left hover:bg-surface-muted ${selected()?.id === row.id ? 'bg-surface-muted' : ''}`} onClick={() => void open(row)}><span class="flex items-center gap-2 font-semibold"><span aria-hidden="true" class="grid size-8 shrink-0 place-items-center rounded-full bg-neutral-200 text-xs">{(row.contact_name || String(row.id)).slice(0,2).toUpperCase()}</span>{row.contact_name || String(row.id)}<Show when={row.unread_count}><span class="text-xs text-primary">{row.unread_count}</span></Show></span><span class="text-xs text-neutral-500">{row.channel_name} · {row.ai_assistance ? label('automation') : label('human')}</span><span class="truncate text-sm text-neutral-500">{row.last_message}</span></button>}</For>
            <Show when={!rows().length && !busy()}><p class="px-5 py-6 text-sm text-neutral-500">{account() ? label('empty') : label('select_account')}</p></Show>
            <Show when={more()}><Button class="m-4" size="sm" variant="secondary" disabled={busy()} onClick={() => void load(account() as number, true)}>{label('more')}</Button></Show>
          </aside>
          <section class={`min-w-0 flex-1 flex-col ${selected() ? 'flex' : 'hidden md:flex'}`}>
            <Show when={selected()} fallback={<p class="m-auto p-6 text-neutral-500">{label('select_conversation')}</p>}>{row => <>
              <div class="flex items-center gap-3 border-b border-border px-5 py-3"><Button variant="ghost" size="iconCompact" onClick={() => { threadEpoch++; setSelected(undefined); setMessages([]); setOlder(false); setError(''); setBusy(false); setDraft(''); }} aria-label={label('back')}><ArrowLeft size={18}/></Button><strong class="min-w-0 flex-1 truncate">{row().contact_name}</strong><Button size="sm" variant="ghost" onClick={() => setDetail(!detail())}>{label('details')}</Button></div>
              <Show when={detail()}><div class="border-b border-border bg-surface-muted p-5 text-sm"><p>{label('channel')}: {row().channel_name}</p><p>{label('authority')}</p><p>{label('notes_unavailable')}</p></div></Show>
              <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5"><Show when={older()}><Button size="sm" variant="ghost" disabled={busy()} onClick={() => void open(row(), true)}>{label('older')}</Button></Show><For each={messages()}>{message => <div class={`max-w-[85%] rounded-xl border border-border px-4 py-3 ${message.direction === 'outbound' ? 'ml-auto bg-surface-muted' : 'bg-surface'}`}><span class="mb-2 block text-xs text-neutral-500">{message.direction === 'inbound' ? row().contact_name : label(message.sender_type === 'human-agent' ? 'public_human' : 'public_agent')}</span><p class="whitespace-pre-wrap text-sm">{message.deleted_at ? label('deleted') : message.content || label('attachment')}</p></div>}</For></div>
              <div class="border-t border-border p-4"><p class="mb-3 text-xs text-neutral-500">{label('writes_unavailable')}</p><Show when={mode() === 'demo'}><textarea class="w-full resize-none rounded-md border border-border bg-surface p-3 text-sm" aria-label={label('draft')} placeholder={label('draft')} value={draft()} onInput={e => setDraft(e.currentTarget.value)}/></Show><div class="mt-2 flex gap-2"><Button size="sm" disabled>{label('takeover')}</Button><Button size="sm" variant="secondary" disabled>{label('send')}</Button></div></div>
            </>}</Show>
          </section>
        </div>
      </Show>
      <Show when={view() !== 'inbox'}><section class="mx-auto w-full max-w-3xl overflow-y-auto p-6"><h1 class="font-display text-2xl font-bold">{label(view())}</h1><p class="mt-3 text-sm text-neutral-500">{label('configuration_unavailable')}</p>
        <Show when={view() === 'settings'}><div class="mt-6 flex flex-col gap-3"><Button variant="secondary" onClick={() => setView('agent')}>{label('agents')}</Button><Button variant="secondary" onClick={() => setView('integrations')}>{label('integrations')}</Button></div></Show>
        <Show when={view() === 'agent'}><div class="mt-6 grid gap-5"><h2 class="text-xl font-semibold">{label('service_agent')}</h2><For each={['scope','knowledge','tools','schedule','host']}>{field => <label class="flex flex-col gap-2 text-sm">{label(field)}<textarea disabled={mode() !== 'demo'} class="rounded-md border border-border bg-surface p-3" placeholder={label(`${field}_hint`)}/></label>}</For><Button disabled>{label('publish')}</Button></div></Show>
        <Show when={view() === 'spaces'}><div class="mt-6 flex flex-col gap-5"><p>{label('spaces_description')}</p><For each={['inbox','tasks','integrations']}>{name => <label class="flex gap-3"><input type="checkbox" disabled={mode() !== 'demo'} checked/>{label(name)}</label>}</For><label class="flex gap-3"><input type="checkbox" disabled={mode() !== 'demo'} checked={plugins()} onChange={e => setPlugins(e.currentTarget.checked)}/>{label('crm')}</label><p class="text-xs text-neutral-500">{label('spaces_boundary')}</p></div></Show>
        <Show when={view() === 'integrations'}><div class="mt-6 flex flex-col gap-4"><p>{label('channels_description')}</p><For each={['WhatsApp','Web','Instagram']}>{channel => <div class="flex items-center justify-between rounded-lg border border-border bg-surface p-4"><span>{channel}</span><span class="text-xs text-neutral-500">{label('not_connected')}</span></div>}</For></div></Show>
      </section></Show>
    </Show>
      </div>
    </div>
  </main>;
}
