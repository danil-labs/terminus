import Check from "lucide-solid/icons/check";
import ChevronDown from "lucide-solid/icons/chevron-down";
import Plus from "lucide-solid/icons/plus";
import SlidersHorizontal from "lucide-solid/icons/sliders-horizontal";
import { For, type JSX, Show } from "solid-js";
import { t } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import {
  createFullscreen,
  createWindowTitle,
  HEADER_HEIGHT,
  needsTrafficLightPadding,
  TRAFFIC_LIGHT_PADDING,
  toggleMaximizeFromHeader,
} from "../../lib/window";
import { Button } from "../../ui/Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuGroupLabel,
  DropdownMenuItem,
  DropdownMenuItemIndicator,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../ui/DropdownMenu";
import { createWorkspaces } from "../settings/workspaces-store";
import { topState, type WorkspaceAttention } from "./attention";
import WindowControls from "./WindowControls";
import { AttentionBadge, MarcaDeWorkspace } from "./WorkspaceColumn";

/**
 * La fila del título, a todo lo ancho: el nombre del workspace al principio y
 * de qué build salió la ventana al final. Su alto es `ALTO_DE_CABECERA`, que es
 * lo que la pone en el eje del semáforo (`lib/window.ts`).
 */
export default function TitleBar(props: {
  attention: WorkspaceAttention[];
  onManage: () => void;
  /** Los espacios del workspace, detrás de su nombre. */
  escritorios?: (workspace: () => string) => JSX.Element;
}) {
  const ws = createWorkspaces();
  const apartarSemaforo = needsTrafficLightPadding(() => true, createFullscreen());
  const titulo = createWindowTitle();
  // Tres partes (base, runtime y build) son el build del motor y se
  // etiquetan; una sola parte extra es la rama de una build de desarrollo
  // y se enseña tal cual.
  const segmentoFinal = () => {
    const actual = titulo();
    if (!actual || actual === "Terminus") return null;
    const partes = actual.split(" · ");
    const texto = partes.at(-1) ?? actual;
    return partes.length >= 3 ? t("shell.window.engine_build", { build: texto }) : texto;
  };

  return (
    <div
      data-title-bar=""
      class={cn(
        "flex shrink-0 items-center border-b border-border bg-surface-muted",
        HEADER_HEIGHT,
        apartarSemaforo() ? TRAFFIC_LIGHT_PADDING : "pl-2",
      )}
      data-tauri-drag-region=""
      onDblClick={toggleMaximizeFromHeader}
    >
      <WorkspaceMenu ws={ws} attention={props.attention} onManage={props.onManage} />
      <Show when={props.escritorios && ws.actual()}>{(actual) => props.escritorios?.(() => actual().name)}</Show>
      {/* Un solo margen automático para el final de la fila: ver `WindowControls`. */}
      <div class="ml-auto flex min-w-0 items-center">
        <Show when={segmentoFinal()}>
          {(texto) => (
            <span data-window-branch="" class="min-w-0 truncate px-3 text-xs font-medium text-neutral-500">
              {texto()}
            </span>
          )}
        </Show>
        <WindowControls />
      </div>
    </div>
  );
}

/**
 * El nombre del cliente, que no es una pestaña ni lleva señal: lo que espera
 * en OTRO workspace se ve en su renglón del menú y en la columna.
 */
function WorkspaceMenu(props: {
  ws: ReturnType<typeof createWorkspaces>;
  attention: WorkspaceAttention[];
  onManage: () => void;
}) {
  const ws = props.ws;
  const stateOf = (id: string) =>
    topState(props.attention.find((w) => w.workspace === id)?.tasks ?? []);

  return (
    <Show when={ws.actual()}>
      {(actual) => (
        <DropdownMenu placement="bottom-start" gutter={4}>
          <DropdownMenuTrigger
            as={Button}
            variant="chrome"
            size="compact"
            data-workspace-name=""
            class="h-6.5 max-w-55 min-w-0 gap-1 px-1.5 text-[0.8125rem] font-bold"
            title={actual().name}
          >
            <span class="min-w-0 truncate">{actual().name}</span>
            <ChevronDown size={13} aria-hidden="true" class="shrink-0 text-neutral-500" />
          </DropdownMenuTrigger>
          <DropdownMenuContent class="w-64" data-workspace-menu="">
            <DropdownMenuGroup>
              <DropdownMenuGroupLabel>{t("shell.workspaces.label")}</DropdownMenuGroupLabel>
              <DropdownMenuRadioGroup value={ws.activo() ?? undefined} onChange={(id) => void ws.cambiarA(id)}>
                <For each={ws.lista() ?? []}>
                  {(w) => {
                    const actualEs = () => w.id === ws.activo();
                    const estado = () => (actualEs() ? null : stateOf(w.id));
                    return (
                      <DropdownMenuRadioItem value={w.id} closeOnSelect class="flex items-center gap-2" data-workspace-option={w.id}>
                        <span
                          aria-hidden="true"
                          class={cn(
                            "relative grid size-5 shrink-0 place-items-center overflow-hidden rounded-sm border bg-surface text-[0.6875rem] leading-none font-bold",
                            actualEs() ? "border-neutral-500 text-neutral-950" : "border-border-strong text-neutral-700",
                          )}
                        >
                          <MarcaDeWorkspace name={w.name} logo={w.logo} />
                        </span>
                        <span class="min-w-0 flex-1 truncate">{w.name}</span>
                        <Show when={estado()}>{(s) => <AttentionBadge state={s()} />}</Show>
                        <DropdownMenuItemIndicator class="grid w-3.5 shrink-0 text-neutral-950">
                          <Check size={14} aria-hidden="true" />
                        </DropdownMenuItemIndicator>
                      </DropdownMenuRadioItem>
                    );
                  }}
                </For>
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              class="flex items-center gap-2"
              onSelect={() => window.dispatchEvent(new CustomEvent("harness:new-workspace"))}
            >
              <Plus size={14} aria-hidden="true" class="shrink-0 text-neutral-500" />
              {t("shell.workspaces.new")}
            </DropdownMenuItem>
            <DropdownMenuItem class="flex items-center gap-2" onSelect={props.onManage}>
              <SlidersHorizontal size={14} aria-hidden="true" class="shrink-0 text-neutral-500" />
              {t("settings.workspaces.manage")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </Show>
  );
}
