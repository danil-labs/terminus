import { createEffect, createMemo, createSignal, For, on, Show } from 'solid-js';
import { templateHasUnmappableParams, templateVariables, type StatusOut } from '../../../../../../packages/attention/src/broadcasts.ts';
import { t } from '../../../lib/i18n';
import { Button } from '../../../ui/Button';
import { EmptyState } from '../../../ui/EmptyState';
import { Input } from '../../../ui/Input';
import { Select } from '../../../ui/Select';
import { Field, errorText, type Context } from './parts';
import { createQuery } from './query';

const LITERAL = '__literal__';
const SOURCES = ['contact.name', 'contact.email', 'contact.phone', 'time.now', 'time.now_full'] as const;

/** Crea el borrador; la audiencia y el envío se deciden después, en el detalle. */
export function CreateCampaign(props: { context: Context; onDone: (created: StatusOut | null) => void }) {
  const api = props.context.api;
  const templates = createQuery(() => api.templates(true));
  // Si faltan los metadatos, el selector sigue con las fuentes estándar.
  const metadata = createQuery(() => api.metadataKeys().catch(() => []));
  const [name, setName] = createSignal('');
  const [templateId, setTemplateId] = createSignal<number | null>(null);
  const [channelId, setChannelId] = createSignal<number | null>(null);
  const [values, setValues] = createSignal<Record<string, string>>({});
  const [literal, setLiteral] = createSignal<Record<string, boolean>>({});
  const [error, setError] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const channels = createQuery(() => api.templateChannels(templateId()!), { key: templateId, enabled: () => templateId() !== null });

  const template = createMemo(() => templates.data()?.find(row => row.id === templateId()) ?? null);
  const variables = () => template() ? templateVariables(template()!.components) : [];
  const unmappable = () => !!template() && templateHasUnmappableParams(template()!.components);
  const eligible = () => channels.data() ?? [];
  const noChannels = () => templateId() !== null && !!channels.data() && eligible().length === 0;
  const channelOk = () => eligible().some(row => row.id === channelId());
  const complete = () => variables().every(name => values()[name]?.trim());
  const ready = () => !!name().trim() && templateId() !== null && channelOk() && complete() && !unmappable() && !busy() && props.context.canWrite();

  createEffect(() => { const first = templates.data()?.[0]; if (templateId() === null && first) setTemplateId(first.id); });
  createEffect(on(templateId, () => { setValues({}); setLiteral({}); }));
  createEffect(() => { const rows = channels.data(); if (rows && !rows.some(row => row.id === channelId())) setChannelId(rows[0]?.id ?? null); });

  async function submit(event: Event) {
    event.preventDefault();
    if (!ready()) return;
    setBusy(true); setError('');
    const mapping = variables().length ? Object.fromEntries(variables().map(key => [key, values()[key]!.trim()])) : undefined;
    try { props.onDone(await api.createCampaign({ template_id: templateId()!, channel_id: channelId()!, name: name().trim(), ...(mapping ? { variable_mapping: mapping } : {}) })); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }
  function pick(variable: string, value: string) {
    setLiteral({ ...literal(), [variable]: value === LITERAL });
    setValues({ ...values(), [variable]: value === LITERAL ? '' : value });
  }

  return <section class="grid content-start gap-3 rounded-lg border border-border bg-surface p-4" aria-label={t("broadcasts.new_broadcast")}>
    <header class="flex items-center justify-between"><h2 class="m-0 text-base font-semibold">{t("broadcasts.new_broadcast")}</h2><Button type="button" variant="ghost" size="sm" onClick={() => props.onDone(null)}>{t("broadcasts.cancel")}</Button></header>
    <Show when={templates.error()}><p role="alert" class="m-0 text-[0.82rem] font-medium text-error-strong">{t("broadcasts.templates_error")} {templates.error()}</p></Show>
    <Show when={templates.data()?.length === 0} fallback={
      <form class="grid gap-3" onSubmit={event => void submit(event)}>
        <Field label={t("broadcasts.name")} for="camp-name"><Input id="camp-name" value={name()} maxLength={200} autocomplete="off" placeholder={t("broadcasts.name_placeholder")} onInput={event => setName(event.currentTarget.value)}/></Field>
        <Field label={t("broadcasts.template_approved")} for="camp-template">
          <Select id="camp-template" value={templateId() ?? ''} disabled={!templates.data()} onChange={event => setTemplateId(Number(event.currentTarget.value))}>
            <For each={templates.data()}>{row => <option value={row.id}>{row.name}{row.language ? ` · ${row.language}` : ''}</option>}</For>
          </Select>
        </Field>
        <Field label={t("broadcasts.sender")} for="camp-channel" hint={templateId() === null ? t("broadcasts.pick_template_first") : noChannels() ? undefined : t("broadcasts.sender_hint")}>
          <Select id="camp-channel" value={channelId() ?? ''} disabled={templateId() === null || eligible().length === 0} onChange={event => setChannelId(Number(event.currentTarget.value))}>
            <For each={eligible()}>{row => <option value={row.id}>{row.name || t("broadcasts.channel_fallback", { id: row.id })}</option>}</For>
          </Select>
        </Field>
        <Show when={noChannels()}><p role="alert" class="m-0 text-[0.82rem] font-medium text-error-strong">{t("broadcasts.no_eligible")}</p></Show>
        <Show when={unmappable()} fallback={
          <Show when={variables().length > 0}>
            <div class="grid gap-2 rounded-md border border-border bg-surface-muted p-3">
              <span class="text-[0.8rem] font-semibold text-neutral-700">{t("broadcasts.variables")}</span>
              <p class="m-0 text-[0.78rem] text-neutral-500">{t("broadcasts.variables_hint")}</p>
              <For each={variables()}>{variable => <Field label={`{{${variable}}}`} for={`camp-var-${variable}`}>
                <div class="grid gap-1.5">
                  <Select id={`camp-var-${variable}`} value={literal()[variable] ? LITERAL : values()[variable] ?? ''} onChange={event => pick(variable, event.currentTarget.value)}>
                    <option value="">{t("broadcasts.pick_source")}</option>
                    <For each={SOURCES}>{source => <option value={source}>{t(`broadcasts.source_${source.replace('.', '_')}`)}</option>}</For>
                    <For each={metadata.data()}>{key => <option value={`contact.metadata.${key}`}>{t("broadcasts.source_metadata", { key })}</option>}</For>
                    <option value={LITERAL}>{t("broadcasts.source_literal")}</option>
                  </Select>
                  <Show when={literal()[variable]}><Input value={values()[variable] ?? ''} autocomplete="off" placeholder={t("broadcasts.literal_placeholder")} aria-label={t("broadcasts.literal_for", { name: variable })} onInput={event => setValues({ ...values(), [variable]: event.currentTarget.value })}/></Show>
                </div>
              </Field>}</For>
            </div>
          </Show>
        }><p role="alert" class="m-0 text-[0.82rem] font-medium text-error-strong">{t("broadcasts.unmappable")}</p></Show>
        <Show when={error()}><p role="alert" class="m-0 text-[0.82rem] font-medium text-error-strong">{error()}</p></Show>
        <div class="flex justify-end"><Button type="submit" disabled={!ready()}>{busy() ? t("broadcasts.creating") : t("broadcasts.create_draft")}</Button></div>
      </form>
    }><EmptyState title={t("broadcasts.no_approved")} description={t("broadcasts.no_approved_hint")}/></Show>
  </section>;
}
