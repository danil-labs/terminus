import { For, Show } from 'solid-js';
import CheckCheck from 'lucide-solid/icons/check-check';
import { campaignProgress, nothingReachedMeta, sendsDone, type CampaignStats, type CampaignStatus } from '../../../../../../packages/attention/src/broadcast-panel.ts';
import { t } from '../../../lib/i18n';
import { ProgressBar } from '../../../ui/ProgressBar';
import { Eyebrow } from './parts';

/** Conteos, avance y embudo; una sola lectura de `/stats` alimenta los tres. */
export function ProgressPanel(props: { stats: CampaignStats; status: CampaignStatus }) {
  const counts = () => campaignProgress(props.stats);
  const cards = () => [
    [t("broadcasts.pending"), counts().pending], [t("broadcasts.sent"), counts().sent], [t("broadcasts.delivered"), counts().delivered],
    [t("broadcasts.failed"), counts().failed], [t("broadcasts.read"), counts().read], [t("broadcasts.responded"), counts().responded],
  ] as const;
  const funnel = () => [
    [t("broadcasts.sent"), counts().sent, false], [t("broadcasts.delivered"), counts().delivered, false], [t("broadcasts.read"), counts().read, false],
    [t("broadcasts.responded"), counts().responded, false], [t("broadcasts.failed"), counts().failed, true],
  ] as const;
  const widest = () => Math.max(1, ...funnel().map(row => row[1]));
  return <div class="@container grid gap-3">
    <Show when={sendsDone(props.stats, props.status)}><p role="status" class="m-0 flex w-fit items-center gap-1.5 rounded-full bg-surface-muted px-2.5 py-1 text-[0.76rem] font-medium text-neutral-700"><CheckCheck size={13} aria-hidden="true"/>{t("broadcasts.sends_done")}</p></Show>
    <div class="grid grid-cols-2 gap-2 @[28rem]:grid-cols-3 @[52rem]:grid-cols-6">
      <For each={cards()}>{card => <div class="grid gap-0.5 rounded-md border border-border bg-surface p-3"><strong class="text-lg text-neutral-950 tabular-nums">{card[1]}</strong><span class="text-[0.76rem] text-neutral-500">{card[0]}</span></div>}</For>
    </div>
    <div class="grid gap-1.5">
      <ProgressBar value={counts().processed} max={counts().total} label={t("broadcasts.progress")} barClass="bg-primary"/>
      <p class="m-0 text-[0.76rem] text-neutral-500"><span class="font-mono tabular-nums">{t("broadcasts.processed", { done: counts().processed, total: counts().total })}</span></p>
    </div>
    <Show when={counts().total > 0}>
      <div class="grid gap-2 rounded-md border border-border bg-surface p-3">
        <Eyebrow>{t("broadcasts.funnel")}</Eyebrow>
        <Show when={nothingReachedMeta(props.stats)}><p class="m-0 text-[0.82rem] text-neutral-500">{t("broadcasts.nothing_reached_meta")}</p></Show>
        <div class="grid gap-1.5">
          <For each={funnel()}>{row => <div class="grid grid-cols-[6rem_minmax(0,1fr)_3rem] items-center gap-2 text-[0.78rem]">
            <span class="truncate text-neutral-700">{row[0]}</span>
            <span class="h-3.5 min-w-0 rounded-sm bg-surface-muted"><span class={`block h-full rounded-sm transition-[width] duration-300 ${row[2] ? 'bg-error-strong' : 'bg-primary'}`} style={{ width: `${(row[1] / widest()) * 100}%` }}/></span>
            <span class="text-right font-mono text-neutral-950 tabular-nums">{row[1]}</span>
          </div>}</For>
        </div>
      </div>
    </Show>
  </div>;
}
