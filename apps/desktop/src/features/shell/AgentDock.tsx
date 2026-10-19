import ChevronRight from "lucide-solid/icons/chevron-right";
import Plus from "lucide-solid/icons/plus";
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { t } from "../../lib/i18n";
import type { AgentProfile } from "../../lib/model";
import { cn } from "../../lib/utils";
import { AstroAvatar } from "../projects/AstroAvatar";
import { displayName } from "../projects/profiles";
import { DOCK_DEFAULT_CAPACITY, type DockAgent, dockCapacity, orderDockAgents, planDock } from "./dockLayout";

export type { DockAgent } from "./dockLayout";

/** Mismas palabras que la fila del agente en `AgentRows`. */
export function dockStatusText(agent: DockAgent): string {
  if (!agent.status || agent.status === "asleep") return t("projects.sessions.agent_asleep");
  if (agent.status === "working") {
    return agent.liveTasks > 0
      ? t("projects.sessions.agent_working", { count: agent.liveTasks })
      : t("projects.sessions.agent_working_alone");
  }
  return agent.minutesSinceLastTurn != null
    ? t("projects.sessions.agent_awake_since", { minutes: agent.minutesSinceLastTurn })
    : t("projects.sessions.agent_awake");
}

const SLOT =
  "relative grid size-[26px] shrink-0 place-items-center rounded-[7px] border border-transparent bg-transparent p-0 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-950 focus-visible:outline-2 focus-visible:outline-primary";

/**
 * Dock de agentes al pie del sidebar: una sola fila de caras. Pulsar una filtra
 * por ese agente; pulsarla otra vez quita el filtro.
 */
export default function AgentDock(props: {
  agents: DockAgent[];
  selected: string | null;
  onSelect: (name: string | null) => void;
  onSeeAll: () => void;
  onNewAgent?: () => void;
  /** Perfil del agente: nombre visible, cara, imagen propia y si está oculto. */
  profileOf?: (name: string) => AgentProfile | undefined;
}) {
  let fila: HTMLDivElement | undefined;
  const [capacidad, setCapacidad] = createSignal(DOCK_DEFAULT_CAPACITY);
  onMount(() => {
    if (!fila) return;
    const medir = () => setCapacidad(dockCapacity(fila?.clientWidth ?? 0));
    medir();
    if (typeof ResizeObserver === "undefined") return;
    const ojo = new ResizeObserver(medir);
    ojo.observe(fila);
    onCleanup(() => ojo.disconnect());
  });

  const label = (name: string) => displayName(name, props.profileOf?.(name));
  const ordenados = createMemo(() =>
    orderDockAgents(props.agents, (a) => label(a.name), (a) => props.profileOf?.(a.name)?.hidden === true),
  );
  const plan = createMemo(() =>
    planDock(ordenados(), capacidad(), { hasNew: !!props.onNewAgent, selected: props.selected }),
  );

  return (
    <div class="flex flex-col gap-1 border-t border-border px-2 pt-1.5 pb-0.5" role="group" aria-label={t("shell.agent_dock.title")}>
      <div class="flex items-center text-[0.6875rem] text-neutral-500">
        <span>{t("shell.agent_dock.title")}</span>
        <button
          type="button"
          class="ml-auto flex items-center gap-0.5 rounded-sm border-0 bg-transparent p-0 text-[0.6875rem] text-neutral-500 hover:text-neutral-950 focus-visible:outline-2 focus-visible:outline-primary"
          onClick={() => props.onSeeAll()}
        >
          {t("shell.agent_dock.see_all")}
          <ChevronRight size={11} aria-hidden="true" />
        </button>
      </div>
      <div ref={fila} class="flex min-w-0 items-center gap-1.5">
        <For each={plan().shown}>
          {(agente) => {
            const elegido = () => props.selected === agente.name;
            const texto = () => `${label(agente.name)} · ${dockStatusText(agente)}`;
            return (
              <button
                type="button"
                class={cn(SLOT, elegido() && "border-neutral-500 bg-neutral-200 hover:bg-neutral-200")}
                aria-pressed={elegido()}
                aria-label={texto()}
                title={texto()}
                onClick={() => props.onSelect(elegido() ? null : agente.name)}
              >
                <AstroAvatar
                  name={agente.name}
                  status={agente.status ?? "asleep"}
                  body={props.profileOf?.(agente.name)?.body}
                  avatar={props.profileOf?.(agente.name)?.avatar}
                  size={20}
                />
                <Show when={agente.liveTasks > 0}>
                  <span
                    aria-hidden="true"
                    class="absolute -right-[3px] -bottom-[3px] rounded-full bg-neutral-950 px-[3px] text-[9px] leading-3 font-bold text-surface"
                  >
                    {agente.liveTasks}
                  </span>
                </Show>
              </button>
            );
          }}
        </For>
        <Show when={plan().overflow > 0}>
          <button
            type="button"
            class={cn(SLOT, "text-[0.6875rem] font-semibold")}
            aria-label={t("shell.agent_dock.more", { count: plan().overflow })}
            title={t("shell.agent_dock.more", { count: plan().overflow })}
            onClick={() => props.onSeeAll()}
          >
            +{plan().overflow}
          </button>
        </Show>
        <Show when={props.onNewAgent}>
          <button
            type="button"
            class={SLOT}
            aria-label={t("projects.agents.new_open")}
            title={t("projects.agents.new_open")}
            onClick={() => props.onNewAgent?.()}
          >
            <Plus size={14} aria-hidden="true" />
          </button>
        </Show>
      </div>
    </div>
  );
}
