import Archive from "lucide-solid/icons/archive";
import Check from "lucide-solid/icons/check";
import CircleAlert from "lucide-solid/icons/circle-alert";
import CircleHelp from "lucide-solid/icons/circle-help";
import CirclePause from "lucide-solid/icons/circle-pause";
import ShieldQuestion from "lucide-solid/icons/shield-question";
import { Match, Show, Switch } from "solid-js";
import { Dynamic } from "solid-js/web";
import { t } from "../../lib/i18n";
import "../../lib/sharedClock";
import { cn } from "../../lib/utils";
import { type TaskActivity, taskPriority } from "@terminus/design";

export function taskLabel(state: ReturnType<typeof taskPriority>, folded = false) {
    switch (state) {
      case "approving": return folded ? t("projects.status.folded_approving") : t("projects.status.approving");
      case "asked": return folded ? t("projects.status.folded_asked") : t("projects.status.asked");
      case "working": return folded ? t("projects.status.folded_working") : t("projects.status.working");
      case "failed": return folded ? t("projects.status.folded_failed") : t("projects.status.failed");
      case "interrupted": return folded ? t("projects.status.folded_interrupted") : t("projects.status.interrupted");
      case "unseen": return folded ? t("projects.status.folded_unseen") : t("projects.status.unseen");
      default: return "";
    }
}

/** Lo comparten la fila, lo plegado y la columna de workspaces: un color por estado. */
export function stateColor(state: ReturnType<typeof taskPriority>) {
  switch (state) {
    case "failed": return "text-error-strong";
    case "interrupted": return "text-neutral-500";
    case "approving": return "text-warning";
    case "working": return "text-primary";
    case "unseen": return "text-success-strong";
    default: return "text-brand-yellow";
  }
}

export function stateIcon(state: ReturnType<typeof taskPriority>) {
  switch (state) {
    case "failed": return CircleAlert;
    case "interrupted": return CirclePause;
    case "approving": return ShieldQuestion;
    case "unseen": return Check;
    default: return CircleHelp;
  }
}

/**
 * El color de cada estado en la tarjeta del riel: preguntar y pedir aprobación
 * comparten el ámbar fuerte, que sobre el fondo del riel se lee como texto.
 */
function railColor(state: ReturnType<typeof taskPriority>) {
  switch (state) {
    case "failed": return "text-error-strong";
    case "interrupted": return "text-neutral-500";
    case "approving":
    case "asked": return "text-warning-strong";
    default: return "text-neutral-500";
  }
}

/**
 * El arco que gira sobre su pista: «trabajando» en la tarjeta del riel. Va al
 * reloj común (`lib/sharedClock.ts`): diez tareas trabajando dan un paso juntas.
 */
export function RailSpinner(props: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={props.size ?? 14} height={props.size ?? 14} class="animate-riel-giro" aria-hidden="true" data-shared-clock>
      <circle cx="8" cy="8" r="5.5" fill="none" stroke-width="2" style={{ stroke: "var(--color-border-strong)" }} />
      <path d="M8 2.5a5.5 5.5 0 0 1 5.5 5.5" fill="none" stroke-width="2" stroke-linecap="round" style={{ stroke: "var(--color-primary)" }} />
    </svg>
  );
}

/** El anillo punteado de la tarea que el motor todavía registra. */
function RailDashedRing(props: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={props.size ?? 14} height={props.size ?? 14} class="animate-riel-giro-lento text-neutral-500" aria-hidden="true" data-shared-clock>
      <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2.2 2.4" />
    </svg>
  );
}

/**
 * La marca de la tarjeta del riel, a la derecha del título: un hueco de 16 px
 * que se queda vacío cuando no hay nada que decir.
 *
 * Trabajando es un arco que gira; recién creada, un anillo punteado más lento;
 * sin ver, un punto verde; detenida por ti, una pausa gris, separada del fallo.
 * Terminada y vista no lleva nada: lo dice la fila apagándose.
 */
function RailMark(props: TaskActivity & { provisional?: boolean; archivada?: boolean; plegadas?: boolean; size?: number }) {
  const state = () => taskPriority(props);
  const label = () => taskLabel(state(), !!props.plegadas);
  const lado = () => props.size ?? 14;
  return (
    <Switch>
      <Match when={props.provisional && !props.plegadas}>
        <span class="inline-flex shrink-0 items-center justify-center" title={t("projects.status.provisional")} aria-label={t("projects.status.provisional")}>
          <RailDashedRing size={lado()} />
        </span>
      </Match>
      <Match when={state() === "working"}>
        <span class="inline-flex shrink-0 items-center justify-center" title={label()} aria-label={label()}>
          <RailSpinner size={lado()} />
        </span>
      </Match>
      <Match when={state() === "unseen"}>
        <span class="inline-flex shrink-0 items-center justify-center" style={{ width: `${lado()}px`, height: `${lado()}px` }} title={label()} aria-label={label()}>
          <span aria-hidden="true" class="size-[7px] rounded-full bg-success-strong" />
        </span>
      </Match>
      <Match when={state()}>
        <span class={cn("inline-flex shrink-0 items-center justify-center", railColor(state()))} title={label()} aria-label={label()}>
          <Dynamic component={stateIcon(state())} size={lado()} aria-hidden="true" />
        </span>
      </Match>
      <Match when={props.archivada && !props.plegadas}>
        <span class="inline-flex shrink-0 items-center justify-center text-neutral-500" title={t("projects.status.archived")} aria-label={t("projects.status.archived")}>
          <Archive size={lado()} aria-hidden="true" />
        </span>
      </Match>
    </Switch>
  );
}

export default function EstadoDeTarea(props: TaskActivity & {
  ambito?: "tarea" | "plegadas";
  class?: string;
  /** Lado del icono; la fila del riel lo sube a 13. */
  size?: number;
  /** Las marcas de la tarjeta del riel (`Sessions.tsx`): arco, anillo, punto. */
  riel?: boolean;
  /** Recién creada: el motor todavía no la registra (`lib/taskDraft.ts`). */
  provisional?: boolean;
  archivada?: boolean;
}) {
  const lado = () => props.size ?? 12;
  const state = () => taskPriority(props);
  const label = () => taskLabel(state(), props.ambito === "plegadas");
  return <Show when={!props.riel} fallback={<RailMark {...props} plegadas={props.ambito === "plegadas"} />}>
  <Show when={state() || (props.outcome === "delivered" && props.ambito !== "plegadas")}><span class={cn("inline-flex shrink-0 items-center gap-0.5", props.class)}>
    <Show when={state()} fallback={<Show when={props.outcome === "delivered" && props.ambito !== "plegadas"}><span class="inline-flex shrink-0 text-neutral-500" title={t("projects.status.delivered")} aria-label={t("projects.status.delivered")}><Check size={lado()} aria-hidden="true" /></span></Show>}>
      <span class={cn("inline-flex shrink-0 items-center justify-center", stateColor(state()))} style={{ width: `${lado()}px`, height: `${lado()}px` }} title={label()} aria-label={label()}>
        <Show when={state() === "working"} fallback={<Dynamic component={stateIcon(state())} size={lado()} aria-hidden="true" />}>
          <span aria-hidden="true" class="size-1.5 rounded-full bg-current" />
        </Show>
      </span>
    </Show>
  </span></Show>
  </Show>;
}
