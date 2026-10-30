import { createMemo, createSignal, For, Show } from 'solid-js';
import CalendarClock from 'lucide-solid/icons/calendar-clock';
import Pause from 'lucide-solid/icons/pause';
import Play from 'lucide-solid/icons/play';
import Square from 'lucide-solid/icons/square';
import UserPlus from 'lucide-solid/icons/user-plus';
import { actionsFor, buildingAudience, campaignProgress, summarizeFailures, type Campaign, type Recipient } from '../../../../../../packages/attention/src/broadcast-panel.ts';
import { t } from '../../../lib/i18n';
import { Button } from '../../../ui/Button';
import { Input } from '../../../ui/Input';
import { Skeleton } from '../../../ui/Skeleton';
import { AddContacts } from './AddContacts';
import { Confirm, Eyebrow, Note, StatusBadge, errorText, type Context } from './parts';
import { ProgressPanel } from './Progress';
import { createQuery } from './query';

const STATS_POLL = 3000;

export function CampaignDetail(props: { context: Context; campaign: Campaign; onChanged: () => void }) {
  const api = props.context.api;
  const id = props.campaign.id;
  const running = () => props.campaign.status === 'running';
  const stats = createQuery(() => api.stats(id), { poll: () => running() ? STATS_POLL : false, key: () => props.campaign.status, focus: true });
  const failed = () => stats.data() ? campaignProgress(stats.data()!).failed : 0;
  const recipients = createQuery(() => api.recipients(id), { enabled: () => failed() > 0 || buildingAudience(props.campaign.status) });
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [confirm, setConfirm] = createSignal<'start' | 'cancel' | null>(null);
  const [scheduling, setScheduling] = createSignal(false);
  const [when, setWhen] = createSignal('');
  const [adding, setAdding] = createSignal(false);
  const actions = () => actionsFor(props.campaign.status);
  const canDeliver = () => props.context.canWrite() && props.context.canOperate(props.campaign.channel_id);
  const canOperate = () => props.context.canOperate(props.campaign.channel_id);
  const emptyAudience = () => stats.data()?.total === 0;

  async function act(action: () => Promise<unknown>) {
    setBusy(true); setError(''); setConfirm(null);
    try { await action(); setScheduling(false); props.onChanged(); void stats.refresh(); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }

  return <section class="flex h-full min-h-0 min-w-0 flex-col overflow-hidden" aria-label={t("broadcasts.detail_of", { name: props.campaign.name })}>
    <header class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
      <div class="min-w-0">
        <Eyebrow>{t("broadcasts.broadcast")}</Eyebrow>
        <h2 class="m-0 mt-0.5 flex items-center gap-2 text-base"><span class="truncate">{props.campaign.name}</span><StatusBadge status={props.campaign.status}/></h2>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <Show when={actions().includes('start')}><Button size="sm" type="button" disabled={busy() || emptyAudience() || !canDeliver()} title={emptyAudience() ? t("broadcasts.empty_audience") : undefined} onClick={() => setConfirm('start')}><Play size={15}/>{props.campaign.status === 'scheduled' ? t("broadcasts.start_now") : t("broadcasts.start")}</Button></Show>
        <Show when={actions().includes('schedule')}><Button size="sm" variant="secondary" type="button" disabled={!canDeliver()} onClick={() => setScheduling(!scheduling())}><CalendarClock size={15}/>{t("broadcasts.schedule")}</Button></Show>
        <Show when={actions().includes('pause')}><Button size="sm" variant="secondary" type="button" disabled={busy() || !canOperate()} onClick={() => void act(() => api.pause(id))}><Pause size={15}/>{t("broadcasts.pause")}</Button></Show>
        <Show when={actions().includes('resume')}><Button size="sm" type="button" disabled={busy() || !canDeliver()} onClick={() => void act(() => api.resume(id))}><Play size={15}/>{t("broadcasts.resume")}</Button></Show>
        <Show when={actions().includes('cancel')}><Button size="sm" variant="danger" type="button" disabled={busy() || !canOperate()} onClick={() => setConfirm('cancel')}><Square size={14}/>{t("broadcasts.cancel_broadcast")}</Button></Show>
      </div>
    </header>
    <div class="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto p-4">
      <Show when={error()}><Note tone="danger">{t("broadcasts.action_error", { reason: error() })}</Note></Show>
      <Show when={confirm() === 'start'}><Confirm text={t("broadcasts.confirm_start", { count: stats.data()?.total ?? 0, account: props.context.accountName() })} action={t("broadcasts.confirm_start_action")} busy={busy()} onBack={() => setConfirm(null)} onConfirm={() => void act(() => api.start(id))}/></Show>
      <Show when={confirm() === 'cancel'}><Confirm text={t("broadcasts.confirm_cancel")} action={t("broadcasts.confirm_cancel_action")} danger busy={busy()} onBack={() => setConfirm(null)} onConfirm={() => void act(() => api.cancel(id))}/></Show>
      <Show when={scheduling() && actions().includes('schedule')}>
        <form class="flex flex-wrap items-end gap-2 rounded-md border border-border bg-surface-muted p-3" onSubmit={event => { event.preventDefault(); if (when()) void act(() => api.schedule(id, new Date(when()).toISOString())); }}>
          <label class="grid gap-1 text-[0.8rem] text-neutral-500">{t("broadcasts.schedule_at")}<Input type="datetime-local" class="w-auto" value={when()} onInput={event => setWhen(event.currentTarget.value)}/></label>
          <Button type="submit" size="sm" disabled={!when() || busy() || !canDeliver()}>{t("broadcasts.schedule")}</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setScheduling(false)}>{t("broadcasts.cancel")}</Button>
        </form>
      </Show>
      <Show when={!stats.data() && !stats.error()}><div class="grid grid-cols-2 gap-2"><Skeleton class="h-16" filas={2}/><Skeleton class="h-16" filas={2}/></div></Show>
      <Show when={stats.error() && !stats.data()}><Note tone="danger">{t("broadcasts.stats_error")} {stats.error()}</Note></Show>
      <Show when={stats.data()}>{value => <div class="grid gap-3">
        <Show when={failed() > 0}><FailureSummary failed={failed()} total={value().total} rows={recipients.data()} loading={!recipients.data() && !recipients.error()}/></Show>
        <ProgressPanel stats={value()} status={props.campaign.status}/>
      </div>}</Show>
      <Show when={buildingAudience(props.campaign.status)}>
        <Show when={adding()} fallback={<Button size="sm" variant="secondary" type="button" class="w-fit" onClick={() => setAdding(true)}><UserPlus size={15}/>{t("broadcasts.add_contacts")}</Button>}>
          <AddContacts context={props.context} campaignId={id} onClose={() => setAdding(false)} onAdded={() => { void stats.refresh(); void recipients.refresh(); }}/>
        </Show>
        <Audience total={stats.data()?.total ?? 0} rows={recipients.data()} error={recipients.error()}/>
      </Show>
    </div>
  </section>;
}

function FailureSummary(props: { failed: number; total: number; rows?: Recipient[]; loading: boolean }) {
  const reasons = createMemo(() => summarizeFailures(props.rows));
  const shown = () => reasons().reduce((sum, row) => sum + row.count, 0);
  const headline = () => props.failed < props.total ? t("broadcasts.failed_some", { failed: props.failed, total: props.total }) : props.total === 1 ? t("broadcasts.failed_one") : t("broadcasts.failed_all", { total: props.total });
  return <Note tone="danger">
    <div class="grid gap-1">
      <strong>{headline()}</strong>
      <Show when={props.loading}><span>{t("broadcasts.loading_reason")}</span></Show>
      <Show when={!props.loading}>
        <Show when={reasons().length > 0} fallback={<span>{t("broadcasts.review_numbers")}</span>}>
          <ul class="m-0 grid list-none gap-1 p-0">
            <For each={reasons()}>{row => <li class="grid gap-0.5">
              <div class="flex gap-2"><span class="shrink-0 font-mono tabular-nums">{row.count}×</span><span>{row.code ? t(`broadcasts.meta_${row.code}`) : row.text || t("broadcasts.meta_generic")}</span></div>
              <Show when={row.raw}><details class="ml-6 text-neutral-500"><summary class="cursor-pointer">{t("broadcasts.technical_details")}</summary><pre class="m-0 mt-1 max-h-32 overflow-auto rounded-sm bg-surface-muted p-2 text-[0.7rem] break-all whitespace-pre-wrap text-neutral-700">{row.raw}</pre></details></Show>
            </li>}</For>
          </ul>
          <Show when={shown() < props.failed}><span class="text-neutral-500">{t("broadcasts.reasons_partial", { shown: shown(), failed: props.failed })}</span></Show>
        </Show>
      </Show>
    </div>
  </Note>;
}

function Audience(props: { total: number; rows?: Recipient[]; error: string }) {
  const rows = () => props.rows ?? [];
  return <div class="rounded-md border border-border bg-surface p-3">
    <div class="flex items-baseline justify-between"><Eyebrow>{t("broadcasts.audience")}</Eyebrow><Show when={rows().length > 0}><span class="font-mono text-[0.82rem] text-neutral-950 tabular-nums">{props.total}</span></Show></div>
    <Show when={props.error}><p role="alert" class="m-0 mt-1 text-[0.82rem] text-error-strong">{props.error}</p></Show>
    <Show when={!props.rows && !props.error}><div class="mt-2"><Skeleton class="h-16"/></div></Show>
    <Show when={props.rows && rows().length === 0}><p class="m-0 mt-1 text-[0.82rem] text-neutral-500">{t("broadcasts.audience_empty")}</p></Show>
    <Show when={rows().length > 0}>
      <ul class="m-0 mt-2 grid max-h-56 list-none content-start gap-0.5 overflow-auto p-0">
        <For each={rows()}>{row => <li class="flex items-center justify-between gap-2 px-1 py-1 text-[0.85rem]">
          <span class="truncate">{row.name || row.phone || t("broadcasts.contact_fallback", { id: row.contact_account_id })}<Show when={row.name && row.phone}><span class="text-neutral-500"> · {row.phone}</span></Show></span>
          <span class="shrink-0 rounded-sm bg-surface-muted px-1.5 py-0.5 text-[0.72rem] text-neutral-700">{row.status}</span>
        </li>}</For>
      </ul>
      <Show when={props.total > rows().length}><p class="m-0 mt-2 text-[0.76rem] text-neutral-500">{t("broadcasts.showing_of", { shown: rows().length, total: props.total })}</p></Show>
    </Show>
  </div>;
}
