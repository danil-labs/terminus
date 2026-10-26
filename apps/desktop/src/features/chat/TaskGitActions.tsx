import Rocket from "lucide-solid/icons/rocket";
import { createEffect, createMemo, createSignal, on, onCleanup, Show } from "solid-js";
import { invoke } from "../../lib/invoke";
import { t } from "../../lib/i18n";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogTitle } from "../../ui/Dialog";
import { asFailure, type Failure, FailureNote } from "../../ui/Failure";
import { canFinishTask, effectiveTaskGit, retainGitObservation, watchSessionGit, type GitStatus } from "../projects/taskGit";
import SessionGit, { sessionGitDescription } from "../projects/SessionGit";

type Task = { id: string; parent?: string | null; subagent?: string | null; archived?: boolean | null };
type Blockers = { unsaved: unknown[]; not_finished?: boolean };

export default function TaskGitActions(props: {
  workspace: string;
  project: string;
  session: string;
  machine?: string;
  on: boolean;
  busy: boolean;
  readOnly: boolean;
  title: string;
  tasks: Task[];
  onFinished: () => void;
}) {
  // Las props JSX pueden crear memos al leerse: se capturan con dueño antes de usarlas en callbacks asíncronos.
  const context = createMemo(() => ({ workspace: props.workspace, project: props.project, session: props.session, machine: props.machine, on: props.on, busy: props.busy, readOnly: props.readOnly, title: props.title, tasks: props.tasks, onFinished: props.onFinished }));
  const [rows, setRows] = createSignal<Record<string, GitStatus>>({});
  const [sheet, setSheet] = createSignal<"details" | "finish" | null>(null);
  const [finishing, setFinishing] = createSignal(false);
  const [failure, setFailure] = createSignal<Failure | null>(null);
  const scope = createMemo(() => JSON.stringify([context().workspace, context().project, context().session, context().machine]));
  const online = createMemo(() => context().on);
  const options = () => ({ headers: { "x-terminus-workspace": context().workspace, ...(context().machine ? { "x-terminus-machine": context().machine } : {}) } });
  const task = () => context().tasks.find((row) => row.id === context().session) ?? { id: context().session };
  const status = createMemo(() => {
    const git = effectiveTaskGit(task(), rows(), context().tasks);
    return context().on ? git : { ...git, stale: true };
  });
  const ready = () => !context().readOnly && context().on && canFinishTask(task(), status(), context().busy || finishing());
  let read = () => {};
  let previousScope: string | undefined;
  createEffect(on(() => [scope(), online()] as const, ([key]) => {
    if (previousScope !== key) setRows({});
    previousScope = key;
    setFailure(null);
    setSheet(null);
    if (!context().on || !context().project) { read = () => {}; return; }
    const observation = watchSessionGit(context().project, { workspace: context().workspace, machine: context().machine });
    observation.prioritize([context().session]);
    read = observation.refresh;
    createEffect(() => {
      const value = observation.rows();
      setRows((before) => retainGitObservation(before, value));
      const error = observation.error();
      setFailure(error ? asFailure(error) : null);
    });
    onCleanup(() => { read = () => {}; observation.release(); });
  }));
  const finish = async () => {
    if (!ready()) return;
    const key = scope();
    const args = { project: context().project, id: context().session };
    const opts = options();
    setFinishing(true);
    setFailure(null);
    try {
      const blockers = await invoke<Blockers>("task_blockers", { ...args, finish: true }, opts);
      if (scope() !== key || !context().on) return;
      if (blockers.unsaved.length || blockers.not_finished) {
        setFailure({ what: t("chat.task.finish_blocked"), detail: "" });
        read();
        return;
      }
      await invoke("finish_task", args, opts);
      if (scope() === key) context().onFinished();
    } catch (error) {
      if (scope() === key) setFailure(asFailure(error));
    } finally {
      setFinishing(false);
    }
  };
  return <>
    <Show when={!!context().project}><div data-task-git-actions class="ml-auto flex min-w-0 shrink-0 items-center gap-1">
      <button type="button" data-task-pr aria-label={sessionGitDescription(status()) || t("chat.task.details")} onClick={() => setSheet("details")} class="flex min-h-9 min-w-0 items-center rounded-sm px-1 text-xs outline-none hover:bg-neutral-200 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-primary">
        <Show when={status().pull || status().branch || status().kind === "kn"} fallback={<span>{t("projects.git.unknown")}</span>}>
          <SessionGit status={status()} compact />
        </Show>
      </button>
      <Button variant="ghost" size="icon" data-task-finish disabled={!ready()} aria-busy={finishing()} aria-label={t("projects.sessions.finish")} title={ready() ? t("projects.sessions.finish") : t("chat.task.finish_unavailable")} class="size-9 shrink-0 text-brand-purple" onClick={() => setSheet("finish")}>
        <Rocket size={17} />
      </Button>

    </div></Show>
    <Show when={sheet() !== null}><Dialog open={sheet() !== null} onOpenChange={(value) => { if (!value && !finishing()) setSheet(null); }}>
      <DialogContent>
        <DialogTitle class="text-base font-semibold">{sheet() === "finish" ? t("projects.sessions.finish") : t("chat.task.details")}</DialogTitle>
        <p class="mt-3 break-words text-sm font-medium">{context().title}</p>
        <Show when={sheet() === "details"} fallback={<p class="mt-3 text-sm text-neutral-500">{status().shared_with || task().subagent ? t("chat.task.finish_shared") : t("chat.task.finish_confirm")}</p>}>
          <p class="mt-3 text-sm text-neutral-500">{sessionGitDescription(status()) || t("projects.git.unknown")}</p>
          <Show when={!ready()}><p class="mt-3 text-sm text-neutral-500">{t("chat.task.finish_unavailable")}</p></Show>
          <Button variant="outline" size="compact" class="mt-3" onClick={read} disabled={!context().on}>{t("chat.task.refresh")}</Button>
        </Show>
        <Show when={failure()}>{(error) => <div class="mt-3"><FailureNote f={error()} /></div>}</Show>
        <div class="mt-4 flex justify-end gap-2">
          <Button variant="ghost" disabled={finishing()} onClick={() => setSheet(null)}>{t("projects.sessions.blockers_cancel")}</Button>
          <Button disabled={!ready()} data-task-finish-confirm onClick={() => sheet() === "finish" ? void finish() : setSheet("finish")}>{t("projects.sessions.finish")}</Button>
        </div>
      </DialogContent>
    </Dialog></Show>
  </>;
}
