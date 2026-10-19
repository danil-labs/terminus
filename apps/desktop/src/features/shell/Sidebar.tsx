import Archive from "lucide-solid/icons/archive";
import ChevronRight from "lucide-solid/icons/chevron-right";
import History from "lucide-solid/icons/history";
import Loader2 from "lucide-solid/icons/loader-2";
import MoreVertical from "lucide-solid/icons/more-vertical";
import PanelLeftClose from "lucide-solid/icons/panel-left-close";
import Plus from "lucide-solid/icons/plus";
import Search from "lucide-solid/icons/search";
import SettingsIcon from "lucide-solid/icons/settings";
import SquarePen from "lucide-solid/icons/square-pen";
import TriangleAlert from "lucide-solid/icons/triangle-alert";
import X from "lucide-solid/icons/x";
import { createEffect, createMemo, createSignal, type JSX, on, onCleanup, Show } from "solid-js";
import { destinoEnVuelo, puntoDelArrastre, tareaEnVuelo } from "../../lib/drag";
import { enfocarYSeleccionar } from "../../lib/focus";
import { t } from "../../lib/i18n";
import type { Project } from "../../lib/model";
import { createPref } from "../../lib/prefs";
import { PROJECT_NAME_MAX_LENGTH } from "../../lib/projectNames";
import { ariaDeAtajo } from "../../lib/shortcuts";
import { cn } from "../../lib/utils";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { KeyedList } from "../../ui/KeyedList";
import {
  ITEM_DE_MENU,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../ui/Popover";
import { BotonConAtajo, TeclaDeAtajo } from "../../ui/Shortcut";
import {
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  Sidebar as SidebarShell,
} from "../../ui/sidebar";
import { type ClonEnCurso, faseDeClon } from "../projects/AddWorkdir";
import { AstroAvatar } from "../projects/AstroAvatar";
import { FolderSquare } from "../projects/FolderChip";
import NewAgent, { type ModelChoices } from "../projects/NewAgent";
import Sessions, { type SessionRow } from "../projects/Sessions";
import type { Etapa } from "../projects/TaskStage";
import EstadoDeTarea from "../projects/TaskStatus";
import { ConexionesMenu } from "../settings/Tools";
import {
  applyFilter,
  bucketOf,
  DEFAULT_SIDEBAR_FILTER,
  effectiveFolders,
  type FlatTask,
  flattenTasks,
  folderCounts,
  groupTasks,
  normalizeFilter,
  rowActivity,
  type SidebarFilter,
} from "./sidebarTasks";

/* El ancho vive en `ColumnaLateral`, que es la columna que envuelve a esta
   barra. Aquí había cuatro constantes —expandido, mínimo, máximo y el riel— que
   existían para alimentar un panel redimensionable; ese panel se fue, y con él
   la única razón de que el ancho fuera un número en este archivo. */

/**
 * El rasgo que enciende la cabecera sobre la que se soltaría la tarea que va en
 * la mano. Solo agrupando por carpeta hay cabeceras que reciben tareas.
 */
const RECIBE_LA_TAREA = ["ring-2", "ring-primary"];

type Tarea = FlatTask<SessionRow>;

/**
 * Abierto o cerrado, y nada más.
 *
 * **Ni el ancho ni el arrastre viven aquí.** Los dos son de `ColumnaLateral`,
 * que es lo que las dos columnas comparten. Aquí queda lo
 * que **no** comparten: que el historial recuerda entre sesiones de la app si
 * estaba plegado, mientras la columna de artefactos se cierra al cambiar de
 * tarea porque es de ella.
 */
export function createSidebar() {
  const [colapsado, setColapsado] = createPref("sidebar.collapsed", false);

  return {
    colapsado,
    alternar: () => setColapsado(!colapsado()),
  };
}

/**
 * La columna izquierda, montada sobre el shell de `ui/sidebar.tsx`.
 *
 * **Solo tareas, en una lista plana de todas las carpetas.** La carpeta es un
 * dato de cada fila y no un nivel de la lista: una carpeta sin tareas no
 * aparece nunca. Arriba lo que te necesita, en medio lo demás y lo asentado
 * plegado al final.
 */
export default function Sidebar(props: {
  projects: Project[];
  /** Por id de proyecto, no por nombre: un proyecto se renombra. */
  sessions: Record<string, SessionRow[]>;
  current: string | null;
  /** Las tareas que están contestando ahora mismo. */
  vivas: string[];
  /** Las tareas paradas esperando que apruebes una acción. */
  aprobando: string[];
  collapsed: boolean;
  onToggle: () => void;
  onPick: (project: string, id: string) => void;
  onNew: () => void;
  onRenombrarProyecto: (id: string, name: string) => Promise<void> | void;
  onBorrarProyecto: (id: string) => Promise<void> | void;
  /** With more than one space, the folder leaves the active one instead of being deleted. */
  onRemoveFromSpace?: (id: string) => void;
  onAnadirCarpeta: () => void;
  /** El clon que corre ahora mismo, si lo hay. Ver `projects/AddWorkdir.tsx`. */
  clon: ClonEnCurso | null;
  /** Devuelve el diálogo del clon, con su progreso y su cancelación. */
  onAbrirClon: () => void;
  /** Qué proyecto se está mirando en el panel principal, si alguno. */
  proyectoAbierto: string | null;
  /** Abre el proyecto en el panel principal: sus tareas y su contexto fijo. */
  onAbrirProyecto: (id: string) => void;
  /** Lo que se ofrece como modelo por defecto al crear un agente. */
  modelos: ModelChoices;
  /** Empezar una tarea dentro de ese proyecto, sin pasar por su vista. */
  onNuevaTareaEn: (id: string) => void;
  onDelete: (project: string, id: string) => Promise<boolean | void> | boolean | void;
  onMove: (project: string, id: string, to: string) => void;
  onEtapa: (project: string, id: string, etapa: Etapa | null) => void;
  onRenombrar: (project: string, id: string, title: string) => Promise<boolean | void> | boolean | void;
  onPin?: (project: string, id: string, pinned: boolean) => void | Promise<void>;
  onSettings: (panel?: string) => void;
  /** El nombre del escritorio activo, para su riel vacío. */
  escritorio?: string | null;
  viendoArchivadas?: boolean;
  onArchivadas?: () => void;
  spaces?: { id: string; name: string }[];
  onMoveToSpace?: (project: string, id: string, space: string) => void;
}) {
  const [creatingAgentIn, setCreatingAgentIn] = createSignal<{ id: string; name: string } | null>(null);
  let listViewport: HTMLDivElement | undefined;
  // Colapsado, el historial no desaparece: se abre al lado del riel.
  const [desplegado, setDesplegado] = createSignal(false);
  // El renombrado de carpeta, en línea en su cabecera de grupo.
  const [nombre, setNombre] = createSignal("");
  // Qué carpeta tiene el menú abierto, y en qué vista: las acciones o la
  // confirmación de borrado. **Un solo Popover con dos contenidos**, no dos
  // anidados: un panel que se abre desde dentro de otro se cierra con el
  // primero, y la advertencia de lo que se pierde se iría con él.
  const [menu, setMenu] = createSignal<string | null>(null);
  const [confirmando, setConfirmando] = createSignal<string | null>(null);
  const [renombrando, setRenombrando] = createSignal<string | null>(null);
  let riel: HTMLDivElement | undefined;

  // Expandir vuelve redundante el desplegable: la lista ya está a la vista.
  createEffect(
    on(
      () => props.collapsed,
      (c) => {
        if (!c) setDesplegado(false);
      },
    ),
  );

  createEffect(
    on(desplegado, (abierto) => {
      if (!abierto) return;
      const alPulsar = (e: PointerEvent) => {
        if (!riel?.contains(e.target as Node)) setDesplegado(false);
      };
      const alTeclear = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          setDesplegado(false);
        }
      };
      document.addEventListener("pointerdown", alPulsar);
      window.addEventListener("keydown", alTeclear, true);
      onCleanup(() => {
        document.removeEventListener("pointerdown", alPulsar);
        window.removeEventListener("keydown", alTeclear, true);
      });
    }),
  );

  // Los grupos por carpeta plegados; la clave es la de siempre para no perder
  // lo que alguien ya había plegado.
  const [cerrados, setCerrados] = createPref<string[]>("historial.cerrados", []);
  const alternarGrupo = (p: string) =>
    setCerrados(
      cerrados().includes(p)
        ? cerrados().filter((x) => x !== p)
        : [...cerrados(), p],
    );
  const [asentadasAbiertas, setAsentadasAbiertas] = createPref("sidebar.asentadas.abiertas", false);
  const [filtroGuardado] = createPref<SidebarFilter>("sidebar.filtro", DEFAULT_SIDEBAR_FILTER);
  const filtro = createMemo(() => normalizeFilter(filtroGuardado()));

  const [searchOpen, setSearchOpen] = createSignal(false);
  const [searchText, setSearchText] = createSignal("");
  const query = () => searchText().trim();
  const [searchCounts, setSearchCounts] = createSignal<Record<string, number>>({});
  const reportResults = (key: string, count: number) => setSearchCounts(previous => previous[key] === count ? previous : { ...previous, [key]: count });
  const closeSearch = () => { setSearchText(""); setSearchOpen(false); };
  createEffect(() => { if (props.collapsed) closeSearch(); });

  /** De qué carpeta es cada tarea, por id: las acciones de la fila llegan con el id. */
  const carpetaDeTarea = createMemo(() => {
    const mapa = new Map<string, string>();
    for (const [project, rows] of Object.entries(props.sessions)) for (const row of rows) if (!mapa.get(row.id)) mapa.set(row.id, project);
    return mapa;
  });
  const carpetaDe = (id: string) => carpetaDeTarea().get(id) ?? "";
  const nombreDe = (project: string) => props.projects.find((p) => p.id === project)?.name;
  const relacionadas = createMemo(() => Object.values(props.sessions).flat());

  const todas = createMemo(() => flattenTasks(props.sessions, !!query()));
  const cuentas = createMemo(() => folderCounts(todas()));
  const visibles = createMemo(() =>
    applyFilter(todas(), effectiveFolders(filtro(), cuentas()), filtro().agent));
  const actividad = (row: SessionRow) => rowActivity(row, props.vivas, props.aprobando);
  const cubos = createMemo(() => {
    const out: Record<"need" | "tasks" | "settled", Tarea[]> = { need: [], tasks: [], settled: [] };
    for (const tarea of visibles()) out[bucketOf(tarea.row, actividad(tarea.row))].push(tarea);
    return out;
  });
  const grupos = createMemo(() => {
    const agrupar = filtro().group;
    if (agrupar === "none") return [];
    return groupTasks([...cubos().need, ...cubos().tasks], agrupar, actividad, props.projects.map((p) => p.id));
  });
  const conResultados = (clave: string) => (searchCounts()[clave] ?? 0) > 0;

  /**
   * A qué proyectos puede irse una tarea que hoy está en `de`.
   *
   * **Sacarla de todos no está aquí**, aunque el backend lo trate como un
   * destino más (`to` vacío): en el menú es una acción y no un sitio, y
   * mezclarla con los nombres de proyecto la hacía leerse como uno.
   */
  const destinos = (de: string) =>
    props.projects
      .filter((p) => p.id !== de)
      .map((p) => ({ id: p.id, name: p.name }));

  /**
   * Un tramo de la lista: las tareas de varias carpetas en una sola lista.
   *
   * **Es un componente y no una variable con JSX.** La lista se pinta en dos
   * sitios —expandida y en el desplegable—; una variable contendría un solo
   * nodo del DOM y colocarlo dos veces lo movería del primero al segundo.
   */
  const Historial = (p: { tareas: Tarea[]; clave: string }) => (
    <Sessions sidebar
      sessions={p.tareas.map((tarea) => tarea.row)}
      relatedSessions={relacionadas()}
      groupByAuthor={false}
      search={query()}
      onSearchResults={count => reportResults(p.clave, count)}
      current={props.current}
      vivas={props.vivas}
      aprobando={props.aprobando}
      de=""
      projectOf={(row) => carpetaDe(row.id)}
      destinos={[]}
      destinosDe={(row) => destinos(carpetaDe(row.id))}
      carpetaDe={(row) => nombreDe(carpetaDe(row.id))}
      onPick={(s) => {
        props.onPick(carpetaDe(s), s);
        setDesplegado(false);
      }}
      onDelete={(s) => props.onDelete(carpetaDe(s), s)}
      onEtapa={(s, etapa) => props.onEtapa(carpetaDe(s), s, etapa)}
      onRenombrar={(s, title) => props.onRenombrar(carpetaDe(s), s, title)}
      onPin={props.onPin ? (s, pinned) => props.onPin?.(carpetaDe(s), s, pinned) : undefined}
      spaces={props.spaces}
      onMoveToSpace={(s, space) => props.onMoveToSpace?.(carpetaDe(s), s, space)}
      onMove={(s, to) => {
        // El grupo de destino se abre: una tarea que se mueve a una carpeta
        // plegada desaparece de la pantalla, y eso se lee como que se borró.
        setCerrados(cerrados().filter((x) => x !== to));
        props.onMove(carpetaDe(s), s, to);
      }}
    />
  );

  /** El rótulo de un tramo, con su cuenta a la derecha. */
  const Rotulo = (p: { children: JSX.Element; cuenta: number; tono?: "need" }) => (
    <div class={cn(
      "flex h-7 min-w-0 items-center gap-1.5 px-2 pt-1 text-[0.6875rem] font-medium",
      p.tono === "need" ? "text-warning" : "text-neutral-500",
    )}>
      {p.children}
      <span class={cn("ml-auto shrink-0 tabular-nums", p.tono !== "need" && "text-neutral-700")}>{p.cuenta}</span>
    </div>
  );

  /** Cuántas filas enseña un tramo: buscando, las que encontró. */
  const cuentaDe = (clave: string, tareas: Tarea[]) => query() ? (searchCounts()[clave] ?? 0) : tareas.length;

  const Tramo = (p: { clave: string; titulo: string; tareas: Tarea[]; tono?: "need" }) => (
    <Show when={p.tareas.length > 0}>
      <section
        data-sidebar-section={p.clave}
        aria-label={p.titulo}
        classList={{ hidden: !!query() && !conResultados(p.clave) }}
      >
        <Rotulo cuenta={cuentaDe(p.clave, p.tareas)} tono={p.tono}>
          <span class="min-w-0 truncate">{p.titulo}</span>
        </Rotulo>
        <Historial tareas={p.tareas} clave={p.clave} />
      </section>
    </Show>
  );

  /**
   * La carpeta que se está clonando, encima de la lista.
   *
   * No se puede abrir ni recibe tareas: no hay proyecto hasta que `git clone`
   * termina. Pulsarla devuelve el diálogo, que es donde viven el progreso y la
   * cancelación. Sin esta fila, un clon de varios minutos no deja rastro en la
   * lista y se relanza creyendo que no pasó nada.
   */
  const FilaDeClon = (pp: { clon: ClonEnCurso }) => (
    <button
      class="grid min-w-0 grid-cols-[22px_minmax(0,1fr)] items-center gap-0.5 rounded-[var(--radius-sm)] px-2 py-1 text-left outline-none hover:bg-surface-muted focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      onClick={() => props.onAbrirClon()}
    >
      <Show
        when={!pp.clon.failed}
        fallback={
          <TriangleAlert
            size={14}
            class="justify-self-center text-error-strong"
            aria-hidden="true"
          />
        }
      >
        <Loader2
          size={14}
          class="animate-spin justify-self-center text-neutral-500"
          aria-hidden="true"
        />
      </Show>
      <span class="grid min-w-0">
        <span class="truncate text-[0.8125rem] font-medium text-neutral-500">
          {pp.clon.name || t("shell.sidebar.clone_unnamed")}
        </span>
        <span class="truncate text-[0.6875rem] text-neutral-500">
          {pp.clon.failed
            ? t("projects.add.clone_failed")
            : `${t("projects.add.cloning")} ${faseDeClon(pp.clon.phase)}${
                pp.clon.percent == null
                  ? ""
                  : ` · ${t("projects.add.percent", { percent: pp.clon.percent })}`
              }`}
        </span>
      </span>
    </button>
  );

  /**
   * La cabecera de un grupo por carpeta. Solo existe si la carpeta tiene
   * tareas; es además el destino del arrastre y la puerta a lo que se hace
   * con la carpeta mientras eso no viva en Ajustes.
   */
  const CabeceraDeCarpeta = (pp: { p: Project; abierto: boolean; cuenta: number; tareas: Tarea[] }) => {
    const p = () => pp.p;
    const recibiendo = () => destinoEnVuelo() === p().id;
    return (
      <div
        data-folder-group={p().id}
        class={cn(
          "group grid min-w-0 grid-cols-[20px_minmax(0,1fr)_auto_auto] items-center rounded-[var(--radius-sm)]",
          recibiendo() && RECIBE_LA_TAREA,
        )}
        data-destino={p().id}
      >
        <button
          class="relative grid size-5 place-items-center rounded-sm text-neutral-500 outline-none hover:bg-surface-muted hover:text-neutral-950 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          aria-expanded={pp.abierto}
          aria-label={
            pp.abierto
              ? t("shell.sidebar.collapse_group", { name: p().name })
              : t("shell.sidebar.expand_group", { name: p().name })
          }
          onClick={() => alternarGrupo(p().id)}
        >
          <span class="transition-opacity group-hover:opacity-0"><FolderSquare id={p().id} /></span>
          <ChevronRight size={14} class={cn("absolute opacity-0 transition-[opacity,transform] group-hover:opacity-100", pp.abierto && "rotate-90")} />
        </button>

        {/* Renombrar pasa dentro de la cabecera, con la misma altura y letra:
            lo único que cambia es que el texto se puede escribir. */}
        <Show
          when={renombrando() === p().id}
          fallback={
            <SidebarMenuButton
              data-folder-open=""
              class="h-7 min-h-7 grid-cols-[minmax(0,1fr)_auto] text-[0.75rem] font-semibold"
              isActive={props.proyectoAbierto === p().id}
              selectionMark={false}
              onDblClick={() => { setNombre(p().name); setRenombrando(p().id); }}
              onKeyDown={(e) => { if (e.key === "F2") { e.preventDefault(); setNombre(p().name); setRenombrando(p().id); } }}
              onClick={() => {
                props.onAbrirProyecto(p().id);
                setDesplegado(false);
              }}
            >
              <span class="truncate">{p().name}</span>
              <Show
                when={!pp.abierto}
                fallback={<span class="tabular-nums text-[0.6875rem] font-medium text-neutral-500">{pp.cuenta}</span>}
              >
                <EstadoDeTarea
                  ambito="plegadas"
                  aprobando={pp.tareas.some((x) => props.aprobando.includes(x.row.id))}
                  viva={pp.tareas.some((x) => props.vivas.includes(x.row.id))}
                  esperando={pp.tareas.some((x) => x.row.esperando)}
                  outcome={pp.tareas.some((x) => x.row.sin_ver && x.row.outcome === "failed") ? "failed" : null}
                  sinVer={pp.tareas.some((x) => x.row.sin_ver)}
                />
              </Show>
            </SidebarMenuButton>
          }
        >
          <form
            class="grid h-7 min-w-0 grid-cols-[minmax(0,1fr)] items-center gap-0.5 rounded-[var(--radius-sm)] bg-neutral-200 px-2 text-[0.75rem] font-semibold"
            onSubmit={(e) => {
              e.preventDefault();
              const n = nombre().trim();
              setRenombrando(null);
              if (n && n !== p().name)
                void props.onRenombrarProyecto(p().id, n);
            }}
          >
            <Input
              ref={enfocarYSeleccionar}
              variant="ghost"
              class="block h-auto min-h-0 rounded-none border-0 p-0 font-sans text-[0.75rem] leading-[1.25] text-inherit [font-weight:inherit]"
              maxlength={PROJECT_NAME_MAX_LENGTH}
              value={nombre()}
              aria-label={t("shell.sidebar.rename_label", { name: p().name })}
              onInput={(e) => setNombre(e.currentTarget.value)}
              onBlur={() => setRenombrando(null)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setRenombrando(null);
              }}
            />
          </form>
        </Show>

        {/* Borrar vive dentro del menú, con su nombre escrito, y la
            confirmación se pinta en este mismo panel. */}
        <Popover
          open={menu() === p().id}
          onOpenChange={(abre) => {
            setMenu(abre ? p().id : null);
            if (!abre) setConfirmando(null);
          }}
          placement="right-start"
          gutter={6}
        >
          {/* Sin `onClick` propio: pisaría el que abre el panel. Ver
              la cabecera de `Sessions.tsx`. */}
          <PopoverTrigger
            as={(disparador: object) => (
              <button
                {...disparador}
                class="mr-1 grid size-6 shrink-0 place-items-center rounded-sm text-neutral-500 opacity-0 outline-none hover:bg-surface-muted hover:text-neutral-950 focus-visible:opacity-100 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary group-hover:opacity-100 group-focus-within:opacity-100 data-[expanded]:opacity-100"
                aria-label={t("shell.sidebar.project_actions", { name: p().name })}
                aria-haspopup="menu"
                title={t("shell.sidebar.actions")}
              >
                <MoreVertical size={15} />
              </button>
            )}
          />
          {/* Un solo `PopoverContent` con dos vistas: cambiarlo por otro lo
              desmonta a mitad de una decisión que es irreversible. */}
          <PopoverContent
            role={confirmando() === p().id ? undefined : "menu"}
            class={confirmando() === p().id ? "w-80 p-3" : "w-56 p-1"}
          >
            <Show
              when={confirmando() === p().id}
              fallback={
                <>
                  <button role="menuitem" class={ITEM_DE_MENU} onClick={() => {
                    setMenu(null);
                    setCreatingAgentIn({ id: p().id, name: p().name });
                  }}>{t("projects.agents.new_open")}</button>
                  <button
                    role="menuitem"
                    class={ITEM_DE_MENU}
                    onClick={() => {
                      setMenu(null);
                      setNombre(p().name);
                      setRenombrando(p().id);
                    }}
                  >
                    {t("shell.sidebar.rename")}
                  </button>
                  <Show
                    when={props.onRemoveFromSpace}
                    fallback={
                      <button
                        role="menuitem"
                        class={`${ITEM_DE_MENU} text-error-strong`}
                        onClick={() => setConfirmando(p().id)}
                      >
                        {t("shell.sidebar.delete_project")}
                      </button>
                    }
                  >
                    {(quitar) => (
                      <button
                        role="menuitem"
                        class={ITEM_DE_MENU}
                        onClick={() => {
                          setMenu(null);
                          quitar()(p().id);
                        }}
                      >
                        {t("shell.sidebar.remove_from_space")}
                      </button>
                    )}
                  </Show>
                </>
              }
            >
              <p class="m-0 text-sm font-semibold text-neutral-950">
                {t("shell.sidebar.delete_title", { name: p().name })}
              </p>
              <p class="mt-1 mb-3 text-xs leading-relaxed text-neutral-700">
                {p().sessions === 0
                  ? t("shell.sidebar.delete_empty")
                  : t("shell.sidebar.delete_with_tasks", {
                      count: p().sessions,
                    })}{" "}
                {t("shell.sidebar.delete_no_undo")}
              </p>
              <div class="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  class="shrink-0"
                  onClick={() => setMenu(null)}
                >
                  {t("shell.sidebar.keep")}
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  class="shrink-0"
                  onClick={() => {
                    setMenu(null);
                    void props.onBorrarProyecto(p().id);
                  }}
                >
                  {t("shell.sidebar.delete_project")}
                </Button>
              </div>
            </Show>
          </PopoverContent>
        </Popover>

        <button
          class="mr-1 grid size-6 shrink-0 place-items-center rounded-sm text-neutral-500 opacity-0 outline-none hover:bg-surface-muted hover:text-neutral-950 focus-visible:opacity-100 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary group-hover:opacity-100 group-focus-within:opacity-100"
          aria-label={t("shell.sidebar.new_task_in", { name: p().name })}
          title={t("shell.sidebar.new_task_in", { name: p().name })}
          onClick={(e) => {
            e.stopPropagation();
            props.onNuevaTareaEn(p().id);
          }}
        >
          <SquarePen size={15} />
        </button>
      </div>
    );
  };

  /** El título de un grupo de «Agrupar». */
  const tituloDeGrupo = (clave: string) => {
    const agrupar = filtro().group;
    if (agrupar === "folder") return clave === "" ? t("shell.sidebar.no_folder") : (nombreDe(clave) ?? clave);
    if (agrupar === "status") {
      return clave === "need" ? t("shell.sidebar.need_you")
        : clave === "working" ? t("shell.sidebar.group_working")
        : t("shell.sidebar.group_idle");
    }
    return clave.startsWith("agent:") ? clave.slice(6) : t("projects.sessions.without_agent");
  };

  const Grupo = (p: { clave: string; tareas: Tarea[] }) => {
    const clave = () => `group:${p.clave}`;
    const proyecto = () => filtro().group === "folder" ? props.projects.find((x) => x.id === p.clave) : undefined;
    const abierto = () => !!query() || filtro().group !== "folder" || !cerrados().includes(p.clave);
    return (
      <section
        data-sidebar-group={p.clave}
        aria-label={tituloDeGrupo(p.clave)}
        classList={{ hidden: !!query() && !conResultados(clave()) }}
      >
        <Show
          when={proyecto()}
          fallback={
            <div
              data-destino={filtro().group === "folder" ? "" : undefined}
              class={cn("rounded-[var(--radius-sm)]", filtro().group === "folder" && destinoEnVuelo() === "" && RECIBE_LA_TAREA)}
            >
              <Rotulo cuenta={cuentaDe(clave(), p.tareas)} tono={filtro().group === "status" && p.clave === "need" ? "need" : undefined}>
                <Show when={p.clave.startsWith("agent:")}>
                  <AstroAvatar name={p.clave.slice(6)} status="asleep" size={14} />
                </Show>
                <span class="min-w-0 truncate">{tituloDeGrupo(p.clave)}</span>
              </Rotulo>
            </div>
          }
        >
          {(proj) => <CabeceraDeCarpeta p={proj()} abierto={abierto()} cuenta={cuentaDe(clave(), p.tareas)} tareas={p.tareas} />}
        </Show>
        <Show when={abierto()}>
          <Historial tareas={p.tareas} clave={clave()} />
        </Show>
      </section>
    );
  };

  const hayResultados = () => Object.values(searchCounts()).some((n) => n > 0);

  /** La misma lista, montada en dos sitios: expandida y en el desplegable. */
  const Lista = () => (
    <div data-sidebar-tasks class="grid min-w-0 gap-1">
      <Show when={props.clon}>{(c) => <FilaDeClon clon={c()} />}</Show>

      <Show when={todas().length === 0 && !query()}>
        <Show
          when={props.projects.length === 0}
          fallback={<p class="m-0 px-2 pt-1 text-xs text-neutral-500" data-sidebar-empty="">{t("shell.sidebar.empty")}</p>}
        >
          <Show when={props.escritorio}>
            <p class="m-0 px-2 pt-1 text-xs text-neutral-500" data-desk-empty="">
              {t("spaces.rail.empty", { name: props.escritorio ?? "" })}
            </p>
          </Show>
          <Button variant="ghost" size="compact" class="w-full justify-start text-neutral-500" onClick={props.onAnadirCarpeta}><Plus size={14} />{t("shell.sidebar.new_folder")}</Button>
        </Show>
      </Show>

      <Show
        when={filtro().group !== "none"}
        fallback={
          <>
            <Tramo clave="need" titulo={t("shell.sidebar.need_you")} tareas={cubos().need} tono="need" />
            <Tramo clave="tasks" titulo={t("shell.sidebar.tasks")} tareas={cubos().tasks} />
          </>
        }
      >
        <KeyedList each={grupos()} by={(g) => g.key}>{(g) => <Grupo clave={g().key} tareas={g().tasks} />}</KeyedList>
      </Show>

      {/* Lo asentado nace plegado: entregado y visto, o marcado como hecho.
          Buscando se abre, para que lo encontrado se vea. */}
      <Show when={cubos().settled.length > 0}>
        <section
          data-sidebar-section="settled"
          aria-label={t("shell.sidebar.settled")}
          classList={{ hidden: !!query() && !conResultados("settled") }}
        >
          <button
            type="button"
            class="flex h-7 w-full min-w-0 items-center gap-1 rounded-sm px-2 pt-1 text-left text-[0.6875rem] font-medium text-neutral-500 outline-none hover:text-neutral-950 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-primary"
            aria-expanded={!!query() || asentadasAbiertas()}
            onClick={() => setAsentadasAbiertas(!asentadasAbiertas())}
          >
            <ChevronRight size={13} aria-hidden="true" class={cn("shrink-0 transition-transform", (!!query() || asentadasAbiertas()) && "rotate-90")} />
            <span class="min-w-0 truncate">{t("shell.sidebar.settled")}</span>
            <span class="ml-auto shrink-0 tabular-nums text-neutral-700">{cuentaDe("settled", cubos().settled)}</span>
          </button>
          <Show when={!!query() || asentadasAbiertas()}>
            <Historial tareas={cubos().settled} clave="settled" />
          </Show>
        </section>
      </Show>
    </div>
  );

  return (
    <div
      ref={riel}
      // El borde que separa esta región del chat lo dibuja `ColumnaLateral`, y
      // no aquí: es la frontera **entre** las dos columnas, así que tiene que
      // irse cuando la columna se va. Con el borde en este div, cerrarla lo
      // recortaba a la vez que el contenido; con el mismo borde en las dos
      // columnas habría dos definiciones de la misma línea.
      //
      // `w-full min-w-0`: sin eso el contenido no se entera del ancho del
      // contenedor —`overflow-visible` hace falta para el menú del pie y para
      // el desplegable— así que los títulos largos lo estiraban y empujaban
      // fuera de la vista lo que estuviera a la derecha, como el «+».
      class="relative z-40 h-full min-h-0 w-full min-w-0 overflow-hidden"
    >
      <Show when={creatingAgentIn()}>{project => <NewAgent
        abierto onAbrir={open => { if (!open) setCreatingAgentIn(null); }}
        project={project().id}
        modelos={props.modelos}
        onCreado={() => setCreatingAgentIn(null)}
      />}</Show>
      <SidebarShell
        state={props.collapsed ? "collapsed" : "expanded"}
        class="h-full w-full min-w-0"
        aria-label={t("shell.sidebar.label")}
      >
        {/* Sin cabecera, el pie cae en la fila `1fr` de las tres que reparte
            `ui/sidebar.tsx`: se pega debajo de la lista y se va con lo que ésta
            crezca. */}
        <SidebarHeader class="px-2 pt-2 pb-2">
          <div class={cn("flex min-w-0 items-center gap-1", props.collapsed && "flex-col")}>
          <BotonConAtajo
            variant="ghost"
            size="icon"
            class="size-7 shrink-0 text-neutral-500"
            onClick={props.onToggle}
            aria-pressed
            accion="sidebar"
            etiqueta={t("shell.sidebar.hide")}
            aria-label={t("shell.sidebar.hide")}
          >
            <PanelLeftClose size={16} />
          </BotonConAtajo>
          <Show when={!props.collapsed && !searchOpen()}>
            <Button variant="chrome" size="iconCompact" class="size-7 shrink-0 text-neutral-500" aria-label={t("shell.sidebar.search")} title={t("shell.sidebar.search")} aria-expanded={searchOpen()} onClick={() => setSearchOpen(true)}>
              <Search size={16} />
            </Button>
          </Show>
          <Show when={!props.collapsed && searchOpen()}>
            <div data-sidebar-search class="flex h-7 min-w-0 flex-1 items-center gap-1 rounded-md border border-border-strong bg-surface-raised px-1 focus-within:outline-solid focus-within:outline-2 focus-within:outline-primary">
              <Input ref={enfocarYSeleccionar} type="text" role="searchbox" variant="ghost" class="h-full min-h-0 min-w-0 flex-1 border-0 px-0 py-0" placeholder={t("shell.sidebar.search")} aria-label={t("shell.sidebar.search")} value={searchText()} onInput={event => setSearchText(event.currentTarget.value)} onKeyDown={event => {
                if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeSearch(); }
              }} />
              <Button variant="chrome" size="iconCompact" class="size-6 shrink-0 text-neutral-500" aria-label={t("shell.sidebar.close_search")} title={t("shell.sidebar.close_search")} onClick={closeSearch}><X size={14} /></Button>
            </div>
          </Show>
          </div>
        </SidebarHeader>

        <SidebarContent class="gap-2 px-2 pb-0">
          <SidebarMenu>
            <SidebarMenuItem>
              {/* Nueva tarea es la acción principal, negra y sólida.
                  `primary` queda reservado para las acciones del agente. */}
              <SidebarMenuButton
                class="bg-neutral-950 font-bold text-neutral-50 hover:bg-neutral-950"
                aria-keyshortcuts={ariaDeAtajo("newTask")}
                aria-label={t("shell.sidebar.new_task")}
                onClick={() => {
                  props.onNew();
                  setDesplegado(false);
                }}
              >
                <SquarePen size={14} aria-hidden="true" />
                <Show when={!props.collapsed}>
                  <span>{t("shell.sidebar.new_task")}</span>
                  <TeclaDeAtajo accion="newTask" />
                </Show>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <Show when={props.collapsed}>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={desplegado()}
                  tooltip={t("shell.sidebar.tasks")}
                  aria-label={t("shell.sidebar.tasks")}
                  aria-expanded={desplegado()}
                  onClick={() => setDesplegado((v) => !v)}
                >
                  <History size={15} />
                  {/* Con la lista escondida, el riel sigue diciendo que hay una
                      sesión abierta: sin esto el estado se comunicaría solo al
                      desplegar. */}
                  <Show when={props.current}>
                    <span class="ui-sidebar-menu-badge absolute top-1 right-1 size-1.5 rounded-full bg-primary" />
                  </Show>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </Show>
          </SidebarMenu>

          <Show when={!props.collapsed}>
            {/* **`overflow-y-auto` y NO `overflow-auto`.** Aquél es de los dos
                ejes: los títulos llegaban al borde sin puntos suspensivos y lo
                de la derecha quedaba fuera de la vista. */}
            {/* `data-arrastre-scroll`: con la lista larga, arrastrar una tarea
                hasta un grupo que está fuera de la vista exige que el panel
                se desplace solo al llegar a sus bordes (`lib/drag.ts`). */}
            <div
              ref={listViewport}
              class="-mr-2 min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto pr-2"
              data-arrastre-scroll=""
            >
              <Show when={query() && !hayResultados()}>
                <p role="status" class="m-0 px-2 py-1 text-xs text-neutral-500">{t("shell.sidebar.no_results")}</p>
              </Show>
              <Lista />
            </div>
          </Show>
        </SidebarContent>

        {/* El de MCP es chico a propósito: es una consulta de un vistazo, del
            peso del botón que oculta el historial. «Archivadas» va primero: abre
            una página, no levanta un panel. */}
        <SidebarFooter class="border-t border-border p-2">
          <div class={cn("flex items-center justify-end gap-1", props.collapsed && "flex-col")}>
            <Show when={!props.collapsed && props.onArchivadas}>
              <Button
                variant={props.viendoArchivadas ? "secondary" : "ghost"}
                size="icon"
                class="size-7 shrink-0 text-neutral-500"
                data-archived-foot=""
                aria-pressed={props.viendoArchivadas}
                aria-label={t("spaces.archived.title")}
                title={t("spaces.archived.foot_title")}
                onClick={() => props.onArchivadas?.()}
              >
                <Archive size={15} aria-hidden="true" />
              </Button>
            </Show>
            <ConexionesMenu onManage={() => props.onSettings("skills")} />
            <Button
              variant="ghost"
              size="icon"
              class="size-7 shrink-0 text-neutral-500"
              aria-label={t("settings.title")}
              title={t("settings.title")}
              onClick={() => props.onSettings()}
            >
              <SettingsIcon size={15} />
            </Button>
          </div>
        </SidebarFooter>
      </SidebarShell>

      {/* El historial colapsado no desaparece: se abre al lado del riel. Este SÍ
          lleva borde y sombra: flota de verdad sobre lo que hay debajo, que es
          para lo que el sistema reserva la elevación. */}
      <Show when={props.collapsed && desplegado()}>
        <div class="absolute top-12 left-full z-40 ml-2 flex max-h-[min(60vh,420px)] w-70 flex-col overflow-hidden rounded-lg border border-border bg-surface-raised shadow-md">
          <div
            ref={listViewport}
            class="min-w-0 overflow-x-hidden overflow-y-auto p-2"
            data-arrastre-scroll=""
          >
            <Lista />
          </div>
        </div>
      </Show>

      {/* Lo que va en la mano mientras se arrastra una tarea.

          **Sin esto el gesto no se ve.** El puntero cambia de forma y el
          grupo de debajo se enciende, pero nada dice QUÉ se está moviendo.

          `pointer-events-none` no es cosmético: `lib/drag.ts` resuelve el
          destino con `elementFromPoint`, y un nodo pegado al puntero sería
          siempre lo que hay debajo del puntero. */}
      <Show when={tareaEnVuelo()}>
        {(enVuelo) => (
          <div
            aria-hidden="true"
            class="pointer-events-none fixed z-[90] max-w-64 truncate rounded-md border border-border bg-surface-raised px-2 py-1 text-xs text-neutral-950 shadow-md"
            style={{
              left: `${puntoDelArrastre().x + 12}px`,
              top: `${puntoDelArrastre().y + 10}px`,
            }}
          >
            {enVuelo().titulo}
          </div>
        )}
      </Show>
    </div>
  );
}
