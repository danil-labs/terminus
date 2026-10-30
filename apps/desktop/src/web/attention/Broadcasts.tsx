import { createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import ArrowLeft from 'lucide-solid/icons/arrow-left';
import Plus from 'lucide-solid/icons/plus';
import { canManageBroadcast, createBroadcastPanel, type BroadcastPanel, type BroadcastSource, type StatusOut } from '../../../../../packages/attention/src/broadcast-panel.ts';
import { t } from '../../lib/i18n';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { Input } from '../../ui/Input';
import { Skeleton } from '../../ui/Skeleton';
import { CampaignDetail } from './broadcasts/CampaignDetail';
import { CreateCampaign } from './broadcasts/CreateCampaign';
import { FeatureGate } from './broadcasts/Gate';
import { Note, RowButton, StatusBadge, type Context } from './broadcasts/parts';
import { createQuery } from './broadcasts/query';
import { TemplateEditor, TemplateList } from './broadcasts/Templates';

const CAMPAIGNS_POLL = 8000;

/** Sesión, transporte y cuenta los pone la capability: esta vista no sabe en qué cliente corre. */
export function Broadcasts(props: { source?: BroadcastSource }) {
  const source = props.source;
  const api = source ? createBroadcastPanel(source) : null;
  const [generation, setGeneration] = createSignal(1);
  onMount(() => {
    const stop = source?.session.subscribe?.(() => setGeneration(value => value + 1));
    if (stop) onCleanup(stop);
  });
  return <Show when={source && api} fallback={<div class="p-4"><Note tone="danger">{t("web.alpha.session_required")}</Note></div>}>
    <Show when={generation()} keyed>{_ => <Workspace api={api!} source={source!}/>}</Show>
  </Show>;
}

function Workspace(props: { api: BroadcastPanel; source: BroadcastSource }) {
  const api = props.api;
  // Las funciones y los permisos se muestran mientras no se sepan: el servidor es quien rechaza.
  const access = createQuery(async () => {
    const account = await props.source.account();
    if (account === null) return { account: null, name: null, features: null, permissions: null };
    const [name, features, permissions] = await Promise.all([api.account(account).catch(() => null), api.features(account).catch(() => null), api.permissions(account).catch(() => null)]);
    return { account, name, features, permissions };
  }, { focus: true });
  const gated = () => { const features = access.data()?.features; return !!features && !features.includes('campaigns'); };
  const canOperate = (channel: number | null) => canManageBroadcast(access.data()?.permissions ?? null, channel);
  const manage = () => access.data()?.permissions?.permissions.includes('campaigns.manage') ?? false;
  const accountName = () => { const value = access.data(); return value?.name || t("broadcasts.account_fallback", { id: value?.account ?? 0 }); };
  const context: Context = { api, canWrite: () => api.writes && manage(), canManage: manage, canOperate, accountName };
  return <section class="@container flex h-full min-h-0 min-w-0 flex-col overflow-hidden" data-broadcasts="" aria-label={t("broadcasts.title")}>
    <Show when={props.source.demo}><p class="m-0 border-b border-border px-4 py-2 text-xs text-neutral-500">{t("web.alpha.demo_badge")} · {t("broadcasts.demo_note")}</p></Show>
    <Show when={!api.writes}><p role="note" class="m-0 border-b border-border bg-surface-muted px-4 py-2 text-xs text-neutral-500">{t("broadcasts.writes_off")}</p></Show>
    <Show when={access.data()} fallback={<Show when={access.error()} fallback={<div class="p-4"><Skeleton class="h-14 rounded-md" filas={4}/></div>}><div class="p-4"><Note tone="danger">{access.error()}</Note></div></Show>}>{value =>
      <Show when={value().account} keyed fallback={<div class="p-4"><Note tone="warning">{t("broadcasts.no_active_account")}</Note></div>}>{account => <>
        <p class="m-0 shrink-0 truncate border-b border-border px-4 py-1.5 text-xs text-neutral-500" data-broadcast-account="" title={t("broadcasts.account_hint")}>{t("broadcasts.viewing_account", { name: accountName() })}</p>
        <Show when={!gated()} fallback={<FeatureGate context={context} account={account}/>}><Panes context={context}/></Show>
      </>}</Show>
    }</Show>
  </section>;
}

function Panes(props: { context: Context }) {
  const api = props.context.api;
  const campaigns = createQuery(() => api.campaigns(), { focus: true, poll: rows => rows?.some(row => row.status === 'running' || row.status === 'scheduled') ? CAMPAIGNS_POLL : false });
  const [mode, setMode] = createSignal<'campaigns' | 'templates'>('campaigns');
  const templates = createQuery(() => api.templates(false), { enabled: () => mode() === 'templates' });
  const [query, setQuery] = createSignal('');
  const [selected, setSelected] = createSignal<number | null>(null);
  const [creating, setCreating] = createSignal(false);
  const [templateId, setTemplateId] = createSignal<number | null>(null);
  const [newTemplate, setNewTemplate] = createSignal(false);
  const campaign = createMemo(() => campaigns.data()?.find(row => row.id === selected()));
  const statusLabel = (value: string) => t(`broadcasts.status_${value}`);
  const rows = () => {
    const needle = query().trim().toLowerCase();
    return (campaigns.data() ?? []).filter(row => !needle || row.name.toLowerCase().includes(needle) || statusLabel(row.status).toLowerCase().includes(needle));
  };
  const open = () => mode() === 'templates' ? newTemplate() || templateId() !== null : creating() || selected() !== null;
  function back() { setCreating(false); setSelected(null); setNewTemplate(false); setTemplateId(null); }
  function switchMode(next: 'campaigns' | 'templates') { back(); setQuery(''); setMode(next); }
  function created(row: StatusOut | null) { setCreating(false); if (row) { setSelected(row.id); void campaigns.refresh(); } }
  const canCreate = () => mode() === 'templates' ? props.context.canWrite() : props.context.canManage();
  const startNew = () => { back(); if (mode() === 'templates') setNewTemplate(true); else setCreating(true); };
  return <div class="flex min-h-0 flex-1 overflow-hidden @[46rem]:grid @[46rem]:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
    <section aria-label={t("broadcasts.title")} class={`min-h-0 w-full min-w-0 flex-col overflow-hidden @[46rem]:flex @[46rem]:border-r @[46rem]:border-border ${open() ? 'hidden' : 'flex'}`}>
      <header class="flex min-h-11 w-full min-w-0 shrink-0 items-center gap-2 border-b border-border px-3 py-1">
        <span class="min-w-0 flex-1 truncate text-[0.85rem] font-semibold text-neutral-950">{mode() === 'templates' ? t("broadcasts.templates") : t("broadcasts.title")}</span>
        <Button size="sm" variant="secondary" type="button" disabled={!canCreate()} onClick={startNew}><Plus size={15}/>{mode() === 'templates' ? t("broadcasts.new_template_short") : t("broadcasts.new_broadcast_short")}</Button>
      </header>
      <div class="grid w-full min-w-0 shrink-0 gap-2 border-b border-border px-3 py-2">
        <Input value={query()} aria-label={mode() === 'templates' ? t("broadcasts.search_templates") : t("broadcasts.search_broadcasts")} placeholder={mode() === 'templates' ? t("broadcasts.search_templates") : t("broadcasts.search_broadcasts")} onInput={event => setQuery(event.currentTarget.value)}/>
        <div role="group" aria-label={t("broadcasts.view_label")} class="flex flex-wrap items-center gap-1.5">
          <For each={['campaigns', 'templates'] as const}>{value => <Button type="button" size="compact" variant={mode() === value ? 'primary' : 'secondary'} aria-pressed={mode() === value} onClick={() => switchMode(value)}>{value === 'campaigns' ? t("broadcasts.title") : t("broadcasts.templates")}</Button>}</For>
        </div>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto p-2">
        <Show when={mode() === 'campaigns'} fallback={<TemplateList context={props.context} templates={templates} query={query()} selected={templateId()} onOpen={id => { setNewTemplate(false); setTemplateId(id); }}/>}>
          <Show when={!campaigns.data() && !campaigns.error()}><Skeleton class="h-12 rounded-md" filas={4}/></Show>
          <Show when={campaigns.error()}><div class="grid gap-2 p-1"><Note tone="danger">{t("broadcasts.list_error")} {campaigns.error()}</Note><Button size="sm" variant="secondary" class="justify-self-start" onClick={() => void campaigns.refresh()}>{t("customize.retry")}</Button></div></Show>
          <Show when={campaigns.data()?.length === 0}><EmptyState title={t("broadcasts.empty_title")} description={t("broadcasts.empty_hint")}/></Show>
          <Show when={(campaigns.data()?.length ?? 0) > 0 && rows().length === 0}><p role="status" class="m-0 p-4 text-center text-[0.85rem] text-neutral-500">{t("broadcasts.search_empty", { query: query().trim() })}</p></Show>
          <ul class="m-0 grid list-none content-start gap-1 p-0">
            <For each={rows()}>{row => <li class="min-w-0"><RowButton active={selected() === row.id && !creating()} onClick={() => { setCreating(false); setSelected(row.id); }}><strong class="min-w-0 truncate text-[0.88rem] font-semibold text-neutral-950">{row.name}</strong><StatusBadge status={row.status}/></RowButton></li>}</For>
          </ul>
        </Show>
      </div>
    </section>
    <div class={`min-h-0 min-w-0 flex-1 flex-col overflow-hidden @[46rem]:flex ${open() ? 'flex' : 'hidden'}`}>
      <div class="shrink-0 px-2 pt-2 @[46rem]:hidden"><Button size="sm" variant="ghost" type="button" onClick={back}><ArrowLeft size={14}/>{mode() === 'templates' ? t("broadcasts.templates") : t("broadcasts.title")}</Button></div>
      <Show when={mode() === 'campaigns'} fallback={
        <Show when={newTemplate() || templateId() !== null} fallback={<div class="grid h-full place-items-center p-6"><EmptyState title={t("broadcasts.pick_template")} description={t("broadcasts.pick_template_hint")}/></div>}>
          <div class="min-h-0 flex-1 overflow-y-auto p-4"><Show when={newTemplate() ? 'new' : templateId()} keyed><TemplateEditor context={props.context} templateId={newTemplate() ? null : templateId()} onDone={back} onChanged={() => void templates.refresh()}/></Show></div>
        </Show>
      }>
        <Show when={creating()} fallback={
          <Show when={selected() !== null} fallback={<div class="grid h-full place-items-center p-6"><EmptyState title={t("broadcasts.pick_broadcast")} description={t("broadcasts.pick_broadcast_hint")}/></div>}>
            <Show when={campaign()?.id} keyed fallback={<Show when={campaigns.data()}><div class="p-4"><EmptyState title={t("broadcasts.not_found")} description={t("broadcasts.not_found_hint")}/></div></Show>}>
              <div class="min-h-0 flex-1"><CampaignDetail context={props.context} campaign={campaign()!} onChanged={() => void campaigns.refresh()}/></div>
            </Show>
          </Show>
        }><div class="min-h-0 flex-1 overflow-y-auto p-4"><CreateCampaign context={props.context} onDone={created}/></div></Show>
      </Show>
    </div>
  </div>;
}
