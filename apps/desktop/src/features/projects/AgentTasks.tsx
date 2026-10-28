import { type ComponentProps, createEffect, createSignal, on, Show } from "solid-js";
import RightPanelHeader from "../shell/RightPanelHeader";
import { t } from "../../lib/i18n";
import { Input } from "../../ui/Input";
import { taskDescendants, taskIdentity } from "@terminus/tasks";
import Sessions, { type SessionRow } from "./Sessions";

export function createdTasks(rows: SessionRow[], agent: string, thread: string | null, folder?: string): SessionRow[] {
  const scoped = folder === undefined ? rows : rows.filter(row => (row.folder ?? "") === folder);
  const conversations = new Set(scoped.filter(row => row.chat_de_agente && row.agent === agent).map(row => row.id));
  const seeds = scoped.filter(row => !row.chat_de_agente && (thread
    ? row.launched_by === thread
    : !!row.launched_by && (conversations.has(row.launched_by) || row.launcher_name === agent)));
  const ids = new Set([...seeds, ...taskDescendants(rows, seeds)].map(taskIdentity));
  return rows.filter(row => ids.has(taskIdentity(row)));
}

export default function AgentTasks(props: {
  context: string;
  tasks: SessionRow[];
  list: Omit<ComponentProps<typeof Sessions>, "sessions" | "onPick" | "groupByAuthor" | "search">;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = createSignal("");
  createEffect(on(() => props.context, () => setSearch("")));
  return <aside data-agent-tasks class="flex h-full min-h-0 flex-col">
    <RightPanelHeader title={t("projects.agent_tasks.title")} closeLabel={t("projects.agent_tasks.close")}
      closeTooltip={t("projects.agent_tasks.close")} onClose={props.onClose} />
    <div class="px-2 pt-2">
      <Input type="search" aria-label={t("projects.agent_tasks.search")} placeholder={t("projects.agent_tasks.search")} value={search()} onInput={event => setSearch(event.currentTarget.value)} />
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto p-2">
      <Show when={props.tasks.length}>
        <Sessions {...props.list} sessions={props.tasks} onPick={props.onPick} groupByAuthor={false} search={search()} />
      </Show>
    </div>
  </aside>;
}
