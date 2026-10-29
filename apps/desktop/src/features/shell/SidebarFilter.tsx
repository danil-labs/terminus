import Check from "lucide-solid/icons/check";
import SlidersHorizontal from "lucide-solid/icons/sliders-horizontal";
import { For, type JSX, Show } from "solid-js";
import { t } from "../../lib/i18n";
import {
  type SidebarGrouping,
  type SidebarView,
  DEFAULT_SIDEBAR_VIEW,
  groupingLabel,
  nonDefaultCount,
  sameAgent,
  scopeLabel,
} from "../../lib/sidebarView";
import { cn } from "../../lib/utils";
import { Button } from "../../ui/Button";
import { ITEM_DE_MENU, Popover, PopoverContent, PopoverTrigger } from "../../ui/Popover";
import { AstroAvatar } from "../projects/AstroAvatar";
import { FolderSquare } from "../projects/FolderChip";

export type SidebarFilterFolder = { id: string; name: string; count: number };
/** `installed` falso: ya no está instalado, pero tiene tareas. */
export type SidebarFilterAgent = { name: string; installed: boolean; body?: string | null; avatar?: string | null };

export type SidebarFilterProps = {
  view: SidebarView;
  onChange: (view: SidebarView) => void;
  /** Solo las carpetas que tienen tareas. */
  folders: SidebarFilterFolder[];
  agents: SidebarFilterAgent[];
  /** Con una sola máquina, «Por máquina» haría un solo grupo: no se ofrece. */
  machines?: boolean;
};

const GROUPINGS: SidebarGrouping[] = ["none", "folder", "status", "agent", "machine"];

const renglon = cn(ITEM_DE_MENU, "grid grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-2 py-1");
const titulo = "flex items-center px-2 pt-1.5 pb-0.5 text-[0.6875rem] font-medium text-neutral-500";

function Casilla(props: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      class={cn(
        "grid size-3.5 place-items-center rounded-[3px] border",
        props.on ? "border-neutral-950 bg-neutral-950 text-surface-raised" : "border-neutral-500",
      )}
    >
      <Show when={props.on}><Check size={10} stroke-width={3} /></Show>
    </span>
  );
}

function Radio(props: { on: boolean }) {
  return (
    <span aria-hidden="true" class="grid size-3 place-items-center rounded-full border border-neutral-500">
      <Show when={props.on}><span class="size-1.5 rounded-full bg-neutral-950" /></Show>
    </span>
  );
}

function Opcion(props: {
  role: "menuitemcheckbox" | "menuitemradio";
  on: boolean;
  onSelect: () => void;
  children: JSX.Element;
  aside?: JSX.Element;
}) {
  return (
    <button type="button" role={props.role} aria-checked={props.on} class={renglon} onClick={() => props.onSelect()}>
      <Show when={props.role === "menuitemcheckbox"} fallback={<Radio on={props.on} />}>
        <Casilla on={props.on} />
      </Show>
      <span class="flex min-w-0 items-center gap-1.5 truncate">{props.children}</span>
      <span class="text-[0.6875rem] text-neutral-500 tabular-nums">{props.aside}</span>
    </button>
  );
}

/** El botón de filtro del sidebar y su panel: carpetas, agente y agrupar. */
export function SidebarFilter(props: SidebarFilterProps) {
  const cambiados = () => nonDefaultCount(props.view);
  const set = (patch: Partial<SidebarView>) => props.onChange({ ...props.view, ...patch });
  const total = () => props.folders.reduce((sum, f) => sum + f.count, 0);
  const alternarCarpeta = (id: string) =>
    set({
      folders: props.view.folders.includes(id)
        ? props.view.folders.filter((f) => f !== id)
        : [...props.view.folders, id],
    });
  const etiqueta = () =>
    cambiados() > 0
      ? t("shell.sidebar.view.trigger_count", { count: cambiados() })
      : t("shell.sidebar.view.trigger");

  return (
    <Popover placement="bottom-end" gutter={4}>
      <PopoverTrigger
        as={(p: object) => (
          <Button
            {...p}
            variant="chrome"
            size="iconCompact"
            class="relative size-7 shrink-0 text-neutral-500"
            aria-haspopup="menu"
            aria-label={etiqueta()}
            title={t("shell.sidebar.view.trigger")}
          >
            <SlidersHorizontal size={15} />
            <Show when={cambiados() > 0}>
              <span
                aria-hidden="true"
                class="ui-sidebar-menu-badge absolute -top-1 -right-1 min-w-3.5 rounded-full bg-neutral-950 px-1 text-center text-[0.625rem] font-semibold text-surface-raised"
              >
                {cambiados()}
              </span>
            </Show>
          </Button>
        )}
      />
      <PopoverContent
        role="menu"
        aria-label={t("shell.sidebar.view.trigger")}
        class="grid max-h-[min(70vh,32rem)] w-60 gap-0.5 overflow-y-auto p-1.5"
        onOpenAutoFocus={(e: Event) => e.preventDefault()}
      >
        <div role="group" aria-label={t("shell.sidebar.view.folders")} class="grid gap-0.5">
          <div class={titulo}>
            <span>{t("shell.sidebar.view.folders")}</span>
            <Show when={props.view.folders.length > 0}>
              <button
                type="button"
                class="ml-auto rounded-sm px-1 text-neutral-500 hover:text-neutral-950 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-primary"
                onClick={() => set({ folders: [] })}
              >
                {t("shell.sidebar.view.all")}
              </button>
            </Show>
          </div>
          <Opcion role="menuitemcheckbox" on={props.view.folders.length === 0} onSelect={() => set({ folders: [] })} aside={total()}>
            {t("shell.sidebar.view.all_folders")}
          </Opcion>
          <For each={props.folders}>
            {(f) => (
              <Opcion role="menuitemcheckbox" on={props.view.folders.includes(f.id)} onSelect={() => alternarCarpeta(f.id)} aside={f.count}>
                <span class="flex min-w-0 items-center gap-1.5"><FolderSquare id={f.id} /><span class="truncate">{f.name}</span></span>
              </Opcion>
            )}
          </For>
        </div>

        <Show when={props.agents.length > 0}>
          <span class="my-1 h-px bg-border" />
          <div role="group" aria-label={t("shell.sidebar.view.agent")} class="grid gap-0.5">
            <div class={titulo}>{t("shell.sidebar.view.agent")}</div>
            <Opcion role="menuitemradio" on={props.view.agent === null} onSelect={() => set({ agent: null })}>
              {t("shell.sidebar.view.all_agents")}
            </Opcion>
            <For each={props.agents}>
              {(a) => (
                <Opcion
                  role="menuitemradio"
                  on={sameAgent(props.view.agent, a.name)}
                  onSelect={() => set({ agent: a.name })}
                  aside={a.installed ? undefined : t("shell.sidebar.view.agent_uninstalled")}
                >
                  <AstroAvatar name={a.name} body={a.body} avatar={a.avatar} status="asleep" size={14} />
                  <span class="truncate">{a.name}</span>
                </Opcion>
              )}
            </For>
          </div>
        </Show>

        <span class="my-1 h-px bg-border" />
        <div role="group" aria-label={t("shell.sidebar.view.group")} class="grid gap-0.5">
          <div class={titulo}>{t("shell.sidebar.view.group")}</div>
          <For each={GROUPINGS.filter((g) => g !== "machine" || props.machines || props.view.group === "machine")}>
            {(g) => (
              <Opcion
                role="menuitemradio"
                on={props.view.group === g}
                onSelect={() => set({ group: g })}
                aside={g === DEFAULT_SIDEBAR_VIEW.group ? t("shell.sidebar.view.default") : undefined}
              >
                {groupingLabel(g)}
              </Opcion>
            )}
          </For>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** La línea bajo «Nueva tarea»: qué se enseña, y a su derecha el filtro. */
export function SidebarScope(props: SidebarFilterProps & { class?: string }) {
  const nombre = (id: string) => props.folders.find((f) => f.id === id)?.name ?? id;
  return (
    <div class={cn("flex min-w-0 items-center gap-1 pl-2", props.class)}>
      <span class="min-w-0 flex-1 truncate text-[0.71875rem] text-neutral-500">{scopeLabel(props.view, nombre)}</span>
      <SidebarFilter {...props} />
    </div>
  );
}
