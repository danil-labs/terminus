import Ellipsis from "lucide-solid/icons/ellipsis";
import Folder from "lucide-solid/icons/folder";
import Plus from "lucide-solid/icons/plus";
import { createMemo, createSignal, For, Show } from "solid-js";
import { enfocarYSeleccionar } from "../../lib/focus";
import { t } from "../../lib/i18n";
import { carpetasDelEscritorio, ordenDelEscritorio, type Space, spaceName } from "../../lib/spaces";
import type { Project } from "../../lib/model";
import { cn } from "../../lib/utils";
import { createNavigationOrder, createNavigationReorder } from "../../lib/navigation-order";
import { Button } from "../../ui/Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuGroupLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../ui/DropdownMenu";
import { asFailure, type Failure, FailureNote } from "../../ui/Failure";
import { KeyedList } from "../../ui/KeyedList";
import { Input } from "../../ui/Input";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "../../ui/Popover";
import type { SessionRow } from "../projects/Sessions";
import type { AttentionState } from "./attention";
import { AttentionBadge } from "./WorkspaceColumn";

/** El tope de `spaces::NAME_MAX_CHARS`. */
const NOMBRE_MAX = 30;

/**
 * Los escritorios del workspace, en la fila del título. La elegida no lleva
 * señal: sus tareas ya están en el riel. Las flechas mueven el foco entre
 * píldoras y Enter elige; cambiar de escritorio remonta la pestaña de delante,
 * y no se hace por pasar el foco.
 */
export default function SpaceBar(props: {
  workspace: string;
  workspaceId: string;
  spaces: Space[];
  activa: string | null;
  proyectos: Project[];
  sesiones: Record<string, SessionRow[]>;
  senal: (id: string) => AttentionState | null;
  onElegir: (id: string) => void;
  onCrear: (name: string, folders: string[]) => Promise<void>;
  onRenombrar: (id: string, name: string) => Promise<void>;
  onCarpetas: (id: string, folders: string[]) => Promise<void>;
  onEliminar: (id: string) => void;
}) {
  const [menuDe, setMenuDe] = createSignal<string | null>(null);
  const [carpetasDe, setCarpetasDe] = createSignal<string | null>(null);
  const [renombrando, setRenombrando] = createSignal<string | null>(null);
  const [nombre, setNombre] = createSignal("");
  let lista: HTMLDivElement | undefined;
  const order = createNavigationOrder(() => `spaces.order.${props.workspaceId}`);
  const orderedSpaces = createMemo(() => order.arrange(props.spaces));
  const reorder = createNavigationReorder({
    scope: () => props.workspaceId,
    list: () => lista,
    attribute: "data-space-pill",
    axis: "x",
    ids: () => orderedSpaces().map(space => space.id),
    save: order.save,
  });

  const empezarARenombrar = (i: Space) => {
    setNombre(spaceName(i));
    setRenombrando(i.id);
  };
  const terminarDeRenombrar = (i: Space) => {
    const n = nombre().trim();
    setRenombrando(null);
    if (n && n !== spaceName(i)) void props.onRenombrar(i.id, n);
    queueMicrotask(() => lista?.querySelector<HTMLElement>(`[data-space="${i.id}"]`)?.focus());
  };
  const moverFoco = (desde: HTMLElement, paso: number) => {
    const tabs = [...(lista?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])];
    const i = tabs.indexOf(desde);
    tabs[(i + paso + tabs.length) % tabs.length]?.focus();
  };

  return (
    <>
      <span aria-hidden="true" class="mr-2 ml-1.5 h-4 w-px shrink-0 bg-border-strong" />
      <div
        ref={lista}
        role="tablist"
        aria-label={t("spaces.bar.label", { workspace: props.workspace })}
        data-space-bar=""
        // Sin `overflow`: un menú de Kobalte abierto desde un contenedor con scroll
        // cuelga la página en WebKitGTK. Las que no caben encogen su nombre.
        class="flex min-w-0 items-center gap-0.5"
      >
        <KeyedList each={orderedSpaces()} by={space => space.id}>
          {(i) => {
            const elegida = () => i().id === props.activa;
            const unica = () => props.spaces.length === 1;
            const senal = () => (elegida() ? null : props.senal(i().id));
            return (
              <Popover
                open={carpetasDe() === i().id}
                onOpenChange={(abierta) => setCarpetasDe(abierta ? i().id : null)}
                placement="bottom-start"
                gutter={4}
              >
                <PopoverAnchor
                  data-space-pill={i().id}
                  data-selected={elegida() ? "true" : "false"}
                  class={cn(
                    "group relative inline-flex h-6.5 min-w-0 items-center rounded-md border text-xs whitespace-nowrap select-none",
                    reorder.source() === i().id && "cursor-grabbing opacity-40",
                    elegida()
                      ? "shrink-0 border-border-strong bg-surface-raised font-semibold text-neutral-950 shadow-sm"
                      : "border-transparent font-medium text-neutral-500 hover:bg-neutral-200 hover:text-neutral-950",
                  )}
                  onContextMenu={(e: MouseEvent) => {
                    e.preventDefault();
                    setMenuDe(i().id);
                  }}
                >
                  <Show when={reorder.edge(i().id)}>
                    {(edge) => <span aria-hidden="true" class={cn("pointer-events-none absolute top-0 bottom-0 w-0.5 bg-primary", edge() === "before" ? "-left-0.5" : "-right-0.5")} />}
                  </Show>
                  <Show
                    when={renombrando() === i().id}
                    fallback={
                      <button
                        type="button"
                        role="tab"
                        data-space={i().id}
                        aria-selected={elegida()}
                        tabIndex={elegida() ? 0 : -1}
                        title={spaceName(i())}
                        class="inline-flex h-full min-w-0 touch-none items-center gap-1.5 rounded-[inherit] pr-0.5 pl-2.5 outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                        onPointerDown={(e) => reorder.start(i().id, e)}
                        onClick={() => props.onElegir(i().id)}
                        // El primer clic elige la píldora y el segundo ya no hace
                        // nada: el doble clic renombra en el sitio, como el
                        // historial de tareas.
                        onDblClick={() => empezarARenombrar(i())}
                        onKeyDown={(e) => {
                          if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                            e.preventDefault();
                            moverFoco(e.currentTarget, e.key === "ArrowRight" ? 1 : -1);
                          } else if (e.key === "F2") {
                            e.preventDefault();
                            empezarARenombrar(i());
                          }
                        }}
                      >
                        <span class="max-w-40 truncate">{spaceName(i())}</span>
                        <Show when={senal()}>{(s) => <AttentionBadge state={s()} />}</Show>
                      </button>
                    }
                  >
                    <Input
                      ref={enfocarYSeleccionar}
                      variant="ghost"
                      class="mx-2 h-auto min-h-0 w-38 rounded-none border-0 p-0 text-xs font-semibold text-neutral-950"
                      maxlength={NOMBRE_MAX}
                      value={nombre()}
                      aria-label={t("spaces.rename.label", { name: spaceName(i()) })}
                      onInput={(e) => setNombre(e.currentTarget.value)}
                      onBlur={() => setRenombrando(null)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          terminarDeRenombrar(i());
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          setRenombrando(null);
                        }
                      }}
                    />
                  </Show>
                  <Show when={renombrando() !== i().id}>
                    <DropdownMenu
                      open={menuDe() === i().id}
                      onOpenChange={(abierto) => setMenuDe(abierto ? i().id : null)}
                      placement="bottom-start"
                      gutter={4}
                    >
                      <DropdownMenuTrigger
                        data-space-actions={i().id}
                        tabIndex={elegida() ? 0 : -1}
                        aria-label={t("spaces.menu.actions", { name: spaceName(i()) })}
                        title={t("spaces.menu.actions", { name: spaceName(i()) })}
                        class={cn(
                          "mr-0.75 grid size-5 place-items-center rounded-sm text-neutral-500 outline-none hover:bg-neutral-200 hover:text-neutral-950 focus-visible:opacity-100 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary data-[expanded]:bg-neutral-200 data-[expanded]:text-neutral-950 data-[expanded]:opacity-100",
                          elegida() ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                        )}
                      >
                        <Ellipsis size={14} aria-hidden="true" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent class="w-60" data-space-menu={i().id}>
                        <DropdownMenuGroup>
                          <DropdownMenuGroupLabel>{spaceName(i())}</DropdownMenuGroupLabel>
                          <DropdownMenuItem class="flex items-center justify-between gap-2" onSelect={() => empezarARenombrar(i())}>
                            {t("spaces.menu.rename")}
                            <kbd class="font-sans text-[0.6875rem] text-neutral-500">F2</kbd>
                          </DropdownMenuItem>
                          <DropdownMenuItem class="flex items-center justify-between gap-2" onSelect={() => setCarpetasDe(i().id)}>
                            {t("spaces.menu.folders")}
                            <span class="text-[0.6875rem] text-neutral-500">{i().folders.length}</span>
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                        <Show
                          when={unica()}
                          fallback={
                            <DropdownMenuItem class="text-error-strong" onSelect={() => props.onEliminar(i().id)}>
                              {t("spaces.menu.delete")}
                            </DropdownMenuItem>
                          }
                        >
                          <DropdownMenuItem
                            class="text-neutral-500"
                            closeOnSelect={false}
                            aria-disabled="true"
                            aria-describedby={`por-que-no-${i().id}`}
                          >
                            {t("spaces.menu.delete")}
                          </DropdownMenuItem>
                          <p id={`por-que-no-${i().id}`} class="m-0 max-w-56 px-2 pt-0.5 pb-1.5 text-[0.6875rem] leading-snug text-neutral-500">
                            {t("spaces.menu.delete_last")}
                          </p>
                        </Show>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </Show>
                </PopoverAnchor>
                <PopoverContent class="w-80 p-3" aria-label={t("spaces.folders.title", { name: spaceName(i()) })}>
                  <CarpetasDe
                    space={i()}
                    proyectos={props.proyectos}
                    sesiones={props.sesiones}
                    onCambiar={(folders) => props.onCarpetas(i().id, folders)}
                  />
                </PopoverContent>
              </Popover>
            );
          }}
        </KeyedList>
      </div>
      <NewSpace workspace={props.workspace} proyectos={props.proyectos} onCrear={props.onCrear} />
    </>
  );
}

/** Los proyectos del espacio, con casilla: marcado está agregado. Ninguno manda. */
function CarpetasDe(props: {
  space: Space;
  proyectos: Project[];
  sesiones: Record<string, SessionRow[]>;
  onCambiar: (folders: string[]) => Promise<void>;
}) {
  const [fallo, setFallo] = createSignal<Failure | null>(null);
  const filas = () =>
    ordenDelEscritorio(props.proyectos, carpetasDelEscritorio(props.proyectos, props.space, props.sesiones));
  const added = (id: string) => props.space.folders.includes(id);
  const tareas = (folder: string) =>
    (props.sesiones[folder] ?? []).filter((r) => !r.archived && r.space === props.space.id && !r.chat_de_agente).length;
  const alternar = async (id: string, marcar: boolean) => {
    setFallo(null);
    const folders = marcar ? [...props.space.folders, id] : props.space.folders.filter((f) => f !== id);
    try {
      await props.onCambiar(folders);
    } catch (e) {
      setFallo(asFailure(e));
    }
  };

  return (
    <div class="grid gap-2" data-space-folders={props.space.id}>
      <h3 class="m-0 truncate text-[0.8125rem] font-semibold">
        {t("spaces.folders.title", { name: spaceName(props.space) })}
      </h3>
      <ul class="m-0 grid max-h-60 list-none gap-0.5 overflow-y-auto p-0">
        <For each={filas()}>
          {(p) => (
            <li class="grid min-h-7 grid-cols-[auto_16px_minmax(0,1fr)_auto] items-center gap-2 text-[0.8125rem]" data-folder-line={p.id}>
              <input
                type="checkbox"
                class="size-4 shrink-0 accent-primary"
                checked={added(p.id)}
                aria-label={t("spaces.folders.toggle", { name: p.name })}
                onChange={(e) => void alternar(p.id, e.currentTarget.checked)}
              />
              <Folder size={14} aria-hidden="true" class="text-neutral-500" />
              <span class="truncate" title={p.name}>{p.name}</span>
              <Show when={!added(p.id) && tareas(p.id) > 0}>
                <span class="shrink-0 text-[0.6875rem] text-neutral-500">
                  {t("spaces.folders.tasks", { count: tareas(p.id) })}
                </span>
              </Show>
            </li>
          )}
        </For>
      </ul>
      <p class="m-0 text-[0.6875rem] leading-snug text-neutral-500">{t("spaces.folders.hint")}</p>
      <Show when={fallo()}>{(f) => <FailureNote f={f()} />}</Show>
    </div>
  );
}

/** El «+»: nombre y, si se quieren, proyectos para agregar desde el principio. */
function NewSpace(props: {
  workspace: string;
  proyectos: Project[];
  onCrear: (name: string, folders: string[]) => Promise<void>;
}) {
  const [abierta, setAbierta] = createSignal(false);
  const [nombre, setNombre] = createSignal("");
  const [elegidas, setElegidas] = createSignal<string[]>([]);
  const [creando, setCreando] = createSignal(false);
  const [fallo, setFallo] = createSignal<Failure | null>(null);
  // Las últimas que se agregaron a Terminus, delante: lo reciente es lo que se
  // agrega. Solo diez, que son las que caben sin desplazar el resto del alta.
  const recientes = () => [...props.proyectos].reverse().slice(0, 10);
  const abrir = (si: boolean) => {
    if (!si && creando()) return;
    setAbierta(si);
    if (si) {
      setNombre("");
      setElegidas([]);
      setFallo(null);
    }
  };
  const crear = async () => {
    const name = nombre().trim();
    if (!name || creando()) return;
    setCreando(true);
    setFallo(null);
    try {
      await props.onCrear(name, elegidas());
      setAbierta(false);
    } catch (e) {
      setFallo(asFailure(e));
    } finally {
      setCreando(false);
    }
  };

  return (
    <Popover open={abierta()} onOpenChange={abrir} placement="bottom-start" gutter={4}>
      <PopoverTrigger
        data-new-space=""
        aria-label={t("spaces.new.title")}
        title={t("spaces.new.title")}
        class="ml-1 grid size-6 shrink-0 place-items-center rounded-md border border-dashed border-neutral-500 text-neutral-500 outline-none hover:bg-neutral-200 hover:text-neutral-950 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary data-[expanded]:bg-neutral-200 data-[expanded]:text-neutral-950"
      >
        <Plus size={14} aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent class="w-80 p-3" aria-label={t("spaces.new.title")}>
        <h3 class="m-0 mb-2 text-[0.8125rem] font-semibold">{t("spaces.new.title")}</h3>
        <form
          class="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void crear();
          }}
        >
          <label class="grid gap-1 text-[0.75rem] text-neutral-500">
            {t("spaces.new.name")}
            <Input
              ref={(el: HTMLInputElement) => setTimeout(() => el.focus(), 0)}
              maxlength={NOMBRE_MAX}
              placeholder={t("spaces.new.placeholder")}
              value={nombre()}
              disabled={creando()}
              onInput={(e) => setNombre(e.currentTarget.value)}
            />
          </label>
          <fieldset class="m-0 grid gap-1 border-0 p-0">
            <legend class="mb-1 p-0 text-[0.75rem] text-neutral-500">{t("spaces.new.folders")}</legend>
            <Show
              when={props.proyectos.length > 0}
              fallback={
                <p class="m-0 text-[0.75rem] text-neutral-500">
                  {t("spaces.new.no_folders", { workspace: props.workspace })}
                </p>
              }
            >
              <div class="grid max-h-36 gap-1 overflow-y-auto">
                <For each={recientes()}>
                  {(p) => (
                    <label class="flex min-w-0 items-center gap-2 text-[0.8125rem]">
                      <input
                        type="checkbox"
                        class="size-4 shrink-0 accent-primary"
                        checked={elegidas().includes(p.id)}
                        disabled={creando()}
                        onChange={(e) =>
                          setElegidas((xs) => (e.currentTarget.checked ? [...xs, p.id] : xs.filter((x) => x !== p.id)))
                        }
                      />
                      <span class="truncate">{p.name}</span>
                    </label>
                  )}
                </For>
              </div>
            </Show>
          </fieldset>
          <Show when={fallo()}>{(f) => <FailureNote f={f()} />}</Show>
          <div class="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" disabled={creando()} onClick={() => setAbierta(false)}>
              {t("spaces.new.cancel")}
            </Button>
            <Button type="submit" size="sm" disabled={!nombre().trim() || creando()}>
              {t("spaces.new.create")}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
