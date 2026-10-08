import Plus from "lucide-solid/icons/plus";
import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import { t } from "../../lib/i18n";
import { createNavigationReorder } from "../../lib/navigation-order";
import { KeyedList } from "../../ui/KeyedList";
import { cn } from "../../lib/utils";
import { generacionDeLogo, urlDeLogo } from "./logo-src";
import { ITEM_DE_MENU, Popover, PopoverAnchor, PopoverContent } from "../../ui/Popover";
import { RETARDO_TOOLTIP, TooltipContent, TooltipRoot, TooltipTrigger } from "../../ui/Tooltip";
import { stateColor, stateIcon, taskLabel } from "../projects/TaskStatus";
import { cerrarConEscape, createWorkspaces, type Workspace } from "../settings/workspaces-store";
import { topState, type AttentionState, type WorkspaceAttention } from "./attention";

/** Las iniciales de las dos primeras palabras; una sola palabra da una letra. */
export function monogram(name: string) {
  const words = name.trim().split(/[\s\-_.]+/).filter(Boolean);
  return words.slice(0, 2).map((word) => [...word][0] ?? "").join("").toUpperCase() || "?";
}

/** El logo del workspace, o sus iniciales si no hay imagen o todavía no carga. */
export function MarcaDeWorkspace(props: { name: string; logo?: string | null }) {
  const [url, setUrl] = createSignal<string | null>(null);
  createEffect(() => {
    const path = props.logo ?? null;
    const gen = generacionDeLogo();
    if (!path) {
      setUrl(null);
      return;
    }
    let vivo = true;
    onCleanup(() => {
      vivo = false;
    });
    void urlDeLogo(path).then((siguiente) => {
      if (vivo && generacionDeLogo() === gen) setUrl(siguiente);
    });
  });
  return (
    <Show when={url()} fallback={<>{monogram(props.name)}</>}>
      {(src) => <img src={src()} alt="" draggable={false} class="absolute inset-0 size-full object-cover" />}
    </Show>
  );
}

/**
 * Lo más urgente de un workspace, en un disco. La pregunta va en amarillo con el
 * glifo navy: el amarillo como glifo sobre la superficie no llega a 3:1.
 */
export function AttentionBadge(props: { state: AttentionState; class?: string }) {
  return (
    <span
      data-attention-badge={props.state}
      class={cn(
        "grid size-4 shrink-0 place-items-center rounded-full border",
        props.state === "asked"
          ? "border-border-strong bg-brand-yellow text-brand-navy"
          : cn("border-border bg-surface", stateColor(props.state)),
        props.class,
      )}
    >
      <Dynamic component={stateIcon(props.state)} size={11} />
    </span>
  );
}

/** Cambiar de workspace con un clic y ver, sin entrar, qué espera en cada uno. */
export default function WorkspaceColumn(props: {
  attention: WorkspaceAttention[];
  onManage: () => void;
}) {
  const ws = createWorkspaces();
  let list: HTMLDivElement | undefined;
  const reorder = createNavigationReorder({
    scope: () => ws.activo() ?? "",
    list: () => list,
    attribute: "data-workspace-tile",
    axis: "y",
    ids: () => (ws.lista() ?? []).map(w => w.id),
    save: ws.reorder,
  });
  const [menuOf, setMenuOf] = createSignal<string | null>(null);
  cerrarConEscape(() => menuOf() !== null, () => setMenuOf(null));

  const stateOf = (id: string) =>
    topState(props.attention.find((w) => w.workspace === id)?.tasks ?? []);

  const Tile = (p: { w: Workspace }) => {
    const active = () => p.w.id === ws.activo();
    const state = () => stateOf(p.w.id);
    const label = () => {
      const s = state();
      return s
        ? t("shell.workspaces.tile_with_state", { name: p.w.name, state: taskLabel(s, true) })
        : p.w.name;
    };
    let anchor: HTMLButtonElement | undefined;
    return (
      <Popover
        open={menuOf() === p.w.id}
        onOpenChange={(open) => setMenuOf(open ? p.w.id : null)}
        placement="right-start"
        gutter={4}
      >
        <PopoverAnchor class="w-full">
          {/* El monograma no basta para distinguir dos workspaces; `title` casi no se ve en el webview. */}
          <TooltipRoot openDelay={RETARDO_TOOLTIP} placement="right" gutter={6} disabled={menuOf() === p.w.id || reorder.source() !== null}>
          <TooltipTrigger
            as="button"
            ref={anchor}
            type="button"
            data-workspace-tile={p.w.id}
            data-attention={state() ?? undefined}
            class={cn("marca-seleccion group relative grid h-12 w-full shrink-0 touch-none place-items-center outline-none select-none", reorder.source() === p.w.id && "cursor-grabbing opacity-40")}
            aria-current={active() ? "true" : undefined}
            aria-label={label()}
            onPointerDown={(e: PointerEvent) => reorder.start(p.w.id, e)}
            onClick={() => void ws.cambiarA(p.w.id)}
            onContextMenu={(e: MouseEvent) => {
              e.preventDefault();
              setMenuOf(p.w.id);
            }}
            onKeyDown={(e: KeyboardEvent) => {
              if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
                e.preventDefault();
                setMenuOf(p.w.id);
              }
            }}
          >
            <Show when={reorder.edge(p.w.id)}>
              {(edge) => <span aria-hidden="true" class={cn("pointer-events-none absolute right-2 left-2 h-0.5 bg-primary", edge() === "before" ? "top-0" : "bottom-0")} />}
            </Show>
            <span
              aria-hidden="true"
              class={cn(
                "relative grid size-10 place-items-center rounded-lg border text-[0.875rem] font-semibold group-focus-visible:outline-solid group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-primary",
                active()
                  ? "border-border-strong bg-surface-raised text-neutral-950"
                  : "border-border bg-surface text-neutral-700 group-hover:bg-neutral-200 group-hover:text-neutral-950",
              )}
            >
              <span class="absolute inset-0 overflow-hidden rounded-[inherit]">
                <span class="relative grid size-full place-items-center">
                  <MarcaDeWorkspace name={p.w.name} logo={p.w.logo} />
                </span>
              </span>
              <Show when={state()}>
                {(s) => <AttentionBadge state={s()} class="absolute -top-1.5 -right-1.5" />}
              </Show>
            </span>
          </TooltipTrigger>
          <TooltipContent>{label()}</TooltipContent>
          </TooltipRoot>
        </PopoverAnchor>
        {/* Sin `Popover.Trigger` el foco no vuelve solo al cuadro. */}
        <PopoverContent
          role="menu"
          class="w-56 p-1"
          onCloseAutoFocus={(e: Event) => {
            e.preventDefault();
            anchor?.focus();
          }}
        >
          <p class="m-0 truncate px-2 pt-1 pb-1 text-[0.6875rem] font-medium text-neutral-500">{p.w.name}</p>
          <button
            role="menuitem"
            class={ITEM_DE_MENU}
            onClick={() => {
              setMenuOf(null);
              props.onManage();
            }}
          >
            {t("settings.workspaces.manage")}
          </button>
        </PopoverContent>
      </Popover>
    );
  };

  // Con uno solo no hay a dónde cambiar: crear el segundo vive en el menú del nombre (`TitleBar.tsx`).
  return (
    <Show when={(ws.lista()?.length ?? 0) > 1}>
    <nav
      aria-label={t("shell.workspaces.label")}
      data-workspace-column=""
      class="flex h-full w-16 shrink-0 flex-col border-r border-border bg-surface-muted"
    >
      <div ref={list} class="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-x-hidden overflow-y-auto pt-2 pb-2">
        <KeyedList each={ws.lista() ?? []} by={w => w.id}>{w => <Tile w={w()} />}</KeyedList>
        <button
          type="button"
          class="mt-1 grid size-10 shrink-0 place-items-center rounded-lg border border-dashed border-neutral-500 text-neutral-500 outline-none hover:bg-neutral-200 hover:text-neutral-950 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          aria-label={t("shell.workspaces.new")}
          title={t("shell.workspaces.new")}
          onClick={() => window.dispatchEvent(new CustomEvent("harness:new-workspace"))}
        >
          <Plus size={16} aria-hidden="true" />
        </button>
      </div>
    </nav>
    </Show>
  );
}
