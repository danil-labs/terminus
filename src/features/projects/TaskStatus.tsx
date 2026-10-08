import Check from "lucide-solid/icons/check";
import CircleAlert from "lucide-solid/icons/circle-alert";
import CircleHelp from "lucide-solid/icons/circle-help";
import ShieldQuestion from "lucide-solid/icons/shield-question";
import { Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import { t } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { type TaskActivity, taskPriority } from "./taskActivity";

export function taskLabel(state: ReturnType<typeof taskPriority>, folded = false) {
    switch (state) {
      case "approving": return folded ? t("projects.status.folded_approving") : t("projects.status.approving");
      case "asked": return folded ? t("projects.status.folded_asked") : t("projects.status.asked");
      case "working": return folded ? t("projects.status.folded_working") : t("projects.status.working");
      case "failed": return folded ? t("projects.status.folded_failed") : t("projects.status.failed");
      case "unseen": return folded ? t("projects.status.folded_unseen") : t("projects.status.unseen");
      default: return "";
    }
}

/** Lo comparten la fila, lo plegado y la columna de workspaces: un color por estado. */
export function stateColor(state: ReturnType<typeof taskPriority>) {
  switch (state) {
    case "failed": return "text-error-strong";
    case "approving": return "text-warning";
    case "working": return "text-primary";
    case "unseen": return "text-success-strong";
    default: return "text-brand-yellow";
  }
}

export function stateIcon(state: ReturnType<typeof taskPriority>) {
  switch (state) {
    case "failed": return CircleAlert;
    case "approving": return ShieldQuestion;
    case "unseen": return Check;
    default: return CircleHelp;
  }
}

export default function EstadoDeTarea(props: TaskActivity & {
  ambito?: "tarea" | "plegadas";
  class?: string;
  /** Lado del icono; la fila del riel lo sube a 13. */
  size?: number;
}) {
  const lado = () => props.size ?? 12;
  const state = () => taskPriority(props);
  const label = () => taskLabel(state(), props.ambito === "plegadas");
  return <Show when={state() || (props.outcome === "delivered" && props.ambito !== "plegadas")}><span class={cn("inline-flex shrink-0 items-center gap-0.5", props.class)}>
    <Show when={state()} fallback={<Show when={props.outcome === "delivered" && props.ambito !== "plegadas"}><span class="inline-flex shrink-0 text-neutral-500" title={t("projects.status.delivered")} aria-label={t("projects.status.delivered")}><Check size={lado()} aria-hidden="true" /></span></Show>}>
      <span class={cn("inline-flex shrink-0 items-center justify-center", stateColor(state()))} style={{ width: `${lado()}px`, height: `${lado()}px` }} title={label()} aria-label={label()}>
        <Show when={state() === "working"} fallback={<Dynamic component={stateIcon(state())} size={lado()} aria-hidden="true" />}>
          <span aria-hidden="true" class="size-1.5 rounded-full bg-current" />
        </Show>
      </span>
    </Show>
  </span></Show>;
}
