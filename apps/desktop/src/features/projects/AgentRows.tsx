import ChevronRight from "lucide-solid/icons/chevron-right";
import MoreVertical from "lucide-solid/icons/more-vertical";
import Plus from "lucide-solid/icons/plus";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { enfocarYSeleccionar } from "../../lib/focus";
import { t } from "../../lib/i18n";
import { invoke } from "../../lib/invoke.ts";
import type { HandlerDefinition, HandlerStatusRow } from "../../lib/model";
import { cn } from "../../lib/utils";
import { Button } from "../../ui/Button";
import { asFailure, type Failure, FailureNote } from "../../ui/Failure";
import { Input } from "../../ui/Input";
import { ITEM_DE_MENU, Popover, PopoverContent, PopoverTrigger } from "../../ui/Popover";
import { Toast, ToastPortal } from "../../ui/Toast";
import { descriptionOf, MODES, nameOf, watchKeepAwake } from "../shell/KeepAwake";
import { AstroAvatar } from "./AstroAvatar";
import { watchHandlerStatuses } from "./handlerPresence";
import { DEFAULT_PROFILE, displayName, notifyProfiles, watchProfiles } from "./profiles";
import { matchesTaskQuery } from "./taskSearch";

/**
 * Cómo se lee el estado de un encargado en su fila. Sin fila de estado —
 * todavía no llegó la primera lectura— se pinta dormido: es el reposo, no un
 * error.
 */
function textoDeEstado(row: HandlerStatusRow | undefined): string {
  if (!row || row.status === "asleep") return t("projects.sessions.agent_asleep");
  if (row.status === "working") {
    return row.live_tasks > 0
      ? t("projects.sessions.agent_working", { count: row.live_tasks })
      : t("projects.sessions.agent_working_alone");
  }
  return row.minutes_since_last_turn != null
    ? t("projects.sessions.agent_awake_since", { minutes: row.minutes_since_last_turn })
    : t("projects.sessions.agent_awake");
}

export default function AgentRows(props: {
  project: string;
  onNewAgent: () => void;
  encargados: HandlerDefinition[];
  search?: string;
  onSearchResults?: (count: number) => void;
  /** El nombre del encargado con el que se va a hablar, si es de este proyecto. */
  hablando?: string | null;
  onHablar: (project: string, name: string) => void;
  onProfile: (project: string, name: string) => void;
}) {
  const estados = watchHandlerStatuses(props.project);
  const awake = watchKeepAwake();
  // Qué fila tiene el menú abierto. Uno por lista, como en las tareas.
  const [menu, setMenu] = createSignal<string | null>(null);
  const profiles = watchProfiles(props.project);
  const porNombre = createMemo(() => new Map(estados().map((r) => [r.name, r] as const)));
  // Los ocultos no se pintan aquí. Se vuelven a ver —y a mostrar— desde la
  // vista del proyecto, que es donde está la lista completa.
  const visibles = createMemo(() =>
    props.encargados.filter((e) => !profiles()[e.name]?.hidden && matchesTaskQuery([e.name, displayName(e.name, profiles()[e.name])], props.search ?? "")),
  );
  if (props.onSearchResults) {
    createEffect(() => props.onSearchResults?.(visibles().length));
    onCleanup(() => props.onSearchResults?.(0));
  }
  // El nombre visible se cambia en la fila, como el título de una tarea: doble
  // clic, Enter o salir del campo guardan, Escape deja el que había.
  const [renombrando, setRenombrando] = createSignal<string | null>(null);
  const [borrador, setBorrador] = createSignal("");
  const [fallo, setFallo] = createSignal<Failure | null>(null);
  const empezarARenombrar = (name: string) => {
    setMenu(null);
    setBorrador(displayName(name, profiles()[name]));
    setRenombrando(name);
  };
  const guardarNombre = async (name: string) => {
    if (renombrando() !== name) return;
    setRenombrando(null);
    const perfil = profiles()[name] ?? DEFAULT_PROFILE;
    const nuevo = borrador().trim();
    // Vacío o igual al nombre del agente vuelve al nombre de siempre.
    const visible = nuevo && nuevo !== name ? nuevo : null;
    if (visible === (perfil.display_name ?? null)) return;
    try {
      await invoke("save_agent_profile", {
        project: props.project,
        name,
        displayName: visible,
        body: perfil.body,
        veil: perfil.veil,
      });
      notifyProfiles();
    } catch (error) {
      setFallo(asFailure(error));
    }
  };

  return (
    <>
      <Show when={fallo()}>{(f) => (
        <ToastPortal>
          <Toast tone="error" onDismiss={() => setFallo(null)}>
            <FailureNote f={f()} />
          </Toast>
        </ToastPortal>
      )}</Show>
      <ul class="m-0 flex min-w-0 list-none flex-col gap-0.5 p-0">
        <For each={visibles()}>
          {(e) => {
            return (
            <li>
              <div
                class={cn(
                  "group/agente relative grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-sm border border-transparent py-px pr-1 pl-2 hover:bg-neutral-100",
                  props.hablando === e.name &&
                    "border-neutral-500 bg-neutral-200 font-semibold text-neutral-950 shadow-sm",
                  renombrando() === e.name && "bg-neutral-200 hover:bg-neutral-200",
                )}
                /* El estado no se escribe: lo dice la cara. Sigue en el
                   `title` y en el nombre accesible, que no ocupan renglón. */
                title={textoDeEstado(porNombre().get(e.name))}
                aria-label={`${displayName(e.name, profiles()[e.name])} · ${textoDeEstado(porNombre().get(e.name))}`}
              >
                {/* 24 px es el mínimo de área de clic (WCAG 2.2 § 2.5.8); con
                    la fila en `py-px` cada agente ocupa 30 px. */}
                <button aria-label={displayName(e.name, profiles()[e.name])} class="grid size-6 shrink-0 place-items-center rounded-sm text-neutral-500 focus-visible:outline-2 focus-visible:outline-primary" onClick={() => props.onHablar(props.project, e.name)}>
                  <AstroAvatar name={e.name} status={porNombre().get(e.name)?.status ?? "asleep"} body={profiles()[e.name]?.body} avatar={profiles()[e.name]?.avatar} size={20} />
                </button>
                <Show
                  when={renombrando() === e.name}
                  fallback={
                    <button type="button" class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap rounded-sm bg-transparent text-left text-[0.8125rem] leading-[1.35] focus-visible:outline-2 focus-visible:outline-primary" aria-label={`${displayName(e.name, profiles()[e.name])} · ${textoDeEstado(porNombre().get(e.name))}`} aria-current={props.hablando === e.name ? "page" : undefined} onClick={() => props.onHablar(props.project, e.name)} onDblClick={() => empezarARenombrar(e.name)}>
                      {displayName(e.name, profiles()[e.name])}
                    </button>
                  }
                >
                  <form data-agent-rename class="min-w-0" onSubmit={(ev) => { ev.preventDefault(); void guardarNombre(e.name); }}>
                    {/* La medida del nombre y no la del átomo: renombrar no mueve la fila. */}
                    <Input
                      ref={enfocarYSeleccionar}
                      variant="ghost"
                      class="block h-auto min-h-0 rounded-none border-0 p-0 font-sans text-[0.8125rem] leading-[1.35] text-inherit [font-weight:inherit]"
                      maxlength={60}
                      value={borrador()}
                      placeholder={e.name}
                      aria-label={t("projects.agents.rename_label", { name: displayName(e.name, profiles()[e.name]) })}
                      onInput={(ev) => setBorrador(ev.currentTarget.value)}
                      onBlur={() => void guardarNombre(e.name)}
                      onKeyDown={(ev) => {
                        if (ev.key === "Escape") {
                          ev.stopPropagation();
                          setRenombrando(null);
                        }
                      }}
                    />
                  </form>
                </Show>
                <div data-agent-actions class={cn("pointer-events-none absolute inset-y-1 right-1 flex items-center rounded-sm pl-1 opacity-0 transition-opacity group-hover/agente:pointer-events-auto group-hover/agente:bg-neutral-100 group-hover/agente:opacity-100 group-focus-within/agente:pointer-events-auto group-focus-within/agente:opacity-100", props.hablando === e.name ? "bg-neutral-200" : "bg-neutral-100", menu() === e.name && "pointer-events-auto opacity-100", renombrando() === e.name && "hidden")}>
                {/* Un menú, como el de las tareas: con dos acciones, abrir
                    el perfil directo dejaría fuera el reposo de la computadora. */}
                <Popover open={menu() === e.name} onOpenChange={(abierto) => setMenu(abierto ? e.name : null)} placement="right-start" gutter={6}>
                  <PopoverTrigger
                    as={(p: object) => (
                      <button
                        {...p}
                        class="grid size-6 place-items-center rounded-sm border-0 bg-transparent text-neutral-500 hover:bg-neutral-200 hover:text-neutral-950 focus-visible:outline-2 focus-visible:outline-primary"
                        aria-label={t("projects.agents.actions_named", { name: displayName(e.name, profiles()[e.name]) })}
                        aria-haspopup="menu"
                        title={t("projects.agents.actions")}
                      >
                        <MoreVertical size={15} />
                      </button>
                    )}
                  />
                  <PopoverContent role="menu" class="w-64 p-1">
                    <button
                      role="menuitem"
                      class={ITEM_DE_MENU}
                      onClick={() => {
                        setMenu(null);
                        props.onProfile(props.project, e.name);
                      }}
                    >
                      {t("projects.agents.profile_open")}
                    </button>
                    <button role="menuitem" class={ITEM_DE_MENU} onClick={() => empezarARenombrar(e.name)}>
                      {t("projects.agents.rename")}
                    </button>
                    {/* Los tres modos y no un interruptor: «Apagado» es un
                        estado que alguien eligió, y un sí/no lo pintaría igual
                        que «Con agentes» y lo pisaría al volver a pulsarlo. */}
                    <Show when={awake.status()?.supported}>
                      <span class="my-1 block h-px bg-border" />
                      <Popover placement="right-start" gutter={6}>
                        <div onPointerDown={(ev) => ev.stopPropagation()} onClick={(ev) => ev.stopPropagation()}>
                          <PopoverTrigger as={(trigger: object) => (
                            <button {...trigger} role="menuitem" aria-haspopup="menu" class={`${ITEM_DE_MENU} flex items-center justify-between gap-2`}>
                              <span class="min-w-0 truncate">{t("shell.keep_awake.title")}</span>
                              <span class="flex shrink-0 items-center gap-1 text-[0.6875rem] text-neutral-500">
                                {awake.status() ? nameOf(awake.status()!.mode) : ""}
                                <ChevronRight size={14} />
                              </span>
                            </button>
                          )} />
                        </div>
                        <PopoverContent role="menu" aria-label={t("shell.keep_awake.title")} class="w-72 p-1">
                          <p class="m-0 px-2 pt-1 pb-1.5 text-[0.6875rem] leading-[1.4] text-neutral-500">
                            {t("projects.agents.keep_awake_scope")}
                          </p>
                          <For each={MODES}>
                            {(mode) => (
                              <button
                                role="menuitemradio"
                                aria-checked={awake.status()?.mode === mode}
                                class={cn(ITEM_DE_MENU, awake.status()?.mode === mode && "font-semibold")}
                                onClick={() => {
                                  setMenu(null);
                                  awake.choose(mode);
                                }}
                              >
                                <span class="block">{nameOf(mode)}</span>
                                <span class="block text-[0.6875rem] font-normal text-neutral-500">{descriptionOf(mode)}</span>
                              </button>
                            )}
                          </For>
                        </PopoverContent>
                      </Popover>
                    </Show>
                  </PopoverContent>
                </Popover>
                </div>
              </div>
            </li>
          ); }}
        </For>
      </ul>
      <Show when={!props.search?.trim()}><Button variant="ghost" size="compact" class="w-full justify-start text-neutral-500" onClick={props.onNewAgent}><Plus size={14} />{t("projects.agents.new_open")}</Button></Show>
    </>
  );
}
