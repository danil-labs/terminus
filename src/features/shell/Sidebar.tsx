import Archive from "lucide-solid/icons/archive";
import ChevronRight from "lucide-solid/icons/chevron-right";
import Clock from "lucide-solid/icons/clock";
import FolderPlus from "lucide-solid/icons/folder-plus";
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
import { createEffect, createResource, createSignal, on, onCleanup, Show } from "solid-js";
import { destinoEnVuelo, puntoDelArrastre, tareaEnVuelo } from "../../lib/drag";
import { enfocarYSeleccionar } from "../../lib/focus";
import { lastRoster, rememberRoster } from "../../lib/handlerRoster";
import { t } from "../../lib/i18n";
import { invoke } from "../../lib/invoke.ts";
import type { HandlerList, Project } from "../../lib/model";
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
import WorkdirIcon from "../code/WorkdirIcon";
import { type ClonEnCurso, faseDeClon } from "../projects/AddWorkdir";
import AgentRows from "../projects/AgentRows";
import NewAgent, { type ModelChoices } from "../projects/NewAgent";
import Sessions, { type SessionRow } from "../projects/Sessions";
import type { Etapa } from "../projects/TaskStage";
import EstadoDeTarea from "../projects/TaskStatus";
import { ConexionesMenu } from "../settings/Tools";

/* El ancho vive en `ColumnaLateral`, que es la columna que envuelve a esta
   barra. Aquí había cuatro constantes —expandido, mínimo, máximo y el riel— que
   existían para alimentar un panel redimensionable; ese panel se fue, y con él
   la única razón de que el ancho fuera un número en este archivo. */

/**
 * La clave con la que se recuerda si «Recientes» está plegado.
 *
 * **No puede ser `""`**, que es como Rust nombra al grupo sin proyecto: la
 * preferencia guarda ids de proyecto, y una cadena vacía en esa lista no se
 * distingue de un id que se perdió. Lleva un prefijo que ningún `short_id`
 * puede producir.
 */
const SUELTAS = "@recientes";

/**
 * El rasgo que enciende la fila sobre la que se soltaría la tarea que va en la
 * mano. Lo llevan las dos filas que aceptan soltar —un proyecto y «Recientes»—
 * y escrito dos veces se separan sin que nada avise.
 */
const RECIBE_LA_TAREA = ["ring-2", "ring-primary"];

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
 * La columna izquierda, montada sobre el shell de `ui/sidebar.tsx`. Antes esto
 * era `.side-btn` y sus cinco modificadores escritos aquí: la casilla de 22px
 * para el ícono, el truncado de la etiqueta, el tooltip solo cuando está
 * colapsado. Sale del átomo en vez de mantenerse dos veces.
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
  /** Con qué encargado se está hablando ahora, para marcar su fila. */
  hablandoCon?: { project: string; name: string } | null;
  onHablarCon: (project: string, name: string) => void;
  /** Lo que se ofrece como modelo por defecto al crear un agente. */
  modelos: ModelChoices;
  onAgentProfile: (project: string, name: string) => void;
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
  // El alta de proyecto, en línea: un nombre no merece una hoja aparte.
  const [nombre, setNombre] = createSignal("");
  // Qué proyecto tiene el menú abierto, y en qué vista: las acciones o la
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

  /* Aquí vivía `withHistory`: la lista se filtraba a los proyectos que ya
     tenían conversación, con una razón escrita —«el historial es de lo que se
     hizo, no de lo que existe»— que era buena cuando los proyectos salían de
     leer una carpeta con 25 subrepos.

     Ya no salen de ahí: se crean a mano, uno por uno, y uno recién creado que no
     aparece en el sidebar es un proyecto que no existe para quien lo acaba de
     nombrar. La regla se conserva donde sí valía: su historial solo se despliega
     si tiene algo dentro. */

  // Se despliegan solos, porque son pocos y son justo los que importan. Cerrar
  // uno se recuerda; nada se abre por estar activo si no tiene nada dentro.
  const [cerrados, setCerrados] = createPref<string[]>("historial.cerrados", []);
  const alternarGrupo = (p: string) =>
    setCerrados(
      cerrados().includes(p)
        ? cerrados().filter((x) => x !== p)
        : [...cerrados(), p],
    );

  const [agentesPlegados, setAgentesPlegados] = createPref<string[]>(
    "sidebar.agentes.plegados",
    [],
  );
  const alternarAgentes = (p: string) =>
    setAgentesPlegados(
      agentesPlegados().includes(p)
        ? agentesPlegados().filter((x) => x !== p)
        : [...agentesPlegados(), p],
    );

  const [searchOpen, setSearchOpen] = createSignal(false);
  const [searchText, setSearchText] = createSignal("");
  const query = () => searchText().trim();
  const [searchCounts, setSearchCounts] = createSignal<Record<string, number>>({});
  const reportResults = (key: string, count: number) => setSearchCounts(previous => previous[key] === count ? previous : { ...previous, [key]: count });
  const resultCount = (project: string) => (searchCounts()[`tasks:${project}`] ?? 0) + (searchCounts()[`agents:${project}`] ?? 0);
  const closeSearch = () => { setSearchText(""); setSearchOpen(false); };
  createEffect(() => { if (props.collapsed) closeSearch(); });

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
   * El historial de un grupo.
   *
   * **Es un componente y no una variable con JSX.** Se pinta en dos sitios —la
   * lista expandida y el desplegable—; una variable contendría un solo nodo del
   * DOM y colocarlo dos veces lo movería del primero al segundo.
   */
  const EncabezadoDeTareas = () => (
    <div data-tasks-header class="mx-1 mt-2 mb-0.5 flex h-7 min-w-0 items-center pl-1">
      <span class="min-w-0 flex-1 truncate px-1 text-[0.6875rem] font-medium text-neutral-500 uppercase">{t("shell.sidebar.tasks")}</span>
    </div>
  );

  const Historial = (p: { de: string }) => (
    <Sessions sidebar
      sessions={props.sessions[p.de] ?? []}
      groupByHandler={p.de !== ""}
      groupByAuthor={false}
      search={query()}
      onSearchResults={count => reportResults(`tasks:${p.de}`, count)}
      current={props.current}
      vivas={props.vivas}
      aprobando={props.aprobando}
      destinos={destinos(p.de)}
      de={p.de}
      onPick={(s) => {
        props.onPick(p.de, s);
        setDesplegado(false);
      }}
      onDelete={(s) => props.onDelete(p.de, s)}
      onEtapa={(s, etapa) => props.onEtapa(p.de, s, etapa)}
      onRenombrar={(s, title) => props.onRenombrar(p.de, s, title)}
      onPin={props.onPin ? (s, pinned) => props.onPin?.(p.de, s, pinned) : undefined}
      spaces={props.spaces}
      carpeta={props.projects.find((x) => x.id === p.de)?.name}
      onMoveToSpace={(s, space) => props.onMoveToSpace?.(p.de, s, space)}
      onMove={(s, to) => {
        // El grupo de destino se abre: una tarea que se mueve a un proyecto
        // plegado desaparece de la pantalla, y eso se lee como que se borró.
        setCerrados(cerrados().filter((x) => x !== (to === "" ? SUELTAS : to)));
        props.onMove(p.de, s, to);
      }}
    />
  );

  // Las tareas que todavía no están en ningún proyecto. **Van al final y no
  // arriba**: son las que aún no se han ordenado, no las importantes. Es el
  // reparto de ChatGPT —los proyectos mandan, lo suelto se acumula debajo— y
  // sale de que preguntar no exige haber nombrado el trabajo primero.
  const sueltas = () => props.sessions[""] ?? [];

  /**
   * La carpeta que se está clonando, en el sitio donde va a aparecer.
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

  /** Una carpeta de trabajo en el riel, con sus tareas debajo. */
  const FilaDeCarpeta = (pp: { p: Project }) => {
          const p = () => pp.p;
          const delProyecto = () => props.sessions[p().id] ?? [];
          // Del material del proyecto, no de la app: sale con la misma
          // llamada que ya usa `ProjectView.tsx`, releída al cambiar de carpeta.
          // Se recarga al crear uno: sin esto el riel solo mira el id del
          // proyecto, que no cambia, y quien crea su primer agente no lo ve
          // aparecer y concluye que no se creó.
          const [creados, setCreados] = createSignal(0);
          const alCrear = () => setCreados((n) => n + 1);
          window.addEventListener("harness:encargados", alCrear);
          onCleanup(() => window.removeEventListener("harness:encargados", alCrear));
          const [encargados] = createResource(
            () => `${p().id}:${creados()}`,
            async (clave) => {
              const id = clave.split(":")[0];
              try {
                const listado = (await invoke<HandlerList>("list_encargados", { project: id })).encargados;
                rememberRoster(id, listado);
                return listado;
              } catch {
                return lastRoster(id) ?? [];
              }
            },
          );
          const roster = () => encargados() ?? lastRoster(p().id);
          const abierto = () => !!query() || !cerrados().includes(p().id);
          const plegadas = () => delProyecto().filter((s) => !s.archived);
          /** Si soltar aquí la tarea que va en la mano la movería a este. */
          const recibiendo = () => destinoEnVuelo() === p().id;

          return (
            <div data-folder-row={p().id} classList={{ hidden: !!query() && resultCount(p().id) === 0 }}>
              {/* **La fila es el destino del arrastre**, y por eso el
                  `data-destino` va aquí y no en el botón: soltar sobre el
                  espacio del chevron o del menú cuenta igual. Cómo se resuelve
                  está en `lib/drag.ts`. */}
              <div
                class={cn(
                  "group grid min-w-0 grid-cols-[20px_minmax(0,1fr)_auto_auto] items-center rounded-[var(--radius-sm)]",
                  recibiendo() && RECIBE_LA_TAREA,
                )}
                data-destino={p().id}
              >
                <button
                  class="group/project-icon relative grid size-5 place-items-center rounded-sm text-neutral-500 outline-none hover:bg-surface-muted hover:text-neutral-950 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:pointer-events-none"
                  aria-expanded={abierto()}
                  aria-label={
                    abierto()
                      ? t("shell.sidebar.collapse_group", { name: p().name })
                      : t("shell.sidebar.expand_group", { name: p().name })
                  }
                  onClick={() => alternarGrupo(p().id)}
                >
                  <span class="transition-opacity group-hover:opacity-0 group-focus-visible/project-icon:opacity-0">
                    <WorkdirIcon kind={p().kind} cloud={p().cloud} />
                  </span>
                  <ChevronRight size={14} class={cn("absolute opacity-0 transition-[opacity,transform] group-hover:opacity-100 group-focus-visible/project-icon:opacity-100", abierto() && "rotate-90")} />
                </button>

                {/* **Renombrar pasa dentro de la fila, y antes la
                    sustituía.** El formulario ocupaba el sitio del proyecto
                    entero —sin chevron, sin carpeta y con la caja del átomo,
                    más alta que la fila—, así que al empezar a escribir el
                    nombre se movía de sitio y todo lo de abajo con él. En el
                    historial, ese mismo campo llevaba la fila de 27,55 px a
                    47,50 px. Ahora
                    el campo se pinta en la columna del nombre, con la misma
                    altura, la misma sangría y la misma letra: lo único que
                    cambia es que el texto se puede escribir, y llega
                    seleccionado. Es el mismo arreglo que el renombrado de
                    tareas (`tareas/Sessions.tsx`) porque es el mismo gesto.

                    Y el nombre no lleva `font-mono` ni cuando se lee ni
                    cuando se escribe: era el nombre de una carpeta y ahora es
                    el nombre que alguien le puso a su trabajo. */}
                <Show
                  when={renombrando() === p().id}
                  fallback={
                    <SidebarMenuButton
                      // **La jerarquía estaba al revés, y medida.** El proyecto
                      // —que es el contenedor— iba en el gris de lo secundario y sus
                      // tareas en el color del texto normal: **4,10:1 contra
                      // 20,12:1 en oscuro**, o sea que el contenedor pesaba cinco
                      // veces menos que lo contenido. Y sobre la fila rellena
                      // —hover o abierta— ese gris quedaba en 4,13:1 en claro, por
                      // debajo de AA.
                      //
                      // Ahora comparte la tinta con sus tareas y se separa por peso,
                      // que es el escalón que la escala tipográfica reserva a
                      // los rótulos de interfaz. Lo que dice «esto contiene» es la
                      // carpeta y la sangría de lo que cuelga, no que se lea peor.
                      class="h-8 min-h-8 grid-cols-[minmax(0,1fr)_auto] font-semibold"
                      isActive={props.proyectoAbierto === p().id}
                      // **Sin la barra de acento, y es el segundo sitio que la
                      // pierde** —el primero fue el historial de tareas, por lo
                      // mismo—. A la izquierda del nombre ya hay dos cosas: el
                      // chevron que pliega y la carpeta. Una barra vertical
                      // pegada al borde añade una tercera raya en la misma banda
                      // de 20 px y se lee como decoración, no como estado. Lo que
                      // dice cuál está abierto es el relleno de la fila más la
                      // negrita, con lo que eso cuesta escrito en
                      // `styles/selection.css`.
                      selectionMark={false}
                      onDblClick={() => { setNombre(p().name); setRenombrando(p().id); }}
                      onKeyDown={(e) => { if (e.key === "F2") { e.preventDefault(); setNombre(p().name); setRenombrando(p().id); } }}
                      onClick={() => {
                        props.onAbrirProyecto(p().id);
                        setDesplegado(false);
                      }}
                    >
                      <span class="flex min-w-0 items-baseline gap-1.5">
                        <span class="truncate">{p().name}</span>
                      </span>
                      <Show when={!abierto()}>
                        <EstadoDeTarea
                          ambito="plegadas"
                          aprobando={plegadas().some((s) => props.aprobando.includes(s.id))}
                          viva={plegadas().some((s) => props.vivas.includes(s.id))}
                          esperando={plegadas().some((s) => s.esperando)}
                          outcome={plegadas().some((s) => s.sin_ver && s.outcome === "failed") ? "failed" : null}
                          sinVer={plegadas().some((s) => s.sin_ver)}
                        />
                      </Show>
                    </SidebarMenuButton>
                  }
                >
                  <form
                    class="grid h-8 min-w-0 grid-cols-[minmax(0,1fr)] items-center gap-0.5 rounded-[var(--radius-sm)] bg-neutral-200 px-2 font-semibold"
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
                      // Sin caja y con `font-sans`: el nombre conserva la misma
                      // tipografía al pasar de lectura a edición.
                      class="block h-auto min-h-0 rounded-none border-0 p-0 font-sans text-[0.8125rem] leading-[1.25] text-inherit [font-weight:inherit]"
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

                {/* **Borrar dejó de estar a un clic.** Era un bote de basura
                    suelto en la fila: el gesto irreversible del sidebar era el
                    más fácil de pulsar sin querer. Ahora vive dentro del menú,
                    con su nombre escrito, y la confirmación se pinta en este
                    mismo panel. */}
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
                  {/* **Un solo `PopoverContent` con dos vistas dentro**, y no
                      uno por vista: el panel es el mismo objeto flotante, y
                      cambiarlo por otro lo desmonta y lo vuelve a montar —
                      parpadea y se reposiciona a mitad de una decisión que es
                      irreversible. */}
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

                {/* Va después del menú: delante movería de sitio el control que ya
                    estaba. El nombre va en `aria-label` y `title` — la fila no
                    tiene ancho para un rótulo. */}
                <button
                  class="mr-1 grid size-6 shrink-0 place-items-center rounded-sm text-neutral-500 opacity-0 outline-none hover:bg-surface-muted hover:text-neutral-950 focus-visible:opacity-100 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary group-hover:opacity-100 group-focus-within:opacity-100"
                  aria-label={t("shell.sidebar.new_task_in", { name: p().name })}
                  title={t("shell.sidebar.new_task_in", { name: p().name })}
                  onClick={(e) => {
                    // La fila entera abre el proyecto; esto es otra cosa.
                    e.stopPropagation();
                    props.onNuevaTareaEn(p().id);
                  }}
                >
                  <SquarePen size={15} />
                </button>
              </div>
              <Show when={abierto()}>
                <div data-project-sessions={p().id} class="my-0.5 ml-2 min-w-0 border-l border-border pl-1.5">
                  <div data-sidebar-agents classList={{ hidden: !!query() && !searchCounts()[`agents:${p().id}`] }}>
                    <button
                      type="button"
                      class="flex w-full min-w-0 items-center gap-1 rounded-sm px-2 pt-2 pb-1 text-left text-[0.6875rem] font-medium text-neutral-500 uppercase outline-none hover:text-neutral-950 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                      aria-expanded={(!!query() || !agentesPlegados().includes(p().id))}
                      onClick={() => alternarAgentes(p().id)}
                    >
                      <span class="min-w-0 truncate">{t("shell.sidebar.agents")}</span>
                      <ChevronRight size={12} aria-hidden="true" class={cn("shrink-0 transition-transform", (!!query() || !agentesPlegados().includes(p().id)) && "rotate-90")} />
                    </button>
                    <Show when={(!!query() || !agentesPlegados().includes(p().id))}>
                      <AgentRows project={p().id} onNewAgent={() => setCreatingAgentIn({ id: p().id, name: p().name })}
                        encargados={roster() ?? []} search={query()} onSearchResults={count => reportResults(`agents:${p().id}`, count)} hablando={props.hablandoCon?.project === p().id ? props.hablandoCon.name : null} onHablar={props.onHablarCon} onProfile={props.onAgentProfile} />
                    </Show>
                  </div>
                  <div data-sidebar-tasks classList={{ hidden: !!query() && !searchCounts()[`tasks:${p().id}`] }}>
                    <EncabezadoDeTareas />
                    <Show when={delProyecto().length > 0} fallback={<Button variant="ghost" size="compact" class="w-full justify-start text-neutral-500" onClick={() => props.onNuevaTareaEn(p().id)}><Plus size={14} />{t("shell.sidebar.new_task")}</Button>}>
                      <Historial de={p().id} />
                    </Show>
                  </div>
                </div>
              </Show>
            </div>
          );

  };

  /** La misma lista, montada en dos sitios: expandida y en el desplegable. */
  const Lista = () => (
    <div class="grid min-w-0 gap-1">
      <div class="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center pr-1">
        <span class="min-w-0 truncate px-2 text-[0.6875rem] font-medium text-neutral-500">
          {t("shell.sidebar.projects")}
        </span>
        <button
          class="grid size-5 shrink-0 place-items-center rounded-sm text-neutral-500 hover:bg-surface-muted hover:text-neutral-950"
          aria-label={t("shell.sidebar.add_workdir")}
          title={t("shell.sidebar.add_workdir")}
          onClick={props.onAnadirCarpeta}
        >
          <FolderPlus size={14} />
        </button>
      </div>

      <Show when={props.clon}>{(c) => <FilaDeClon clon={c()} />}</Show>

      <Show when={props.projects.length === 0}>
        <Show when={props.escritorio}>
          <p class="m-0 px-2 pt-1 text-xs text-neutral-500" data-desk-empty="">
            {t("spaces.rail.empty", { name: props.escritorio ?? "" })}
          </p>
        </Show>
        <Button variant="ghost" size="compact" class="w-full justify-start text-neutral-500" onClick={props.onAnadirCarpeta}><Plus size={14} />{t("shell.sidebar.new_folder")}</Button>
      </Show>

      <KeyedList each={props.projects} by={p => p.id}>
        {p => <FilaDeCarpeta p={p()} />}
      </KeyedList>

      {/* **Se ve además mientras se arrastra una tarea que está en un
          proyecto**, aunque el grupo esté vacío: si no, sacarla de su proyecto
          no tendría dónde soltarse y el gesto solo funcionaría cuando ya hubiera
          tareas sueltas. */}
      <Show
        when={
          sueltas().length > 0 ||
          (tareaEnVuelo() !== null && tareaEnVuelo()?.de !== "")
        }
      >
        <div data-sidebar-tasks classList={{ hidden: !!query() && resultCount("") === 0 }}>
          <div
            class={cn("grid min-w-0 grid-cols-[20px_minmax(0,1fr)] items-center rounded-[var(--radius-sm)]",
              destinoEnVuelo() === "" && RECIBE_LA_TAREA,
            )}
            data-destino=""
          >
            <SidebarMenuButton
              class="col-span-2 grid-cols-[20px_22px_minmax(0,1fr)] pl-0 font-medium"
              aria-expanded={(!!query() || !cerrados().includes(SUELTAS))}
              onClick={() => alternarGrupo(SUELTAS)}
            >
              <ChevronRight size={14} aria-hidden="true" class={cn("transition-transform text-neutral-500", (!!query() || !cerrados().includes(SUELTAS)) && "rotate-90")} />
              <Clock size={14} />
              <span class="truncate">{t("shell.sidebar.recent")}</span>
            </SidebarMenuButton>
          </div>
          <Show when={(!!query() || !cerrados().includes(SUELTAS))}>
            <div class="min-w-0 pl-2">
              <Historial de="" />
            </div>
          </Show>
        </div>
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
                  tooltip={t("shell.sidebar.projects")}
                  aria-label={t("shell.sidebar.projects")}
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
                ejes: el contenido dejaba de recortarse en horizontal y pasaba a
                poder desplazarse, así que los títulos llegaban al borde sin
                puntos suspensivos y el «+» de proyectos quedaba a la derecha del
                scroll — presente y fuera de la vista.

                `SidebarContent` de `ui/sidebar.tsx` ya trae
                `overflow-hidden min-w-0`, que es lo correcto; esto lo reabría.
                La librería estaba bien: el envoltorio no. */}
            {/* `data-arrastre-scroll`: con la lista larga, arrastrar una tarea
                hasta un proyecto que está fuera de la vista exige que el panel
                se desplace solo al llegar a sus bordes (`lib/drag.ts`). */}
            <div
              ref={listViewport}
              class="-mr-2 min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto pr-2"
              data-arrastre-scroll=""
            >
              <Show when={query() && !["", ...props.projects.map(project => project.id)].some(project => resultCount(project) > 0)}>
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
          proyecto de debajo se enciende, pero nada dice QUÉ se está moviendo:
          con dos tareas de título parecido, soltar en el sitio correcto la
          equivocada no se nota hasta que la lista se recompone.

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
