import Search from "lucide-solid/icons/search";
import ArrowUp from "lucide-solid/icons/arrow-up";
import ArrowDown from "lucide-solid/icons/arrow-down";
import X from "lucide-solid/icons/x";
import { fromMarkdown } from "mdast-util-from-markdown";
import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { t } from "../../lib/i18n";
import { textoDeAtajo, ariaDeAtajo } from "../../lib/shortcuts";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";

export type SearchMessage = { block: number; text: string; markdown: boolean };
export type ThreadSearchTarget = {
  messages: () => SearchMessage[];
  thread: () => HTMLElement | undefined;
  jump: (block: number) => void;
};

type Match = { block: number; occurrence: number };
type PaintedMatch = { left: number; top: number; width: number; height: number; active: boolean };

type TextNode = { type: string; value?: string; children?: TextNode[] };
function plainText(node: TextNode): string {
  if (["html", "image", "definition"].includes(node.type)) return "";
  if (node.value !== undefined) return node.value;
  const separator = ["root", "list", "blockquote"].includes(node.type) ? "\n" : "";
  return node.children?.map(plainText).join(separator) ?? "";
}

function offsets(text: string, query: string): { start: number; end: number }[] {
  if (!query) return [];
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  return [...text.matchAll(pattern)].map(match => ({ start: match.index, end: match.index + match[0].length }));
}

function rangesIn(element: Element, query: string): Range[] {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes: { node: Text; start: number; end: number }[] = [];
  let text = "";
  let previousBlock: Element | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest("button, [aria-hidden='true']")) continue;
    const block = node.parentElement?.closest("p, pre, li, h1, h2, h3, h4, h5, h6, td, th") ?? null;
    if (text && previousBlock !== block) text += "\n";
    previousBlock = block;
    const value = node.textContent ?? "";
    nodes.push({ node: node as Text, start: text.length, end: text.length + value.length });
    text += value;
  }
  return offsets(text, query).flatMap(match => {
    const first = nodes.find(node => node.end > match.start);
    const last = nodes.find(node => node.end >= match.end);
    if (!first || !last) return [];
    const range = document.createRange();
    range.setStart(first.node, match.start - first.start);
    range.setEnd(last.node, match.end - last.start);
    return [range];
  });
}

export function ThreadSearch(props: {
  conversation: string;
  active: boolean;
  messages: SearchMessage[];
  thread: () => HTMLElement | undefined;
  onJump: (block: number) => void;
  leadingTools?: JSX.Element;
  tools?: JSX.Element;
}) {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [selected, setSelected] = createSignal(0);
  const [painted, setPainted] = createSignal<PaintedMatch[]>([]);
  let input: HTMLInputElement | undefined;
  let opener: HTMLElement | null = null;
  let frame = 0;
  const cache = new Map<string, string>();
  const matches = createMemo<Match[]>(() => {
    if (!open() || !query()) return [];
    const used = new Set<string>();
    const found = props.messages.flatMap(message => {
      let text = message.text;
      if (message.markdown) {
        used.add(text);
        let parsed = cache.get(text);
        if (parsed === undefined) {
          parsed = plainText(fromMarkdown(text));
          cache.set(text, parsed);
        }
        text = parsed;
      }
      return offsets(text, query()).map((_, occurrence) => ({ block: message.block, occurrence }));
    });
    for (const key of cache.keys()) if (!used.has(key)) cache.delete(key);
    return found;
  });
  const current = createMemo(() => matches()[Math.min(selected(), matches().length - 1)], undefined, {
    equals: (a, b) => a?.block === b?.block && a?.occurrence === b?.occurrence,
  });
  const paint = (scroll: boolean) => {
    const thread = props.thread();
    if (!thread || !open()) return setPainted([]);
    const target = current();
    const counts = new Map<number, number>();
    for (const match of matches()) counts.set(match.block, (counts.get(match.block) ?? 0) + 1);
    const results = [...thread.querySelectorAll<HTMLElement>("[data-thread-search-text]")].flatMap(element => {
      const block = Number(element.dataset.threadSearchText);
      return rangesIn(element, query()).slice(0, counts.get(block) ?? 0).map((range, occurrence) => ({ range, active: block === target?.block && occurrence === target.occurrence }));
    });
    if (scroll) {
      const rect = results.find(result => result.active)?.range.getBoundingClientRect();
      if (rect) thread.scrollTop += rect.top - thread.getBoundingClientRect().top - thread.clientHeight / 3;
    }
    const origin = thread.getBoundingClientRect();
    setPainted(results.flatMap(result => [...result.range.getClientRects()].map(rect => ({
      left: rect.left - origin.left + thread.scrollLeft,
      top: rect.top - origin.top + thread.scrollTop,
      width: rect.width, height: rect.height, active: result.active,
    }))));
  };
  const schedule = (scroll = false) => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => paint(scroll));
  };
  const close = () => {
    setOpen(false);
    setPainted([]);
    cache.clear();
    opener?.focus({ preventScroll: true });
  };
  const show = () => {
    if (!open()) opener = document.activeElement as HTMLElement | null;
    setOpen(true);
    input?.focus({ preventScroll: true });
    input?.select();
  };
  const move = (delta: number) => {
    const total = matches().length;
    if (total) setSelected((selected() + delta + total) % total);
  };
  createEffect(on(query, () => setSelected(0)));
  createEffect(on(() => props.conversation, () => {
    setOpen(false);
    setQuery("");
    setPainted([]);
    cache.clear();
  }, { defer: true }));
  createEffect(() => {
    const match = current();
    query();
    if (!open()) return;
    if (match) props.onJump(match.block);
    schedule(Boolean(match));
  });
  createEffect(() => {
    if (!open()) return;
    const thread = props.thread();
    const content = thread?.querySelector("[data-chat-thread]");
    if (!thread || !content) return;
    const observer = new MutationObserver(() => schedule());
    observer.observe(content, { subtree: true, childList: true, characterData: true });
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => schedule());
    resize?.observe(thread);
    resize?.observe(content);
    const repaint = () => schedule();
    thread.addEventListener("scroll", repaint);
    onCleanup(() => { observer.disconnect(); resize?.disconnect(); thread.removeEventListener("scroll", repaint); });
  });
  onMount(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!props.active || event.defaultPrevented || event.isComposing) return;
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "f") {
        if ((event.target as Element | null)?.closest(".cm-editor, [role='dialog']")) return;
        event.preventDefault();
        show();
      } else if (open() && event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
      }
    };
    window.addEventListener("keydown", keydown);
    onCleanup(() => window.removeEventListener("keydown", keydown));
  });
  onCleanup(() => cancelAnimationFrame(frame));
  return <>
    <div class="relative flex max-w-full items-start gap-1">
      <Show when={open()}>
        <div class="flex min-w-0 flex-wrap items-center gap-1 rounded-md border border-border-strong bg-surface-raised p-1 shadow-sm" role="search" aria-label={t("chat.search.label")}>
          <Input ref={input} class="w-44 min-w-0" value={query()} placeholder={t("chat.search.placeholder")}
            aria-label={t("chat.search.label")} onInput={event => setQuery(event.currentTarget.value)}
            onKeyDown={event => {
              if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); move(event.shiftKey ? -1 : 1); }
              if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
            }} />
          <span class="shrink-0 text-xs text-neutral-500" role="status" aria-live="polite">
            {query() ? matches().length ? t("chat.search.count", { current: Math.min(selected() + 1, matches().length), total: matches().length }) : t("chat.search.empty") : ""}
          </span>
          <Button variant="chrome" size="iconCompact" disabled={!matches().length} title={t("chat.search.previous")} aria-label={t("chat.search.previous")} onClick={() => move(-1)}><ArrowUp size={14} /></Button>
          <Button variant="chrome" size="iconCompact" disabled={!matches().length} title={t("chat.search.next")} aria-label={t("chat.search.next")} onClick={() => move(1)}><ArrowDown size={14} /></Button>
          <Button variant="chrome" size="iconCompact" title={t("chat.search.close")} aria-label={t("chat.search.close")} onClick={close}><X size={14} /></Button>
        </div>
      </Show>
      <div class="flex shrink-0 flex-col gap-1">
        {props.leadingTools}
        <Button variant="chrome" size="iconCompact" class="size-7 text-neutral-500" onClick={show}
          title={t("chat.search.open", { key: textoDeAtajo("findInTask") })} aria-label={t("chat.search.label")}
          aria-keyshortcuts={ariaDeAtajo("findInTask")} aria-expanded={open()}><Search size={14} /></Button>
        {props.tools}
      </div>
    </div>
    <Show when={open() && props.thread()}>{thread => <Portal mount={thread()}>
      <div class="pointer-events-none absolute inset-0" aria-hidden="true">
        <For each={painted()}>{rect => <span class="absolute rounded-sm bg-warning/20" classList={{ "outline-solid outline-2 outline-primary": rect.active }}
          style={{ left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` }} />}</For>
      </div>
    </Portal>}</Show>
  </>;
}
