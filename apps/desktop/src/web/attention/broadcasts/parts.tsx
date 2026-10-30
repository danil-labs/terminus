import { Show, type JSX } from 'solid-js';
import type { Broadcasts, CampaignStatus, Template } from '../../../../../../packages/attention/src/broadcasts.ts';
import { t } from '../../../lib/i18n';
import { Badge } from '../../../ui/Badge';
import { Button } from '../../../ui/Button';

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';
export const STATUS_TONE: Record<CampaignStatus, Tone> = { draft: 'neutral', scheduled: 'info', running: 'success', paused: 'warning', cancelled: 'danger', completed: 'success', failed: 'danger' };
const TEMPLATE_TONE: Record<string, Tone> = { DRAFT: 'neutral', APPROVED: 'success', PENDING: 'warning', REJECTED: 'danger', DELETED: 'neutral' };

/** Lo que toda vista de Difusiones recibe: el cliente y si esta persona puede escribir aquí. */
export type Context = { api: Broadcasts; canWrite: () => boolean; accountName: () => string };

export const errorText = (cause: unknown) => !(cause instanceof Error) ? t("web.alpha.error") : cause.message === 'writes_disabled' ? t("broadcasts.writes_off") : cause.message;

export function StatusBadge(props: { status: CampaignStatus }) {
  return <Badge tone={STATUS_TONE[props.status]}>{t(`broadcasts.status_${props.status}`)}</Badge>;
}

export function TemplateBadge(props: { template: Template }) {
  const known = () => Object.hasOwn(TEMPLATE_TONE, props.template.status);
  return <Badge tone={TEMPLATE_TONE[props.template.status] ?? 'neutral'} title={props.template.status === 'REJECTED' ? props.template.rejection_reason ?? undefined : undefined}>{known() ? t(`broadcasts.template_status_${props.template.status}`) : props.template.status}</Badge>;
}

const NOTE: Record<Tone, string> = { neutral: 'border-border text-neutral-700', info: 'border-border text-neutral-700', success: 'border-current text-success-strong', warning: 'border-current text-warning-strong', danger: 'border-current text-error-strong' };
export function Note(props: { tone?: Tone; children: JSX.Element }) {
  const tone = () => props.tone ?? 'neutral';
  return <div role={tone() === 'danger' || tone() === 'warning' ? 'alert' : 'status'} class={`m-0 rounded-md border px-3 py-2 text-[0.82rem] leading-relaxed ${NOTE[tone()]}`}>{props.children}</div>;
}

export function Eyebrow(props: { children: JSX.Element }) {
  return <span class="text-[0.7rem] font-semibold tracking-wider text-neutral-500 uppercase">{props.children}</span>;
}

export function Field(props: { label: string; for?: string; hint?: string; children: JSX.Element }) {
  return <div class="grid min-w-0 gap-1">
    <label for={props.for} class="text-[0.8rem] font-medium text-neutral-700">{props.label}</label>
    {props.children}
    <Show when={props.hint}><p class="m-0 text-[0.76rem] text-neutral-500">{props.hint}</p></Show>
  </div>;
}

/** Confirmación en línea: un error de la acción se queda junto a ella. */
export function Confirm(props: { text: string; action: string; danger?: boolean; busy?: boolean; onConfirm: () => void; onBack: () => void }) {
  return <div class="grid gap-2 rounded-md border border-border bg-surface-muted p-3">
    <p class="m-0 text-[0.85rem] text-neutral-700">{props.text}</p>
    <div class="flex items-center justify-end gap-2">
      <Button type="button" variant="ghost" size="sm" onClick={props.onBack}>{t("broadcasts.back")}</Button>
      <Button type="button" variant={props.danger ? 'danger' : 'primary'} size="sm" disabled={props.busy} onClick={props.onConfirm}>{props.action}</Button>
    </div>
  </div>;
}

export function RowButton(props: { active: boolean; onClick: () => void; children: JSX.Element; muted?: boolean }) {
  return <button type="button" aria-current={props.active ? 'true' : undefined} onClick={props.onClick} class={`grid w-full min-w-0 cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-transparent bg-transparent px-2.5 py-2 text-left hover:bg-neutral-100 ${props.active ? 'bg-neutral-200 hover:bg-neutral-200' : ''} ${props.muted ? 'opacity-60' : ''}`}>{props.children}</button>;
}
