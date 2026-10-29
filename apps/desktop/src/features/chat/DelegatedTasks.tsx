import { type ComponentProps, createEffect, createSignal, on, Show } from "solid-js";
import GitBranch from "lucide-solid/icons/git-branch";
import { t } from "../../lib/i18n";
import type { SenderTask } from "../../lib/recipients";
import { Button } from "../../ui/Button";
import { asFailure, FailureNote } from "../../ui/Failure";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/Popover";
import Sessions, { type SessionRow } from "../projects/Sessions";
import { delegatedRailRows } from "./delegatedRail";
import { buildTaskTree, type TaskBranch, type TaskTreeRow, taskIdentity, taskDescendants, withTaskAncestors } from "@terminus/tasks";
import { taskPriority } from "@terminus/design";
import { delegatedAttention } from "./delegatedRail";

export { delegatedAttention } from "./delegatedRail";

export type DelegatedListProps = Omit<ComponentProps<typeof Sessions>, "sessions" | "flat" | "card" | "hoverCardPlacement" | "includeArchived" | "groupByAuthor" | "groupByHandler">;

export function delegatedDescendants(rows: SessionRow[], root: TaskTreeRow): SessionRow[] {
  return taskDescendants(rows, [root]);
}

export function delegatedFamilies(rows: SessionRow[]): Map<string, string[]> {
  const families = new Map<string, string[]>();
  const visit = (branches: TaskBranch<SessionRow>[], ancestors: string[]) => {
    for (const branch of branches) {
      for (const ancestor of ancestors) families.set(ancestor, [...(families.get(ancestor) ?? []), branch.tarea.id]);
      visit(branch.hijas, [...ancestors, branch.tarea.id]);
    }
  };
  visit(buildTaskTree(rows), []);
  return families;
}

/** Las delegadas con la tarjeta del riel (`taskCard`): estado y título; proveedor, carpeta, máquina, agente y PR. */
export function DelegatedTaskList(props: {
  rows: SessionRow[];
  list: (folder: string) => DelegatedListProps;
  readOnly?: boolean;
  hoverCardPlacement?: "left-start" | "right-start";
  matchingIds?: readonly string[];
}) {
  const folderOf = (id: string) => props.rows.find(row => row.id === id)?.folder ?? "";
  const base = () => props.list(props.rows[0]?.folder ?? "");
  return <Sessions {...base()} card hoverCardPlacement={props.hoverCardPlacement} sessions={props.rows} includeArchived readOnly={props.readOnly}
    matchingIds={props.matchingIds} groupByAuthor={false} groupByHandler={false}
    projectOf={row => row.folder ?? ""}
    carpetaDe={row => props.list(row.folder ?? "").carpetaDe?.(row)}
    destinosDe={row => props.list(row.folder ?? "").destinos}
    onPick={id => props.list(folderOf(id)).onPick(id)}
    onPickRelated={row => props.list(row.folder ?? "").onPick(row.id)}
    onDelete={id => props.list(folderOf(id)).onDelete(id)}
    onMove={(id, to) => props.list(folderOf(id)).onMove(id, to)}
    onEtapa={(id, stage) => props.list(folderOf(id)).onEtapa(id, stage)}
    onRenombrar={(id, title) => props.list(folderOf(id)).onRenombrar(id, title)}
    onPin={base().onPin ? (id, pinned) => props.list(folderOf(id)).onPin?.(id, pinned) : undefined} />;
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
    provider: props.reference.provider, model: props.reference.model ?? null, refs: [],
    created_at: 0, updated_at: 0, turns: 0, parent: null, subagent: null,
    esperando: false, stage: null, agent: null, parent_agent: null, chat_de_agente: false,
  });
  return <div data-delegated-launch={props.reference.task} class="my-2 min-w-0 border-l border-border pl-2">
    <DelegatedTaskList rows={[row() ?? referenceRow(), ...taskDescendants(props.rows, [row() ?? referenceRow()])]} list={props.list} readOnly={!row()} />
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
  const rows = () => delegatedRailRows(props.rows, true, props.live, props.approvals);
  const active = () => rows().filter(row => taskPriority(delegatedAttention([row], props.live, props.approvals)));
  const shown = () => all() ? rows() : withTaskAncestors(rows(), active());
  return <Show when={rows().length || props.error}>
    <Popover open={open()} onOpenChange={setOpen} placement="left-start" gutter={8}>
      <PopoverTrigger as={(trigger: object) => <Button {...trigger} type="button" variant="chrome" size="iconCompact"
        class="relative size-7 text-neutral-500"
        data-delegated-trigger="toolbar"
        aria-label={t("chat.delegation.open", { count: rows().length })}
        title={t("chat.delegation.open", { count: rows().length })}>
        <GitBranch size={14} aria-hidden="true" />
        <span class="absolute -right-0.5 -bottom-0.5 min-w-3 rounded bg-surface-raised px-0.5 text-[9px] leading-3 tabular-nums">{rows().length}</span>
      </Button>} />
      <PopoverContent class="w-96 max-w-[calc(100vw-24px)] p-2" aria-label={t("chat.delegation.heading")}>
        <div class="flex items-center justify-between gap-2 px-2 pb-2 text-xs">
          <span class="font-medium">{t("chat.delegation.total", { count: rows().length })}</span>
          <div class="flex gap-1" role="group" aria-label={t("chat.delegation.filter")}>
            <Button size="sm" variant="ghost" class="h-6 px-2 text-xs" aria-pressed={!all()} onClick={() => setAll(false)}>{t("chat.delegation.activity")}</Button>
            <Button size="sm" variant="ghost" class="h-6 px-2 text-xs" aria-pressed={all()} onClick={() => setAll(true)}>{t("chat.delegation.all")}</Button>
          </div>
        </div>
        <div data-delegated-list class="max-h-[min(55vh,420px)] overflow-y-auto overscroll-contain">
          <Show when={props.error}>{error => <><FailureNote f={asFailure(error())} /><Button variant="ghost" size="sm" onClick={props.onRetry}>{t("chat.delegation.retry")}</Button></>}</Show>
          <Show when={shown().length} fallback={<p class="m-0 px-2 py-3 text-xs text-neutral-500">{props.loading ? t("chat.delegation.loading") : t("chat.delegation.idle")}</p>}>
            <DelegatedTaskList rows={shown()} hoverCardPlacement="left-start" matchingIds={all() ? undefined : active().map(taskIdentity)} list={folder => ({ ...props.list(folder), onPick: id => {
              setOpen(false);
              props.list(folder).onPick(id);
            } })} />
          </Show>
        </div>
      </PopoverContent>
    </Popover>
  </Show>;
}
