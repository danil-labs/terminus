import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { BroadcastError, broadcastActions, canManageBroadcast, createBroadcasts, type Broadcast, type BroadcastAction, type BroadcastChannel, type BroadcastContact, type BroadcastPermissions, type BroadcastTemplate } from '../../../../../packages/attention/src/broadcasts.ts';
import { type Account, type InboxSession } from '../../../../../packages/attention/src/inbox.ts';
import { t } from '../../lib/i18n';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Dialog, DialogContent, DialogTitle } from '../../ui/Dialog';
import { Input } from '../../ui/Input';
import { Select } from '../../ui/Select';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '../../ui/Table';

type Editor = { kind: 'create' } | { kind: 'contacts'; campaign: Broadcast } | { kind: 'action'; campaign: Broadcast; action: BroadcastAction };

export function Broadcasts(props: { demo: boolean; session?: InboxSession & { subscribe?: (clear: () => void) => () => void } }) {
  if (props.demo) return <BroadcastDemo/>;
  const prefix = `${import.meta.env.BASE_URL}alpha-api`;
  const api = props.session && !props.demo ? createBroadcasts(props.session, fetch, prefix) : null;
  const [accounts, setAccounts] = createSignal<Account[]>([]);
  const [account, setAccount] = createSignal(0);
  const [rows, setRows] = createSignal<Broadcast[]>([]);
  const [perms, setPerms] = createSignal<BroadcastPermissions | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [success, setSuccess] = createSignal('');
  const [editor, setEditor] = createSignal<Editor | null>(null);
  const [pending, setPending] = createSignal(false);
  const [formLoading, setFormLoading] = createSignal(false);
  const [formError, setFormError] = createSignal('');
  const [operationVersion, setOperationVersion] = createSignal(0);
  let scope = new AbortController();
  const bumpOperations = () => setOperationVersion(value => value + 1);
  const resetScope = () => { scope.abort(); scope = new AbortController(); };
  const errorMessage = (cause: unknown) => {
    if (cause instanceof BroadcastError) {
      if (cause.code === 'account_mismatch' || cause.code === 'missing_active_account') return t(`broadcast-writes.${cause.code}`);
      if (cause.uncertain) return t("broadcast-writes.write_error");
      return cause.status ? t("broadcast-writes.rejected", { code: cause.code }) : t("broadcast-writes.not_sent");
    }
    return t("broadcast-writes.load_error");
  };
  const resource = (edit: Editor) => edit.kind === 'create' ? 'create' : `${edit.kind === 'contacts' ? 'contacts' : 'campaign'}:${edit.campaign.id}`;
  const blocked = () => { operationVersion(); const edit = editor(); return !!(api && edit && account() && api.blocked(account(), resource(edit))); };
  const [formSuccess, setFormSuccess] = createSignal('');
  const [templates, setTemplates] = createSignal<BroadcastTemplate[]>([]);
  const [templateId, setTemplateId] = createSignal(0);
  const [channels, setChannels] = createSignal<BroadcastChannel[]>([]);
  const [channelId, setChannelId] = createSignal(0);
  const [name, setName] = createSignal('');
  const [mapping, setMapping] = createSignal<Record<string, string>>({});
  const [contacts, setContacts] = createSignal<BroadcastContact[]>([]);
  const [selected, setSelected] = createSignal<number[]>([]);
  const [total, setTotal] = createSignal<number | null>(null);
  const [scheduled, setScheduled] = createSignal('');
  let epoch = 0, formEpoch = 0;
  const template = () => templates().find(row => row.id === templateId());
  const variableValue = (key: string) => Object.hasOwn(mapping(), key) ? mapping()[key] : '';
  const eligible = () => channels().some(row => row.id === channelId() && row.active) && canManageBroadcast(perms(), channelId());
  const canCreate = () => !!template()?.supported && !!name().trim() && eligible() && template()!.variables.every(key => variableValue(key).trim() && variableValue(key).length <= 1024);
  const canSubmit = () => {
    const edit = editor();
    if (!edit || !api || pending() || formLoading() || blocked()) return false;
    if (edit.kind === 'create') return canCreate();
    if (!canManageBroadcast(perms(), edit.campaign.channel_id)) return false;
    if (edit.kind === 'contacts') return false;
    if (edit.action !== 'pause' && edit.action !== 'cancel') return false;
    if (!broadcastActions(edit.campaign.status).includes(edit.action)) return false;
    return total() !== null;
  };
  function clear() {
    resetScope(); epoch++; formEpoch++; setAccounts([]); setAccount(0); setRows([]); setPerms(null); setEditor(null);
    setTemplates([]); setChannels([]); setContacts([]); setMapping({}); setName(''); setSelected([]); setScheduled(''); setTotal(null);
    setBusy(false); setPending(false); setFormLoading(false); setError(''); setSuccess(''); setFormError(''); setFormSuccess('');
  }
  async function load(target = account()) {
    if (!api || !target) return;
    resetScope();
    const version = ++epoch;
    formEpoch++; setEditor(null); setAccount(target); setRows([]); setPerms(null); setBusy(true); setError(''); setSuccess('');
    try {
      const [permissions, campaigns] = await Promise.all([api.permissions(target, scope.signal), api.list(target, scope.signal)]);
      if (version !== epoch) return;
      setPerms(permissions); setRows(campaigns);
    } catch (cause) { if (version === epoch) setError(errorMessage(cause)); }
    finally { if (version === epoch) setBusy(false); }
  }
  async function initialize() {
    if (!api) return;
    const version = ++epoch; setBusy(true); setError('');
    try {
      const [value, active] = await Promise.all([api.accounts(scope.signal), api.activeAccount(scope.signal)]);
      if (version !== epoch) return;
      setAccounts(value);
      if (!value.some(row => row.id === active)) throw new BroadcastError('account_mismatch');
      await load(active);
    } catch (cause) { if (version === epoch) { setError(errorMessage(cause)); setBusy(false); } }
  }
  onMount(() => {
    const stop = props.session?.subscribe?.(clear);
    if (stop) onCleanup(stop);
    void initialize();
  });
  onCleanup(() => { scope.abort(); epoch++; formEpoch++; });
  async function open(edit: Editor) {
    if (!api || busy() || pending() || edit.kind === 'contacts' || (edit.kind === 'action' && edit.action !== 'pause' && edit.action !== 'cancel')) return;
    const version = ++formEpoch, current = epoch, target = account();
    setEditor(edit); bumpOperations(); setFormError(''); setFormSuccess(''); setFormLoading(true); setTemplates([]); setTemplateId(0); setChannels([]); setChannelId(0);
    setContacts([]); setSelected([]); setMapping({}); setName(''); setTotal(null); setScheduled('');
    try {
      if (edit.kind === 'create') {
        const value = await api.templates(target, scope.signal);
        if (version === formEpoch && current === epoch) setTemplates(value);
      } else {
        const value = await api.stats(target, edit.campaign.id, scope.signal);
        if (version === formEpoch && current === epoch) setTotal(value);
      }
    } catch (cause) { if (version === formEpoch && current === epoch) setFormError(errorMessage(cause)); }
    finally { if (version === formEpoch && current === epoch) setFormLoading(false); }
  }
  async function chooseTemplate(value: number) {
    if (!api) return;
    const version = ++formEpoch, current = epoch;
    setTemplateId(value); setMapping({}); setChannels([]); setChannelId(0); setFormError(''); setFormLoading(true);
    try {
      const valueChannels = value ? await api.channels(account(), value, scope.signal) : [];
      if (version === formEpoch && current === epoch) setChannels(valueChannels.filter(row => row.active && canManageBroadcast(perms(), row.id)));
    } catch (cause) { if (version === formEpoch && current === epoch) setFormError(errorMessage(cause)); }
    finally { if (version === formEpoch && current === epoch) setFormLoading(false); }
  }
  async function submit(event: SubmitEvent) {
    event.preventDefault();
    const edit = editor();
    if (!api || !edit || !canSubmit()) return;
    const current = epoch, version = formEpoch, target = account();
    setPending(true); setFormError(''); setFormSuccess('');
    try {
      if (edit.kind === 'create') {
        await api.create(target, { name: name(), template_id: templateId(), channel_id: channelId(), variable_mapping: Object.fromEntries(template()!.variables.map(key => [key, variableValue(key).trim()])) }, scope.signal);
      } else if (edit.kind === 'contacts') {
        const result = await api.addContacts(target, edit.campaign.id, selected(), scope.signal);
        if (current === epoch && version === formEpoch) {
          setSelected([]);
          setFormSuccess(t("broadcast-writes.contacts_result", { added: result.added, requested: result.requested, rejected: result.rejected.length }));
        }
        return;
      } else await api.transition(target, edit.campaign.id, edit.action, scheduled() || undefined, scope.signal);
      if (current !== epoch || version !== formEpoch) return;
      setEditor(null); setSuccess(t("broadcast-writes.saved"));
      try { const campaigns = await api.list(target, scope.signal); if (current === epoch) setRows(campaigns); }
      catch (cause) { if (current === epoch) { setRows([]); setPerms(null); setError(errorMessage(cause)); } }
    } catch (cause) { if (current === epoch && version === formEpoch) setFormError(errorMessage(cause)); }
    finally { if (current === epoch) { setPending(false); bumpOperations(); } }
  }
  async function reread() {
    const edit = editor();
    if (!api || !edit || pending()) return;
    const current = epoch, version = formEpoch;
    setFormLoading(true); setFormError('');
    try {
      const campaigns = await api.list(account(), scope.signal, true);
      const count = edit.kind === 'contacts' ? await api.stats(account(), edit.campaign.id, scope.signal, true) : null;
      if (current !== epoch || version !== formEpoch) return;
      setRows(campaigns);
      setEditor(null);
      setSuccess(count === null ? t("broadcast-writes.reloaded") : t("broadcast-writes.reloaded_contacts", { count }));
      bumpOperations();
    } catch (cause) { if (current === epoch && version === formEpoch) setFormError(errorMessage(cause)); }
    finally { if (current === epoch && version === formEpoch) setFormLoading(false); }
  }
  const modalTitle = () => {
    const edit = editor();
    return edit?.kind === 'action' ? t(`broadcast-writes.${edit.action}`) : t(edit?.kind === 'contacts' ? 'broadcast-writes.audience' : 'broadcast-writes.new');
  };
  return <section class="flex h-full min-h-0 min-w-0 flex-col overflow-y-auto" aria-label={t("customize.broadcasts")}>
    <header class="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
      <h2 class="m-0 flex-1 text-sm font-semibold">{t("customize.broadcasts")}</h2>
      <Button size="sm" variant="secondary" disabled={!api || busy() || pending()} onClick={() => void (account() ? load() : initialize())}>{t("broadcast-writes.refresh")}</Button>
      <Button size="sm" disabled={!api || busy() || pending() || !perms()?.permissions.includes('campaigns.manage')} onClick={() => void open({ kind: 'create' })}>{t("broadcast-writes.new")}</Button>
    </header>
    <div class="grid gap-3 p-4">
      <p class="m-0 text-xs text-neutral-500">{t("broadcast-writes.boundary")}</p>
      <Show when={props.demo || !props.session}><p role="note">{t("broadcast-writes.session_required")}</p></Show>
      <Show when={accounts().length}><label class="grid gap-1 text-xs">{t("broadcast-writes.account")}<Select value={account()} disabled><For each={accounts()}>{row => <option value={row.id}>{row.name}</option>}</For></Select></label></Show>
      <p class="m-0 text-xs text-neutral-500">{t("broadcast-writes.account_hint")}</p>
      <Show when={busy()}><p role="status">{t("broadcast-writes.loading")}</p></Show>
      <Show when={error()}><p role="alert" class="text-sm text-error-strong">{error()}</p></Show>
      <Show when={success()}><p role="status" class="text-sm text-success-strong">{success()}</p></Show>
      <Show when={perms() && !perms()!.permissions.includes('campaigns.manage')}><p role="note" class="text-xs text-neutral-500">{t("broadcast-writes.readonly")}</p></Show>
      <Show when={!busy() && !error() && account() && rows().length === 0}><p role="status">{t("broadcast-writes.empty")}</p></Show>
      <Table><TableHead><TableRow><TableHeaderCell>{t("broadcast-writes.name")}</TableHeaderCell><TableHeaderCell>{t("broadcast-writes.channel")}</TableHeaderCell><TableHeaderCell>{t("broadcast-writes.state")}</TableHeaderCell><TableHeaderCell>{t("broadcast-writes.actions")}</TableHeaderCell></TableRow></TableHead><TableBody><For each={rows()}>{row => <TableRow>
        <TableCell>{row.name}</TableCell><TableCell>{row.channel_id ?? t("broadcast-writes.no_channel")}</TableCell><TableCell><Badge forma="dato">{t(`broadcast-writes.state_${row.status}`)}</Badge></TableCell>
        <TableCell><div class="flex flex-wrap gap-2"><Show when={row.status === 'draft' || row.status === 'scheduled' || row.status === 'paused'}><Button size="sm" variant="secondary" disabled title={t("broadcast-writes.boundary")} onClick={() => void open({ kind: 'contacts', campaign: row })}>{t("broadcast-writes.audience")}</Button></Show><For each={broadcastActions(row.status)}>{action => <Button size="sm" variant="secondary" disabled={pending() || !['pause', 'cancel'].includes(action) || !canManageBroadcast(perms(), row.channel_id)} title={!['pause', 'cancel'].includes(action) ? t("broadcast-writes.boundary") : undefined} onClick={() => void open({ kind: 'action', campaign: row, action })}>{t(`broadcast-writes.${action}`)}</Button>}</For></div></TableCell>
      </TableRow>}</For></TableBody></Table>
    </div>
    <Dialog open={editor() !== null} onOpenChange={value => { if (!value && !pending()) { formEpoch++; setEditor(null); } }}><DialogContent class="max-h-[85vh] overflow-y-auto"><DialogTitle>{modalTitle()}</DialogTitle>
      <form class="mt-3 grid gap-3" onSubmit={event => void submit(event)}>
        <p class="m-0 text-xs text-neutral-500">{t("broadcast-writes.target_account", { name: accounts().find(row => row.id === account())?.name ?? '' })}</p>
        <Show when={editor()?.kind === 'create'}>
          <label class="grid gap-1 text-xs">{t("broadcast-writes.name")}<Input value={name()} maxLength={200} disabled={pending()} onInput={event => setName(event.currentTarget.value)}/></label>
          <label class="grid gap-1 text-xs">{t("broadcast-writes.template")}<Select value={templateId()} disabled={pending()} onChange={event => void chooseTemplate(Number(event.currentTarget.value))}><option value={0}>{t("broadcast-writes.choose")}</option><For each={templates()}>{row => <option value={row.id}>{row.name}</option>}</For></Select></label>
          <Show when={!formLoading() && templates().length === 0}><p role="note" class="text-xs">{t("broadcast-writes.no_templates")}</p></Show>
          <label class="grid gap-1 text-xs">{t("broadcast-writes.channel")}<Select value={channelId()} disabled={pending() || formLoading()} onChange={event => setChannelId(Number(event.currentTarget.value))}><option value={0}>{t("broadcast-writes.choose")}</option><For each={channels()}>{row => <option value={row.id}>{row.name || row.id}</option>}</For></Select></label>
          <Show when={templateId() && !formLoading() && channels().length === 0}><p role="note" class="text-xs">{t("broadcast-writes.no_channels")}</p></Show>
          <Show when={template() && !template()!.supported}><p role="alert" class="text-xs text-error-strong">{t("broadcast-writes.unsupported")}</p></Show>
          <For each={template()?.variables ?? []}>{key => <label class="grid gap-1 text-xs">{t("broadcast-writes.variable", { name: key })}<Input value={variableValue(key)} maxLength={1024} disabled={pending()} onInput={event => setMapping(values => ({ ...values, [key]: event.currentTarget.value }))}/></label>}</For>
        </Show>
        <Show when={editor()?.kind === 'contacts'}>
          <p class="m-0 text-sm">{(editor() as { campaign: Broadcast }).campaign.name}</p><p class="m-0 text-xs text-neutral-500">{t("broadcast-writes.audience_hint")}</p>
          <div class="grid max-h-64 gap-2 overflow-y-auto"><For each={contacts()}>{row => <label class="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected().includes(row.id)} disabled={pending() || !!formSuccess() || (!selected().includes(row.id) && selected().length >= 100)} onChange={event => setSelected(ids => event.currentTarget.checked ? [...ids, row.id] : ids.filter(id => id !== row.id))}/>{row.name || t("broadcast-writes.contact")} {row.phone ? `••••${row.phone.replace(/\D/g, '').slice(-4)}` : ''}</label>}</For></div>
          <Show when={!formLoading() && contacts().length === 0}><p role="status">{t("broadcast-writes.no_contacts")}</p></Show>
        </Show>
        <Show when={editor()?.kind === 'action'}>
          <p class="m-0 text-sm">{(editor() as { campaign: Broadcast }).campaign.name}</p>
          <p class="m-0 text-xs">{t("broadcast-writes.target_channel", { channel: (editor() as { campaign: Broadcast }).campaign.channel_id ?? t("broadcast-writes.no_channel") })}</p>
          <Show when={total() !== null}><p class="m-0 text-xs">{t("broadcast-writes.recipients", { count: total()! })}</p></Show>
          <p class="m-0 text-xs text-neutral-500">{t("broadcast-writes.confirm_hint")}</p>
          <Show when={(editor() as { action?: string })?.action === 'schedule'}><label class="grid gap-1 text-xs">{t("broadcast-writes.schedule_at")}<Input type="datetime-local" value={scheduled()} disabled={pending()} onInput={event => setScheduled(event.currentTarget.value)}/></label></Show>
        </Show>
        <Show when={formLoading()}><p role="status" class="text-xs">{t("broadcast-writes.loading")}</p></Show>
        <Show when={formError()}><p role="alert" class="text-sm text-error-strong">{formError()}</p></Show>
        <Show when={blocked()}><p role="alert" class="text-sm text-error-strong">{t("broadcast-writes.reconcile_required")}</p><Button type="button" variant="secondary" disabled={pending() || formLoading()} onClick={() => void reread()}>{t("broadcast-writes.reread")}</Button></Show>
        <Show when={formSuccess()}><p role="status" class="text-sm text-success-strong">{formSuccess()}</p></Show>
        <div class="flex justify-end gap-2"><Button type="button" variant="secondary" disabled={pending()} onClick={() => { formEpoch++; setEditor(null); }}>{t("broadcast-writes.close")}</Button><Button type="submit" disabled={!canSubmit()}>{t(pending() ? 'broadcast-writes.pending' : editor()?.kind === 'create' ? 'broadcast-writes.create' : editor()?.kind === 'contacts' ? 'broadcast-writes.add' : 'broadcast-writes.confirm')}</Button></div>
      </form>
    </DialogContent></Dialog>
  </section>;
}

function BroadcastDemo() {
  return <section class="flex h-full min-h-0 min-w-0 flex-col overflow-y-auto" aria-label={t("customize.broadcasts")}>
    <header class="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3"><h2 class="m-0 flex-1 text-sm font-semibold">{t("customize.broadcasts")}</h2><Badge forma="dato">{t("customize.prototype")}</Badge><Button size="sm" variant="secondary" disabled>{t("customize.new_unavailable")}</Button></header>
    <p role="note" class="m-0 border-b border-border bg-surface-muted px-4 py-3 text-xs leading-relaxed text-neutral-500">{t("customize.broadcast_notice")}</p>
    <div class="p-4"><Table><caption class="pb-3 text-left text-xs text-neutral-500">{t("customize.synthetic_campaigns")}</caption><TableHead><TableRow><TableHeaderCell>{t("customize.name")}</TableHeaderCell><TableHeaderCell>{t("customize.channel")}</TableHeaderCell><TableHeaderCell>{t("customize.state")}</TableHeaderCell></TableRow></TableHead><TableBody><TableRow><TableCell>{t("customize.sample_campaign")}</TableCell><TableCell>WhatsApp</TableCell><TableCell><Badge forma="dato">{t("customize.draft")}</Badge></TableCell></TableRow></TableBody></Table></div>
  </section>;
}
