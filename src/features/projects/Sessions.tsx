import { invoke } from "../../lib/invoke.ts";
import ChevronRight from "lucide-solid/icons/chevron-right";
import MoreVertical from "lucide-solid/icons/more-vertical";
import Pin from "lucide-solid/icons/pin";
import PinOff from "lucide-solid/icons/pin-off";
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js";
import { arrastrar, fueArrastre, tareaEnVuelo } from "../../lib/drag";
import { enfocarYSeleccionar } from "../../lib/focus";
import { t } from "../../lib/i18n";
import { createPref } from "../../lib/prefs";
import { SESSION_TITLE_MAX_LENGTH } from "../../lib/projectNames";
import { cn } from "../../lib/utils";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogTitle } from "../../ui/Dialog";
import { asFailure, type Failure, FailureNote } from "../../ui/Failure";
import { celebrateFinishedTask, FinishTaskButton } from "../../ui/FinishTaskButton";
import { KeyedList } from "../../ui/KeyedList";
import { Input } from "../../ui/Input";
import { Toast, ToastPortal } from "../../ui/Toast";
import { MarcaAgente, WorktreeRoto } from "../../ui/icons";
import {
  ITEM_DE_MENU,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../ui/Popover";
import { WithMentions } from "../chat/WithMentions";
import SessionGit from "./SessionGit";
import { createTaskHistories } from "./taskHistories";
import { AstroAvatar } from "./AstroAvatar";
import { displayName, watchProfiles } from "./profiles";
import EtapaDeTarea, { ETAPAS, type Etapa } from "./TaskStage";
import EstadoDeTarea from "./TaskStatus";
import { matchesTaskQuery } from "./taskSearch";
import { canFinishTask, effectiveTaskGit, type GitStatus, sharesTaskGit, watchSessionGit } from "./taskGit";
import { authorKey, authorKeys } from "./taskAuthors";
import { descendientes, type Rama as RamaDeTareas, taskTree } from "./taskTree";
import type { TaskActivity } from "./taskActivity";

export function readableSessionTitle(title: string): string {
  if (!title.startsWith("/root/")) return title;
  return title.split("/").filter(Boolean).at(-1)?.replaceAll("_", " ") || title;
}

/** Lo que devuelve `task_blockers`: qué estorba para terminar o archivar. */
type Blockers = {
  unsaved: { session: string; title: string; files: string[] }[];
  not_finished: boolean;
};

/** El gesto que quedó esperando a que la persona decida qué hacer con eso. */
type Aviso = { id: string; finish: boolean; rect?: DOMRect; blockers: Blockers };

/** El título de un tema; el de la Bandeja sale del catálogo, no de `session.json`. */
/** El nombre del agente en la pastilla de la fila: diez caracteres como mucho,
 *  para que el mensaje de al lado conserve su sitio. Completo en el `title`. */
const AGENT_NAME_MAX = 10;
export function shortAgentName(nombre: string): string {
  const letras = [...nombre];
  return letras.length > AGENT_NAME_MAX ? `${letras.slice(0, AGENT_NAME_MAX - 1).join("")}…` : nombre;
}

export function threadTitle(row: Pick<SessionRow, "inbox" | "title"> | undefined): string {
  return row?.inbox ? t("projects.threads.inbox") : (row?.title ?? "");
}

export type SessionRow = {
  folder?: string;
  workspace?: string;
  delegated_activity?: TaskActivity;
  agent_thread?: boolean;
  /** Si la sesión nativa ya tiene trabajo: lo decide Rust (`Session::native_work`). */
  native_work?: boolean;
  /** Bandeja antigua del encargado (`Session::inbox`), visible si existe. */
  inbox?: boolean;
  /** El backend decide el pin; las conversaciones antiguas heredan el valor por omisión. */
  pinned?: boolean | null;
  launched_by?: string | null;
  launcher_available?: boolean;
  has_delegates?: boolean;
  launcher_name?: string | null;
  archived?: boolean | null;
  result_revision?: string | null;
  outcome?: "delivered" | "failed" | null;
  id: string;
  title: string;
  agent: string;
  /** Con qué modelo corrió. `null` es "el que el agente traiga por omisión". */
  model: string | null;
  last_message?: string | null;
  /**
   * A qué entidades del proyecto apunta la tarea, acumulado turno a turno por
   * el backend. **No se deriva del título**: una fuente mencionada en el turno
   * cinco no está ahí, y es justo lo que hace que se pueda buscar y auditar
   * por referencia en vez de por coincidencia de texto.
   */
  refs: string[];
  /** Cuándo nació. **Es el orden de la lista** (`sessions::list_live_sessions`). */
  created_at: number;
  /** Cuándo se movió por última vez. No es el orden: ver `created_at`. */
  updated_at: number;
  turns: number;
  /** Borrar al padre conserva a la hija: el historial la muestra en la raíz. */
  parent: string | null;
  /**
   * La llamada del CLI del padre que la abrió, si nació como subagente suyo
   * (`agents::Delegation::Native`). No se le puede escribir: el CLI no
   * reanuda un subagente, y la caja se esconde con esto.
   */
  subagent: string | null;
  /** El agente preguntó algo en esta sesión y nadie ha contestado. */
  esperando: boolean;
  /** Lo pone la ventana desde `workspace/attention.rs`: `list_live_sessions` no lo trae. */
  sin_ver?: boolean;
  /**
   * En qué etapa la puso una persona, o `null` si nadie la marcó. Ver
   * `TaskStage.tsx`.
   */
  stage: Etapa | null;
  /** Con qué criterio corre esta tarea (`workspace/handlers.rs`). */
  encargado: string | null;
  /**
   * El encargado del padre, cuando esta tarea es una hija de orquestación.
   * Derivado, solo para pintar quién la lanzó: NO es el criterio de esta
   * tarea, que no hereda el encargado del padre.
   */
  encargado_del_padre: string | null;
  /**
   * Si esta sesión es el chat persistente de un encargado. El historial la
   * muestra junto a sus tareas en la carpeta; una tarea con `encargado` no lleva esto.
   */
  chat_de_agente: boolean;
  /** De qué espacio es (`spaces::of_rows`). Ver `lib/spaces.ts`. */
  space?: string | null;
};

type EstadoDelWorktree = { available: boolean; owned: boolean };

/**
 * Qué tareas padre están desplegadas, por id. Una rama nace plegada: las
 * subtareas se levantan solas mientras el turno corre, y desplegadas empujan
 * hacia abajo el resto del historial sin que nadie lo haya pedido. La fila de
 * resumen dice cuántas hay y es la que las abre.
 *
 * **Vive en el módulo y no dentro del componente**, al revés que los proyectos
 * plegados del riel. El motivo es que esta lista se monta varias veces a la vez
 * —una por proyecto en el riel, más la del proyecto abierto en el panel
 * principal— y las mismas tareas salen en dos de ellas. Con una señal por
 * instancia, plegar una tarea en el riel la dejaría desplegada en la vista del
 * proyecto hasta el siguiente arranque: dos listas de lo mismo diciendo cosas
 * distintas de la misma tarea. `chasis/Sidebar.tsx` no tiene ese problema
 * porque su lista de proyectos se pinta en un solo sitio.
 *
 * Se recuerda entre arranques: lo que alguien desplegó es lo que sí quiere ver,
 * y volver a abrirlo en cada arranque es trabajo que nadie pidió.
 */
const [desplegadas, setDesplegadas] = createPref<string[]>(
  "historial.subtareas.abiertas",
  [],
);

const alternarDesplegada = (id: string) =>
  setDesplegadas(
    desplegadas().includes(id)
      ? desplegadas().filter((x) => x !== id)
      : [...desplegadas(), id],
  );

/**
 * El historial del proyecto. `Nueva tarea` es una acción del sidebar, arriba de
 * la lista, y sobrevive al riel cuando la lista no.
 *
 * **En pantalla es «tarea» y en el código es `Session`**: quien usa la app pide
 * una tarea, y «sesión» nombra el mecanismo con que se cumple —un proceso de
 * agente que arranca, contesta y se reanuda—. Ver `workspace/sessions.rs`.
 *
 * **Las hijas van anidadas bajo su padre y no se mueven de proyecto.** Una tarea
 * hija es un encargo despachado por su padre (`workspace/orchestration.rs`) y la anidación
 * ES esa relación: moverla sola dejaría al padre apuntando a un id que ya no
 * está en su proyecto. Borrarse sí puede — un encargo fallido se limpia aquí.
 *
 * **Plegado dice qué esconde.** El chevron es el mismo control con que se pliega
 * un proyecto en el riel (`chasis/Sidebar.tsx`), y el hueco se reserva también
 * en las filas sin hijas para que los títulos no se desalineen. Una subtarea no
 * es una carpeta —puede estar parada esperando a una persona—, así que plegada
 * la fila lleva dos datos y ninguna glosa:
 *
 * - **Cuántas esconde**, en número. El plural lo declara el catálogo, nunca un
 *   ternario en el JSX, y el número se escribe con el locale del manifiesto
 *   (`lib/format.ts`): un `Intl` de nivel de módulo lo escribiría a la española
 *   bajo una interfaz en maya, sin dar error.
 * - **Si algo de dentro espera a alguien**, con el punto de `EstadoDeTarea` y su
 *   orden de urgencia: `aprobando` —la única que no avanza sin ti—, `vivas` y
 *   `esperando` (`sessions::sin_contestar`, el agente preguntó y nadie
 *   contestó).
 *
 * **El punto del padre no se toca al plegar**, y revertirlo no enseña el daño:
 * mezclarle el estado de sus hijas haría que la fila y su pestaña dijeran cosas
 * distintas de la misma tarea, y el orden de urgencia se tragaría la pregunta
 * sin contestar de una hija bajo un padre trabajando. Son dos puntos en dos
 * sitios: el de la tarea junto al título y el de lo plegado junto al número.
 *
 * **Renombrar no mueve nada** — la identidad es el id, que es la carpeta
 * (`sessions::rename_session`). Hay dos gestos porque ninguno basta solo: doble
 * clic en la fila, que no se encuentra sin probarlo y no se da con el teclado, y
 * «Cambiarle el nombre» en el menú, la única puerta para quien no usa ratón. El
 * campo sale en el sitio del título y relleno con el nombre de ahora: lo que se
 * corrige es lo que se lee en esa fila. **Salir del campo guarda; `Escape`
 * descarta** — un `onBlur` que cancela borra lo tecleado al ir a pulsar
 * cualquier otra cosa, sin decir nada.
 *
 * **Las acciones de la fila son un menú.** Dos íconos sueltos hacen que la fila
 * se lea como una barra de herramientas, y la cruz —el gesto irreversible— es la
 * más fácil de pulsar sin querer. Ningún disparador lleva `onClick` encima: la
 * prop propia pisaría el que `PopoverTrigger` pasa dentro de `p` y el panel no
 * abriría —Kobalte no compone manejadores, gana el último—, así que **quien no
 * deja pasar el clic a la fila es la fila**, que ignora lo que venga de su
 * columna de acciones. Lo comprueba `scripts/triggers.test.mjs`.
 */
export default function Sessions(props: {
  sessions: SessionRow[];
  relatedSessions?: SessionRow[];
  sidebar?: boolean;
  includeArchived?: boolean;
  flat?: boolean;
  readOnly?: boolean;
  groupByAuthor?: boolean;
  groupByHandler?: boolean;
  search?: string;
  onSearchResults?: (count: number) => void;
  current: string | null;
  /**
   * Qué tareas están contestando ahora mismo.
   *
   * **Con una sola tarea a la vez esto no hacía falta**: lo que trabajaba era lo
   * que tenías delante. Desde que se puede lanzar otra sin esperar a la
   * anterior, el historial es el único sitio donde se ve que algo sigue
   * corriendo en una tarea que no estás mirando.
   */
  vivas: string[];
  /**
   * Las tareas paradas esperando que apruebes una acción.
   *
   * **Es el único estado que no avanza sin ti**, así que manda sobre los otros
   * dos: una que trabaja no necesita nada, y una que preguntó puede seguir
   * esperando. Antes esto no se veía en ningún sitio y por eso la hoja de aprobar
   * se pintaba encima de cualquier conversación: era la única forma de no
   * perderla.
   */
  aprobando: string[];
  /**
   * A qué proyectos se puede mover una tarea de esta lista.
   *
   * **Se pasa ya resuelto y no se calcula aquí**: quien monta la lista es el
   * único que sabe de qué grupo es, y una lista que se ofreciera a sí misma
   * como destino sería un movimiento que no mueve nada.
   */
  destinos: { id: string; name: string }[];
  /**
   * De qué grupo es esta lista: el id del proyecto, o `""` para las tareas que
   * no están en ninguno —así nombra el backend a «sin proyecto»
   * (`sessions::move_session`)—.
   *
   * Se necesita entero y no como un booleano: el arrastre tiene que saber cuál
   * de los proyectos de la pantalla es el suyo para no encenderlo como destino.
   */
  de: string;
  onPick: (id: string) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, to: string) => void;
  /**
   * Marcar la etapa de una tarea, o quitársela con `null`.
   *
   * **Una hija también se marca.** No se puede mover ni sacar del proyecto
   * —eso rompería el árbol del encargo— pero en qué etapa está el trabajo de
   * una subtarea es exactamente la clase de cosa que hay que poder decir: es
   * la que se queda parada esperando a alguien.
   */
  onEtapa: (id: string, etapa: Etapa | null) => void;
  /**
   * Cambiarle el nombre a una tarea.
   *
   * **Una hija también se renombra**, por lo mismo que se le marca la etapa: su
   * título lo escribió el encargo que la despachó y corregirlo no la saca de su
   * árbol. Lo que no se le ofrece es mover, que sí lo rompería.
   */
  onRenombrar: (id: string, title: string) => void;
  /** Se conecta cuando el backend ofrece la guarda persistente. */
  onPin?: (id: string, pinned: boolean) => void | Promise<void>;
  /** Los espacios a los que puede irse una tarea raíz. Con una sola no se ofrece. */
  spaces?: { id: string; name: string }[];
  /** El nombre de la carpeta, que no cambia al moverla de espacio. */
  carpeta?: string;
  onMoveToSpace?: (id: string, space: string) => void;
}) {
  const otherSpaces = (row: SessionRow) =>
    row.chat_de_agente || row.agent_thread || row.inbox
      ? []
      : (props.spaces ?? []).filter((i) => i.id !== row.space);
  const [finishing, setFinishing] = createSignal<string[]>([]);
  const [archiving, setArchiving] = createSignal<string[]>([]);
  const [actionFailure, setActionFailure] = createSignal<Failure | null>(null);
  const [aviso, setAviso] = createSignal<Aviso | null>(null);
  const finishTask = async (id: string, rect: DOMRect) => {
    if (finishing().includes(id)) return;
    setFinishing(ids => [...ids, id]);
    setActionFailure(null);
    try {
      await invoke("finish_task", { project: props.de, id });
      // `anunciar` no actualiza esta ventana: su firma es la de quien
      // escribió, y el sondeo la descarta. Sin este aviso el archivado
      // queda en disco y la lista de aquí sigue mostrando la fila.
      window.dispatchEvent(new CustomEvent("harness:tasks-changed", { detail: { project: props.de } }));
      celebrateFinishedTask(rect);
    } catch (error) {
      setActionFailure(asFailure(error));
    } finally {
      setFinishing(ids => ids.filter(value => value !== id));
    }
  };
  const archiveTask = async (id: string) => {
    if (archiving().includes(id)) return;
    setArchiving(ids => [...ids, id]);
    setActionFailure(null);
    try {
      await invoke("set_task_archived", { project: props.de, id, archived: true });
      window.dispatchEvent(new CustomEvent("harness:tasks-changed", { detail: { project: props.de } }));
      setMenu(null);
    } catch (error) {
      setActionFailure(asFailure(error));
    } finally {
      setArchiving(ids => ids.filter(value => value !== id));
    }
  };
  // `finish_task` y `set_task_archived` matan los turnos y toman los candados
  // de la familia antes de mirar el árbol: sin esta pregunta previa la espera
  // es real y el error llega al final, sin salida.
  const intentar = async (id: string, finish: boolean, rect?: DOMRect) => {
    const marcar = finish ? setFinishing : setArchiving;
    if ((finish ? finishing() : archiving()).includes(id)) return;
    marcar(ids => [...ids, id]);
    setActionFailure(null);
    let blockers: Blockers;
    try {
      blockers = await invoke<Blockers>("task_blockers", { project: props.de, id, finish });
    } catch (error) {
      setActionFailure(asFailure(error));
      return;
    } finally {
      marcar(ids => ids.filter(value => value !== id));
    }
    if (blockers.unsaved.length === 0 && !blockers.not_finished) {
      await (finish && rect ? finishTask(id, rect) : archiveTask(id));
      return;
    }
    setAviso({ id, finish, rect, blockers });
  };
  const descartarYSeguir = async () => {
    const a = aviso();
    if (!a) return;
    setAviso(null);
    const marcar = a.finish ? setFinishing : setArchiving;
    marcar(ids => [...ids, a.id]);
    try {
      for (const work of a.blockers.unsaved) {
        await invoke("discard_task_changes", { project: props.de, id: work.session, files: work.files });
      }
    } catch (error) {
      setActionFailure(asFailure(error));
      return;
    } finally {
      marcar(ids => ids.filter(value => value !== a.id));
    }
    // Se vuelve a mirar: lo que apareció mientras el aviso estaba abierto se
    // queda en disco, y tiene que verse en el aviso y no en un error plegado.
    await intentar(a.id, a.finish, a.rect);
  };
  const [gitRows, setGitRows] = createSignal<Record<string, GitStatus>>({});
  // La barra enseña solo lo vivo: las archivadas no se pintan ni se observan. Con
  // cientos archivadas, pedir su git y su historial en cada barrido trababa la ventana.
  const enBarra = createMemo(() => props.sessions.filter(s => (props.includeArchived || !s.archived)
    && (!props.sidebar || !!props.search?.trim() || s.pinned || !(s.parent || s.launched_by) || !(s.launcher_available ?? props.sessions.some(root => root.id === (s.parent ?? s.launched_by))))));
  const [worktrees] = createTaskHistories<EstadoDelWorktree>(() => props.de, enBarra);
  createEffect(() => {
    const watcher = watchSessionGit(props.de);
    createEffect(() => setGitRows(watcher.rows()));
    const gitInput = createMemo(() => JSON.stringify([
      enBarra().map(s => [s.id, s.updated_at]), props.vivas, props.current,
    ]));
    createEffect(on(gitInput, () => {
      watcher.prioritize([...(props.current ? [props.current] : []), ...props.vivas, ...enBarra().map(s => s.id)]);
      watcher.refresh();
    }));
    onCleanup(watcher.release);
  });
  // Borrar se lleva la carpeta de trabajo entera, y esos documentos no están
  // commiteados en ningún lado: no tienen de dónde volver. Por eso la
  // confirmación vive en la propia fila, con lo que se pierde escrito.
  const [confirmando, setConfirmando] = createSignal<string | null>(null);
  // El menú va por portal: escapa del recorte deliberado del sidebar, y con
  // veinte proyectos la lista de destinos no desplaza lo que hay debajo.
  const [menu, setMenu] = createSignal<string | null>(null);
  // Qué tarea se está renombrando, y con qué borrador. **El campo sustituye al
  // título en su propia fila** en vez de abrir un diálogo: lo que se está
  // corrigiendo es lo que se lee ahí, y sacarlo a una hoja aparte lo separa de
  // las filas de al lado, que son con las que uno lo distingue.
  const [renombrando, setRenombrando] = createSignal<string | null>(null);
  const [borrador, setBorrador] = createSignal("");

  const empezarARenombrar = (s: SessionRow) => {
    setMenu(null);
    setConfirmando(null);
    setBorrador(s.title);
    setRenombrando(s.id);
  };

  /**
   * El árbol: las raíces en el orden que ya traen —las más nuevas primero, por
   * cuándo nacieron— y las hijas de cada una anidadas debajo.
   *
   * **El orden lo fija `sessions::list_live_sessions` y aquí no se toca.** Iba por
   * última actividad, y eso hacía que una tarea saltara de sitio cada vez que
   * su agente escribía un delta —la suya o la de cualquier otra que estuviera
   * contestando—: la lista se barajaba bajo el puntero. Qué está pasando ahora
   * lo dice `EstadoDeTarea`, que no mueve ninguna fila.
   *
   * Activas y archivadas se arman cada una por el `archived` de la fila, no
   * por el de su raíz: finalizar una hija no espera al padre.
   */
  const profiles = watchProfiles(props.de);
  const query = createMemo(() => (props.search ?? "").trim());
  const filteredSessions = createMemo(() => !query() ? enBarra() : enBarra().filter(session => {
    const git = effectiveTaskGit(session, gitRows(), props.relatedSessions ?? props.sessions);
    const agente = session.encargado ? displayName(session.encargado, profiles()[session.encargado]) : null;
    return matchesTaskQuery([session.title, session.last_message, git?.branch, git?.alias, agente], query());
  }));
  if (props.onSearchResults) {
    createEffect(() => props.onSearchResults?.(filteredSessions().length));
    onCleanup(() => props.onSearchResults?.(0));
  }
  const activas = createMemo<RamaDeTareas<SessionRow>[]>((previas) => props.flat || props.sidebar
    ? filteredSessions().map(tarea => ({ tarea, hijas: [] }))
    : taskTree(filteredSessions(), props.includeArchived ? null : false, previas, props.groupByHandler === true));
  const fijada = (row: SessionRow) => row.pinned ?? (row.chat_de_agente || row.inbox === true);
  const setPinned = async (row: SessionRow) => {
    if (!props.onPin) return;
    setMenu(null);
    setActionFailure(null);
    try {
      await props.onPin(row.id, !fijada(row));
      window.dispatchEvent(new CustomEvent("harness:tasks-changed", { detail: { project: props.de } }));
    } catch (error) {
      setActionFailure(asFailure(error));
    }
  };

  /**
   * Una fila del historial, y **nada más que la fila**.
   *
   * No conoce a sus hijas: el expansor es la fila de resumen que dibuja el
   * árbol, así que aquí no hace falta saber si esta tarea tiene encargos — y una
   * fila que no las conoce no puede volver a reservarles sitio.
   */
  const Fila = (f: { s: SessionRow; hija?: boolean }) => {
    const activity = (): TaskActivity => f.s.delegated_activity ?? {
      aprobando: props.aprobando.includes(f.s.id),
      viva: props.vivas.includes(f.s.id),
      esperando: f.s.esperando,
      outcome: f.s.outcome,
      sinVer: f.s.sin_ver,
    };
    // Agrupando por agente la cabecera ya lo dice; en el chat del agente, también.
    const conPastilla = () => !(props.groupByHandler && props.groupByAuthor !== false) && !f.s.chat_de_agente && !!f.s.encargado;
    const title = () => f.s.inbox ? t("projects.threads.inbox")
      : f.s.chat_de_agente && !f.s.agent_thread ? t("projects.threads.persistent_chat")
      : f.s.title;
    /**
     * Cierra el renombrado guardando lo escrito.
     *
     * **Salir del campo guarda, no cancela.** Un campo en línea sin botón de
     * guardar cuyo `onBlur` descarta borra lo tecleado al ir a pulsar cualquier
     * otra cosa, sin decir nada. Descartar tiene su gesto, y es `Escape`.
     *
     * Un nombre en blanco no borra el que había: el vacío no es un nombre, y
     * Rust lo rechaza igual (`sessions::titulo_de_tarea`).
     */
    const guardarNombre = () => {
      if (renombrando() !== f.s.id) return;
      const n = borrador().trim();
      setRenombrando(null);
      if (n && n !== f.s.title) props.onRenombrar(f.s.id, n);
    };

    /** El cohete es el único de los dos controles que ocupa sitio en la fila. */
    const puedeFinalizar = () =>
      !props.readOnly && !fijada(f.s) && canFinishTask(
        f.s,
        effectiveTaskGit(f.s, gitRows(), props.relatedSessions ?? props.sessions),
        props.vivas.includes(f.s.id) || props.aprobando.includes(f.s.id),
      );

    return (
      <>
        {/* `aria-current` además de la clase, y no es adorno: la fila
          abierta se marcaba solo con fondo y negrita, así que un
          lector de pantalla recorría veinte tareas sin saber cuál
          está abierta.

          **Sin `marca-seleccion`:** en una lista sangrada bajo su
          proyecto, la barra de acento morada compite con la propia
          sangría. El borde en `neutral-500` es lo que cumple los 3:1 que
          pide WCAG 2.2 § 1.4.11 —4,13:1 en claro y 4,53:1 en oscuro—; el
          fondo y la negrita solos no llegaban. */}
        <div
          data-sesion={f.s.id}
          data-pinned={fijada(f.s) ? "true" : undefined}
          data-legacy={f.s.chat_de_agente ? "true" : undefined}
          class={cn(
            "group/session relative grid min-w-0 cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-0.5 rounded-sm border border-transparent py-1 pr-1 pl-2 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-primary",
            f.s.id === props.current &&
              "border-neutral-500 bg-neutral-200 font-semibold text-neutral-950 shadow-sm",
            renombrando() === f.s.id && "bg-neutral-200 hover:bg-neutral-200",
            // Con el menú abierto el puntero puede irse de la fila, y el velo
            // del menú se vería recortado sobre otro fondo.
            menu() === f.s.id && "bg-neutral-100",
            tareaEnVuelo()?.id === f.s.id &&
              "border-border bg-transparent opacity-40 [border-style:dashed]",
          )}
          aria-current={f.s.id === props.current ? "true" : undefined}
          role="link"
          tabIndex={0}
          onKeyDown={event => {
            if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
            event.preventDefault();
            props.onPick(f.s.id);
          }}
          // **Renombrando, la fila se rellena.** El campo perdió su borde y su
          // anillo para no cambiar de tamaño (ver el `Input` de abajo), así que
          // el estado se marca donde no cuesta píxeles: en el fondo de la fila,
          // que ya es la superficie con la que esta lista dice «esto es lo que
          // estás mirando». Con el caret y el nombre seleccionado dentro, es la
          // misma señal que da renombrar en el Finder.
          data-renombrando={renombrando() === f.s.id ? "true" : undefined}
          // **La fila que va en la mano se atenúa, y eso es lo que hace
          //  visible el gesto.** El chip que sigue al puntero solo dice
          //  QUÉ se lleva; sin que el origen reaccione, la lista se ve
          //  intacta y el arrastre parece no mover nada. Es la
          //  retroalimentación que da por hecha cualquier arrastre del
          //  sistema: lo que se levanta deja su hueco marcado.
          data-en-vuelo={tareaEnVuelo()?.id === f.s.id ? "true" : undefined}
          // Arrastrar la fila hasta un proyecto la mueve. El umbral y
          // por qué no es el arrastre de HTML5 están en `lib/drag.ts`.
          // Una hija no se arrastra: ver la cabecera del módulo.
          onPointerDown={(e) => {
            if (props.readOnly || f.hija || f.s.parent || f.s.chat_de_agente) return;
            const en = e.target as HTMLElement;
            if (en.closest("[data-session-actions]")) return;
            // Tampoco desde la confirmación de borrado: ahí lo que hay
            // que poder hacer es pulsar uno de los dos botones.
            if (en.closest("[data-session-confirm]")) return;
            // Ni desde el campo de renombrar: ahí el gesto de arrastrar es
            // seleccionar texto, y sin esta línea seleccionar media palabra
            // levantaría la tarea y la movería de proyecto al soltar.
            if (en.closest("[data-session-rename]")) return;
            arrastrar(e, { id: f.s.id, de: props.de, titulo: f.s.title }, (a) =>
              props.onMove(f.s.id, a),
            );
          }}
          onClick={(e) => {
            // El menú vive en un portal: Solid deja subir su clic por esta
            // fila aunque el botón no esté dentro de ella.
            if (!e.currentTarget.contains(e.target as Node)) return;
            // Lo de la columna de acciones no abre la tarea, y esto es
            // lo único que lo impide: el disparador del menú NO puede
            // llevar un `onClick` propio sin matar el que lo abre.
            if ((e.target as HTMLElement).closest("[data-session-actions]")) return;
            if ((e.target as HTMLElement).closest("[data-session-rename]")) return;
            // Soltar después de arrastrar dispara un `click` igual.
            if (fueArrastre()) return;
            props.onPick(f.s.id);
          }}
          // **Doble clic sobre la fila renombra**, que es el gesto con el que se
          // renombra cualquier cosa de una lista. Es un atajo del que ya está en
          // el menú y no la única puerta: un gesto sin rótulo no lo encuentra
          // quien no lo busca, y con el teclado no se da.
          //
          // El primero de los dos clics abre la tarea, y eso se queda: es lo que
          // hace la fila, y renombrar la que tienes delante es justo el caso.
          onDblClick={(e) => {
            if (props.readOnly || f.s.chat_de_agente) return;
            const en = e.target as HTMLElement;
            if (en.closest("[data-session-actions]")) return;
            if (en.closest("[data-session-confirm]")) return;
            if (en.closest("[data-session-rename]")) return;
            empezarARenombrar(f.s);
          }}
        >
          {/* Solo el título, como el historial de Claude. La fecha y el
            agente son metadatos: para elegir una conversación de una
            lista corta se usa de qué iba, no cuándo fue.

            El punto es la excepción, y no es metadato: una sesión
            detenida esperando a una persona se ve igual que una
            terminada, y con varias abiertas la que espera es justo la
            que nadie vuelve a abrir. Purple fijo —no `primary`— porque
            es la señal de «esto espera por ti» del sistema visual, y un
            indicador que cambia de color con el tema deja de
            reconocerse.

            Y las menciones del título se pintan COMO MENCIONES: el
            nombre de una tarea referencia entidades reales, y
            aplanarlo a texto en el historial es donde se perdería. */}
          <div class="flex items-start gap-1.5">
            {/* **El hueco se reserva aunque no haya nada que plegar**, igual
              que en la fila de un proyecto: sin él, la fila con hijas
              correría su título 22 px a la derecha y la lista dejaría de
              leerse como una columna.

              Y es un `span` y no un botón deshabilitado: un control
              invisible que no hace nada sigue anunciándose, y aquí habría
              uno por cada tarea del historial. */}
            {/* El punto es `EstadoDeTarea`, el mismo que lleva la pestaña
              de la tarea: el orden de urgencia y el color se deciden ahí
              una sola vez, para que la fila y la pestaña no puedan decir
              cosas distintas de la misma tarea. */}
            <div class="min-w-0 flex-1">
              {/* El campo debe conservar la altura y tipografía del título para no desplazar el historial al editar. */}
              <Show
                when={renombrando() === f.s.id}
                fallback={
                  // El cohete es absoluto: sin este hueco el título se mete debajo. Por
                  // `:has`, no por clase reactiva: cada fila mutaría al llegar git.
                  <div class="flex min-w-0 items-center gap-1 text-[0.8125rem] leading-[1.35] [:has(>[data-finish-slot])_&]:pr-16">
                    <Show when={fijada(f.s)}><span role="img" aria-label={t("projects.sessions.pinned")} title={t("projects.sessions.pinned")} class="shrink-0 text-neutral-500"><Pin size={12} /></span></Show>
                    <span class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"><WithMentions>{f.s.subagent ? readableSessionTitle(title()) : title()}</WithMentions></span>
                  </div>
                }
              >
                <form
                  data-session-rename
                  class="min-w-0"
                  onSubmit={(e) => {
                    e.preventDefault();
                    guardarNombre();
                  }}
                >
                  <Input
                    ref={enfocarYSeleccionar}
                    variant="ghost"
                    // `font-sans` conserva la letra del título, y
                    // `p-0`/`min-h-0` devuelve su altura: 13 px por 1,35, los
                    // mismos que el título. El peso lo hereda, para que
                    // la tarea abierta siga en negrita mientras se renombra.
                    class="block h-auto min-h-0 rounded-none border-0 p-0 font-sans text-[0.8125rem] leading-[1.35] text-inherit [font-weight:inherit]"
                    maxlength={SESSION_TITLE_MAX_LENGTH}
                    value={borrador()}
                    aria-label={t("projects.sessions.rename_label", {
                      title: f.s.title,
                    })}
                    onInput={(e) => setBorrador(e.currentTarget.value)}
                    onBlur={guardarNombre}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setRenombrando(null);
                      }
                    }}
                  />
                </form>
              </Show>
              {/* Proveedor, mensaje y estado del modelo en una línea. */}
              <div data-session-preview class="mt-1 flex min-w-0 items-center gap-1.5 text-[0.6875rem] font-normal leading-tight text-neutral-500">
                <Show when={worktrees()?.get(f.s.id)?.owned && !worktrees()?.get(f.s.id)?.available}>
                  <span class="flex shrink-0 text-error-strong" title={t("projects.sessions.worktree_missing")} aria-label={t("projects.sessions.worktree_missing")}><WorktreeRoto size={13} /></span>
                </Show>
                <span class="flex shrink-0" title={f.s.agent} aria-label={f.s.agent}><MarcaAgente id={f.s.agent} size={13} /></span>
                {/* El botón del cohete es translúcido: sin desvanecer, el mensaje se lee a
                    través. Máscara y no velo: el fondo del riel cambia con el tema y el wallpaper. */}
                <span class="min-w-0 flex-1 truncate [:has(>[data-finish-slot])_&]:[mask-image:linear-gradient(to_left,transparent_56px,black_88px)]">{f.s.last_message}</span>
                <EstadoDeTarea
                  {...activity()}
                  outcome={activity().outcome ?? f.s.outcome}
                  size={13}
                />
              </div>
              {/* Agente, y rama o worktree con su git, en la última línea. */}
              <SessionGit
                status={effectiveTaskGit(f.s, gitRows(), props.relatedSessions ?? props.sessions)}
                shared={sharesTaskGit(f.s, gitRows(), props.relatedSessions ?? props.sessions)}
                hasLead={conPastilla()}
                lead={
                  <Show when={conPastilla() && f.s.encargado}>
                  {(nombre) => {
                    const visible = () => displayName(nombre(), profiles()[nombre()]);
                    return (
                      <span
                        data-session-agent
                        class={cn(
                          "inline-flex max-w-full shrink-0 items-center gap-1 rounded-full border border-border py-px pr-1.5 pl-0.5 text-xs leading-4 text-neutral-700",
                          f.s.id === props.current ? "bg-neutral-50" : "bg-neutral-100",
                        )}
                        title={visible()}
                      >
                        <AstroAvatar
                          name={nombre()}
                          status={props.vivas.includes(f.s.id) ? "working" : "asleep"}
                          body={profiles()[nombre()]?.body}
                          avatar={profiles()[nombre()]?.avatar}
                          size={16}
                        />
                        <span class="whitespace-nowrap">{shortAgentName(visible())}</span>
                      </span>
                    );
                  }}
                </Show>
                }
              />
            </div>
            {/* La etapa va al final de la misma línea y no debajo: una segunda
                línea daría dos alturas de fila en la misma lista según quién
                esté marcada, y un historial se recorre de un vistazo
                precisamente porque todas las filas miden igual. Quien se
                recorta es el título — de los dos, el que se lee a distancia es
                la palabra corta. */}
            <EtapaDeTarea etapa={f.s.stage} class="mt-[3px]" />
          </div>

          {/* 24 px en la línea del título se salen por arriba. Al centro y fuera de
              flujo: en columna se corren la rama y el PR. `right-8` deja el menú. */}
          <Show when={puedeFinalizar() && renombrando() !== f.s.id}>
            <span data-session-actions data-finish-slot class="absolute top-1/2 right-8 z-10 flex -translate-y-1/2">
              <FinishTaskButton
                label={t("projects.sessions.finish")}
                description={f.s.subagent || gitRows()[f.s.id]?.shared_with
                  ? t("projects.sessions.finish_shared_description")
                  : t("projects.sessions.finish_description")}
                busy={finishing().includes(f.s.id)}
                onFinish={rect => void intentar(f.s.id, true, rect)}
              />
            </span>
          </Show>

          {/* Las acciones son una capa y no una columna: en columna le quitaban
              su ancho al título de todas las filas, aun invisibles. Van una
              encima de otra —el menú arriba, fijar abajo— para no tapar más
              renglón del que tapaba el menú solo. El velo va en `neutral-100`,
              el fondo que tiene la fila mientras se ve. */}
          <Show when={!props.readOnly}><div
            data-session-actions
            class={cn(
              "absolute inset-y-1 right-1 flex flex-col items-center justify-center gap-0.5 rounded-sm bg-neutral-100 opacity-0 group-hover/session:opacity-100 group-focus-within/session:opacity-100",
              menu() === f.s.id && "opacity-100",
              // Renombrando, el foco está en el campo: el velo saldría con el
              // fondo que no es y tapando el final del nombre que se escribe.
              renombrando() === f.s.id && "hidden",
            )}
            data-abierto={menu() === f.s.id ? "true" : undefined}
          >
            <span
              aria-hidden="true"
              class="pointer-events-none absolute inset-y-0 right-full w-8 bg-linear-to-l from-neutral-100"
            />
            <Popover
              open={menu() === f.s.id}
              onOpenChange={(abierto) => {
                setMenu(abierto ? f.s.id : null);
                if (!abierto) setConfirmando(null);
              }}
              placement="right-start"
              gutter={6}
            >
              {/* Sin `onClick` propio: ver la cabecera del módulo. */}
              <PopoverTrigger
                as={(p: object) => (
                  <button
                    {...p}
                    class="grid place-items-center rounded-sm border-0 bg-transparent px-1 py-0.5 leading-[1.3] text-neutral-500 hover:bg-neutral-200 hover:text-neutral-950"
                    aria-label={t("projects.sessions.actions_named", {
                      title: f.s.title,
                    })}
                    aria-haspopup="menu"
                    title={t("projects.sessions.actions")}
                  >
                    <MoreVertical size={15} />
                  </button>
                )}
              />
              <PopoverContent
                role={confirmando() === f.s.id ? "alertdialog" : "menu"}
                aria-label={confirmando() === f.s.id ? t("projects.sessions.delete") : undefined}
                class={confirmando() === f.s.id ? "w-72 p-3" : "max-h-72 w-56 overflow-y-auto p-1"}
              >
                <Show when={confirmando() === f.s.id} fallback={<>
                    <Popover placement="right-start" gutter={6}>
                      <div onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
                        <PopoverTrigger as={(trigger: object) => (
                          <button {...trigger} role="menuitem" aria-haspopup="menu" class={`${ITEM_DE_MENU} flex items-center justify-between gap-2`}>
                            {t("projects.sessions.stage")}<ChevronRight size={14} />
                          </button>
                        )} />
                      </div>
                      <PopoverContent role="menu" class="w-56 p-1">
                        <For each={ETAPAS}>
                          {(e) => (
                            <button
                              role="menuitemradio"
                              aria-checked={f.s.stage === e.id}
                              class={cn(
                                ITEM_DE_MENU,
                                "truncate",
                                f.s.stage === e.id && "font-semibold",
                              )}
                              onClick={() => {
                                setMenu(null);
                                props.onEtapa(f.s.id, e.id);
                              }}
                            >
                              {e.rotulo()}
                            </button>
                          )}
                        </For>
                        <button
                          role="menuitemradio"
                          aria-checked={!f.s.stage}
                          class={cn(
                            ITEM_DE_MENU,
                            "truncate",
                            !f.s.stage && "font-semibold",
                          )}
                          onClick={() => {
                            setMenu(null);
                            props.onEtapa(f.s.id, null);
                          }}
                        >
                          {t("projects.stage.none")}
                        </button>
                      </PopoverContent>
                    </Popover>
                    <span class="my-1 block h-px bg-border" />

                    {/* **Renombrar está escrito, y el doble clic es el atajo.**
                      El gesto de la fila no lo encuentra quien no lo prueba, y
                      con el teclado no se da: si la única forma de cambiarle el
                      nombre a una tarea fuera un doble clic, para media pantalla
                      no existiría. */}
                    <button
                      role="menuitem"
                      class={ITEM_DE_MENU}
                      onClick={() => empezarARenombrar(f.s)}
                    >
                      {t("projects.sessions.rename")}
                    </button>
                    <span class="my-1 block h-px bg-border" />

                    <Show when={!f.hija && !f.s.parent && props.destinos.length > 0}>
                      <Popover placement="right-start" gutter={6}>
                        <div onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
                          <PopoverTrigger as={(trigger: object) => (
                            <button {...trigger} role="menuitem" aria-haspopup="menu" class={`${ITEM_DE_MENU} flex items-center justify-between gap-2`}>
                              {t("projects.sessions.move_to")}<ChevronRight size={14} />
                            </button>
                          )} />
                        </div>
                        <PopoverContent role="menu" class="max-h-72 w-56 overflow-y-auto p-1">
                          <For each={props.destinos}>
                            {(d) => (
                              <button
                                role="menuitem"
                                class={`${ITEM_DE_MENU} truncate`}
                                onClick={() => {
                                  setMenu(null);
                                  props.onMove(f.s.id, d.id);
                                }}
                              >
                                {d.name}
                              </button>
                            )}
                          </For>
                        </PopoverContent>
                      </Popover>
                      <span class="my-1 block h-px bg-border" />
                    </Show>

                    <Show when={!f.hija && !f.s.parent && !f.s.archived && otherSpaces(f.s).length > 0}>
                      <Popover placement="right-start" gutter={6}>
                        <div onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
                          <PopoverTrigger as={(trigger: object) => (
                            <button {...trigger} role="menuitem" aria-haspopup="menu" data-move-space={f.s.id} class={`${ITEM_DE_MENU} flex items-center justify-between gap-2`}>
                              {t("spaces.move.to")}<ChevronRight size={14} />
                            </button>
                          )} />
                        </div>
                        <PopoverContent role="menu" aria-label={t("spaces.move.to")} class="max-h-72 w-60 overflow-y-auto p-1">
                          <For each={otherSpaces(f.s)}>
                            {(d) => (
                              <button
                                role="menuitem"
                                class={`${ITEM_DE_MENU} truncate`}
                                onClick={() => {
                                  setMenu(null);
                                  props.onMoveToSpace?.(f.s.id, d.id);
                                }}
                              >
                                {d.name}
                              </button>
                            )}
                          </For>
                          <Show when={props.carpeta}>
                            {(c) => <p class="m-0 px-2 pt-1 pb-1.5 text-[0.6875rem] text-neutral-500">{t("spaces.move.folder_stays", { folder: c() })}</p>}
                          </Show>
                        </PopoverContent>
                      </Popover>
                    </Show>

                    <Show when={!f.hija && !f.s.parent && props.de !== ""}>
                      <button
                        role="menuitem"
                        class={ITEM_DE_MENU}
                        onClick={() => {
                          setMenu(null);
                          props.onMove(f.s.id, "");
                        }}
                      >
                        {t("projects.sessions.remove_from_project")}
                      </button>
                    </Show>

                    <Show when={!f.s.archived && !fijada(f.s)}>
                      <button
                        role="menuitem"
                        class={ITEM_DE_MENU}
                        disabled={archiving().includes(f.s.id)}
                        onClick={() => void intentar(f.s.id, false)}
                      >
                        {t("projects.sessions.archive")}
                      </button>
                    </Show>
                    <button
                      role="menuitem"
                      class={`${ITEM_DE_MENU} text-error-strong`}
                      onClick={() => {
                        setConfirmando(f.s.id);
                      }}
                    >
                      {t("projects.sessions.delete")}
                    </button>
                </>}>
                  <div
                    data-session-confirm
                    class="min-w-0"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") { setConfirmando(null); setMenu(null); }
                    }}
                  >
                    <p class="m-0 mb-1.5 text-xs leading-[1.4] text-neutral-500">
                      {t("projects.sessions.delete_confirm")}
                    </p>
                    <div class="flex gap-1.5">
                      <Button
                        variant="danger"
                        size="compact"
                        ref={(el: HTMLElement) =>
                          queueMicrotask(() => el.focus({ preventScroll: true }))
                        }
                        onClick={() => {
                          setConfirmando(null);
                          setMenu(null);
                          props.onDelete(f.s.id);
                        }}
                      >
                        {t("projects.sessions.delete")}
                      </Button>
                      <Button
                        variant="outline"
                        size="compact"
                        onClick={() => { setConfirmando(null); setMenu(null); }}
                      >
                        {t("projects.sessions.keep")}
                      </Button>
                    </div>
                  </div>
                </Show>
              </PopoverContent>
            </Popover>
            <Show when={props.onPin}>
              <button
                type="button"
                data-session-pin
                class="grid place-items-center rounded-sm border-0 bg-transparent px-1 py-0.5 leading-[1.3] text-neutral-500 hover:bg-neutral-200 hover:text-neutral-950 focus-visible:outline-2 focus-visible:outline-primary"
                aria-label={fijada(f.s) ? t("projects.sessions.unpin_named", { title: f.s.title }) : t("projects.sessions.pin_named", { title: f.s.title })}
                aria-pressed={fijada(f.s)}
                title={fijada(f.s) ? t("projects.sessions.unpin") : t("projects.sessions.pin")}
                onClick={() => void setPinned(f.s)}
              >
                <Show when={fijada(f.s)} fallback={<Pin size={14} />}>
                  <PinOff size={14} />
                </Show>
              </button>
            </Show>
          </div></Show>
        </div>
      </>
    );
  };

  /** Una raíz con su rama de encargos. La pintan las dos listas: activas y archivadas. */
  const Rama = (r: { rama: RamaDeTareas<SessionRow>; hija?: boolean }) => {
    const rama = () => r.rama;
    // Cuenta y estado del plegado: todo lo de debajo, a cualquier nivel.
    const escondidas = () => descendientes(rama());
    return (
      <li>
        <Fila s={rama().tarea} hija={r.hija} />
        <Show when={rama().hijas.length > 0}>
          <button
            type="button"
            class="mt-0.5 ml-2.5 flex w-[calc(100%-10px)] cursor-pointer items-center gap-1.5 rounded-sm border-0 bg-transparent px-1.5 py-0.5 text-left text-[0.6875rem] leading-[1.2] text-neutral-500 tabular-nums hover:bg-neutral-200 hover:text-neutral-950 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
            aria-expanded={(!!query() || desplegadas().includes(rama().tarea.id))}
            aria-label={
              !(!!query() || desplegadas().includes(rama().tarea.id))
                ? t("projects.sessions.subtasks_expand", {
                    count: escondidas().length,
                    title: rama().tarea.title,
                  })
                : t("projects.sessions.subtasks_collapse", {
                    count: escondidas().length,
                    title: rama().tarea.title,
                  })
            }
            onClick={() => alternarDesplegada(rama().tarea.id)}
          >
            <ChevronRight
              size={12}
              class={cn(
                "shrink-0 transition-transform",
                (!!query() || desplegadas().includes(rama().tarea.id)) && "rotate-90",
              )}
            />
            {/* El estado de lo escondido va aquí, que es donde está lo
                escondido. El punto del padre sigue siendo suyo. */}
            <EstadoDeTarea
              ambito="plegadas"
              aprobando={escondidas().some((h) =>
                props.aprobando.includes(h.id),
              )}
              viva={escondidas().some((h) => props.vivas.includes(h.id))}
              esperando={escondidas().some((h) => h.esperando)}
              outcome={escondidas().some((h) => h.outcome === "failed") ? "failed" : null}
              sinVer={escondidas().some((h) => h.sin_ver)}
            />
            {/* Sin repetirlo al lector de pantalla: el `aria-label` del
                botón ya dice cuántas son. */}
            <span aria-hidden="true">
              {t("projects.sessions.subtasks_count", {
                count: escondidas().length,
              })}
            </span>
          </button>
        </Show>

        {/* La sangría con su hilo es la relación entera: encargos de
            la fila de arriba, sin rótulo que lo explique. */}
        <Show
          when={
            rama().hijas.length > 0 && (!!query() || desplegadas().includes(rama().tarea.id))
          }
        >
          <ul class="mt-0.5 ml-2.5 flex min-w-0 list-none flex-col gap-0.5 border-l border-border p-0 pl-1.5 [&>li]:min-w-0">
            <KeyedList each={rama().hijas} by={branch => branch.tarea.id}>{h => <Rama rama={h()} hija />}</KeyedList>
          </ul>
        </Show>
      </li>
    );
  };

  const [collapsedAuthors, setCollapsedAuthors] = createPref<string[]>(`taskAuthors.collapsed.${props.de}`, []);
  const toggleAuthor = (key: string) => setCollapsedAuthors(collapsedAuthors().includes(key) ? collapsedAuthors().filter(item => item !== key) : [...collapsedAuthors(), key]);
  const authorLabel = (key: string) => key.startsWith("agent:")
    ? displayName(key.slice(6), profiles()[key.slice(6)])
    : key === "unassigned" ? t("projects.sessions.without_agent")
    : key === "agent" ? t("projects.sessions.launched_by_agent")
    : key === "user" ? t("projects.sessions.launched_by_you")
    : t("projects.sessions.launcher_unknown");
  const AuthorGroups = (groupProps: { branches: RamaDeTareas<SessionRow>[] }) => {
    const keys = createMemo(() => authorKeys(groupProps.branches.map((branch) => branch.tarea), props.groupByHandler));
    // El orden relativo viene del backend; solo las fijadas suben dentro de su agente.
    const ofAuthor = (key: string) => groupProps.branches.filter(branch => authorKey(branch.tarea, props.groupByHandler) === key)
      .sort((a, b) => Number(fijada(b.tarea)) - Number(fijada(a.tarea)));
    return <Show when={props.groupByAuthor !== false} fallback={<ul class="m-0 flex min-w-0 list-none flex-col gap-2 p-0 [&>li]:min-w-0"><KeyedList each={[...groupProps.branches].sort((a, b) => Number(fijada(b.tarea)) - Number(fijada(a.tarea)))} by={branch => branch.tarea.id}>{branch => <Rama rama={branch()} />}</KeyedList></ul>}>
      <For each={keys()}>{key => <section data-task-author={key} aria-label={authorLabel(key)} class="flex min-w-0 flex-col gap-1">
      <div class="group/task-author flex items-center gap-1.5 px-2 pt-1 text-xs font-medium text-neutral-500">
        <Show
          when={key.startsWith("agent:")}
          fallback={
            <button
              class="relative grid size-[18px] shrink-0 place-items-center rounded-sm focus-visible:outline-2 focus-visible:outline-primary"
              aria-expanded={!collapsedAuthors().includes(key)}
              aria-label={t(collapsedAuthors().includes(key) ? "shell.sidebar.expand_group" : "shell.sidebar.collapse_group", { name: authorLabel(key) })}
              onClick={() => toggleAuthor(key)}>
              <ChevronRight size={14} class={cn("transition-transform", !collapsedAuthors().includes(key) && "rotate-90")} />
            </button>
          }
        >
          <button class="group/author-icon relative grid size-[18px] shrink-0 place-items-center rounded-sm focus-visible:outline-2 focus-visible:outline-primary"
            aria-expanded={!collapsedAuthors().includes(key)}
            aria-label={t(collapsedAuthors().includes(key) ? "shell.sidebar.expand_group" : "shell.sidebar.collapse_group", { name: authorLabel(key) })}
            onClick={() => toggleAuthor(key)}>
            <span class="transition-opacity group-hover/task-author:opacity-0 group-focus-visible/author-icon:opacity-0"><AstroAvatar name={key.slice(6)} status="asleep" body={profiles()[key.slice(6)]?.body} avatar={profiles()[key.slice(6)]?.avatar} size={18} /></span>
            <ChevronRight size={14} class={cn("absolute opacity-0 transition-[opacity,transform] group-hover/task-author:opacity-100 group-focus-visible/author-icon:opacity-100", !collapsedAuthors().includes(key) && "rotate-90")} />
          </button>
        </Show>
        <span class="min-w-0 truncate">{authorLabel(key)}</span>
      </div>
      {/* El hilo sangrado es de quién es la tarea, igual que el del proyecto
          dice de qué carpeta es: sin él, cabecera y tareas están al mismo
          nivel y el grupo no se ve dónde acaba. */}
      <ul hidden={collapsedAuthors().includes(key)} class="m-0 ml-2 flex min-w-0 list-none flex-col gap-2 border-l border-border p-0 pl-1.5 [&>li]:min-w-0">
        <KeyedList each={ofAuthor(key)} by={branch => branch.tarea.id}>{branch => <Rama rama={branch()} />}</KeyedList>
      </ul>
    </section>}</For>
    </Show>;
  };

  return (
    <div class="flex min-w-0 flex-col gap-2">
      <Show when={actionFailure()}>{failure => (
        <ToastPortal>
          <Toast tone="error" onDismiss={() => setActionFailure(null)}>
            <div class="max-h-[50vh] overflow-y-auto break-words">
              <FailureNote f={failure()} />
            </div>
          </Toast>
        </ToastPortal>
      )}</Show>
      <Show when={query()}>
        <p data-search-results class="m-0 px-2 text-[0.6875rem] text-neutral-500" aria-live="polite">
          {filteredSessions().length === 0 ? t("projects.agent_tasks.no_results") : t("projects.sessions.search_results", { count: filteredSessions().length })}
        </p>
      </Show>
      <Show when={aviso()}>{a => (
        <Dialog open onOpenChange={(abierto) => { if (!abierto) setAviso(null); }}>
          <DialogContent class="flex flex-col gap-3">
            <DialogTitle class="text-sm font-semibold">
              {a().finish ? t("projects.sessions.blockers_finish_title") : t("projects.sessions.blockers_archive_title")}
            </DialogTitle>
            <Show when={a().blockers.unsaved.length > 0}>
              <p class="m-0 text-[13px] text-neutral-700">
                {t("projects.sessions.blockers_unsaved")}
              </p>
              <ul class="m-0 flex max-h-[40vh] list-none flex-col gap-2 overflow-y-auto p-0">
                <For each={a().blockers.unsaved}>{(work) => (
                  <li class="min-w-0">
                    <span class="flex min-w-0 items-baseline gap-2 text-[13px] font-medium text-neutral-950">
                      <span class="min-w-0 truncate">{readableSessionTitle(work.title)}</span>
                      <span class="shrink-0 text-[11px] font-normal text-neutral-500">
                        {t("projects.sessions.blockers_files", { count: work.files.length })}
                      </span>
                    </span>
                    <ul class="m-0 list-none p-0">
                      <For each={work.files}>{(file) => (
                        <li class="font-mono text-[11px] break-all text-neutral-500">{file}</li>
                      )}</For>
                    </ul>
                  </li>
                )}</For>
              </ul>
            </Show>
            <Show when={a().blockers.not_finished}>
              <p class="m-0 text-[13px] text-neutral-700">
                {t("projects.sessions.blockers_not_finished")}
              </p>
            </Show>
            <div class="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setAviso(null)}>
                {t("projects.sessions.blockers_cancel")}
              </Button>
              <Show when={a().finish && a().blockers.not_finished}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => { const id = a().id; setAviso(null); void intentar(id, false); }}
                >
                  {t("projects.sessions.archive")}
                </Button>
              </Show>
              <Show when={a().blockers.unsaved.length > 0 && !a().blockers.not_finished}>
                <Button variant="danger" size="sm" onClick={() => void descartarYSeguir()}>
                  {t("projects.sessions.blockers_discard")}
                </Button>
              </Show>
            </div>
          </DialogContent>
        </Dialog>
      )}</Show>
      <Show when={activas().length > 0}>
        <AuthorGroups branches={activas()} />
      </Show>

    </div>
  );
}
