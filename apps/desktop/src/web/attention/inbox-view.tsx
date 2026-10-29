import ArrowLeft from 'lucide-solid/icons/arrow-left';
import ChevronDown from 'lucide-solid/icons/chevron-down';
import Globe from 'lucide-solid/icons/globe';
import IdCard from 'lucide-solid/icons/id-card';
import InboxIcon from 'lucide-solid/icons/inbox';
import Mail from 'lucide-solid/icons/mail';
import MessageCircle from 'lucide-solid/icons/message-circle';
import MessageSquare from 'lucide-solid/icons/message-square';
import Paperclip from 'lucide-solid/icons/paperclip';
import Search from 'lucide-solid/icons/search';
import SendHorizontal from 'lucide-solid/icons/send-horizontal';
import { For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { Conversation, Message } from '../../../../../packages/attention/src/inbox.ts';
import { t } from '../../lib/i18n';
import { Button } from '../../ui/Button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../ui/DropdownMenu';
import { Textarea } from '../../ui/Textarea';
import { Toggle } from '../../ui/Toggle';

// Medidas, radios y colores de globo tomados del Inbox de Danil Agents (Appv2); letra y fondos son de Terminus.

const initials = (name: string) => name.split(/\s+/).map(part => part.match(/[\p{L}\p{N}]/u)?.[0] ?? '').filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';
const contactName = (row: Conversation) => row.contact_name.trim() || t("web.alpha.contact_fallback");
const channelIcon = (channel: string) => /whatsapp/i.test(channel) ? MessageCircle : /web/i.test(channel) ? Globe : /mail|correo/i.test(channel) ? Mail : MessageSquare;
const aiState = (row: Conversation) => row.ai_assistance ? t("customize.ai_enabled") : t("customize.ai_paused");

export const senderLabel = (message: Message) => message.direction === 'inbound' ? '' : /^ai(-agent)?$/.test(message.sender_type) ? t("web.alpha.sender_ai") : t("web.alpha.sender_team");

function ContactAvatar(props: { name: string; channel: string; size: 'row' | 'card' }) {
  return <span class="relative mt-0.5 shrink-0" aria-label={props.channel || undefined}>
    <span aria-hidden="true" class={`grid place-items-center rounded-full bg-neutral-100 text-neutral-700 dark:bg-surface-raised ${props.size === 'row' ? 'size-9 text-[0.8rem]' : 'size-11 text-[0.85rem]'}`}>{initials(props.name)}</span>
    <Show when={props.size === 'row'}><span aria-hidden="true" class="absolute -right-0.5 -bottom-0.5 grid size-[15px] place-items-center rounded-full border border-border bg-surface text-neutral-500"><Dynamic component={channelIcon(props.channel)} size={9}/></span></Show>
  </span>;
}

export function ConversationSearch(props: { value: string; onChange: (value: string) => void }) {
  return <div class="flex h-8 w-full min-w-0 items-center gap-1.5 rounded-full border border-border bg-surface py-0 pr-1 pl-2.5 text-neutral-500 transition-all duration-150 ease-out focus-within:border-primary focus-within:ring-[3px] focus-within:ring-primary/15">
    <Search size={13} class="shrink-0 text-neutral-500" aria-hidden="true"/>
    <input type="search" aria-label={t("web.alpha.search_label")} placeholder={t("web.alpha.search_placeholder")} value={props.value} onInput={event => props.onChange(event.currentTarget.value)} class="h-full w-full min-w-0 border-none bg-transparent p-0 text-[12px] text-neutral-950 outline-none placeholder:text-neutral-500 [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-cancel-button]:[-webkit-appearance:none]"/>
  </div>;
}

const channelOption = 'flex cursor-pointer items-center gap-2 border border-transparent text-[0.78rem] aria-[current=true]:border-border-strong aria-[current=true]:bg-surface-raised aria-[current=true]:shadow-sm';

export function ChannelFilter(props: { channels: string[]; value: string | null; onChange: (value: string | null) => void }) {
  return <DropdownMenu>
    <DropdownMenuTrigger aria-label={t("web.alpha.channel_filter")} class="inline-flex h-8 min-h-8 w-auto max-w-[11rem] shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-neutral-200 bg-surface-raised px-2.5 py-1 text-[0.78rem] font-medium text-neutral-900 transition-colors outline-none hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-primary/20 dark:border-border-strong dark:text-neutral-950 dark:hover:bg-surface-muted">
      <Show when={props.value} fallback={<span class="truncate">{t("web.alpha.all_channels")}</span>}>{value => <><Dynamic component={channelIcon(value())} size={13} aria-hidden="true"/><span class="max-w-[80px] truncate">{value()}</span></>}</Show>
      <ChevronDown size={13} class="shrink-0 opacity-60" aria-hidden="true"/>
    </DropdownMenuTrigger>
    <DropdownMenuContent class="min-w-[180px]">
      <DropdownMenuItem class={channelOption} aria-current={props.value === null ? 'true' : undefined} onSelect={() => props.onChange(null)}><span class="flex-1 truncate">{t("web.alpha.all_channels")}</span></DropdownMenuItem>
      <For each={props.channels}>{channel => <DropdownMenuItem class={channelOption} aria-current={props.value === channel ? 'true' : undefined} onSelect={() => props.onChange(channel)}><Dynamic component={channelIcon(channel)} size={13} aria-hidden="true"/><span class="flex-1 truncate">{channel}</span></DropdownMenuItem>}</For>
    </DropdownMenuContent>
  </DropdownMenu>;
}

export function ConversationRow(props: { conversation: Conversation; active: boolean; onSelect: () => void }) {
  const row = () => props.conversation;
  return <button type="button" aria-current={props.active ? 'true' : undefined} onClick={props.onSelect} class="flex w-full min-w-0 max-w-full cursor-pointer items-start gap-3 overflow-hidden rounded-md border border-transparent bg-transparent px-2.5 py-2 text-left transition-colors outline-none hover:bg-surface-muted focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary aria-[current=true]:border-border-strong aria-[current=true]:bg-surface-raised aria-[current=true]:shadow-sm">
    <ContactAvatar name={contactName(row())} channel={row().channel_name} size="row"/>
    <span class="flex w-full min-w-0 max-w-full flex-1 gap-2 overflow-hidden">
      <span class="block min-w-0 flex-1 overflow-hidden">
        <span class="block min-w-0 truncate text-[0.88rem] font-semibold text-neutral-950">{contactName(row())}</span>
        <Show when={row().channel_name}><span class="mt-0.5 flex min-w-0 items-center overflow-hidden"><span title={row().channel_name} class="max-w-[60%] shrink-0 truncate rounded-sm bg-neutral-500/10 px-1 text-[0.62rem] leading-[1.5] font-medium text-neutral-700">{row().channel_name}</span></span></Show>
        <span class="mt-0.5 block min-w-0 truncate text-[0.8rem] text-neutral-500">{row().last_message || '—'}</span>
        <Show when={!row().ai_assistance}><span class="mt-1 flex min-w-0 flex-wrap items-center gap-1 overflow-hidden"><span class="inline-flex shrink-0 items-center rounded-sm bg-brand-yellow px-[3px] py-px text-[0.47rem] leading-[1.6] font-semibold tracking-[0.06em] text-brand-navy uppercase">{t("web.alpha.ai_off")}</span></span></Show>
      </span>
      <span class="flex shrink-0 flex-col items-end gap-1">
        <Show when={row().unread_count > 0}><span role="img" aria-label={t("web.alpha.unread_count", { count: row().unread_count })} class="inline-flex h-[15px] min-w-[15px] shrink-0 items-center justify-center rounded-full bg-brand-purple px-1 text-[0.5rem] leading-none font-bold text-white proportional-nums">{row().unread_count > 99 ? '99+' : row().unread_count}</span></Show>
      </span>
    </span>
  </button>;
}

export function SelectConversation() {
  return <div class="grid h-full place-items-center p-6 text-center">
    <div class="grid justify-items-center gap-2 text-neutral-500">
      <InboxIcon size={22} stroke-width={1.5} aria-hidden="true"/>
      <p class="m-0 text-[0.85rem] font-medium text-neutral-700">{t("web.alpha.select_conversation")}</p>
      <p class="m-0 text-[0.75rem]">{t("web.alpha.select_hint")}</p>
    </div>
  </div>;
}

export function ConversationHeader(props: { conversation: Conversation; detailsOpen: boolean; onBack: () => void; onToggleDetails: () => void }) {
  const row = () => props.conversation;
  return <header class="flex h-11 min-h-11 shrink-0 items-center gap-2 border-b border-border px-3 dark:bg-surface">
    <Button size="iconCompact" variant="ghost" class="text-neutral-500 @[46rem]:hidden" aria-label={t("web.alpha.back")} onClick={props.onBack}><ArrowLeft size={18}/></Button>
    <span class="flex min-w-0 flex-1 flex-col">
      <span class="truncate text-[0.9rem] font-semibold text-neutral-950">{contactName(row())}</span>
      <Show when={row().channel_name}><span class="flex min-w-0 items-center gap-1.5 truncate text-[0.72rem] font-medium text-neutral-500"><Dynamic component={channelIcon(row().channel_name)} size={12} aria-hidden="true"/><span class="truncate">{row().channel_name}</span></span></Show>
    </span>
    <span class="flex shrink-0 items-center gap-2 text-[0.78rem] font-semibold text-neutral-500" title={t("web.alpha.ai_read_only")}>
      <span class="hidden @[36rem]/detail:inline">{t("web.alpha.ai_assistance")}</span>
      <Toggle checked={row().ai_assistance} onChange={() => {}} disabled label={`${aiState(row())} · ${t("web.alpha.ai_read_only")}`}/>
    </span>
    <Button size="sm" variant={props.detailsOpen ? 'secondary' : 'ghost'} class="shrink-0 border-border bg-surface px-2 @[32rem]/detail:px-3" aria-label={t("web.alpha.contact_details")} aria-expanded={props.detailsOpen} aria-controls={`alpha-contact-${row().id}`} title={t("web.alpha.contact_details")} onClick={props.onToggleDetails}>
      <IdCard size={16} aria-hidden="true"/><span class="hidden @[32rem]/detail:inline">{t("web.alpha.details")}</span>
    </Button>
  </header>;
}

export function MessageBubble(props: { message: Message; position: 'first' | 'middle' | 'last' | 'single' }) {
  const outbound = () => props.message.direction === 'outbound';
  const deleted = () => !!props.message.deleted_at;
  const starts = () => props.position === 'first' || props.position === 'single';
  const tail = () => outbound() ? 'rounded-br-[6px]' : 'rounded-bl-[6px]';
  const top = () => starts() ? '' : outbound() ? 'rounded-tr-[6px]' : 'rounded-tl-[6px]';
  const ink = () => outbound() ? 'text-inbox-bubble-out-text' : 'text-neutral-950';
  const muted = () => outbound() ? 'text-inbox-bubble-out-muted' : 'text-neutral-500';
  return <div class={`flex min-w-0 flex-col gap-1 ${starts() ? 'mt-3' : 'mt-0.5'} ${outbound() ? 'items-end' : 'items-start'} ${deleted() ? 'opacity-70' : ''}`}>
    <article class={`relative min-w-0 max-w-[85%] rounded-[18px] border border-border/60 px-4 pt-3 pb-2 shadow-sm @[32rem]:max-w-[78%] @[48rem]:max-w-[70%] @[64rem]:max-w-[60%] ${top()} ${tail()} ${outbound() ? 'bg-inbox-bubble-out' : 'bg-inbox-bubble-in'}`}>
      <Show when={props.message.content} fallback={<Show when={!deleted()}><p class={`m-0 text-[0.92rem] leading-[1.42] italic ${muted()}`}>{t("web.alpha.attachment")}</p></Show>}>
        <p class={`m-0 min-w-0 whitespace-pre-wrap text-[0.92rem] leading-[1.42] [overflow-wrap:anywhere] ${deleted() ? `line-through ${muted()}` : ink()}`}>{props.message.content}</p>
      </Show>
      <footer class={`mt-1 flex items-center justify-end gap-1.5 text-[0.72rem] leading-none ${muted()}`}>
        <Show when={deleted()}><span class="italic">{t("web.alpha.deleted")}</span></Show>
        <Show when={outbound() && starts()}><span class="font-bold text-inbox-bubble-out-label">{senderLabel(props.message)}</span></Show>
      </footer>
    </article>
  </div>;
}

export function InboxComposer() {
  return <form class="absolute right-0 bottom-0 left-0 z-10 bg-transparent p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]" onSubmit={event => event.preventDefault()}>
    <p id="alpha-inbox-send-unavailable" class="m-0 mb-1.5 text-center text-[0.72rem] text-neutral-500">{t("web.alpha.send_unavailable")}</p>
    <div class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-end gap-2 rounded-2xl border border-border/60 bg-surface/30 p-1.5 shadow-sm backdrop-blur-[4px]">
      <Button size="icon" variant="ghost" disabled aria-label={t("web.alpha.attach")} aria-describedby="alpha-inbox-send-unavailable" class="rounded-full border border-border-strong bg-neutral-100 text-neutral-700 dark:bg-surface-raised"><Paperclip size={17}/></Button>
      <Textarea variant="ghost" rows={1} disabled aria-label={t("web.alpha.reply_label")} aria-describedby="alpha-inbox-send-unavailable" placeholder={t("web.alpha.reply_placeholder")} class="max-h-32 overflow-y-auto px-1 py-2 text-base leading-6"/>
      <Button size="icon" type="submit" disabled aria-label={t("web.alpha.send_reply")} aria-describedby="alpha-inbox-send-unavailable" class="rounded-full"><SendHorizontal size={17}/></Button>
    </div>
  </form>;
}

export function ContactDetails(props: { conversation: Conversation; onClose: () => void }) {
  const row = () => props.conversation;
  return <aside id={`alpha-contact-${row().id}`} aria-label={t("web.alpha.contact_details")} class="absolute inset-0 z-20 flex h-full w-full flex-col overflow-hidden bg-surface @[40rem]/detail:relative @[40rem]/detail:inset-auto @[40rem]/detail:z-0 @[40rem]/detail:w-[20rem] @[40rem]/detail:shrink-0 @[40rem]/detail:border-l @[40rem]/detail:border-border">
    <div class="flex h-11 min-h-11 shrink-0 items-center border-b border-border bg-surface px-4 @[40rem]/detail:hidden">
      <Button size="iconCompact" variant="ghost" class="mr-2 text-neutral-500" aria-label={t("web.alpha.back_to_chat")} onClick={props.onClose}><ArrowLeft size={18}/></Button>
      <h3 class="m-0 text-[0.9rem] font-semibold text-neutral-950">{t("web.alpha.contact_details_title")}</h3>
    </div>
    <section class="flex h-full min-h-0 min-w-0 flex-col gap-3 overflow-y-auto p-4">
      <header class="flex items-start gap-3">
        <ContactAvatar name={contactName(row())} channel={row().channel_name} size="card"/>
        <div class="min-w-0 flex-1">
          <h3 class="m-0 truncate text-[1rem] font-semibold text-neutral-950">{contactName(row())}</h3>
          <Show when={row().channel_name}><span class="text-[0.78rem] text-neutral-500">{row().channel_name}</span></Show>
        </div>
      </header>
      <dl class="m-0 grid gap-1.5 text-[0.82rem]">
        <div class="flex items-center justify-between gap-2"><dt class="text-neutral-500">{t("web.alpha.channel")}</dt><dd class="m-0 truncate text-neutral-700">{row().channel_name || '—'}</dd></div>
        <div class="flex items-center justify-between gap-2"><dt class="text-neutral-500">{t("web.alpha.ai_assistance")}</dt><dd class="m-0 truncate text-neutral-700">{row().ai_assistance ? t("web.alpha.ai_on_short") : t("web.alpha.ai_paused_short")}</dd></div>
      </dl>
      <div class="my-1 border-t border-border/60"/>
      <div class="flex flex-col gap-1.5">
        <span class="text-[0.72rem] font-semibold tracking-wider text-neutral-500 uppercase">{t("web.alpha.notes")}</span>
        <p class="m-0 text-[0.8rem] text-neutral-500">{t("web.alpha.notes_unavailable")}</p>
      </div>
    </section>
  </aside>;
}
