import { For, createEffect, createSignal, on } from "solid-js";
import { invoke } from "../../lib/invoke.ts";
import { leerPref } from "../../lib/prefs";
import { t } from "../../lib/i18n";
import { Button } from "../../ui/Button";
import { Toast } from "../../ui/Toast";
import { createWorkspaces } from "../settings/workspaces-store";
import type { AttentionState, WorkspaceAttention } from "./attention";
import { Dynamic } from "solid-js/web";
import { cn } from "../../lib/utils";
import { stateColor, stateIcon } from "../projects/TaskStatus";

/** Qué tareas avisan: todas, solo las que necesitan a la persona, o ninguna. */
export type NotifyChoice = "all" | "needs_you" | "off";
export const NOTIFY_PREF = "notify.tasks";

const NEEDS_YOU: AttentionState[] = ["approving", "asked", "failed"];

type Notice = { key: string; workspace: string; session: string; project: string; state: AttentionState; title: string };

/** Detener tareas a mano las cierra todas a la vez; eso no se avisa como si hubieran terminado. */
let quietUntil = 0;
export function quietFinished(ms = 15000) {
  quietUntil = Date.now() + ms;
}

/**
 * Avisa cuando una tarea pasa a necesitar a la persona o termina sin que nadie
 * la mire. Fuera de la pantalla, aviso del sistema; a la vista sin foco, parpadeo
 * si la necesita; con foco en otra tarea, un aviso dentro de la app.
 */
export default function TaskNotifier(props: {
  attention: WorkspaceAttention[];
  workspace: string | null;
  session: string | null;
  title: (session: string) => string | undefined;
  open: (project: string, session: string) => void;
}) {
  const ws = createWorkspaces();
  const [notices, setNotices] = createSignal<Notice[]>([]);
  let before: Map<string, AttentionState> | null = null;

  const titleOf = (workspace: string, session: string) => {
    if (workspace === props.workspace) return props.title(session)?.trim() || t("shell.close.untitled");
    const name = ws.lista()?.find((w) => w.id === workspace)?.name;
    return name ? t("shell.notify.task_in", { name }) : t("shell.close.untitled");
  };

  const heading = (state: AttentionState, title: string) =>
    state === "approving" ? t("shell.notify.approving", { title })
    : state === "asked" ? t("shell.notify.waiting", { title })
    : state === "failed" ? t("shell.notify.failed", { title })
    : t("shell.notify.finished", { title });
  const hint = (state: AttentionState) =>
    state === "approving" ? t("shell.notify.approving_hint")
    : state === "asked" ? t("shell.notify.waiting_hint")
    : state === "failed" ? t("shell.notify.failed_hint")
    : t("shell.notify.finished_hint");

  async function announce(notice: Notice) {
    const choice = leerPref<NotifyChoice>(NOTIFY_PREF, "all");
    if (choice === "off" || (choice === "needs_you" && !NEEDS_YOU.includes(notice.state))) return;
    if (notice.state === "unseen" && Date.now() < quietUntil) return;
    // Rust decide con el foco nativo: aviso del sistema, parpadeo, o este panel.
    const where = await invoke<string>("tray_notify", {
      title: heading(notice.state, notice.title),
      body: hint(notice.state),
      needsYou: NEEDS_YOU.includes(notice.state),
    }).catch(() => "focused");
    if (where !== "focused") return;
    // Con la tarea delante ya se ve; un turno que cierra en otra lo pinta su pestaña.
    if (notice.workspace === props.workspace && notice.session === props.session) return;
    if (!NEEDS_YOU.includes(notice.state)) return;
    setNotices((list) => [...list.filter((n) => n.key !== notice.key), notice].slice(-3));
  }

  createEffect(
    on(
      () => props.attention,
      (list) => {
        const now = new Map<string, AttentionState>();
        for (const w of list) for (const task of w.tasks) now.set(`${w.workspace}/${task.session}`, task.state);
        // La primera lista es lo que ya esperaba al abrir: eso no es nuevo.
        if (before) {
          for (const w of list) {
            for (const task of w.tasks) {
              const key = `${w.workspace}/${task.session}`;
              if (before.get(key) === task.state) continue;
              void announce({ key, workspace: w.workspace, session: task.session, project: task.project, state: task.state, title: titleOf(w.workspace, task.session) });
            }
          }
        }
        before = now;
        setNotices((shown) => {
          const still = shown.filter((n) => now.get(n.key) === n.state);
          return still.length === shown.length ? shown : still;
        });
      },
    ),
  );

  function go(notice: Notice) {
    setNotices((list) => list.filter((n) => n.key !== notice.key));
    if (notice.workspace === props.workspace) props.open(notice.project, notice.session);
    else void ws.cambiarA(notice.workspace);
  }

  return (
    <For each={notices()}>
      {(notice) => (
        <Toast data-task-notice={notice.state} onDismiss={() => setNotices((list) => list.filter((n) => n.key !== notice.key))}>
          <div class="flex items-start gap-2">
            <Dynamic component={stateIcon(notice.state)} size={14} aria-hidden="true" class={cn("mt-px shrink-0", stateColor(notice.state))} />
            <p class="m-0 min-w-0 break-words text-xs text-neutral-950">{heading(notice.state, notice.title)}</p>
          </div>
          <div>
            <Button variant="outline" size="compact" onClick={() => go(notice)}>
              {t("shell.notify.open")}
            </Button>
          </div>
        </Toast>
      )}
    </For>
  );
}
