import { type ComponentProps, createEffect, createMemo, createSignal, For, on, Show } from "solid-js";
import GitBranch from "lucide-solid/icons/git-branch";
import { t } from "../../lib/i18n";
import type { SenderTask } from "../../lib/recipients";
import { Button } from "../../ui/Button";
import { asFailure, FailureNote } from "../../ui/Failure";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/Popover";
import Sessions, { type SessionRow } from "../projects/Sessions";
import { taskPriority, type TaskActivity } from "../projects/taskActivity";

export type DelegatedListProps = Omit<ComponentProps<typeof Sessions>, "sessions" | "flat" | "includeArchived" | "groupByAuthor" | "groupByHandler">;

export function delegatedAttention(rows: SessionRow[], live: readonly string[], approvals: readonly string[]): TaskActivity {
  return {
    aprobando: rows.some(row => approvals.includes(row.id)),
    esperando: rows.some(row => row.esperando),
    viva: rows.some(row => live.includes(row.id)),
    outcome: rows.some(row => row.outcome === "failed") ? "failed" : null,
    sinVer: rows.some(row => row.sin_ver),
  };
}

export function delegatedDescendants(rows: SessionRow[], root: string): SessionRow[] {
  const selected = new Set([root]);
  let previous = 0;
  while (previous !== selected.size) {
    previous = selected.size;
    for (const row of rows) {
      const launcher = row.parent ?? row.launched_by;
      if (launcher && selected.has(launcher)) selected.add(row.id);
    }
  }
  return rows.filter(row => row.id !== root && selected.has(row.id));
}

export function delegatedFamilies(rows: SessionRow[]): Map<string, string[]> {
  const known = new Map(rows.map(row => [row.id, row]));
  const families = new Map<string, string[]>();
  for (const row of rows) {
    const seen = new Set([row.id]);
    let parent = row.parent ?? row.launched_by;
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      const family = families.get(parent);
      if (family) family.push(row.id);
      else families.set(parent, [row.id]);
      const ancestor = known.get(parent);
      parent = ancestor?.parent ?? ancestor?.launched_by;
    }
  }
  return families;
}

export function DelegatedTaskList(props: {
  rows: SessionRow[];
  list: (folder: string) => DelegatedListProps;
  readOnly?: boolean;
}) {
  const folders = createMemo(() => [...new Set(props.rows.map(row => row.folder ?? ""))]);
  return <For each={folders()}>{folder => <Sessions {...props.list(folder)}
    sessions={props.rows.filter(row => (row.folder ?? "") === folder)}
    flat includeArchived readOnly={props.readOnly} groupByAuthor={false} groupByHandler={false} />}</For>;
}

export function DelegatedLaunch(props: {
  reference: SenderTask;
  rows: SessionRow[];
  list: (folder: string) => DelegatedListProps;
  loading: boolean;
  error?: unknown;
}) {
  const row = () => props.rows.find(row => row.id === props.reference.task);
  const referenceRow = (): SessionRow => ({
    id: props.reference.task, folder: props.reference.folder, title: props.reference.title,
    agent: props.reference.agent, model: props.reference.model ?? null, refs: [],
    created_at: 0, updated_at: 0, turns: 0, parent: null, subagent: null,
    esperando: false, stage: null, encargado: null, encargado_del_padre: null, chat_de_agente: false,
  });
  return <div data-delegated-launch={props.reference.task} class="my-2 min-w-0 border-l border-border pl-2">
    <DelegatedTaskList rows={[row() ?? referenceRow()]} list={props.list} readOnly={!row()} />
    <Show when={!row()}><p class="m-0 px-2 pt-1 text-xs text-neutral-500">
      {props.loading ? t("chat.delegation.loading") : props.error ? t("chat.delegation.failed") : t("chat.delegation.unavailable")}
    </p></Show>
  </div>;
}

export default function DelegatedActivity(props: {
  context: string;
  rows: SessionRow[];
  list: (folder: string) => DelegatedListProps;
  live: string[];
  approvals: string[];
  loading: boolean;
  error?: unknown;
  onRetry: () => void;
}) {
  const [all, setAll] = createSignal(false);
  const [open, setOpen] = createSignal(false);
  createEffect(on(() => props.context, () => { setOpen(false); setAll(false); }));
  const active = () => props.rows.filter(row => taskPriority(delegatedAttention([row], props.live, props.approvals)));
  const shown = () => all() ? props.rows : active();
  return <Show when={props.rows.length || props.error}>
    <Popover open={open()} onOpenChange={setOpen} placement="left-start" gutter={8}>
      <PopoverTrigger as={(trigger: object) => <Button {...trigger} type="button" variant="chrome" size="iconCompact"
        class="relative size-7 text-neutral-500"
        data-delegated-trigger="toolbar"
        aria-label={t("chat.delegation.open", { count: props.rows.length })}
        title={t("chat.delegation.open", { count: props.rows.length })}>
        <GitBranch size={14} aria-hidden="true" />
        <span class="absolute -right-0.5 -bottom-0.5 min-w-3 rounded bg-surface-raised px-0.5 text-[9px] leading-3 tabular-nums">{props.rows.length}</span>
      </Button>} />
      <PopoverContent class="w-96 max-w-[calc(100vw-24px)] p-2" aria-label={t("chat.delegation.heading")}>
        <div class="flex items-center justify-between gap-2 px-2 pb-2 text-xs">
          <span class="font-medium">{t("chat.delegation.total", { count: props.rows.length })}</span>
          <div class="flex gap-1" role="group" aria-label={t("chat.delegation.filter")}>
            <Button size="sm" variant="ghost" class="h-6 px-2 text-xs" aria-pressed={!all()} onClick={() => setAll(false)}>{t("chat.delegation.activity")}</Button>
            <Button size="sm" variant="ghost" class="h-6 px-2 text-xs" aria-pressed={all()} onClick={() => setAll(true)}>{t("chat.delegation.all")}</Button>
          </div>
        </div>
        <div data-delegated-list class="max-h-[min(55vh,420px)] overflow-y-auto overscroll-contain">
          <Show when={props.error}>{error => <><FailureNote f={asFailure(error())} /><Button variant="ghost" size="sm" onClick={props.onRetry}>{t("chat.delegation.retry")}</Button></>}</Show>
          <Show when={shown().length} fallback={<p class="m-0 px-2 py-3 text-xs text-neutral-500">{props.loading ? t("chat.delegation.loading") : t("chat.delegation.idle")}</p>}>
            <DelegatedTaskList rows={shown()} list={folder => ({ ...props.list(folder), onPick: id => {
              setOpen(false);
              props.list(folder).onPick(id);
            } })} />
          </Show>
        </div>
      </PopoverContent>
    </Popover>
  </Show>;
}
