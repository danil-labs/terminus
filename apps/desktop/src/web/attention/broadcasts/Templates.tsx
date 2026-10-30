import { createEffect, createSignal, For, Match, onMount, Show, Switch } from 'solid-js';
import RefreshCw from 'lucide-solid/icons/refresh-cw';
import Trash2 from 'lucide-solid/icons/trash-2';
import { draftContent, extractTemplateVariables, normalizeTemplateName, parseTemplateText, templateContent, type HeaderFormat, type Template, type TemplateContent, type TemplateInput, type TemplateSyncResult, type TextNode } from '../../../../../../packages/attention/src/broadcast-panel.ts';
import { t } from '../../../lib/i18n';
import { Button } from '../../../ui/Button';
import { Input } from '../../../ui/Input';
import { Select } from '../../../ui/Select';
import { Skeleton } from '../../../ui/Skeleton';
import { Textarea } from '../../../ui/Textarea';
import { Confirm, Field, Note, RowButton, TemplateBadge, errorText, type Context } from './parts';
import { createQuery, type Query } from './query';

type HeaderKind = 'none' | HeaderFormat;
const HEADERS: HeaderKind[] = ['none', 'TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT'];
const LANGUAGES = ['es_MX', 'es_ES', 'en_US'] as const;
const ACCEPT: Partial<Record<HeaderKind, string>> = { IMAGE: 'image/png,image/jpeg', VIDEO: 'video/mp4', DOCUMENT: 'application/pdf' };
// Sobrevive al desmontaje: abrir una plantilla desmonta la lista y Meta no debe recibir una ráfaga.
const SYNC_THROTTLE = 60_000;
let lastSync = 0;

function syncSummary(value: TemplateSyncResult) {
  const parts = [
    value.imported > 0 && (value.imported === 1 ? t("broadcasts.sync_imported_one", { count: value.imported }) : t("broadcasts.sync_imported_other", { count: value.imported })),
    value.updated > 0 && (value.updated === 1 ? t("broadcasts.sync_updated_one", { count: value.updated }) : t("broadcasts.sync_updated_other", { count: value.updated })),
    value.marked_deleted > 0 && (value.marked_deleted === 1 ? t("broadcasts.sync_deleted_one", { count: value.marked_deleted }) : t("broadcasts.sync_deleted_other", { count: value.marked_deleted })),
    t("broadcasts.sync_unchanged", { count: value.unchanged }),
  ].filter(Boolean);
  return t("broadcasts.sync_summary", { wabas: value.wabas, parts: parts.join(' · ') });
}

/** Todas las plantillas de la cuenta. La reconciliación con Meta es una escritura: va con el interruptor. */
export function TemplateList(props: { context: Context; templates: Query<Template[]>; query: string; selected: number | null; onOpen: (id: number) => void }) {
  const [syncing, setSyncing] = createSignal(false);
  const [notice, setNotice] = createSignal('');
  async function sync() {
    if (syncing() || !props.context.api.writes) return;
    lastSync = Date.now(); setSyncing(true);
    try { setNotice(syncSummary(await props.context.api.syncTemplates())); void props.templates.refresh(); }
    catch (cause) { setNotice(errorText(cause)); }
    finally { setSyncing(false); }
  }
  onMount(() => { if (props.context.canWrite() && Date.now() - lastSync >= SYNC_THROTTLE) void sync(); });
  const rows = () => {
    const needle = props.query.trim().toLowerCase();
    return (props.templates.data() ?? []).filter(row => !needle || row.name.toLowerCase().includes(needle));
  };
  return <div class="grid content-start gap-2">
    <div class="flex items-center justify-between gap-2 px-1">
      <span class="text-ui text-neutral-500">{(props.templates.data()?.length ?? 0) === 1 ? t("broadcasts.templates_one", { count: 1 }) : t("broadcasts.templates_other", { count: props.templates.data()?.length ?? 0 })}</span>
      <Button size="sm" variant="ghost" type="button" disabled={syncing() || !props.context.canWrite()} aria-label={t("broadcasts.sync_label")} onClick={() => void sync()}><RefreshCw size={14} class={syncing() ? 'animate-spin' : undefined}/>{syncing() ? t("broadcasts.syncing") : t("broadcasts.sync")}</Button>
    </div>
    <Show when={notice()}><p role="status" class="m-0 rounded-md bg-surface-muted px-3 py-2 text-label text-neutral-700">{notice()}</p></Show>
    <Show when={!props.templates.data() && !props.templates.error()}><Skeleton class="h-12" filas={3}/></Show>
    <Show when={props.templates.error()}><Note tone="danger">{t("broadcasts.templates_error")} {props.templates.error()}</Note></Show>
    <Show when={props.templates.data()?.length === 0}><p role="status" class="m-0 p-4 text-center text-body text-neutral-500">{t("broadcasts.no_templates")}</p></Show>
    <ul class="m-0 grid list-none content-start gap-1 p-0">
      <For each={rows()}>{row => <li class="min-w-0"><RowButton active={props.selected === row.id} muted={row.status === 'DELETED'} onClick={() => props.onOpen(row.id)}>
        <span class="grid min-w-0 gap-0.5"><strong class="truncate font-mono text-ui">{row.name}</strong><span class="truncate text-label text-neutral-500">{[row.category, row.language].filter(Boolean).join(' · ') || '—'}</span></span>
        <TemplateBadge template={row}/>
      </RowButton></li>}</For>
    </ul>
  </div>;
}

function Nodes(props: { nodes: TextNode[] }) {
  return <For each={props.nodes}>{node => <Switch>
    <Match when={node.type === 'text' || node.type === 'mono'}><Show when={node.type === 'mono'} fallback={(node as { value: string }).value}><code class="font-mono">{(node as { value: string }).value}</code></Show></Match>
    <Match when={node.type === 'variable'}><span class="rounded-sm bg-primary/15 px-1 font-mono text-[0.82em] font-semibold text-primary-dark">{`{{${(node as { name: string }).name}}}`}</span></Match>
    <Match when={node.type === 'bold'}><strong><Nodes nodes={(node as { children: TextNode[] }).children}/></strong></Match>
    <Match when={node.type === 'italic'}><em><Nodes nodes={(node as { children: TextNode[] }).children}/></em></Match>
    <Match when={node.type === 'strike'}><s><Nodes nodes={(node as { children: TextNode[] }).children}/></s></Match>
  </Switch>}</For>;
}

/** Cómo le llega al cliente: burbuja recibida con encabezado, cuerpo con formato y pie. */
export function TemplatePreview(props: { content: TemplateContent }) {
  const header = () => props.content.header;
  const media = () => header() && header()!.format !== 'TEXT' ? header()! : null;
  return <div class="grid content-start rounded-lg border border-border bg-surface-muted p-4" aria-label={t("broadcasts.preview_label")}>
    <span class="mb-3 text-caption font-semibold tracking-wider text-neutral-500 uppercase">{t("broadcasts.preview")}</span>
    <div class="max-w-[320px] rounded-[18px] rounded-bl-[6px] border border-border bg-surface px-3 pt-2.5 pb-2 shadow-sm">
      <Show when={header()?.format === 'TEXT' && header()?.text?.trim()}><p class="m-0 mb-1 text-lead leading-[1.35] font-bold text-neutral-950">{header()!.text}</p></Show>
      <Show when={media()}>{value => <Show when={value().format === 'IMAGE' && value().media_url} fallback={<div class="mb-2 grid h-28 w-full place-items-center rounded-md bg-neutral-200 text-label font-semibold text-neutral-500">{value().media_url ? t("broadcasts.attached") : t(`broadcasts.header_${value().format}`)}</div>}><img src={value().media_url!} alt={t("broadcasts.header_image_alt")} class="mb-2 max-h-44 w-full rounded-md border border-border object-cover"/></Show>}</Show>
      <p class="m-0 text-lead leading-[1.42] whitespace-pre-wrap text-neutral-950"><Show when={props.content.body.text.trim()} fallback={<span class="text-neutral-500">{t("broadcasts.body_placeholder")}</span>}><Nodes nodes={parseTemplateText(props.content.body.text)}/></Show></p>
      <Show when={props.content.footer?.text.trim()}><p class="m-0 mt-1 text-label leading-[1.3] text-neutral-500">{props.content.footer!.text}</p></Show>
    </div>
  </div>;
}

/** Sin id, plantilla nueva. Un borrador se edita; cualquier otro estado solo se lee. */
export function TemplateEditor(props: { context: Context; templateId: number | null; onDone: () => void; onChanged: () => void }) {
  const template = createQuery(() => props.context.api.template(props.templateId!), { enabled: () => props.templateId !== null });
  return <Show when={props.templateId !== null} fallback={<DraftForm context={props.context} template={null} onDone={props.onDone} onChanged={props.onChanged}/>}>
    <Show when={template.error()}><Note tone="danger">{t("broadcasts.template_error")} {template.error()}</Note></Show>
    <Show when={!template.data() && !template.error()}><Skeleton class="h-28"/></Show>
    <Show when={template.data()} keyed>{row => row.status === 'DRAFT'
      ? <DraftForm context={props.context} template={row} onDone={props.onDone} onChanged={props.onChanged}/>
      : <ReadOnly template={row} onDone={props.onDone}/>}</Show>
  </Show>;
}

function ReadOnly(props: { template: Template; onDone: () => void }) {
  const tone = () => props.template.status === 'REJECTED' ? 'danger' as const : props.template.status === 'APPROVED' ? 'success' as const : 'neutral' as const;
  const message = () => {
    const row = props.template;
    if (row.status === 'REJECTED') return row.rejection_reason ? t("broadcasts.read_rejected_reason", { reason: row.rejection_reason }) : t("broadcasts.read_rejected");
    if (row.status === 'PENDING') return t("broadcasts.read_pending");
    if (row.status === 'APPROVED') return t("broadcasts.read_approved");
    return t("broadcasts.read_state", { state: row.status });
  };
  return <section class="grid min-h-0 content-start gap-3" aria-label={t("broadcasts.template_of", { name: props.template.name })}>
    <header class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex min-w-0 items-center gap-2"><h2 class="m-0 truncate font-mono text-base font-semibold">{props.template.name}</h2><TemplateBadge template={props.template}/></div>
      <Button size="sm" variant="ghost" type="button" onClick={props.onDone}>{t("broadcasts.close")}</Button>
    </header>
    <Note tone={tone()}>{message()}</Note>
    <TemplatePreview content={templateContent(props.template.components)}/>
    <Show when={props.template.waba_id}><p class="m-0 text-label text-neutral-500">{t("broadcasts.waba")} <span class="font-mono">{props.template.waba_id}</span></p></Show>
  </section>;
}

function DraftForm(props: { context: Context; template: Template | null; onDone: () => void; onChanged: () => void }) {
  const api = props.context.api;
  const initial = props.template ? draftContent(props.template.components) : null;
  const channels = createQuery(() => api.channels());
  const [draftId, setDraftId] = createSignal(props.template?.id ?? null);
  const [name, setName] = createSignal(props.template?.name ?? '');
  const [category, setCategory] = createSignal<'MARKETING' | 'UTILITY'>(props.template?.category === 'UTILITY' ? 'UTILITY' : 'MARKETING');
  const [language, setLanguage] = createSignal(props.template?.language ?? 'es_MX');
  const [channelId, setChannelId] = createSignal<number | null>(null);
  const [headerKind, setHeaderKind] = createSignal<HeaderKind>(initial?.header?.format ?? 'none');
  const [headerText, setHeaderText] = createSignal(initial?.header?.text ?? '');
  const [mediaUrl, setMediaUrl] = createSignal<string | null>(initial?.header?.media_url ?? null);
  const [fileName, setFileName] = createSignal<string | null>(null);
  const [uploading, setUploading] = createSignal(false);
  const [body, setBody] = createSignal(initial?.body.text ?? '');
  const [footer, setFooter] = createSignal(initial?.footer?.text ?? '');
  const [busy, setBusy] = createSignal(false);
  const [saved, setSaved] = createSignal(false);
  const [error, setError] = createSignal('');
  const [submitted, setSubmitted] = createSignal<Template | null>(null);
  const [confirming, setConfirming] = createSignal<'submit' | 'discard' | 'cancel' | null>(null);
  let file: HTMLInputElement | undefined;

  createEffect(() => { const first = channels.data()?.[0]; if (channelId() === null && first) setChannelId(first.id); });
  const isMedia = () => headerKind() !== 'none' && headerKind() !== 'TEXT';
  const incomplete = () => !name().trim() || !body().trim() || channelId() === null || (headerKind() === 'TEXT' && !headerText().trim()) || (isMedia() && (!mediaUrl() || uploading()));
  const blocked = () => incomplete() || busy() || !props.context.canWrite();
  const snapshot = () => JSON.stringify([name().trim(), category(), language(), headerKind(), headerText().trim(), mediaUrl(), body().trim(), footer().trim()]);
  let baseline = snapshot();
  const content = (): TemplateContent => ({
    header: headerKind() === 'none' ? null : { format: headerKind() as HeaderFormat, text: headerKind() === 'TEXT' ? headerText().trim() || null : null, media_url: isMedia() ? mediaUrl() : null },
    body: { text: body() }, footer: footer().trim() ? { text: footer().trim() } : null,
  });
  const payload = (): TemplateInput => ({ channel_id: channelId()!, name: name().trim(), category: category(), language: language(), ...content() });

  async function guarded(action: () => Promise<void>) {
    setBusy(true); setError(''); setSaved(false); setConfirming(null);
    try { await action(); props.onChanged(); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }
  const save = () => guarded(async () => {
    if (draftId() === null) setDraftId((await api.createTemplate({ ...payload(), submit: false })).id);
    else await api.updateTemplate(draftId()!, payload());
    setSaved(true);
    baseline = snapshot();
  });
  const submit = () => guarded(async () => {
    if (draftId() === null) { setSubmitted(await api.createTemplate({ ...payload(), submit: true })); return; }
    await api.updateTemplate(draftId()!, payload());
    setSubmitted(await api.submitTemplate(draftId()!));
  });
  const discard = () => guarded(async () => { await api.deleteTemplate(draftId()!); props.onDone(); });
  function cancel() {
    if (busy()) return;
    if (snapshot() !== baseline) setConfirming('cancel'); else props.onDone();
  }
  function pickHeader(kind: HeaderKind) {
    setHeaderKind(kind); setHeaderText(''); setMediaUrl(null); setFileName(null);
    if (file) file.value = '';
  }
  async function upload(selected: File | undefined) {
    if (!selected) return;
    setMediaUrl(null); setFileName(selected.name); setUploading(true); setError('');
    try { setMediaUrl(await api.uploadMedia(selected)); }
    catch (cause) { setError(errorText(cause)); }
    finally { setUploading(false); }
  }

  return <Show when={!submitted()} fallback={<div class="grid gap-2">
    <Note tone="success"><strong>{t("broadcasts.submitted_title")}</strong><br/>{t("broadcasts.submitted_body", { name: submitted()!.name })}</Note>
    <Button size="sm" type="button" class="justify-self-start" onClick={props.onDone}>{t("broadcasts.understood")}</Button>
  </div>}>
    <section class="@container grid min-h-0 content-start gap-3" aria-label={draftId() !== null ? t("broadcasts.edit_draft") : t("broadcasts.new_template")} onKeyDown={event => { if (event.key !== 'Escape') return; event.preventDefault(); if (confirming()) setConfirming(null); else cancel(); }}>
      <header class="flex flex-wrap items-center justify-between gap-2"><h2 class="m-0 text-base font-semibold">{draftId() !== null ? t("broadcasts.edit_draft") : t("broadcasts.new_template")}</h2><Button type="button" variant="ghost" size="sm" onClick={cancel}>{t("broadcasts.cancel")}</Button></header>
      <div class="grid items-start gap-4 @[52rem]:grid-cols-[minmax(0,1fr)_minmax(260px,320px)]">
        <form class="grid min-w-0 gap-3" onSubmit={event => { event.preventDefault(); if (!blocked()) setConfirming('submit'); }}>
          <Field label={t("broadcasts.name")} for="tpl-name" hint={t("broadcasts.template_name_hint")}><Input id="tpl-name" class="font-mono" value={name()} maxLength={512} autocomplete="off" placeholder="bienvenida_clientes" onInput={event => { const value = normalizeTemplateName(event.currentTarget.value); event.currentTarget.value = value; setName(value); }}/></Field>
          <div class="grid gap-3 @[34rem]:grid-cols-2">
            <Field label={t("broadcasts.category")} for="tpl-category"><Select id="tpl-category" value={category()} onChange={event => setCategory(event.currentTarget.value as 'MARKETING' | 'UTILITY')}><option value="MARKETING">{t("broadcasts.category_marketing")}</option><option value="UTILITY">{t("broadcasts.category_utility")}</option></Select></Field>
            <Field label={t("broadcasts.language")} for="tpl-language"><Select id="tpl-language" value={language()} onChange={event => setLanguage(event.currentTarget.value)}><For each={LANGUAGES}>{value => <option value={value}>{t(`broadcasts.language_${value}`)}</option>}</For></Select></Field>
          </div>
          <Field label={t("broadcasts.whatsapp_number")} for="tpl-channel" hint={!channels.data() ? t("broadcasts.loading_channels") : channels.data()!.length === 0 ? t("broadcasts.connect_channel") : t("broadcasts.whatsapp_number_hint")}>
            <Select id="tpl-channel" value={channelId() ?? ''} disabled={!channels.data()?.length} onChange={event => setChannelId(Number(event.currentTarget.value))}><For each={channels.data()}>{row => <option value={row.id}>{row.name || t("broadcasts.channel_fallback", { id: row.id })}</option>}</For></Select>
          </Field>
          <Field label={t("broadcasts.header")} for="tpl-header">
            <div class="grid gap-2">
              <Select id="tpl-header" value={headerKind()} onChange={event => pickHeader(event.currentTarget.value as HeaderKind)}><For each={HEADERS}>{value => <option value={value}>{t(`broadcasts.header_${value}`)}</option>}</For></Select>
              <Show when={headerKind() === 'TEXT'}><Input value={headerText()} maxLength={60} placeholder={t("broadcasts.header_text_placeholder")} aria-label={t("broadcasts.header_text")} onInput={event => setHeaderText(event.currentTarget.value)}/></Show>
              <Show when={isMedia()}>
                <div class="grid gap-2 rounded-md border border-border bg-surface-muted p-3">
                  <input ref={file} type="file" accept={ACCEPT[headerKind()]} aria-label={t("broadcasts.header_file")} class="text-ui text-neutral-700" onChange={event => void upload(event.currentTarget.files?.[0])}/>
                  <Show when={uploading()}><p class="m-0 text-ui text-neutral-500">{t("broadcasts.uploading", { name: fileName() ?? '' })}</p></Show>
                  <Show when={!uploading() && mediaUrl()}><Show when={headerKind() === 'IMAGE'} fallback={<p class="m-0 truncate text-ui text-neutral-700">{fileName() ?? t("broadcasts.attached")}</p>}><img src={mediaUrl()!} alt={t("broadcasts.header_image_alt")} class="max-h-28 w-fit rounded-md border border-border object-contain"/></Show></Show>
                </div>
              </Show>
            </div>
          </Field>
          <Field label={t("broadcasts.body")} for="tpl-body" hint={t("broadcasts.body_hint")}><Textarea id="tpl-body" class="min-h-[110px]" value={body()} maxLength={1024} placeholder={t("broadcasts.body_example")} onInput={event => setBody(event.currentTarget.value)}/></Field>
          <Show when={extractTemplateVariables(body()).length > 0}><p class="m-0 flex flex-wrap items-center gap-1.5 text-ui text-neutral-500">{t("broadcasts.variables_label")}<For each={extractTemplateVariables(body())}>{value => <span class="rounded-sm bg-neutral-500/10 px-1.5 py-0.5 font-mono text-label font-semibold text-neutral-700">{value}</span>}</For></p></Show>
          <Field label={t("broadcasts.footer")} for="tpl-footer"><Input id="tpl-footer" value={footer()} maxLength={60} placeholder={t("broadcasts.footer_placeholder")} onInput={event => setFooter(event.currentTarget.value)}/></Field>
          <Show when={error()}><p role="alert" class="m-0 text-ui font-medium text-error-strong">{error()}</p></Show>
          <Switch fallback={
            <div class="flex flex-wrap items-center justify-end gap-2">
              <Show when={draftId() !== null}><Button type="button" variant="ghost" size="sm" class="mr-auto text-error-strong" disabled={busy() || !props.context.canWrite()} onClick={() => setConfirming('discard')}><Trash2 size={14}/>{t("broadcasts.discard")}</Button></Show>
              <Show when={saved() && !busy()}><span class="text-ui text-neutral-500">{t("broadcasts.draft_saved")}</span></Show>
              <Button type="button" variant="secondary" disabled={blocked()} onClick={() => void save()}>{t("broadcasts.save_draft")}</Button>
              <Button type="button" disabled={blocked()} onClick={() => setConfirming('submit')}>{t("broadcasts.submit")}</Button>
            </div>
          }>
            <Match when={confirming() === 'submit'}><Confirm text={t("broadcasts.confirm_submit")} action={t("broadcasts.confirm_submit_action")} busy={busy()} onBack={() => setConfirming(null)} onConfirm={() => void submit()}/></Match>
            <Match when={confirming() === 'discard'}><Confirm text={t("broadcasts.confirm_discard")} action={t("broadcasts.confirm_discard_action")} danger busy={busy()} onBack={() => setConfirming(null)} onConfirm={() => void discard()}/></Match>
            <Match when={confirming() === 'cancel'}><Confirm text={t("broadcasts.confirm_leave")} action={t("broadcasts.confirm_discard_action")} onBack={() => setConfirming(null)} onConfirm={props.onDone}/></Match>
          </Switch>
        </form>
        <TemplatePreview content={content()}/>
      </div>
    </section>
  </Show>;
}
