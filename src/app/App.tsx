import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import Archive from "lucide-solid/icons/archive";
import Check from "lucide-solid/icons/check";
import Columns2 from "lucide-solid/icons/columns-2";
import Copy from "lucide-solid/icons/copy";
import FolderOpen from "lucide-solid/icons/folder-open";
import PanelLeftOpen from "lucide-solid/icons/panel-left-open";
import PanelRightOpen from "lucide-solid/icons/panel-right-open";
import {
  batch,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  Index,
  type JSX,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
  untrack,
} from "solid-js";
import VisorDeArtefacto from "../features/artifacts/ArtifactViewer";
import type { Preview } from "../features/artifacts/Preview";
import Chat, {
  type Author,
  type Msg,
  type PermissionRequest,
  type VistaDeLaConversacion,
  vistaNueva,
} from "../features/chat/Chat";
import McpSignInNotice, { noteMcpSignIn } from "../features/chat/McpSignInNotice";
import type { Encolado } from "../features/chat/MessageQueue";
import {
  MODO_AUTOMATICO,
  modoInicial,
  modoRecordado,
  recordarModo,
} from "../features/chat/modes";
import DelegatedActivity, { DelegatedLaunch, delegatedAttention, delegatedDescendants, delegatedFamilies, type DelegatedListProps } from "../features/chat/DelegatedTasks";
import PreviousAgentChat from "../features/chat/PreviousAgentChat";
import type { AlmacenDePreguntas, PreguntasAMedias, Respuesta, RespuestaEnviada } from "../features/chat/Questions";
import { contestaALaTerminal, despachable, esDeLaTerminal, guardable, inyectable, type RazonDeRetencion, retencionAlCargar, siguienteLote, sueltaElBorrador } from "../features/chat/queue";
import type { ComandoEnVivo } from "../features/chat/ShellCard";
import type { AlMargen } from "../features/chat/SideQuestion";
import { comandoEscrito } from "../features/chat/slashOutput";
import { ThreadSearch, type ThreadSearchTarget } from "../features/chat/ThreadSearch";
import TranscriptSource from "../features/chat/TranscriptSource";
import type { Lectura } from "../features/chat/threadWindow";
import {
  anexarDelta,
  anexarImagen,
  type ChatEvent,
  type ChatExportado,
  clave,
  mcpCallFromName,
  modeloDeSubtarea,
  type PreguntaEvent,
  type Session,
  type SessionEvent,
  type Signatures,
  type TranscriptOrigin,
  type Turn,
  transcripcion,
} from "../features/chat/transcript";
import VisorDeArchivo from "../features/code/FileViewer";
import { avisarDeLosArboles } from "../features/code/refresh";
import CambiosDelTurno from "../features/code/TurnChanges";
import { arbolesDe, contiene, ubicar } from "../features/code/treeKind";
import ColumnaDeTrabajo from "../features/code/WorkTreeColumn";
import { esDeCodigo } from "../features/code/workdirKind";
import Observability from "../features/observability/Observability";
import Onboarding from "../features/onboarding/Onboarding";
import AnadirCarpeta, { type ClonEnCurso } from "../features/projects/AddWorkdir";
import AgentPageTasks from "../features/projects/AgentPageTasks";
import AgentProfile from "../features/projects/AgentProfile";
import AgentTasks, { createdTasks } from "../features/projects/AgentTasks";
import ArchivedTasks from "../features/projects/ArchivedTasks";
import BaseBranchPicker from "../features/projects/BaseBranchPicker";
import { watchHandlerStatus, watchHandlerStatuses } from "../features/projects/handlerPresence";
import { EmptyContext, ProjectPicker } from "../features/projects/Projects";
import VistaDeProyecto from "../features/projects/ProjectView";
import { DEFAULT_PROFILE, displayName, notifyProfiles, watchProfiles } from "../features/projects/profiles";
import RecentAgentChats from "../features/projects/RecentAgentChats";
import { type SessionRow, threadTitle } from "../features/projects/Sessions";
import TabStrip, { NewTabButton } from "../features/projects/Tabs";
import { createTaskWork, ResumeTask } from "../features/projects/TaskHistory";
import type { Etapa } from "../features/projects/TaskStage";
import { esChatDeAgente } from "../features/projects/taskTree";
import {
  DEFAULT_PERMISSION_MODE_EVENT,
  type DefaultPermissionModeChange,
} from "../features/settings/DefaultPermissions";
import Settings from "../features/settings/Settings";
import type { Startup } from "../features/settings/workspaces-store";
import { createAttention, topState } from "../features/shell/attention";
import DeleteSpace from "../features/shell/DeleteSpace";
import AvisoDeCarpeta from "../features/shell/FolderNotice";
import PantallaDeBloqueo from "../features/shell/LockScreen";
import AvisoDeMaterial from "../features/shell/MaterialNotice";
import Paneles from "../features/shell/Panels";
import Sidebar, { createSidebar } from "../features/shell/Sidebar";
import ColumnaLateral from "../features/shell/SideColumn";
import SpaceBar from "../features/shell/SpaceBar";
import TitleBar from "../features/shell/TitleBar";
import UsageBar from "../features/shell/UsageBar";
import AvisoDeVersion from "../features/shell/VersionNotice";
import WorkspaceColumn from "../features/shell/WorkspaceColumn";
import Sitio from "../features/sites/Site";
import { claseDeFondo } from "../lib/chat-background";
import { fondoDeChat, fondoPropio, veloDeFondo } from "../lib/chat-background-store";
import { copyText } from "../lib/clipboard";
import { pedirElCampo } from "../lib/focus";
import { lastRoster, rememberRoster } from "../lib/handlerRoster";
import { aplicarLenguaDeWorkspace, clavesConocidas, t } from "../lib/i18n";
import { invoke } from "../lib/invoke.ts";
import { createPointerDrag } from "../lib/pointer-drag";
import type { InternalTaskLink } from "../lib/links";
import type { MentionSources } from "../lib/mentions";
import type {
  Agent,
  AgentModels,
  AgentProfile as AgentProfileData,
  ArbolEnTarea,
  HandlerDefinition,
  HandlerList,
  HandlerStatusRow,
  ModoDePermiso,
  Project,
  Source,
} from "../lib/model";
import { carpetaDeTrabajo } from "../lib/model";
import { type CatalogosDeModelos, effortAlCambiarDeModelo, type OpcionDeModelo } from "../lib/models";
import { vistaPreviaDelHilo } from "../lib/nextSteps";
import {
  createPanels,
  deleteLayout,
  gridCell,
  gridTracks,
  MIN_PANEL_HEIGHT,
  MIN_PANEL_WIDTH,
  type Side as PanelSide,
  panelReadingOrder,
  readLayout,
  type PanelSite as SitioDePanel,
  sameSite,
  spacesWithLayout,
} from "../lib/panels";
import { createPref, escribirPref, leerPref } from "../lib/prefs";
import type { Frase } from "../lib/prose";
import { editDraft, insertMention, insertRecipient, type Recipient, type RecipientCandidate, type SenderTask, trimDraft } from "../lib/recipients";
import { conservar, conservarEnOrden, sessionRefresh } from "../lib/sessionRefresh";
import {
  accionDeAtajo,
  destinoDePestana,
  type NavegacionDePestanas,
  navegacionDePestanas,
  ventanaVecina,
} from "../lib/shortcuts";
import { alHilo, comandosConAlMargen, preguntaAlMargen } from "../lib/side-question";
import type { CliCommand, Skill, SlashMenu } from "../lib/skills";
import {
  carpetasDelEscritorio,
  enEscritorio,
  escritorioDeFila,
  type Space,
  spaceName,
} from "../lib/spaces";
import { type Paso, pasoDe } from "../lib/steps";
import {
  esDe,
  paraElMenu,
  type Superficie,
  superficieDe,
} from "../lib/surfaces";
import {
  type ArtifactTab,
  appendToStoredStrip,
  artifactTabId,
  browserTabId,
  createTabs,
  deleteStoredStrip,
  type FileTab,
  fileTabId,
  isContentTab,
  isTaskTab,
  migrateLegacyStrip,
  OBSERVABILITY_TAB_ID,
  type SiteTab,
  siteTabId,
  spacesWithStoredStrip,
  storedStrip,
  type Tab,
  type TaskTab,
} from "../lib/tabs";
import {
  adjuntosDevueltos,
  adjuntosSinMandar,
  claveDeBorrador,
  esProvisional,
  fuentesHeredadas,
  idProvisional,
  proyectoDeNuevaTarea,
  sameSources,
  tituloProvisional,
  unirFuentes,
} from "../lib/taskDraft";
import { editMentions, type PlaceCandidate, type TaskCandidate, type TaskMention, type TextEdit } from "../lib/taskMentions";
import { aplicarTemaDeTerminal } from "../lib/terminal-themes";
import {
  type SessionUsage,
  type UsageRecord,
  type Ventana,
  ventanaDe,
} from "../lib/usage";
import { cn } from "../lib/utils";
import {
  createCompactViewport,
  HEADER_HEIGHT,
  isWindows,
  toggleMaximizeFromHeader,
} from "../lib/window";
import { Button } from "../ui/Button";
import { Dialog, DialogContent, DialogTitle } from "../ui/Dialog";
import { asFailure, claveDe, prosaDe } from "../ui/Failure";
import { BotonConAtajo } from "../ui/Shortcut";
import { Toast, ToastStack } from "../ui/Toast";
import { apagarVistasDe, hayVistasDe } from "../features/code/typst";

// Lo que falla en el camino a la ventana y no en el comando: se vuelve a
// preguntar en vez de pintarlo (`cli/service/mod.rs`, `para_la_ventana`).
const TRANSPORTE = new Set([
  "shell.service.unreachable",
  "shell.service.busy",
  "shell.service.version",
]);

/** Un turno que sigue contestando, tal como lo cuenta `turn::list_live_turns`. */
type TerminalLanzada = {
  project: string;
  agent: string;
  model: string | null;
  effort: string | null;
  permission_mode: string | null;
};

/** Lo que devuelve `run_shell_command`: el turno y la tarea donde corrió. */
type Corrida = { session: string; turn: Turn };

/** Un `!` escrito sin tarea, hasta que Rust dice cuál abrió. */
type ComandoQueNace = {
  lanzado: TerminalLanzada;
  provisional: string;
  titulo: string;
  claveBorrador: string;
  generation: number;
  session: string | null;
};

type LiveTurn = {
  session: string;
  workspace: string;
  project: string;
  started_at: number;
  /** El agente ya contestó y el turno solo sigue abierto por una hija. */
  background?: boolean;
  /** Lo que ocupa la tarea es un `!` y no el agente. */
  shell?: { id: string; command: string };
};

// Sin botón todavía: expone `sleep_session` para el gesto «Dormir» que la
// pantalla aún no ofrece.
export async function sleepSession(project: string, session: string) {
  await invoke<void>("sleep_session", { project, session });
}

/** La página de Archivadas ocupa el sitio de la vista de proyecto; ningún id de carpeta empieza así. */
const ARCHIVADAS = "@archivadas";

export default function App() {
  /**
   * El alta en curso: un pestillo a propósito, que se enciende cuando no
   * hay workspace y se apaga solo al terminar o cancelar. Derivarlo de
   * «¿hay workspace?» desmontaría el asistente en cuanto el paso 1 crea el
   * primero, antes de pedir proveedores de IA y source control.
   */
  const [alta, setAlta] = createSignal<null | "primera" | "nueva">(null);
  // `null` es «este workspace todavía no tiene contexto»; se enseña como un
  // renglón al lado del selector de proyecto, no como una pantalla que lo pida.
  const [contextRoot, setContextRoot] = createSignal<string | null>(null);
  /** Con qué modo arranca lo nuevo de este workspace. `null` es el último elegido a mano. */
  const [workspaceMode, setWorkspaceMode] = createSignal<string | null>(null);
  /** Cuál está abierto, para poder descartar lo que emite el turno de otro. */
  const [workspaceActivo, setWorkspaceActivo] = createSignal<string | null>(
    null,
  );
  const attention = createAttention();
  const [draftBases, setDraftBases] = createSignal<Record<string, string>>({});
  const [hablandoCon, setHablandoCon] = createSignal<{ project: string; name: string } | null>(null);
  const [projectList, setProjectRows] = createSignal<Project[]>([]);
  // El riel pinta carpetas con `For`: una nueva en cada relectura remonta sus tareas, y cada una vuelve a pedir su `task_history`.
  const setProjectList = (next: Project[]) => setProjectRows((previous) => conservar(previous, next, (p) => p.id));
  const [sources, setSources] = createSignal<Source[]>([]);
  const [error, setError] = createSignal<string | null>(null);
  // Por qué esta ventana no puede abrir estos datos, si es que no puede: una
  // instalación con una forma que este binario ya no sabe convertir
  // (`workspaces::base_decidida`). Con esto
  // puesto no se pinta nada más que `PantallaDeBloqueo`.
  const [bloqueo, setBloqueo] = createSignal<Frase | null>(null);

  // Los ids, para el historial agrupado y los efectos que lo recargan.
  const projects = createMemo(() => projectList().map((p) => p.id));
  // Los grupos del historial: los proyectos y las tareas sin proyecto, que
  // Rust responde con `""`. Van por el mismo camino que las demás: son
  // otra carpeta, no otro mecanismo (`workspace/sessions.rs`, `sessions_root`).
  const grupos = createMemo(() => ["", ...projects()]);

  // Vacío es un estado legítimo y es el de arranque: nadie eligió todavía.
  // La app no elige por ti — con un proyecto puesto se puede mandar una
  // pregunta atribuida a un trabajo que nunca se abrió.
  const [project, setProject] = createSignal("");
  // El historial es de TODO el workspace, agrupado por proyecto. Rust
  // responde por proyecto: se pregunta una vez por cada uno. Son lecturas
  // de un directorio, no de red.
  const [sesiones, setSesiones] = createSignal<Record<string, SessionRow[]>>({});
  /**
   * Las tareas que la pantalla ya pinta y Rust todavía no ha escrito.
   *
   * Aparte de `sesiones`, que es el espejo fiel de lo que hay en disco: una
   * fila inventada ahí dentro sobreviviría al siguiente refresco sin que nadie
   * la reclamara. `sesionesConEstado` las junta para pintar.
   */
  const [naciendo, setNaciendo] = createSignal<{ project: string; row: SessionRow }[]>([]);
  const retirarNaciendo = (id: string) =>
    setNaciendo((ns) => ns.filter((n) => n.row.id !== id));
  // La que ya llegó del disco deja de nacer: su fila de verdad la sustituye.
  createEffect(() => {
    const listas = sesiones();
    setNaciendo((ns) => {
      const quedan = ns.filter(
        (n) => !(listas[n.project] ?? []).some((r) => r.id === n.row.id),
      );
      return quedan.length === ns.length ? ns : quedan;
    });
  });
  const [sessionId, setSessionId] = createSignal<string | null>(null);
  // Qué proyecto se está mirando en el panel principal, si alguno: una
  // vista y no un modo. No cambia lo que la app hace, cambia lo que el
  // panel enseña. Abrir una tarea o empezar una la cierra: la
  // conversación es lo que ocupa ese sitio.
  const [proyectoAbierto, setProyectoAbierto] = createSignal<string | null>(
    null,
  );
  // Con la tarea delante, un turno que cierra tampoco queda sin ver.
  createEffect(() => {
    const workspace = workspaceActivo();
    const id = sessionId();
    if (workspace && id && !proyectoAbierto() && attention.unseen(workspace).has(id)) attention.markSeen(workspace, id);
  });

  // Las pestañas: lo que se tiene a mano en el espacio principal —tareas,
  // archivos y artefactos en una tira—, una vista y no la vida de la
  // sesión: cerrar una no toca a Rust ni al historial (`lib/tabs.ts`). La
  // activa la guarda el módulo (`activarPestana`) y no `sessionId`: una
  // tarea, uno de sus archivos y uno de sus artefactos pueden estar
  // abiertos a la vez y los tres dirían "activo" si se derivara de ahí.
  const pestanas = createTabs();
  const pestanaActiva = () => (proyectoAbierto() ? null : pestanas.active());
  // Los escritorios del workspace (`lib/spaces.ts`). Sin lista —un servicio
  // que no los conoce— la ventana se pinta como antes de los espacios.
  const [spaces, setSpaces] = createSignal<Space[]>([]);
  const [escritorio, setEscritorio] = createSignal<string | null>(null);
  const activeSpace = () => spaces().find((i) => i.id === escritorio()) ?? null;
  const multipleSpaces = () => spaces().length > 1;
  const viendoArchivadas = () => proyectoAbierto() === ARCHIVADAS;
  // Los visores se recorren por id y no por el objeto abierto: `For`
  // compara por referencia, y marcar un archivo como cambiado —al
  // guardarlo— crea un objeto nuevo. Eso desmontaría y volvería a montar
  // su visor, tirando el desplazamiento y pidiendo el archivo otra vez.
  const idsDeContenido = createMemo(() =>
    pestanas.open().filter(isContentTab).map((p) => p.id),
  );

  // Las pestañas separadas: fijas a la derecha, fuera de la tira
  // (`lib/panels.ts`). Sin ninguna, todo lo de abajo se comporta como si
  // esto no existiera. La tira gobierna el panel principal y nada más:
  // lo separado no está en la tira, y no hay que preguntarse en cuál de
  // los dos panes cae lo que se pulsa.
  const paneles = createPanels();
  // Cuánto de la cabecera ocupan de verdad los controles de cada
  // plataforma, sin poder expresarse con un padding fijo: el semáforo
  // está a la izquierda en macOS, los controles a la derecha en Windows,
  // y el título de la rama solo existe en builds de desarrollo.
  const [reservaIzquierdaDeTiras, setReservaIzquierdaDeTiras] = createSignal(0);
  const [reservaDerechaDeTiras, setReservaDerechaDeTiras] = createSignal(0);
  let cabeceraDeConversacion: HTMLDivElement | undefined;
  let controlesIzquierdos: HTMLDivElement | undefined;
  let controlesDerechos: HTMLDivElement | undefined;
  const medirReservasDeTiras = () => {
    if (!cabeceraDeConversacion || !controlesIzquierdos || !controlesDerechos)
      return;
    const cabecera = cabeceraDeConversacion.getBoundingClientRect();
    const izquierda = controlesIzquierdos.getBoundingClientRect();
    const derecha = controlesDerechos.getBoundingClientRect();
    setReservaIzquierdaDeTiras(Math.max(0, izquierda.right - cabecera.left));
    setReservaDerechaDeTiras(Math.max(0, cabecera.right - derecha.left));
  };
  onMount(() => {
    medirReservasDeTiras();
    if (typeof ResizeObserver === "undefined") return;
    const ojo = new ResizeObserver(medirReservasDeTiras);
    if (cabeceraDeConversacion) ojo.observe(cabeceraDeConversacion);
    if (controlesIzquierdos) ojo.observe(controlesIzquierdos);
    if (controlesDerechos) ojo.observe(controlesDerechos);
    onCleanup(() => ojo.disconnect());
  });
  // Con la ventana estrecha se enseña solo el panel principal; lo
  // separado sigue separado. El corte es `COMPACT_VIEWPORT_QUERY` —900px
  // de ancho, 1100 en vertical—, ya definido por la app: a 900px, con el
  // historial en sus 260, quedan ~640 para el espacio principal, y el
  // divisor no cabe en dos mínimos de 320 (`lib/panels.ts`). Esconder en
  // vez de juntar es lo que devuelve el reparto al ensanchar.
  const compacta = createCompactViewport();
  const paginaDeAgente = () => !sessionId() && hablandoCon() !== null;
  // La página de un agente ocupa la pantalla entera: las demás ventanas
  // siguen repartidas y vuelven al abrir una tarea, como con la ventana estrecha.
  const unaSolaVentana = () => compacta() || paginaDeAgente();
  /**
   * Las pistas que se le pasan a `Paneles`. Con la ventana estrecha, **una sola
   * celda**: lo separado sigue separado, solo que no se enseña.
   */
  const anchosEnPantalla = () => (unaSolaVentana() ? [1] : paneles.widths());
  const altosEnPantalla = () => (unaSolaVentana() ? [1] : paneles.heights());
  const filasEnPantalla = () =>
    unaSolaVentana() ? [1] : paneles.rowsPerColumn();
  // En qué celda de la cuadrícula se pinta lo que está en `sitio`, o
  // `undefined` si no está a la vista. Quien lo pinta lo esconde además
  // con `hidden`: un hijo sin celda asignada se colaría en la primera
  // libre. Cómo se numeran las celdas está en `celda()`.
  const estiloDeLaCelda = (sitio: SitioDePanel | null) => {
    if (!sitio) return undefined;
    if (unaSolaVentana())
      return sameSite(sitio, paneles.activeSite())
        ? { "grid-column": "1", "grid-row": "1" }
        : undefined;
    return gridCell(sitio, paneles.rowsPerColumn()[sitio.col] ?? 1);
  };
  /** Las ventanas que se pintan. Con la ventana estrecha, solo la activa. */
  const ventanas = () =>
    unaSolaVentana() ? [paneles.activeSite()] : paneles.sites();
  /** Solo las filas bajo la primera llevan su tira dentro de la cuadrícula. */
  const llevaTiraInterior = (sitio: SitioDePanel | null | undefined) =>
    paneles.isSplit() && (sitio?.fila ?? 0) > 0;
  // Si una pestaña se está viendo ahora mismo: es la que su ventana
  // tiene delante, y esa ventana se está pintando. Con la ventana
  // estrecha solo se pinta la activa: lo que hay en las demás sigue
  // repartido pero no se enseña, y ensanchar devuelve el reparto que
  // había en vez de deshacerlo.
  const seVe = (id: string) => {
    const sitio = paneles.siteOf(id);
    if (!sitio || paneles.activeTabAt(sitio) !== id) return false;
    return !unaSolaVentana() || sameSite(sitio, paneles.activeSite());
  };
  /** Dónde se pinta una pestaña, o `undefined` si no se ve. */
  const celdaDe = (id: string) =>
    seVe(id) ? estiloDeLaCelda(paneles.siteOf(id)) : undefined;
  // La vista de proyecto ocupa la celda de la ventana activa, así que quien
  // caiga en esa celda tiene que apartarse: dos nodos con la misma celda se
  // apilan y se leen encima uno del otro. Función y no memo: `proyectoDeLaVista`
  // se declara más abajo, y memoizar lanzaba `ReferenceError` en el primer
  // pintado con la app en blanco.
  const tapadoPorElProyecto = (sitio: SitioDePanel | null | undefined) =>
    (proyectoDeLaVista() !== null || viendoArchivadas()) &&
    !!sitio &&
    sameSite(sitio, paneles.activeSite());
  /** Sitios sin pestaña delante, restando el que ocupa la vista de proyecto. */
  const sitiosEnBlanco = () =>
    paneles
      .sites()
      .filter((s) => paneles.activeTabAt(s) === null && !tapadoPorElProyecto(s));
  /** La fila del historial de una tarea, en el grupo que esté. */
  const filaDe = (id: string) => {
    for (const grupo of Object.values(sesiones())) {
      const fila = grupo.find((r) => r.id === id);
      if (fila) return fila;
    }
    return naciendo().find((n) => n.row.id === id)?.row;
  };
  // Sin la carpeta no se puede abrir: `abrirSesion` la necesita para la pestaña.
  const tareaDelRiel = (id: string): SenderTask | null => {
    for (const [folder, filas] of Object.entries(sesiones())) {
      const fila = filas.find((r) => r.id === id);
      if (fila) return { folder, task: id, title: fila.title.trim() || id, agent: fila.agent };
    }
    return null;
  };
  /**
   * Lo que se pinta en cada pestaña: el título del historial cuando ya llegó,
   * y mientras tanto el que la pestaña se guardó la última vez.
   */
  const pestanasEnPantalla = createMemo<Tab[]>(() =>
    pestanas.open().map((p) => {
      if (!isTaskTab(p)) return p;
      const fila = filaDe(p.id);
      const titulo =
        fila && esChatDeAgente(fila) && !fila.agent_thread ? (fila.encargado ?? p.titulo) : fila?.inbox ? threadTitle(fila) : (fila?.title ?? p.titulo);
      // La misma fila si el título no cambió, lo que arregla la ×: esto
      // devolvía `{ ...p }` siempre, y cualquier recálculo del memo —activar
      // una ventana lo dispara— daba filas NUEVAS. `Pestanas` las pinta con
      // `For`, que compara por referencia: filas nuevas destruye y
      // reconstruye el DOM de toda la tira.

      // Sin esto, cerrar una pestaña de una ventana que no manda no hace
      // nada la primera vez: el `pointerdown` sube al contenedor de la
      // ventana, que la pone al mando (`mandarVentana`), recalcula este
      // memo, y el botón × recién pulsado deja de existir antes de que
      // llegue el `click`.
      return titulo === p.titulo ? p : { ...p, titulo };
    }),
  );

  /**
   * Las pestañas de una ventana, ya con su título. Va aquí y no arriba:
   * un memo antes de `pestanasEnPantalla` la lee en su zona muerta
   * temporal —`ReferenceError`, ventana en blanco— que `tsc` no ve: la
   * referencia es legal para TypeScript.
   */
  const pestanasDe = (sitio: SitioDePanel) => {
    const suyas = paneles.tabsAt(sitio);
    const todas = pestanasEnPantalla();
    return suyas
      .map((id) => todas.find((p) => p.id === id))
      .filter((p): p is Tab => p !== undefined);
  };
  /**
   * El reparto se reconcilia con las pestañas que existen de verdad
   * (`lib/tabs.ts`). Es un efecto y no un memo: escribe. Abrir una cae en
   * la ventana activa; cerrar la última de una ventana se la lleva. Sin
   * esto, un archivo quedaría montado sin celda: invisible, sin error.
   */
  createEffect(
    on(
      () => [pestanas.open().map((p) => p.id), pestanas.active()] as const,
      ([ids, activa]) => {
        paneles.sync(ids);
        // Y la activa se pone delante: abrir una conversación desde el
        // historial no pasa por `activarPestana`, llama a `abrirSesion`
        // directo. Sin esto la pestaña entra detrás de la que ya estaba
        // —la fila del historial se marca y la pantalla no cambia.
        if (activa) paneles.activate(activa);
      },
    ),
  );
  /** Las tareas repartidas, que son las que necesitan su propia transcripción. */
  const tareasEnVentanas = createMemo(() =>
    pestanasEnPantalla().filter(isTaskTab),
  );
  /** Las tareas con pestaña: la lista viva las trae aunque estén archivadas. */
  const sesionesConPestana = createMemo(
    () =>
      [...new Set(pestanas.open().map((p) => p.session))]
        .filter((id) => id !== "" && !esProvisional(id))
        .sort(),
    [],
    { equals: (a, b) => a.length === b.length && a.every((id, i) => id === b[i]) },
  );
  /** Los agentes de las tareas con pestaña: Configuración abre desplegados sus proveedores. */
  const agentesEnUso = () => {
    const abiertas = new Set(sesionesConPestana());
    const agentes = new Set<string>();
    for (const filas of Object.values(sesiones())) {
      for (const fila of filas) if (abiertas.has(fila.id)) agentes.add(fila.agent);
    }
    return [...agentes];
  };
  // Qué pestañas viajaron en la última lectura de cada grupo: la que se abrió
  // después aún no tiene fila, y eso no dice que la tarea ya no exista.
  const pedidas = new Map<string, Set<string>>();
  const sinPedir = (id: string) => grupos().some((g) => !pedidas.get(g)?.has(id));
  const enLista = (id: string) =>
    naciendo().some((n) => n.row.id === id) ||
    Object.values(sesiones()).some((filas) => filas.some((r) => r.id === id));
  // Una relectura por pestaña sin fila hasta que una lectura la lleve: si falla, no se repite en bucle.
  const esperandoFila = new Set<string>();
  function pedirFilasQueFaltan() {
    const faltan = sesionesConPestana().filter((id) => !enLista(id) && sinPedir(id) && !esperandoFila.has(id));
    if (faltan.length === 0) return;
    for (const id of faltan) esperandoFila.add(id);
    void refreshSessions(grupos());
  }
  createEffect(
    on(
      sesionesConPestana,
      () => {
        if (grupos().every((grupo) => grupo in sesiones())) pedirFilasQueFaltan();
      },
      { defer: true },
    ),
  );
  // Podar antes de cargar todos los grupos cerraría pestañas válidas al arrancar.
  // Archivar cierra la pestaña que se vio viva.
  let vivasVistas = new Set<string>();
  createEffect(
    on([sesiones, grupos, escritorio, spaces], ([lista, g, desk, todas]) => {
      if (!g.every((grupo) => grupo in lista)) return;
      const fuera = pestanas.sync((id) => {
        for (const [grupo, filas] of Object.entries(lista)) {
          const fila = filas.find((r) => r.id === id);
          if (fila) return fila.archived === true && vivasVistas.has(id) ? null : { project: grupo, titulo: fila.title };
        }
        const suya = (sinPedir(id) || naciendo().some((n) => n.row.id === id)) && pestanas.open().find((p) => p.session === id);
        return suya ? { project: suya.project, titulo: "" } : null;
      });
      vivasVistas = new Set(
        Object.values(lista)
          .flat()
          .filter((r) => r.archived !== true)
          .map((r) => r.id),
      );
      pedirFilasQueFaltan();
      fuera.forEach(soltarHilo);
      fuera.forEach(soltarBorrador);
      for (const id of fuera) olvidarPestana(id);
      // Una tarea que se movió a otro espacio se lleva su pestaña a esa tira.
      if (!desk) return;
      const ajenas: { p: TaskTab; a: string }[] = [];
      for (const p of pestanas.open()) {
        if (!isTaskTab(p)) continue;
        const fila = Object.values(lista).flat().find((r) => r.id === p.session);
        const a = escritorioDeFila(fila, todas);
        if (a && a !== desk) ajenas.push({ p, a });
      }
      if (ajenas.length > 0) reubicarPestanas(ajenas);
    }),
  );

  /** Saca pestañas de esta tira hacia la guardada de su escritorio, sin olvidar lo leído. */
  function reubicarPestanas(ajenas: { p: TaskTab; a: string }[]) {
    const ws = workspaceActivo();
    if (!ws) return;
    for (const { p, a } of ajenas) appendToStoredStrip(ws, a, { id: p.id, project: p.project, titulo: p.titulo });
    const activaAntes = pestanaActiva();
    const vecina = pestanas.closeMany(ajenas.map(({ p }) => p.id));
    paneles.sync(pestanas.open().map((x) => x.id));
    if (activaAntes === null || pestanas.open().some((x) => x.id === activaAntes)) return;
    if (vecina) void activarPestana(vecina);
    else irAlBlanco(carpetaDelEscritorio(project()));
  }

  /**
   * Cambia la tira y el riel a otro escritorio. Las pestañas del que se deja
   * no se cierran: sus lecturas siguen hasta que su pestaña se cierre en su tira.
   * Archivadas es de todo el workspace y se queda abierta.
   */
  function cambiarEscritorio(id: string, restaurarActiva = true) {
    const ws = workspaceActivo();
    if (!ws || id === escritorio() || !spaces().some((i) => i.id === id)) return;
    const enArchivadas = viendoArchivadas();
    const restored = batch(() => {
      setEscritorio(id);
      escribirPref(`space.${ws}`, id);
      // El reparto del que se deja ya está guardado por cada cambio suyo; aquí
      // se corta, para no escribir el del que llega bajo la clave del otro.
      paneles.bindTo(null, null);
      const r = pestanas.load(ws, id);
      // En el mismo lote: una pestaña sin ventana se monta escondida, gasta su
      // lectura sin caja y reabre al final (`montadas`).
      const vivos = pestanas.open().map((x) => x.id);
      paneles.restore(readLayout(ws, id), vivos);
      paneles.sync(vivos);
      paneles.bindTo(ws, id);
      if (r) paneles.activate(r);
      if (!enArchivadas) setProyectoAbierto(null);
      return r;
    });
    // Las demás ventanas del reparto que vuelve cargan su tarea, para que la
    // rejilla vuelva enseñando lo que tenía. La de delante la abre lo de abajo.
    loadWindowThreads(restored);
    if (!restaurarActiva) return;
    const p = restored ? pestanas.open().find((x) => x.id === restored) : undefined;
    if (enArchivadas) {
      if (p) pestanas.activate(p.id);
      return;
    }
    if (p) void abrirSesion(p.project, p.id);
    else irAlBlanco(carpetaDelEscritorio(project()));
  }

  /** Una carpeta de este escritorio para la caja vacía: la pedida si es suya, si no la primera visible. */
  function carpetaDelEscritorio(pedido: string) {
    const desk = activeSpace();
    if (!desk) return pedido;
    const visibles = carpetasDelEscritorio(projectList(), desk, sesiones());
    if (visibles.some((p) => p.id === pedido)) return pedido;
    return visibles[0]?.id ?? pedido;
  }

  /** Lo que la ventana guarda de una pestaña que ya no va a volver. */
  function soltarPestanaGuardada(id: string) {
    soltarBorrador(id);
    olvidarPestana(id);
    if (!vivas().includes(id)) soltarHilo(id);
  }

  function podarTirasMuertas(ws: string, lista: Space[]) {
    // También el reparto: un espacio con rejilla guardada y sin tira —nadie
    // abrió una pestaña— no lo alcanzaría `escritoriosConTira`.
    const conAlgo = new Set([...spacesWithStoredStrip(ws), ...spacesWithLayout(ws)]);
    for (const id of conAlgo) {
      if (lista.some((i) => i.id === id)) continue;
      for (const p of storedStrip(ws, id)) soltarPestanaGuardada(p.id);
      deleteStoredStrip(ws, id);
      deleteLayout(ws, id);
    }
  }

  /** Qué escritorio abre este workspace: el último que se usó si sigue vivo, o la primera. */
  function asentarEscritorio(ws: string, lista: Space[] | null): string | null {
    if (!lista || lista.length === 0) {
      batch(() => {
        setSpaces([]);
        setEscritorio(null);
      });
      return null;
    }
    migrateLegacyStrip(ws, lista[0].id);
    const guardado = leerPref<string | null>(`space.${ws}`, null);
    const desk = guardado && lista.some((i) => i.id === guardado) ? guardado : lista[0].id;
    podarTirasMuertas(ws, lista);
    batch(() => {
      setSpaces(lista);
      setEscritorio(desk);
    });
    return desk;
  }

  async function reloadSpaces() {
    const ws = workspaceActivo();
    if (!ws) return;
    try {
      const lista = await invoke<Space[]>("list_spaces");
      if (ws !== workspaceActivo() || escritorio() === null) return;
      setSpaces(lista);
      if (!lista.some((i) => i.id === escritorio()) && lista[0]) cambiarEscritorio(lista[0].id);
      podarTirasMuertas(ws, lista);
    } catch {
      // La lista de antes sigue sirviendo hasta el siguiente aviso.
    }
  }

  /** El aviso de lo que un gesto sobre espacios acaba de hacer, con su «Ir». */
  const [aviso, setAviso] = createSignal<{ texto: string; boton?: string; ir?: () => void } | null>(null);
  const [deletingSpace, setDeletingSpace] = createSignal<string | null>(null);
  const replaceSpace = (i: Space) =>
    setSpaces((lista) => lista.map((x) => (x.id === i.id ? i : x)));

  async function createSpace(name: string, folders: string[]) {
    const nueva = await invoke<Space>("create_space", { name, folders });
    setSpaces((lista) => [...lista.filter((i) => i.id !== nueva.id), nueva]);
    cambiarEscritorio(nueva.id);
  }

  async function renameSpace(id: string, name: string) {
    try {
      replaceSpace(await invoke<Space>("rename_space", { id, name }));
    } catch (e) {
      setError(prosaDe(e));
    }
  }

  async function updateSpaceFolders(id: string, folders: string[]) {
    replaceSpace(await invoke<Space>("set_space_folders", { id, folders }));
  }

  async function removeFromActiveSpace(folder: string) {
    const i = activeSpace();
    if (!i) return;
    try {
      await updateSpaceFolders(i.id, i.folders.filter((f) => f !== folder));
    } catch (e) {
      setError(prosaDe(e));
    }
  }

  async function moveToSpace(project: string, id: string, space: string) {
    try {
      const destino = await invoke<{ id: string; name: string | null }>("move_task_to_space", { project, id, space });
      await refreshSessions(grupos());
      setAviso({
        texto: t("spaces.move.toast", { name: spaceName(destino) }),
        boton: t("spaces.toast.go"),
        ir: () => void abrirSesion(project, id),
      });
    } catch (e) {
      setError(prosaDe(e));
    }
  }

  function alternarArchivadas() {
    if (!viendoArchivadas()) {
      setProyectoAbierto(ARCHIVADAS);
      return;
    }
    const p = pestanas.activeTab();
    setProyectoAbierto(null);
    if (p) void activarPestana(p);
    else irAlBlanco();
  }

  /** Borrada: sale de la barra, su tira se olvida y el aviso lleva a Archivadas. */
  function spaceDeleted(i: Space, archivadas: number) {
    const ws = workspaceActivo();
    setDeletingSpace(null);
    if (!ws) return;
    const quedan = spaces().filter((x) => x.id !== i.id);
    if (escritorio() === i.id && quedan[0]) cambiarEscritorio(quedan[0].id);
    setSpaces(quedan);
    for (const p of storedStrip(ws, i.id)) soltarPestanaGuardada(p.id);
    deleteStoredStrip(ws, i.id);
    window.dispatchEvent(new CustomEvent("harness:tasks-changed"));
    void reloadSpaces();
    setAviso({
      texto: t("spaces.delete.toast", { name: spaceName(i), count: archivadas }),
      boton: t("spaces.delete.see_archived"),
      ir: () => {
        if (!viendoArchivadas()) alternarArchivadas();
      },
    });
  }

  /** Lo más urgente de las tareas de un escritorio; con `sinResolver`, también las que se pintan en todos. */
  const senalDe = (desk: string, sinResolver = false) =>
    topState(
      attention.of(workspaceActivo()).filter((a) => {
        const r = filaDe(a.session);
        return !!r && (r.space === desk || (sinResolver && !r.space));
      }),
    );

  // El borrador de cada conversación: lo escrito y lo puesto en la caja que
  // todavía no ha viajado, por conversación y no de la app —cambiar de
  // pestaña no se lleva lo que estabas escribiendo en otra—. La clave es el
  // id de sesión, o el proyecto para la que aún no existe en disco. `archivos`
  // vive aquí y no en `Chat.tsx`: bajarlo lo pierde al cambiar de pestaña.
  type Borrador = {
    input: string;
    task_mentions?: TaskMention[];
    /** A quién va dirigido lo escrito. Lista aparte: no es material del prompt. */
    recipients?: Recipient[];
    mentionHistory?: { text: string; task_mentions?: TaskMention[]; recipients?: Recipient[] }[];
    mentionFuture?: { text: string; task_mentions?: TaskMention[]; recipients?: Recipient[] }[];
    sourceIds: string[];
    excludedSourceIds: string[];
    archivos: string[];
    configuration?: { agent: string; surface: string; model: string; effort: string; mode?: string };
  };
  const SIN_BORRADOR: Borrador = {
    input: "",
    sourceIds: [],
    excludedSourceIds: [],
    archivos: [],
  };
  const [borradores, setBorradores] = createSignal<Record<string, Borrador>>({});
  const claveDelHilo = () => sessionId() ?? "";
  const claveAbierta = () => claveDeBorrador(sessionId(), project(), hablandoCon()?.project === project() ? hablandoCon()?.name : null);
  const editarBorrador = (clave: string, fn: (b: Borrador) => Borrador) =>
    setBorradores((bs) => ({ ...bs, [clave]: fn(bs[clave] ?? SIN_BORRADOR) }));
  const soltarBorrador = (clave: string) =>
    setBorradores((bs) => {
      if (!(clave in bs)) return bs;
      const { [clave]: _, ...resto } = bs;
      return resto;
    });
  const borrador = () => borradores()[claveAbierta()] ?? SIN_BORRADOR;
  const input = () => borrador().input;
  const setInput = (v: string, inputType?: string, edit?: TextEdit) =>
    editarBorrador(claveAbierta(), (b) => {
      const history = [...(b.mentionHistory ?? []), { text: b.input, task_mentions: b.task_mentions, recipients: b.recipients }].slice(-100);
      const restored = inputType?.startsWith("history") ? [...history].reverse().find(h => h.text === v) : undefined;
      // Las dos listas se mueven con el mismo gesto: una que se quedara atrás
      // pintaría su etiqueta sobre otro trozo del texto.
      const next = editDraft({ text: b.input, task_mentions: b.task_mentions, recipients: b.recipients }, v, edit);
      return { ...b, input: v, task_mentions: restored?.task_mentions ?? next.task_mentions,
        recipients: restored?.recipients ?? next.recipients, mentionHistory: history, mentionFuture: [] };
    });
  const navigateMentionHistory = (redo: boolean): boolean => {
    const draft = borrador();
    const history = draft.mentionHistory ?? [];
    const future = draft.mentionFuture ?? [];
    if (![...history, ...future, draft].some(item => item.task_mentions?.length || item.recipients?.length)) return false;
    const next = (redo ? future : history).at(-1);
    if (!next) return false;
    const current = { text: draft.input, task_mentions: draft.task_mentions, recipients: draft.recipients };
    editarBorrador(claveAbierta(), b => ({ ...b, input: next.text, task_mentions: next.task_mentions, recipients: next.recipients,
      mentionHistory: redo ? [...history, current] : history.slice(0, -1),
      mentionFuture: redo ? future.slice(0, -1) : [...future, current],
    }));
    return true;
  };
  const sourceIds = createMemo(() => borrador().sourceIds, undefined, {
    equals: sameSources,
  });
  const excludedSourceIds = createMemo(() => borrador().excludedSourceIds, undefined, {
    equals: sameSources,
  });
  const archivos = () => borrador().archivos;
  const setArchivos = (v: string[]) =>
    editarBorrador(claveAbierta(), (b) => ({ ...b, archivos: v }));
  async function agregarArchivos(paths: string[]) {
    const key = claveAbierta();
    const workspace = workspaceActivo();
    const prepared = await invoke<string[]>("prepare_attachments", {
      project: project(),
      paths,
    });
    if (workspace !== workspaceActivo()) return;
    editarBorrador(key, (b) => ({
      ...b,
      archivos: [...new Set([...b.archivos, ...prepared])],
    }));
  }
  // Lo que la tarea YA lee, distinto de lo que está por adjuntarse: los chips
  // de la caja se vacían al mandar, esto es material de la conversación y se
  // queda a la vista mientras dure. Sin esto, adjuntar se veía como mandar un
  // archivo: el chip desaparecía sin dejar nada diciendo que el agente lo
  // está leyendo.
  const [adjuntas, setAdjuntas] = createSignal<string[]>([]);
  const conFuente = (ids: string[]) =>
    ids
      .map((id) => sources().find((s) => s.id === id))
      .filter((s): s is Source => !!s);
  const idsDelProyecto = createMemo(
    () => projectList().find((p) => p.id === project())?.sources ?? [],
  );
  const heredadas = createMemo(() =>
    fuentesHeredadas(projectList(), project(), excludedSourceIds()),
  );
  const materialPendiente = createMemo(() => conFuente(sourceIds()));
  const contexto = createMemo(() =>
    conFuente(unirFuentes(heredadas(), adjuntas())),
  );

  const [agents, setAgents] = createSignal<Agent[]>([]);
  const [agent, setAgent] = createSignal("claude");
  // Lo que se puede elegir para trabajar. `null` mientras no se ha leído. Es
  // la lista entera, con lo que no se puede usar dentro: quién filtra es cada
  // pantalla, y filtran distinto a propósito (`runtime/surfaces.rs`).
  const [superficies, setSuperficies] = createSignal<Superficie[] | null>(null);
  // Con cuál se está trabajando. No se guarda en la sesión: lo que la tarea
  // persiste es el agente y el modelo, y de ahí se deriva esto al abrirla
  // (`superficies.superficieDe`). Partir la fila de OpenCode en dos no dejó
  // ninguna tarea apuntando a un nombre que ya no existe.
  const [superficie, setSuperficie] = createSignal("");
  // Modelo y razonamiento viven aquí, no dentro de la caja: al reanudar una
  // sesión hay que restaurar con qué corrió, y eso lo sabe quien la carga.
  const [catalogos, setCatalogos] = createSignal<CatalogosDeModelos>({});
  const models = createMemo(() => catalogos()[agent()] ?? null);
  const modelosParaAgentes = createMemo(() => ({
    superficies: superficies() ?? [],
    catalogos: catalogos(),
  }));
  const [model, setModel] = createSignal("");
  const [effort, setEffort] = createSignal("");
  // Cada hilo separa lo persistido de lo que construyen los eventos del turno
  // en curso: si lo propio viviera en `vivo`, releer del disco al volver a
  // una tarea que sigue contestando lo pintaría dos veces, una del disco y
  // otra de la memoria.

  // Un hilo por sesión y no una señal para la abierta: sin eso, lo que
  // contesta una tarea que no se mira no tiene dónde caer, y volver a ella
  // enseña la pregunta sin la respuesta hasta que el turno cierre. Tienen
  // hilo la abierta, las de una pestaña, y las que siguen contestando;
  // cambiar de workspace los suelta todos (`aplicar`).
  type Hilo = { base: Msg[]; vivo: Msg[] };
  const SIN_HILO: Hilo = { base: [], vivo: [] };
  const workspaceThreads = new Map<string, Record<string, Hilo>>();
  const [hilos, setHilos] = createSignal<Record<string, Hilo>>({});
  // El hilo de la conversación abierta, memo aparte y no derivado en línea:
  // `setHilos` reemplaza el registro entero en cada evento pero conserva por
  // referencia el `Hilo` que no tocó, y un memo sobre el objeto no propaga
  // cuando lo que cambió fue el de otra tarea. Sin él, `msgs` recalculaba con
  // cada delta de cualquier tarea del workspace: la transcripción saltaba al
  // final aunque nada hubiera cambiado aquí.
  const hiloAbierto = createMemo(() => hilos()[claveDelHilo()]);
  const msgs = createMemo<Msg[]>(() => {
    const h = hiloAbierto();
    return h ? [...h.base, ...h.vivo] : [];
  });
  // De qué tarea se está trayendo la transcripción del disco, si de alguna.
  // `msgs` no distingue «no tiene mensajes» de «todavía no han llegado»:
  // abrir una tarea es síncrono hasta `setSessionId`, y hasta que
  // `load_session` vuelve el chat pinta su estado de conversación nueva.
  // Guarda el id y no un booleano: las aperturas se solapan, y la respuesta
  // tardía de la primera no debe apagar el indicador de la segunda.
  const [cargandoHilo, setCargandoHilo] = createSignal<string | null>(null);
  /** Lo que construyen los eventos del turno en curso. */
  const anexar = (session: string, fn: (vivo: Msg[]) => Msg[], workspace = workspaceActivo()) => {
    if (workspace && workspace !== workspaceActivo()) {
      const threads = workspaceThreads.get(workspace) ?? {};
      const thread = threads[session] ?? SIN_HILO;
      workspaceThreads.set(workspace, { ...threads, [session]: { ...thread, vivo: fn(thread.vivo) } });
      return;
    }
    setHilos((hs) => {
      const h = hs[session] ?? SIN_HILO;
      return { ...hs, [session]: { ...h, vivo: fn(h.vivo) } };
    });
  };
  /** Lo que ya está —o va a estar— en disco. */
  const asentar = (session: string, fn: (base: Msg[]) => Msg[]) =>
    setHilos((hs) => {
      const h = hs[session] ?? SIN_HILO;
      return { ...hs, [session]: { ...h, base: fn(h.base) } };
    });
  // La transcripción recién leída del disco. `vivo` se vacía solo al
  // cerrarse el turno; al abrir una tarea que sigue contestando se
  // conserva, salvo el tramo que `AskUserQuestion` ya persistió
  // (`guardar_segmento_pregunta`): ese turno llega por partida doble, de
  // `base` y de `vivo`. Se identifican por `turno`; a `base` se le copia
  // su `questionRequestId`, o la respuesta cae al canal de archivo.
  const releer = (session: string, leida: Msg[], vaciarVivo: boolean) =>
    setHilos((hs) => {
      const previo = hs[session];
      const vivoPrevio = previo?.vivo ?? [];
      const ataduras = new Map(
        vivoPrevio
          .filter((m) => m.turno && m.questionRequestId)
          .map((m) => [m.turno as string, m.questionRequestId]),
      );
      const persistidos = new Set(
        leida.map((m) => m.turno).filter((t): t is string => !!t),
      );
      const atada =
        ataduras.size === 0
          ? leida
          : leida.map((m) =>
              m.turno && ataduras.has(m.turno)
                ? { ...m, questionRequestId: ataduras.get(m.turno) }
                : m,
            );
      // El chat identifica filas por referencia: un objeto nuevo por mensaje remonta el hilo entero.
      const base = conservarEnOrden(previo?.base ?? [], atada);
      const vivo = vaciarVivo
        ? []
        : vivoPrevio.filter((m) => !m.turno || !persistidos.has(m.turno));
      const mismoVivo = vivo.length === vivoPrevio.length;
      if (previo && base === previo.base && mismoVivo) return hs;
      return { ...hs, [session]: { base, vivo: mismoVivo ? vivoPrevio : vivo } };
    });
  // Por tarea: `undefined` es que aún no se abrió, `null` que salió de `session.json`.
  const [origenes, setOrigenes] = createSignal<Readonly<Record<string, TranscriptOrigin | null>>>({});
  function loadResult(id: string, session: Session, clear: boolean, generation: number) {
    if (generation !== sessionGeneration) return;
    releer(id, transcripcion(session.turns), clear);
    const origen = session.transcript ?? null;
    setOrigenes((o) =>
      id in o && o[id]?.file === origen?.file && o[id]?.from_cli === origen?.from_cli ? o : { ...o, [id]: origen },
    );
    if (id !== sessionId() || !(session.subagent || session.parent)) return;
    const modelo = modeloDeSubtarea(session);
    if (modelo) setModel(modelo);
    if (session.effort) setEffort(session.effort);
  }
  const soltarHilo = (session: string) =>
    setHilos((hs) => {
      if (!(session in hs)) return hs;
      const { [session]: _, ...resto } = hs;
      return resto;
    });
  // Lo contestado a medias de cada pregunta, por sesión y turno: los ids
  // `q1..qN` se repiten entre turnos. Aquí y no en la tarjeta, que se desmonta
  // con su pestaña.
  const [preguntasAMedias, setPreguntasAMedias] = createSignal<ReadonlyMap<string, PreguntasAMedias>>(new Map());
  const claveDePregunta = (session: string, turno: string) => `${session}\u0000${turno}`;
  const almacenDePreguntas = (session: () => string | null): AlmacenDePreguntas => ({
    leer: (turno) => preguntasAMedias().get(claveDePregunta(session() ?? "", turno)),
    escribir: (turno, aMedias) =>
      setPreguntasAMedias((m) => new Map(m).set(claveDePregunta(session() ?? "", turno), aMedias)),
  });
  const soltarPreguntas = (session: string, turno?: string) =>
    setPreguntasAMedias((m) => {
      const suyas = [...m.keys()].filter((k) =>
        turno === undefined ? k.startsWith(`${session}\u0000`) : k === claveDePregunta(session, turno),
      );
      if (suyas.length === 0) return m;
      const resto = new Map(m);
      for (const k of suyas) resto.delete(k);
      return resto;
    });
  // Cuánto se aprueba a mano, y qué modos puede el agente elegido. Vive aquí
  // por lo mismo que el modelo: al reanudar una tarea hay que restaurar con
  // qué corrió. La lista se pide al backend: lo que cada CLI sostiene es dato
  // suyo (`agents::Permisos`), y escrita aquí sería una segunda copia que un
  // día diría otra cosa.
  const [modo, setModo] = createSignal("");
  const [modos, setModos] = createSignal<ModoDePermiso[]>([]);
  // Qué tareas están contestando ahora mismo, por id. Era un `busy` de la
  // aplicación entera: con un turno vivo, la caja de CUALQUIER otra tarea
  // enseñaba «Detener turno» en `type="button"`, y empezar algo mientras el
  // agente pensaba era imposible. El backend nunca tuvo ese límite
  // —`chat::vivos()` es un conjunto de sesiones, cada turno corre en su
  // propio hilo—: lo que faltaba estaba aquí.
  const [vivas, setVivas] = createSignal<string[]>([]);
  const finishedTurns = new Map<string, boolean | null | undefined>();
  // Turnos que la reconciliación cerró sin su `done`, que llega cada sondeo del servicio.
  const sinDesenlace = new Set<string>();
  const [settlingTurns, setSettlingTurns] = createSignal<string[]>([]);
  let lifecycleRevision = 0;
  const turnRevisions = new Map<string, number>();
  function advanceTurn(id: string) {
    lifecycleRevision++;
    const revision = (turnRevisions.get(id) ?? 0) + 1;
    turnRevisions.set(id, revision);
    return revision;
  }
  const pendingStarts = new Map<string, symbol>();
  const [injecting, setInjecting] = createSignal<{ session: string; id: string }[]>([]);
  const queueBusy = () => busy() || settlingTurns().includes(sessionId() ?? "") || injecting().some((item) => item.session === sessionId());
  const [desdeDeTurno, setDesdeDeTurno] = createSignal<Record<string, number>>({});
  const liveThreads = new Set<string>();
  const liveThreadKey = (workspace: string, session: string) => `${workspace}/${session}`;
  // El turno que ya arrancó y todavía no tiene sesión en disco. El primer
  // mensaje de una tarea crea la sesión en Rust: entre que sale y vuelve el
  // id no hay a qué apuntar. Sin esto, esa ventana deja la caja libre y un
  // segundo Enter manda dos primeros turnos.
  const [arrancando, setArrancando] = createSignal(false);
  /** Si la tarea que se está mirando está contestando. */
  const busy = () => {
    const id = sessionId();
    return id ? vivas().includes(id) : arrancando();
  };
  const marcarViva = (id: string, desde = Date.now()) =>
    batch(() => {
      const workspace = workspaceActivo();
      if (workspace) liveThreads.add(liveThreadKey(workspace, id));
      // Otro turno: el `done` que llegue ya no es del que cerró sin desenlace.
      sinDesenlace.delete(id);
      setVivas((v) => (v.includes(id) ? v : [...v, id]));
      setDesdeDeTurno((d) => (id in d ? d : { ...d, [id]: desde }));
    });
  const marcarQuieta = (id: string) =>
    batch(() => {
      const workspace = workspaceActivo();
      if (workspace) liveThreads.delete(liveThreadKey(workspace, id));
      setVivas((v) => v.filter((x) => x !== id));
      setDesdeDeTurno((d) => {
        if (!(id in d)) return d;
        const { [id]: _, ...resto } = d;
        return resto;
      });
    });
  /**
   * ¿Este evento es de la tarea que se está mirando? Solo filtra el
   * consumo y la ventana de contexto; el chat cae directo en el hilo de
   * su sesión. Un `sessionId() &&` delante aceptaría TODO: «sin tarea» y
   * «tarea recién arrancada» son indistinguibles.
   */
  const esDeLaAbierta = (session: string) => session === sessionId();

  /**
   * ¿Este evento es del workspace que se está mirando? Segundo cinturón,
   * no reemplazo de `esDeLaAbierta`: workspace puede cambiar con una tarea
   * contestando, y solo evitaba pintarse aquí por suerte —ids de sesión
   * aleatorios sin colisión, no una comprobación real.
   */

  /**
   * Solo descarta cuando sabe contra qué comparar, y en esa dirección tiene
   * que fallar: equivocarse hacia «pasa» cuesta lo que el filtro por
   * sesión ya cubría; hacia «descarta» deja corriendo un turno mudo, sin
   * nada que lo explique.
   */

  /**
   * Rust deja el campo fuera cuando el evento no viene de un turno de
   * fondo, y ahí no hay nada que descartar (`chat::emitir_chat`). La
   * cadena vacía cuenta igual —consumo escrito antes de los workspaces—:
   * esconder un gasto real por no saber de quién es sería peor.
   */
  const esDelWorkspaceAbierto = (ws?: string) => {
    const abierto = workspaceActivo();
    return !ws || !abierto || ws === abierto;
  };
  /** Qué tarea se pidió detener. Es de una, no de la app: ver `vivas`. */
  const [deteniendo, setDeteniendo] = createSignal<string | null>(null);
  const stopping = () => deteniendo() !== null && deteniendo() === sessionId();
  // El `!` que ocupa cada tarea mientras corre, pintado con sus `shell_*`.
  const [terminales, setTerminales] = createSignal<Record<string, ComandoEnVivo>>({});
  const [carpetasDeTerminal, setCarpetasDeTerminal] = createSignal<Record<string, string>>({});
  // Con qué se escribió cada `!` que lanzó esta ventana: es con lo que el agente
  // contesta a su salida. Otra ventana no pide esa respuesta.
  const lanzados = new Map<string, TerminalLanzada>();
  // Por el id de ejecución que esta ventana propuso: es lo que trae el
  // `shell_started` de la tarea que su `!` acaba de abrir.
  const nacenConComando = new Map<string, ComandoQueNace>();
  const detenidos = new Set<string>();
  const comandosDeLaCola = new Map<string, string>();
  const [permissions, setPermissions] = createSignal<PermissionRequest[]>([]);
  const [respondiendoPermiso, setRespondiendoPermiso] = createSignal(false);
  const [permissionError, setPermissionError] = createSignal<string | null>(null);
  // De cuánta ventana de contexto va la conversación, aparte del total: no
  // es un acumulado. Cada turno reenvía la conversación entera, y el
  // último reporte ya es el total —sumarlos daría una ventana imposible.

  // Se llama `ventana` y no `contexto`: en este archivo «contexto» ya es
  // el material que la tarea lee.
  const [ventana, setVentana] = createSignal<Ventana>(null);

  // Lo escrito durante un turno, que sale cuando el turno cierre. Vive
  // aquí y no dentro de la caja: es de la SESIÓN.
  const [cola, setCola] = createSignal<Encolado[]>([]);
  // De qué sesión es la cola que se tiene en la mano. `null` es una
  // conversación que todavía no existe en disco.
  const [colaDe, setColaDe] = createSignal<string | null>(null);
  /**
   * Por qué la cola no avanza sola: `fallo` es un turno que no cerró bien
   * —mandar algo encima de lo reventado compone el daño—; `borrador` se
   * cargó de disco y podría dispararse contra un proyecto ya cambiado;
   * `pregunta` es la única que no se suelta a mano, se sale contestando;
   * `session` espera a que termine otro turno de esta misma sesión.
   */
  const [retenida, setRetenida] = createSignal<
    null | "fallo" | "borrador" | "pregunta" | "session"
  >(null);
  type SavedQueue = { project: string; items: Encolado[]; retained: RazonDeRetencion | null };
  const savedQueues = new Map<string, SavedQueue>();
  const drainingQueues = new Set<string>();
  // La retención de cada cola de los workspaces que se dejaron. Sin ella, volver
  // la leía de disco como `borrador` y se quedaba parada (`retencionAlCargar`).
  const workspaceRetentions = new Map<string, Map<string, RazonDeRetencion | null>>();
  // La tarea cuya cola se abrió en `borrador` por venir de disco (`sueltaElBorrador`).
  let draftFromDisk: string | null = null;

  createEffect(on([cola, colaDe, retenida], ([items, owner, retained]) => {
    if (owner && owner === sessionId()) savedQueues.set(owner, { project: project(), items, retained });
  }));

  /** El título de la sesión ocupada. */
  const [esperandoA, setEsperandoA] = createSignal<string | null>(null);
  /**
   * Cuántos turnos cerraron, de cualquier tarea de este cliente. Es lo que
   * despierta una cola retenida por `session`: Rust libera la sesión antes
   * de emitir el `done`, y al recibirlo ya se puede volver a pedir.
   */
  const [cierres, setCierres] = createSignal(0);
  // En qué cierre se retuvo por `session`: el despacho solo reintenta en uno
  // posterior. No es señal a propósito: leerla no debe volver a correr nada.
  let cierreDeLaRetencion = -1;
  // El CLI está reintentando contra su proveedor, en esta sesión: los eventos
  // de otra tarea siguen llegando a esta ventana, y sin la sesión un turno de
  // fondo que reintenta encendería el rótulo del que se está mirando. `null`
  // es lo normal: solo Claude anuncia sus reintentos, y solo mientras duran.
  const [reintento, setReintento] = createSignal<{
    session: string;
    intento: number;
    total: number;
    clase: string;
  } | null>(null);
  // Tareas cuyo agente ya contestó y solo espera a una hija en segundo plano: el
  // turno sigue abierto, pero un mensaje entra ya en vez de esperar al cierre.
  const [enFondo, setEnFondo] = createSignal<string[]>([]);
  // Editar pausa la cola: si el turno cierra a mitad de la edición, no se manda
  // el texto a medias.
  const [editando, setEditando] = createSignal(false);
  const [skills, setSkills] = createSignal<Skill[]>([]);
  const [cliCommands, setCliCommands] = createSignal<CliCommand[]>([]);
  const [sideCommand, setSideCommand] = createSignal<string | null>(null);
  // Sin comandos es «no se pudo saber»: el que no publica lista y el que todavía
  // no la mandó se ven igual desde aquí, y el menú enseña las skills igual. Se
  // vuelve a pedir al cerrar cada turno: los de ACP la publican dentro de uno.
  const cargarComandos = (a: string) => {
    const poner = (menu: SlashMenu) => {
      // La respuesta de un agente que ya no es el de la caja ofrecería sus comandos.
      if (a !== agent()) return;
      setCliCommands(menu.commands);
      setSkills(menu.skills);
      setSideCommand(menu.side_question ?? null);
    };
    void invoke<SlashMenu>("list_slash_menu", { agent: a })
      .then(poner)
      .catch(() => poner({ commands: [], skills: [] }));
  };
  // La pregunta al margen vive en memoria y es de una tarea: al cambiar de
  // tarea se pierde, y la respuesta que llegue tarde no se pinta en otra.
  const [alMargen, setAlMargen] = createSignal<AlMargen | null>(null);
  let preguntasAlMargen = 0;
  createEffect(on(sessionId, (id) => {
    if (alMargen() && alMargen()?.session !== id) cerrarAlMargen();
  }));
  function cerrarAlMargen() {
    preguntasAlMargen++;
    setAlMargen(null);
  }
  async function preguntarAlMargen(question: string) {
    const session = sessionId();
    const turno = ++preguntasAlMargen;
    if (!session) {
      setAlMargen({ session: "", question, answer: null, failure: { what: { clave: "chat.side.error.no_session" }, detail: "" } });
      return;
    }
    setAlMargen({ session, question, answer: null, failure: null });
    const vigente = () => turno === preguntasAlMargen && sessionId() === session;
    try {
      const { answer } = await invoke<{ answer: string }>("ask_side_question", { project: project(), session, question });
      if (vigente()) setAlMargen({ session, question, answer, failure: null });
    } catch (e) {
      if (vigente()) setAlMargen({ session, question, answer: null, failure: asFailure(e) });
    }
  }
  function pasarAlHilo() {
    const m = alMargen();
    if (!m?.answer) return;
    const texto = t("chat.side.thread_text", { question: m.question, answer: m.answer });
    setInput(alHilo(input(), texto));
    cerrarAlMargen();
  }
  // Lo que se puede mencionar. Sale de las fuentes que ESTA tarea tiene
  // adjuntas y solo de ellas: la frontera de lo mencionable es la del agente.
  const [mentionSources, setMentionSources] = createSignal<MentionSources | null>(null);
  const [taskCandidates, setTaskCandidates] = createSignal<TaskCandidate[]>([]);
  let taskCandidateRequest = 0;
  const refreshTaskCandidates = async () => {
    const request = ++taskCandidateRequest;
    const workspace = workspaceActivo();
    const session = sessionId();
    try {
      const items = await invoke<TaskCandidate[]>("list_task_mentions");
      if (request === taskCandidateRequest && workspace === workspaceActivo() && session === sessionId()) setTaskCandidates(items);
    } catch {
      if (request === taskCandidateRequest) setTaskCandidates([]);
    }
  };
  /**
   * Los encargados de la carpeta abierta, para el menú de `@`. Sale de la
   * misma llamada que el riel ya hace, y el último listado conocido cubre la
   * lectura que falle: mejor el nombre de ayer que un menú sin encargados.
   */
  const [rosterDelProyecto] = createResource(project, async (id) => {
    if (!id) return [] as HandlerDefinition[];
    try {
      const listado = (await invoke<HandlerList>("list_encargados", { project: id })).encargados;
      rememberRoster(id, listado);
      return listado;
    } catch {
      return lastRoster(id) ?? [];
    }
  });
  /**
   * La presencia sigue a la carpeta abierta: suscribirse a una fija dejaría
   * las caras del proyecto anterior. Misma forma que `watchHandlerStatus`.
   */
  const [presenciaDeEncargados, setPresenciaDeEncargados] = createSignal<HandlerStatusRow[]>([]);
  createEffect(() => {
    const id = project();
    if (!id) {
      setPresenciaDeEncargados([]);
      return;
    }
    const filas = watchHandlerStatuses(id);
    createEffect(() => setPresenciaDeEncargados(filas()));
  });
  const recipientCandidates = createMemo<RecipientCandidate[]>(() =>
    (rosterDelProyecto() ?? lastRoster(project()) ?? []).map((e) => ({
      name: e.name,
      description: e.description,
      // `undefined` no es un estado: es que todavía no se sabe, y el menú
      // pinta la cara despierta en vez de inventar que duerme.
      status: presenciaDeEncargados().find((r) => r.name === e.name)?.status,
    })),
  );
  const placeCandidates = createMemo<PlaceCandidate[]>(() => {
    return projectList().map(f => ({ target: { kind: "folder" as const, projectId: f.id }, name: f.name, detail: "", updatedAt: f.updated_at }));
  });
  createEffect(on([workspaceActivo, sessionId, sesiones], () => {
    taskCandidateRequest++;
    setTaskCandidates([]);
    if (input().includes("@")) void refreshTaskCandidates();
  }));

  const [folder, setFolder] = createSignal<string | null>(null);

  const sidebar = createSidebar();
  const carpetaDelProyecto = () =>
    carpetaDeTrabajo(projectList().find((p) => p.id === project()) ?? {});
  // Lo único que el panel derecho tiene para enseñar: el árbol de una tarea, o
  // la previsualización de la carpeta de trabajo antes de empezarla. Es la
  // regla que deshabilita el conmutador, y la que impide que un estado
  // recordado abra una columna vacía.
  const columnaConContenido = () => !paginaDeAgente() && Boolean(sessionId() || carpetaDelProyecto());
  // Abierta o cerrada es preferencia de esta máquina, igual que el historial
  // (`lib/prefs.ts`). Sin recordarla, cada tarea nueva y cada cambio de
  // proyecto reabrían la columna que se acababa de cerrar. La llave nombra la
  // columna entera: el panel de tareas de agente comparte estado con el árbol.
  const [arbolQuerido, setArtOpen] = createPref<boolean | null>(
    "shell.right.open",
    null,
  );
  // Sin decidir es lo único que deja abrirse a la previsualización de la
  // carpeta antes de empezar la tarea (`code/TaskPreview.tsx`). Cerrarla
  // escribe `false`, y con eso deja de reaparecer sola.
  const arbolDePartida = () => !sessionId() && Boolean(carpetaDelProyecto());
  const artOpen = () =>
    columnaConContenido() && (arbolQuerido() ?? arbolDePartida());
  const alternarElArbol = () => {
    if (artOpen()) setArtOpen(false);
    else if (columnaConContenido()) setArtOpen(true);
  };

  onMount(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !(e.metaKey || e.ctrlKey)) return;
      if (settings() !== null || alta() !== null) return;
      const accion = accionDeAtajo(e);
      if (accion) {
        e.preventDefault();
        if (accion === "newTask") nuevaSesion();
        else if (accion === "closeTab") closeActiveTab();
        else if (accion === "sidebar") sidebar.alternar();
        else alternarElArbol();
        return;
      }
      const nav = navegacionDePestanas(e);
      if (nav) {
        e.preventDefault();
        irAPestanaDe(nav);
        return;
      }
      const salto = ventanaVecina(e);
      if (salto) {
        e.preventDefault();
        irAVentanaVecina(salto);
        return;
      }
      if (e.altKey || (e.key.toLowerCase() !== "d" && e.code !== "Backslash")) return;
      e.preventDefault();
      if (e.shiftKey) juntarLaActiva();
      else partirLaActiva();
    };
    window.addEventListener("keydown", alTeclear);
    onCleanup(() => window.removeEventListener("keydown", alTeclear));
  });

  // `null` = cerrada. Una cadena es además con qué destino abrirla.
  const [settings, setSettings] = createSignal<string | null>(null);
  const [anadiendoCarpeta, setAnadiendoCarpeta] = createSignal(false);
  /** El clon en vuelo, que el riel enseña mientras no hay proyecto que listar. */
  const [clonEnCurso, setClonEnCurso] = createSignal<ClonEnCurso | null>(null);
  // Cerrar la configuración es el único momento en que las cuentas pudieron
  // cambiar sin que el resto de la app se entere.
  const [cuentasTocadas, setCuentasTocadas] = createSignal(0);

  // Los oyentes se montan una vez y leen las señales al recibir cada evento:
  // guardar fuera el valor de `sessionId()` o `agents()` los dejaría
  // trabajando con el estado del montaje. `firmas` y `encolados` son
  // variables y no señales: nada pinta sus valores, solo los consultan las
  // funciones de respuesta.

  // Con qué se firma lo que llega de cada tarea, por sesión: con una sola
  // firma, arrancar un segundo turno pisa la del primero, y al volver a la
  // primera su texto sale con el autor del otro agente. La clave `""` es la
  // del turno sin sesión en disco; se muda a su id en cuanto Rust lo
  // devuelve.
  const firmas: Record<string, Author | null> = {};
  // Con qué modelo se lanzó el turno en vivo, con las mismas claves que
  // `firmas`: la fila del mensaje lo enseña hasta que el cierre guarde el observado.
  const modelosEnVivo: Record<string, string | null> = {};
  let encolados = 0;

  // Hay una pregunta del agente que nadie contestó. Se deriva de la
  // transcripción, no se guarda: una marca de "pendiente" aparte sería un
  // segundo estado capaz de contradecir a los turnos, dejando seguir el
  // trabajo sin el dato que el agente pidió. Mismo criterio que
  // `sin_contestar` en `workspace/sessions.rs`.
  const preguntasPendientes = (messages: Msg[]) => {
    const contestadas = new Set(
      messages
        .flatMap((m) => m.respuestas ?? [])
        .map((r) => clave(r.turn, r.question)),
    );
    return messages.some(
      (m) =>
        !!m.turno &&
        (m.preguntas ?? []).some((p) => !contestadas.has(clave(m.turno!, p.id))),
    );
  };
  const esperando = createMemo(() => preguntasPendientes(msgs()));
  /**
   * Qué tareas tienen una pregunta sin contestar, para la tira. De la abierta
   * manda lo derivado de su conversación —es más fresco que el historial, que
   * se relee al cerrar el turno—; de las demás, lo que dice su fila.
   */
  const preguntadas = createMemo(() => {
    const abierta = sessionId();
    const otras = Object.values(sesiones())
      .flat()
      .filter((r) => r.esperando && r.id !== abierta)
      .map((r) => r.id);
    const ids = new Set(otras);
    for (const [id, hilo] of Object.entries(hilos())) {
      if (preguntasPendientes([...hilo.base, ...hilo.vivo])) ids.add(id);
    }
    if (abierta && esperando()) ids.add(abierta);
    return [...ids].sort();
  }, undefined, { equals: (a, b) => a.length === b.length && a.every((id, i) => id === b[i]) });

  function sesionesConEstado() {
    const pending = new Set(preguntadas());
    const unseen = attention.unseen(workspaceActivo());
    const listas = sesiones();
    const nuevas = naciendo();
    const proyectos = new Set([...Object.keys(listas), ...nuevas.map((n) => n.project)]);
    return Object.fromEntries([...proyectos].map((project) => {
      const rows = listas[project] ?? [];
      // Delante: `list_live_sessions` ordena por cuándo nacieron, y estas acaban de
      // nacer. La misma fila dos veces mientras el refresco llega se evita
      // mirando lo que ya trajo el disco.
      const enDisco = new Set(rows.map((row) => row.id));
      const propias = nuevas
        .filter((n) => n.project === project && !enDisco.has(n.row.id))
        .map((n) => n.row);
      return [project, [...propias, ...rows.map(row => {
        const preview = vistaPreviaDelHilo(hilos()[row.id]?.vivo ?? []) ?? row.last_message;
        const sinVer = unseen.has(row.id);
        return row.esperando === pending.has(row.id) && preview === row.last_message && !!row.sin_ver === sinVer ? row : {
          ...row, esperando: pending.has(row.id), last_message: preview, sin_ver: sinVer,
        };
      })]];
    }));
  }

  let sessionGeneration = 0;
  const sessionLists = sessionRefresh<SessionRow>({
    read: async (project) => {
      const open = sesionesConPestana();
      const rows = await invoke<SessionRow[]>("list_live_sessions", { project, open });
      pedidas.set(project, new Set(open));
      for (const id of open) esperandoFila.delete(id);
      return rows;
    },
    apply: (update) => setSesiones(update),
    projects: () => grupos(),
    key: (row) => row.id,
    // Una mutación del CLI avisa dos veces seguidas, y varios agentes a la vez, una ráfaga.
    gather: 200,
  });
  onCleanup(() => sessionLists.reset());
  function refreshSessions(proyectos: string[]) {
    return sessionLists.refresh(proyectos);
  }
  /** La relectura que pide un evento del servicio; la de un gesto de la persona va sin espera. */
  function refreshSessionsOnEvent(proyectos: string[]) {
    return sessionLists.gathered(proyectos);
  }
  // Un hueco del stream o un motor nuevo se lleva los eventos `session` de en medio: se
  // relee lo que habrían refrescado. Las tareas vivas las reconcilia `reconcileActiveTurns`.
  function releerTrasHueco() {
    const generation = sessionGeneration;
    void refreshSessionsOnEvent(grupos());
    for (const pestana of pestanas.open()) avisarDeLosArboles(pestana.id);
    const abierta = sessionId();
    if (!abierta || vivas().includes(abierta)) return;
    avisarDeLosArboles(abierta);
    void invoke<Session>("load_session", { project: project(), id: abierta })
      .then((s) => loadResult(abierta, s, true, generation))
      .catch(() => {});
  }

  // La miniatura de un adjunto del mensaje, o `null` si no hay que enseñar
  // una: null no es un fallo, y no se distingue del error. Un PDF, un `.docx`
  // o una imagen que no cabe se pintan igual —con su tarjeta—, y quien llama
  // no decide con la diferencia. Lo que sí sería un fallo es tumbar la
  // transcripción por un archivo que ya no está. Resuelve contra la tarea
  // abierta: de esa son los mensajes que `Chat` está pintando.
  async function miniaturaDeAdjunto(rel: string): Promise<string | null> {
    try {
  // Un adjunto se guarda por su ruta del sistema. Los turnos anteriores a
  // v0.1.23 guardaron una relativa `entradas/…`, y esas van por
  // `attachment_preview`, que resuelve la ruta él para no ser un lector de
  // archivos abierto a la ventana.
      const esDeLaTarea = rel.startsWith("entradas/");
      const id = sessionId();
      if (esDeLaTarea && !id) return null;
      const p = esDeLaTarea
        ? await invoke<Preview>("attachment_preview", {
            project: project(),
            id,
            rel,
          })
        : await invoke<Preview>("preview_file", { path: rel, rel });
      return p.data_url ?? null;
    } catch {
      return null;
    }
  }

  function pegarImagen(mime: string, datos: string): Promise<string> {
    return invoke<string>("guardar_imagen_pegada", { mime, datos });
  }

  // La carpeta de trabajo de la tarea: se abre afuera desde la cabecera y la
  // columna, y resuelve lo que el hilo anuncia por su ruta relativa
  // (`abrirPorRel`).
  async function refreshFolder(p: string, id: string) {
    try {
      setFolder(await invoke<string>("session_folder", { project: p, id }));
    } catch {
      setFolder(null);
    }
  }

  function abrirCarpeta() {
    const f = folder();
    if (f) void invoke("open_external", { target: f }).catch((e) => setError(prosaDe(e)));
  }

  // La confirmación es el icono durante un instante: un aviso aparte para un
  // gesto de un clic es la glosa que el sistema visual descarta.
  const [rutaCopiada, setRutaCopiada] = createSignal(false);
  async function copiarRuta() {
    const f = folder();
    if (!f) return;
    try {
      await copyText(f);
      setRutaCopiada(true);
      setTimeout(() => setRutaCopiada(false), 1500);
    } catch (e) {
      setError(prosaDe(e));
    }
  }

  // Vuelve a leer el material del workspace sin tocar lo que hay abierto: es
  // la mitad de `aplicar` que no es una mudanza. Traer un repositorio cambia
  // lo que el workspace tiene, no en qué workspace estás. Aquí un fallo no
  // vacía las listas, al revés que en `aplicar`: allá lo que quedara en
  // pantalla sería de otro cliente, aquí es de este.
  async function recargarMaterial() {
    const generation = sessionGeneration;
    try {
      const [proyectos, fuentes] = await Promise.all([
        invoke<Project[]>("list_projects"),
        invoke<Source[]>("list_sources"),
      ]);
      if (generation !== sessionGeneration) return;
      setProjectList(proyectos);
      setSources(fuentes);
  // También la raíz, que es material de este workspace: `context_root` solo
  // lo escribía `aplicar()` —arranque y cambio de workspace—. Elegir la
  // fuente principal desde Configuración refrescaba la lista pero el renglón
  // «Sin fuente de contexto» seguía ahí hasta reiniciar la app: la firma de
  // un dato que nadie recarga.
      const arranque = await invoke<Startup>("list_workspaces");
      if (generation !== sessionGeneration) return;
      setContextRoot(
        arranque.workspaces.find((w) => w.id === arranque.active)?.context_root ??
          null,
      );
    } catch (e) {
      setError(prosaDe(e));
    }
  }

  // Deja la pantalla como la de este workspace, y solo la de este.

  // Cambiar de workspace no filtra una lista: cambia la carpeta en disco.
  // Lo que hay puesto —sesión, conversación, artefactos, consumo, cola,
  // material pendiente— es de otro cliente y no puede quedarse ni un
  // render: lo que se quede escribe en el cliente equivocado y sin verse.

  // La cola: el efecto que la guarda resuelve la carpeta por el workspace
  // activo, y una `colaDe` que nombre una tarea del anterior escribe un
  // `.cola.json` en `<workspace nuevo>/sessions/<tarea del viejo>/` —una
  // carpeta sin `session.json`, que `list_live_sessions` salta sin error.

  // El material pendiente (`sourceIds`): los chips desaparecen solos
  // —`conFuente` los cruza contra las fuentes del workspace nuevo—, pero
  // los ids seguirían viajando en el `send_message` siguiente, y
  // `projects::reach` se salta el que no conoce en silencio.

  // Los archivos del borrador, incluida la conversación exportada al
  // continuar una tarea en otra: es una ruta absoluta del workspace
  // anterior, y mandarla copia su contenido a la carpeta de la tarea
  // nueva.

  // Los tres van en `borradores` y se vacían todos. No vale para «cambió el
  // material»: traer un repositorio a mitad de una tarea por aquí cierra la
  // conversación y deja la anterior abandonada, sin error y sin aviso. Para
  // eso está `recargarMaterial`.
  async function aplicar(a: Startup) {
    const activo = a.workspaces.find((w) => w.id === a.active);
  // Sin workspace se abre el alta. Si ya estaba abierta no se toca: el paso 1
  // acaba de crear uno, y volver a mirar aquí la cerraría a mitad.
    if (a.active === null) setAlta((x) => x ?? "primera");
    setContextRoot(activo?.context_root ?? null);
    setWorkspaceMode(activo?.default_permission_mode ?? null);
  // La lengua es del workspace, y cambia al cambiar de cliente: eso es lo que
  // se pidió, no un efecto secundario. `null` hereda la de la máquina.
    aplicarLenguaDeWorkspace(activo?.lengua ?? null);
  // El tema de terminal sigue al workspace por lo mismo: es cómo se distingue
  // en qué cliente se está sin leer el nombre.
    aplicarTemaDeTerminal(activo?.terminal_theme ?? null);
    sessionGeneration++;
    sessionLists.reset();
    const generation = sessionGeneration;
    const previousWorkspace = workspaceActivo();
    if (previousWorkspace) workspaceThreads.set(previousWorkspace, Object.fromEntries(
      Object.entries(hilos()).filter(([id]) => liveThreads.has(liveThreadKey(previousWorkspace, id))),
    ));
    if (previousWorkspace) workspaceRetentions.set(previousWorkspace, new Map(
      [...savedQueues].filter(([, queued]) => queued.items.length > 0).map(([id, queued]) => [id, queued.retained]),
    ));
    savedQueues.clear();
    drainingQueues.clear();
    setWorkspaceActivo(a.active);
    setDraftBases({});
    // Sale la tira del anterior antes que `setSessionId(null)`, que apuntaría
    // «ninguna activa» en la que siga cargada. La nueva es la del escritorio y
    // entra abajo, al leer los espacios, con qué tarea tenía abierta.
    // El reparto de la que se va ya está guardado por espacio; se corta antes
    // de vaciar la tira, para que soltar sus pestañas no pise su rejilla.
    paneles.bindTo(null, null);
    pestanas.load(null);
    batch(() => {
      setSpaces([]);
      setEscritorio(null);
      setAviso(null);
    });
    // Y la pantalla vuelve a una ventana: la rejilla que había era la del
    // cliente que se deja, y la del que llega la pone `asentarEscritorio`.
    paneles.reset();
    setSessionId(null);
    setProyectoAbierto(null);
    setHilos(a.active ? workspaceThreads.get(a.active) ?? {} : {});
    setDesdeDeTurno({});
    setBorradores({});
    setVivas([]);
    setSettlingTurns([]);
    finishedTurns.clear();
    sinDesenlace.clear();
    lifecycleRevision++;
    setFolder(null);
    setVentana(null);
    setSesiones({});
    soltarCola();
    setAdjuntas([]);
    // Y las cuentas, que también son de este workspace: la franja de consumo las
    // lee una vez y se quedaría enseñando las del cliente anterior —nombre,
    // correo y cuánto le queda— sin que nada avise.
    setCuentasTocadas((n) => n + 1);
    // Con qué se puede trabajar es del workspace por lo mismo: la
    // credencial y el consentimiento cuelgan de él; el menú del otro
    // cliente ofrecería lo que este no tiene conectado.
    void cargarSuperficies(true);
    setError(null);
    // Ni con un solo proyecto se preselecciona. Autoseleccionar cuando la lista
    // trae uno ahorra un clic y reintroduce la sorpresa.
    setProject("");
    // Sin workspace no se pregunta por lo que cuelga de él: preguntarlo
    // devolvía «Todavía no hay ningún workspace», pintado como error rojo
    // encima del primer arranque —la app avisando de que falta lo que esa
    // misma pantalla está pidiendo.
    if (a.active === null) {
      setProjectList([]);
      setSources([]);
      return;
    }
    const pedidas = invoke<Space[]>("list_spaces").catch(() => null);
    try {
      // A la vez, no una detrás de otra: no dependen entre sí, y
      // encadenadas sumaban sus latencias en el arranque. `list_sources`
      // esperaba a que volviera `list_projects` para preguntar algo que
      // no usa su respuesta.
      const [proyectos, fuentes] = await Promise.all([
        invoke<Project[]>("list_projects"),
        invoke<Source[]>("list_sources"),
      ]);
      if (generation !== sessionGeneration) return;
      setProjectList(proyectos);
      setSources(fuentes);
    } catch (e) {
      if (generation !== sessionGeneration) return;
      setProjectList([]);
      setSources([]);
      setError(prosaDe(e));
    }
    // La tarea que estaba abierta en este workspace vuelve a estarlo, que es lo
    // que hace un navegador al arrancar. Si su pestaña apunta a una tarea que
    // ya no existe, `abrirSesion` lo dice en la conversación y la
    // sincronización con el historial se lleva la pestaña.
    const lista = await pedidas;
    if (generation !== sessionGeneration) return;
    const desk = asentarEscritorio(a.active, lista);
    const restored = pestanas.load(a.active, desk);
    // El reparto de su espacio vuelve con la tira: la pantalla partida que se
    // dejó al cerrar. La tarea de delante la abre `abrirSesion`, abajo; las
    // otras ventanas cargan la suya por `loadWindowThreads`.
    paneles.bindTo(null, null);
    const vivos = pestanas.open().map((p) => p.id);
    paneles.restore(a.active !== null && desk ? readLayout(a.active, desk) : null, vivos);
    paneles.sync(vivos);
    if (a.active !== null && desk) paneles.bindTo(a.active, desk);
    // Sin reparto guardado, `sincronizar` pone delante la última pestaña y no la activa de la tira.
    if (restored) paneles.activate(restored);
    loadWindowThreads(restored);
    // Su lectura no espera a la conciliación, que tarda lo que tarde el servicio:
    // esperándola, la pestaña de delante salía vacía y sin indicador.
    const delante = restored ? pestanas.open().find((p) => p.id === restored) : undefined;
    if (delante && isTaskTab(delante) && !hilos()[delante.session]) {
      setCargandoHilo(delante.session);
      void loadThread(delante.project, delante.session).finally(() =>
        setCargandoHilo((c) => (c === delante.session ? null : c)));
    }
    const enFrente = paneles.activeTabAt(paneles.activeSite());
    await reconcileActiveTurns();
    if (generation !== sessionGeneration) return;
    // Lo que la persona abrió mientras se conciliaba gana: abrir la restaurada ahora le quitaría la ventana.
    if (sessionId() !== null || pestanas.active() !== null || paneles.activeTabAt(paneles.activeSite()) !== enFrente) return;
    if (delante) void abrirSesion(delante.project, delante.id);
  }

  onMount(() => {
    // Aquí es cuando deja de verse la ventana en blanco: `Setup` no monta esto
    // hasta que su comprobación vuelve. Sin esta línea el arranque no se mide
    // en ningún sitio y cualquier mejora suya es una opinión.
    void invoke("window_ready", { at: Math.round(performance.now()) });
    // El webview es la mayor parte de la memoria de la app y nadie sabe de qué.
    // Nodos, heap y lo que la ventana retiene separan las causas posibles, que
    // piden arreglos distintos. `memory` no existe en todos los motores: cero dice «no se sabe».
    const vitales = () => {
      const memoria = (performance as { memory?: { usedJSHeapSize: number } }).memory;
      const retenidos = Object.values(hilos());
      void invoke("window_vitals", {
        nodes: document.getElementsByTagName("*").length,
        heapMb: Math.round((memoria?.usedJSHeapSize ?? 0) / 1048576),
        tabs: pestanas.open().length,
        threads: retenidos.length,
        messages: retenidos.reduce((n, h) => n + h.base.length + h.vivo.length, 0),
      });
    };
    vitales();
    const latido = setInterval(vitales, 300_000);
    onCleanup(() => clearInterval(latido));
    const closeTab = listen("close-tab", closeActiveTab);
    onCleanup(() => void closeTab.then((unlisten) => unlisten()));

    void invoke<Agent[]>("list_agents").then(setAgents);
    // Lo primero de todo: sin workspace no hay dónde leer ni escribir. El
    // arranque migra lo que hubiera suelto de antes y devuelve cuál quedó
    // activo. Lo que el workspace tiene es su fuente de contexto, no «dónde
    // están los proyectos»: lo que quede en `localStorage` de cuando esa
    // carpeta era una preferencia de esta máquina se lee UNA vez, aquí.
    let workspaceRequest = 0;
    // Que el servicio no conteste todavía no es una respuesta. Recién
    // instalado arranca en frío —`workspaces_startup` tardó nueve segundos
    // en una medición— y el primer intento de la ventana se pasa del plazo:
    // la app abría a medias y no se recuperaba sola.
    const arrancar = async (quedan: number) => {
      try {
        const a = await invoke<Startup>("workspaces_startup");
        if (workspaceRequest !== 0) return;
        // `bloqueo` no pasa por `aplicar`: es lo que lo hace seguro. Viene
        // con `workspaces` y `active` vacíos, que para `aplicar` significan
        // «primer arranque» y abren el alta — la negativa acabaría
        // invitando a crear un workspace en la carpeta que se negó a tocar.
        if (a.bloqueo) {
          setBloqueo(a.bloqueo);
          return;
        }
        await aplicar(a);
      } catch (e) {
        if (workspaceRequest !== 0) return;
        if (quedan > 0 && TRANSPORTE.has(claveDe(e) ?? "")) {
          setTimeout(() => void arrancar(quedan - 1), 1000);
          return;
        }
        setError(prosaDe(e));
        // Sin arranque no hay workspace: no hay nada que ofrecer. Dejarlo
        // en «leyendo» pintaría una caja muda esperando una respuesta que
        // ya falló; vacío es lo que hay, y encima está el error.
        setSuperficies([]);
      }
    };
    void arrancar(10);

    // El selector de workspace vive en otra pantalla y no sabe nada de esta. Se
    // hablan por el evento y no por props para que se pueda mover de sitio —al
    // pie del sidebar— sin tocar a nadie.
    const alMudar = () => {
      const request = ++workspaceRequest;
      void invoke<Startup>("list_workspaces")
        .then((startup) => request === workspaceRequest ? aplicar(startup) : undefined)
        .catch((e) => { if (request === workspaceRequest) setError(prosaDe(e)); });
    };
    window.addEventListener("harness:workspace", alMudar);
    onCleanup(() => window.removeEventListener("harness:workspace", alMudar));

    // Y el otro aviso, que se parece y no es el mismo: cambió el material
    // de este workspace, no el workspace. Son dos eventos: dos
    // consecuencias distintas, una mudanza y un estante nuevo.
    const alCambiarMaterial = () => void recargarMaterial();
    window.addEventListener("harness:sources", alCambiarMaterial);
    onCleanup(() =>
      window.removeEventListener("harness:sources", alCambiarMaterial),
    );

    // Agregar un workspace lo pide quien lo ofrece —el panel de
    // Configuración— y lo monta esta pantalla: el alta ocupa la ventana
    // entera.
    const alPedirAlta = () => {
      // La hoja de Configuración se cierra: el alta va debajo de ella y
      // quedaría tapada por la pantalla desde la que se pidió.
      setSettings(null);
      setAlta("nueva");
    };
    window.addEventListener("harness:new-workspace", alPedirAlta);
    onCleanup(() =>
      window.removeEventListener("harness:new-workspace", alPedirAlta),
    );
    // Lo piden las vistas que necesitan un plugin: `DrawioMcpCanvas.tsx`.
    const alPedirAjustes = (e: Event) => {
      const panel = (e as CustomEvent<unknown>).detail;
      setSettings(typeof panel === "string" ? panel : "");
    };
    window.addEventListener("harness:open-settings", alPedirAjustes);
    onCleanup(() =>
      window.removeEventListener("harness:open-settings", alPedirAjustes),
    );
  });

  // Y al revés: quien ofrezca cambiar de workspace sabe que hay un agente
  // contestando. El bloqueo de verdad lo impone el backend, esto es para
  // no ofrecer un clic que va a fallar. `turn`, no `turno` (AGENTS.md §
  // Qué comprueba cada guarda); `dispatchEvent` sin suscriptores no avisa,
  // igual que `app.emit`. Viaja la cuenta real de `vivas`, no el `busy`
  // de la sesión visible.
  createEffect(
    on(vivas, (v) =>
      window.dispatchEvent(
        new window.CustomEvent("harness:turn", { detail: v.length }),
      ),
    ),
  );

  async function settleTurn(session: string, ok?: boolean | null) {
    const generation = sessionGeneration;
    const revision = advanceTurn(session);
    finishedTurns.set(session, ok);
    batch(() => {
      setSettlingTurns((ids) => [...new Set([...ids, session])]);
      if (ok !== true) {
        const retained = ok === false ? "fallo" : "borrador";
        if (session === sessionId()) setRetenida(retained);
        if (draftFromDisk === session) draftFromDisk = null;
        const queued = savedQueues.get(session);
        if (queued) savedQueues.set(session, { ...queued, retained });
        if (ok == null) sinDesenlace.add(session);
        else sinDesenlace.delete(session);
      } else if (sinDesenlace.delete(session)) {
        // El registro lo dio por cerrado antes de que llegara su `done`: el
        // borrador era por no saber cómo acabó, y ya se sabe.
        if (session === sessionId() && retenida() === "borrador") setRetenida(null);
        const queued = savedQueues.get(session);
        if (queued?.retained === "borrador") savedQueues.set(session, { ...queued, retained: null });
      }
      marcarQuieta(session);
      anexar(session, (messages) =>
        messages.some((m) => m.paso?.corriendo)
          ? messages.map((m) =>
              m.paso?.corriendo ? { ...m, paso: { ...m.paso, corriendo: false } } : m,
            )
          : messages,
      );
      // Igual que en el `done`: el turno se acabó, y con él la espera de sus
      // hijas. Este camino es el del turno que cerró sin que su evento llegara.
      setEnFondo((ids) => ids.filter((id) => id !== session));
      if (deteniendo() === session) setDeteniendo(null);
      setPermissions((items) => items.filter((permission) => permission.session !== session));
      soltarTerminal(session);
    });
    const tab = pestanas.open().find((item) => item.id === session);
    const projectId = session === sessionId() ? project() : tab?.project ?? savedQueues.get(session)?.project;
    try {
      if (projectId !== undefined) {
        const result = await invoke<Session>("load_session", { project: projectId, id: session });
        if (generation === sessionGeneration && revision === turnRevisions.get(session))
          loadResult(session, result, true, generation);
      } else soltarHilo(session);
    } catch {
      // El fallo de lectura conserva lo recibido en vivo y no revive el proceso.
    } finally {
      if (generation === sessionGeneration && revision === turnRevisions.get(session)) batch(() => {
        setSettlingTurns((ids) => ids.filter((id) => id !== session));
        setCierres((n) => n + 1);
        void refreshSessions(grupos());
        void releerProyectos();
        if (ok === true) void drainHiddenQueue(session);
      });
    }
  }

  let serviceListenersReady: Promise<unknown> = Promise.resolve();
  onMount(() => {
    let disposed = false;
    let cursor: number | null = null;
    let replay = true;
    let runtime: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failingSince: number | null = null;
    const poll = async () => {
      await Promise.resolve();
      await serviceListenersReady;
      if (disposed) return;
      try {
        const page = await invoke<{ cursor: number | null; gap: boolean; replay: boolean; runtime: string; reset: boolean }>("service_poll", { cursor, workspace: null, replay, runtime });
        if (disposed) return;
        cursor = page.cursor;
        replay = page.replay;
        runtime = page.runtime;
        if (page.reset || page.gap || failingSince !== null) window.dispatchEvent(new CustomEvent("harness:service-resync"));
        if (page.reset || page.gap) releerTrasHueco();
        if (page.reset) {
          liveThreads.clear();
          workspaceThreads.clear();
          setHilos((threads) => Object.fromEntries(Object.entries(threads).map(([id, thread]) => [id, { ...thread, vivo: [] }])));
          setPermissions([]);
          if (vivas().length > 0) setError(t("chat.error.service_restarted"));
          void reconcileActiveTurns();
        }
        // Un reinicio sin turnos vivos también corta el stream (`page.gap`); sin
        // esta guarda el aviso de hueco sale sin que nada se haya perdido.
        if (page.gap && vivas().length > 0) setError(t("chat.error.service_gap"));
        if (failingSince !== null) {
          failingSince = null;
          if (error() === t("chat.error.service_unavailable") || error() === t("shell.service.engine_down") || error() === t("shell.service.engine_missing")) setError(null);
        }
      } catch (e) {
        // Un sondeo suelto falla al empezar un turno y el siguiente ya contesta.
        failingSince ??= Date.now();
        const sinMotor = claveDe(e) === "shell.service.engine_missing";
        const caido = sinMotor || claveDe(e) === "shell.service.engine_down";
        if (!disposed && Date.now() - failingSince > (caido ? 2_000 : 10_000)) {
          setError(sinMotor ? t("shell.service.engine_missing") : t(caido ? "shell.service.engine_down" : "chat.error.service_unavailable"));
        }
      } finally {
        if (!disposed) timer = setTimeout(() => void poll(), 250);
      }
    };
    void poll();
    onCleanup(() => { disposed = true; if (timer) clearTimeout(timer); });
  });

  async function reconcileActiveTurns() {
    const workspace = workspaceActivo();
    if (!workspace) return;
    const revision = lifecycleRevision;
    const generation = sessionGeneration;
    try {
      const [active, timing] = await Promise.all([
        invoke<string[]>("list_active_turns", { workspace }),
        invoke<LiveTurn[]>("list_live_turns").catch(() => []),
      ]);
      if (generation !== sessionGeneration || revision !== lifecycleRevision) return;
      const enVuelo = timing.filter((turn) => turn.workspace === workspace && active.includes(turn.session));
      setDesdeDeTurno((previous) => ({ ...previous, ...Object.fromEntries(
        enVuelo.map((turn) => [turn.session, turn.started_at]),
      ) }));
      // Una ventana que reabre con un `!` en marcha lo pinta como comando y no
      // como turno del agente; el diario repite después su salida.
      for (const turn of enVuelo) {
        if (turn.shell && !terminales()[turn.session]) {
          ponerTerminal(turn.session, { ...turn.shell, cwd: null, output: "", truncated: false, desde: turn.started_at });
        }
      }
      // El evento efímero no basta al reabrir una ventana.
      const esperandoHijas = new Set(enVuelo.filter((turn) => turn.background).map((turn) => turn.session));
      const conocidas = new Set(enVuelo.filter((turn) => typeof turn.background === "boolean").map((turn) => turn.session));
      setEnFondo((ids) => {
        const siguiente = [...new Set([...ids.filter((id) => !conocidas.has(id) || esperandoHijas.has(id)), ...esperandoHijas])];
        return siguiente.length === ids.length && siguiente.every((id) => ids.includes(id)) ? ids : siguiente;
      });
      for (const id of active) pendingStarts.delete(id);
      const nuevas = active.filter((id) => !vivas().includes(id));
      const finished = vivas().filter((id) => !active.includes(id) && !pendingStarts.has(id) && !drainingQueues.has(id));
      for (const id of nuevas) void reponerGates(id);
      for (const id of active) if (!settlingTurns().includes(id)) marcarViva(id);
      for (const id of finished) void settleTurn(id);
    } catch {
      // Un IPC fallido no demuestra que el turno haya terminado.
    }
  }

  onMount(() => {
    const refresh = () => void reconcileActiveTurns();
    const timer = setInterval(refresh, 5000);
    window.addEventListener("focus", refresh);
    onCleanup(() => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    });
  });
  createEffect(on(workspaceActivo, () => void reconcileActiveTurns()));

  // Los tres oyentes de Rust. Los nombres van como cadena literal:
  // `scripts/bridge.mjs` comprueba que alguien emita lo que la interfaz
  // escucha, y es lo único que sabe leer; una constante lo deja ciego sin
  // fallar. Se suscriben una vez: las funciones de respuesta leen
  // `sessionId()` y las demás señales al recibir cada evento, y copiar sus
  // valores al montar las dejaría trabajando con la sesión anterior.

  // Las capas nativas son hijas de la ventana, no del documento: una recarga
  // del webview —HMR en desarrollo, o un proceso de contenido que se cae y
  // vuelve— las dejaría flotando sobre la interfaz sin pestaña que las
  // cierre. Aquí es el primer instante en que se sabe que el documento es
  // nuevo. Ver `sites::site_sweep`.
  onMount(() => void invoke("site_sweep").catch(() => {}));
  // Lo mismo con los Tinymist de la vista de Typst: sin visor que los suelte, seguirían vivos.
  onMount(() => void invoke("typst_live_stop", { key: null, session: null }).catch(() => {}));

  onMount(() => {
    const chat = listen<ChatEvent>("chat", (e) => {
      const {
        workspace,
        session,
        kind,
        text,
        meta,
        id,
        target,
        detail,
        mcp_app,
        ok,
        request_id,
        origin,
        starts_message,
        message_id,
        task,
      } = e.payload;
      const append = (fn: (messages: Msg[]) => Msg[]) => anexar(session, fn, workspace);
      // Que un turno terminó se apunta ANTES del filtro de abajo: es la mitad
      // que hace posible trabajar en dos tareas. El filtro descarta lo que no
      // se está mirando, correcto para pintar, pero el cierre no es pintura:
      // si se descartara, la tarea que terminó mientras mirabas otra seguiría
      // marcada como viva para siempre, con su caja en «Detener» y sin nada
      // corriendo detrás.
      if (kind === "done") {
        setEnFondo((ids) => ids.filter((id) => id !== session));
        if (!esDelWorkspaceAbierto(workspace)) {
          advanceTurn(session);
          if (workspace) {
            liveThreads.delete(liveThreadKey(workspace, session));
            const threads = workspaceThreads.get(workspace);
            if (threads) delete threads[session];
          }
          setPermissions((items) => items.filter((permission) => permission.session !== session));
        }
        if (esDelWorkspaceAbierto(workspace)) finishedTurns.set(session, ok);
        // Lo mismo que `settleTurn`, para la cola de un workspace que no se mira.
        const retentions = workspace ? workspaceRetentions.get(workspace) : undefined;
        if (!esDelWorkspaceAbierto(workspace) && ok !== true && retentions?.has(session)) {
          retentions.set(session, ok === false ? "fallo" : "borrador");
        }
        if (esDelWorkspaceAbierto(workspace) && deteniendo() === session) setDeteniendo(null);
        // Un turno que acaba libera el material que tenía delante, y hay quien
        // está esperando justo eso para traerlo (`AvisoDeMaterial`). Se avisa
        // aquí, antes del filtro por tarea abierta: el turno que termina puede
        // ser de otra.
        window.dispatchEvent(new CustomEvent("harness:turno-cerrado"));
      // Y el árbol de esa tarea quedó como quedó: el panel de código tiene
      // archivos abiertos que el turno pudo reescribir. Sin este aviso siguen
      // enseñando la versión de antes, y guardar encima escribiría el archivo
      // viejo entero sobre lo que el agente acaba de hacer
      // (`features/code/refresh.ts`). Va antes del filtro por tarea abierta,
      // como el cierre: el panel decide por su cuenta si le toca.
        avisarDeLosArboles(session);
      }

      // Una tarea puede arrancar sin que esta pantalla la lance: las hijas de
      // orquestación las despacha el backend al cerrar el turno del padre
      // (`workspace/orchestration.rs`), y su `started` es la única señal de que
      // existen. Se apunta antes del filtro, como el cierre, y el historial
      // se recarga para que la fila aparezca —o, en un `done` de una tarea
      // que no se está mirando, para que deje de decir que trabaja—.
      if (kind === "started" || kind === "done") {
        if (kind === "started" && workspace) liveThreads.add(liveThreadKey(workspace, session));
        if (kind === "started" && esDelWorkspaceAbierto(workspace)) {
          pendingStarts.delete(session);
          advanceTurn(session);
          setSettlingTurns((ids) => ids.filter((id) => id !== session));
          finishedTurns.delete(session);
          setEnFondo((ids) => ids.filter((id) => id !== session));
          marcarViva(session);
        }
        if (esDelWorkspaceAbierto(workspace)) void refreshSessionsOnEvent(grupos());
      }

      // Cada evento cae en el hilo de SU sesión, esté abierta o no (ver
      // `hilos`). Lo único que se descarta es lo que corre en otro workspace:
      // lo que hay en memoria es de este cliente.

      // El permiso se salta esa comprobación para RECIBIRSE, no para
      // pintarse: descartarlo aquí lo perdería —es la única copia, y el turno
      // que lo espera se quedaría parado sin que nadie pudiera ya
      // contestarle—. Dejarlo entrar no es dejarlo aparecer: quién lo pinta
      // elige el de la tarea abierta, y el resto espera en la suya.

      // Pintarlo al llegar mete el comando de una conversación al pie de otra
      // —y, cambiando de workspace con algo contestando, de otro cliente— con
      // su aviso de procedencia calculado contra el material equivocado. El
      // gate espera en su conversación; el punto del historial y el de la
      // pestaña dicen en cuál.
      if (kind === "shell_started" || kind === "shell_output" || kind === "shell_done") {
        if (esDelWorkspaceAbierto(workspace) && id) alComando(session, kind, { id, text, meta, target });
        return;
      }

      const esGate = kind === "permission";
      const retainedStream = Boolean(workspace && liveThreads.has(liveThreadKey(workspace, session))) &&
        ["delta", "image", "tool", "tool_done", "notice", "task_launched", "command_output", "command_running"].includes(kind);
      if (!esGate && !esDelWorkspaceAbierto(workspace) && !retainedStream) return;

      if (kind === "started") return;

      if (kind === "task_launched") {
        if (task && id) append(messages => messages.some(message => message.turno === id) ? messages : [
          ...messages, { role: "system", text: "", meta: "task_launched", fromTask: task, turno: id },
        ]);
        if (esDelWorkspaceAbierto(workspace)) void refreshSessionsOnEvent(grupos());
        return;
      }

      if (kind === "mcp_auth") {
        noteMcpSignIn(session, text);
        return;
      }

      if (kind === "model") {
        if (session === sessionId()) setModel(text);
        return;
      }
      if (kind === "effort") {
        if (session === sessionId()) setEffort(text);
        return;
      }

      // El CLI está reintentando contra su proveedor. No entra en la
      // transcripción —cinco intentos serían cinco filas permanentes por algo
      // que puede resolverse solo—: enciende el indicador de estado del
      // turno, que es lo único que contesta «¿esto sigue vivo?» mientras el
      // proveedor no contesta. Se apaga en cuanto el turno vuelve a avanzar,
      // unas líneas más abajo.
      if (kind === "retry") {
        const [intento, total] = (meta ?? "").split("/").map(Number);
        setReintento({
          session,
          intento: intento || 0,
          total: total || 0,
          clase: text,
        });
        return;
      }

      // Y se apaga con la primera señal de que el turno avanzó otra vez. Sin
      // esto, un reintento que sale bien deja el rótulo puesto hasta el cierre
      // y la pantalla afirma una espera que ya terminó.
      if (reintento()?.session === session) setReintento(null);

      if (kind === "background") {
        setEnFondo((ids) => (ids.includes(session) ? ids : [...ids, session]));
        const primero = session === sessionId() && !editando() ? cola()[0] : undefined;
        if (primero) void mandarAhora(primero.id);
        return;
      }
      if (enFondo().includes(session)) setEnFondo((ids) => ids.filter((id) => id !== session));

      // Un paso que arranca: la fila aparece con lo que ya se sabe —qué
      // herramienta, sobre qué— y gira hasta que vuelva su resultado. Gira
      // solo si trae `id`: es con lo que empareja su `tool_done`, y sin él
      // una fila marcada como corriendo se quedaría girando el resto de la
      // sesión.
      if (kind === "tool") {
        append((m) => [
          ...m,
          {
            role: "system",
            text,
            meta: "usó",
            paso: pasoDe(text, target ?? null, {
              id,
              detalle: detail ?? null,
              mcpApp: mcp_app ?? mcpCallFromName(text),
              corriendo: id !== undefined,
            }),
          },
        ]);
        return;
      }

      // Y el paso que cierra: empareja solo contra una fila que siga
      // corriendo. Los ids de Codex son `item_0`, `item_1`… y reinician en
      // cada turno; sin esa condición el segundo turno completaría las
      // filas del primero. Si no encuentra a quién cerrar, se cierra sola.
      if (kind === "tool_done") {
        const imagenes = detail?.kind === "output" ? detail.images : undefined;
        append((m) => {
          const cerrado = (p: Paso): Paso => ({
            ...p,
            corriendo: false,
            ok,
            detalle: detail ?? p.detalle,
            mcpApp: mcp_app ? { ...p.mcpApp, ...mcp_app, arguments: mcp_app.arguments ?? p.mcpApp?.arguments } : p.mcpApp ?? mcpCallFromName(text),
          });
          let i = m.length - 1;
          while (i >= 0 && !(m[i].paso?.corriendo && m[i].paso?.id === id)) i--;
          const conPaso: Msg[] =
            i < 0
              ? [
                  ...m,
                  {
                    role: "system",
                    text,
                    meta: "usó",
                    paso: cerrado(pasoDe(text, target ?? null, { id })),
                  },
                ]
              : (() => {
                  const copia = [...m];
                  copia[i] = { ...m[i], paso: cerrado(m[i].paso as Paso) };
                  return copia;
                })();
          return imagenes?.length ? anexarImagen(conPaso, imagenes) : conPaso;
        });
        return;
      }

      if (kind === "done") {
        void settleTurn(session, ok);
        return;
      }

      if (kind === "permission") {
        setPermissionError(null);
        if (!request_id) {
          append((m) => [
            ...m,
            {
              role: "system",
  // Sin nombrar a un agente: un literal escrito mirando a uno nombra al
  // equivocado justo cuando algo va mal. Los de protocolo también piden
  // permiso.
              text: t("shell.turn.permission_no_reply"),
              meta: "fallo",
            },
          ]);
          return;
        }
        setPermissions((ps) =>
          ps.some((p) => p.requestId === request_id)
            ? ps
            : [
                ...ps,
                {
                  session,
                  requestId: request_id,
                  tool: text,
                  target: target ?? meta,
                  origin: origin ?? null,
                },
              ],
        );
        return;
      }

      // Sin este corte cae al delta de abajo y la salida de un comando de
      // barra se pinta como respuesta del agente. `meta` trae la fila con que
      // Rust la guarda; la tarjeta en curso se va cuando llega su salida.
      if (kind === "command_output" || kind === "command_running") {
        const fila: Msg = {
          role: "system",
          text,
          meta: kind === "command_running" ? kind : (meta ?? "command_output"),
          agent: filaDe(session)?.agent ?? (session === sessionId() ? agent() : undefined),
        };
        append((m) => [...m.filter((x) => x.meta !== "command_running"), fila]);
        return;
      }

      // `tool` no cae aquí: lo atiende la línea de tiempo, que además tiene que
      // casar el `tool_done` con el paso que abrió.
      if (kind === "notice") {
        const message = clavesConocidas().has(text) ? t(text) : text;
        append((m) => [...m, { role: "system", text: message, meta: "aviso" }]);
        return;
      }

      // Sin este corte, la presencia cae al delta de abajo —destino de todo lo
      // que no se reconoce— y su etiqueta acaba concatenada dentro de la
      // respuesta del agente. No es conversación: la pinta el riel.
      if (kind === "presence") return;

      // La imagen va en la respuesta, no en el rastro. Si cayera al delta de
      // abajo, el kind se concatenaría al texto.
      if (kind === "image") {
        const imagenes = detail?.kind === "output" ? detail.images ?? [] : [];
        if (imagenes.length > 0) append((m) => anexarImagen(m, imagenes));
        return;
      }

      // delta: los fragmentos se CONCATENAN SIN SEPARADOR. Meter "\n" aquí
      // parte cada token en su propia línea y el texto sale destrozado.
      //
      // Salvo que el CLI diga que aquí empieza otro mensaje, o que diga a qué
      // mensaje pertenece el fragmento: ACP manda `message_id`, y su orden de
      // entrega puede meter una herramienta entre dos fragmentos del mismo
      // mensaje. Sin devolver el texto a su globo, el mensaje sale partido.
      append((m) =>
        anexarDelta(m, {
          text,
          messageId: message_id,
          startsMessage: starts_message,
          author: firmas[session] ?? firmas[""] ?? null,
          model: modelosEnVivo[session] ?? modelosEnVivo[""] ?? null,
        }),
      );
    });
    onCleanup(() => void chat.then((f) => f()));

  // El agente preguntó algo. Llega por su propio evento y no por el del chat:
  // es estructura —opciones que se eligen—, no texto que se pinta. El nombre
  // va en inglés y los campos no, sin ser una inconsistencia: el nombre del
  // evento es una ruta entre dos procesos y los campos son el vocabulario ya
  // persistido en `session.json`.
    const question = listen<PreguntaEvent>("question", (e) => {
      const { workspace, session, turno, preguntas, request_id } = e.payload;
      // Con qué agente se contesta: el de ESA tarea, que puede no ser la
      // abierta. El historial lo sabe por fila; el selector solo sabe el de la
      // que se mira.
      const conAgente = filaDe(session)?.agent ?? (session === sessionId() ? agent() : undefined);
      anexar(session, (m) => {
        const ultimo = m[m.length - 1];
        if (ultimo?.role === "agent" && !ultimo.turno)
          return [
            ...m.slice(0, -1),
            {
              ...ultimo,
              turno,
              preguntas,
              questionRequestId: request_id,
              agent: conAgente,
            },
          ];
        // Un turno que solo preguntó, sin decir nada más, también es un turno.
        return [
          ...m,
          {
            role: "agent",
            text: "",
            turno,
            preguntas,
            questionRequestId: request_id,
            agent: conAgente,
          },
        ];
      }, workspace ?? workspaceActivo());
    });
    onCleanup(() => void question.then((f) => f()));

    // El consumo llega como dato y se conserva por turno. No entra a `msgs`:
    // una línea de tokens es diagnóstico, no una intervención en la conversación.
    const usageEv = listen<UsageRecord>("usage", (e) => {
      const rec = e.payload;
      // `UsageRecord` trae su workspace desde que existe: cada línea del
      // registro tiene que saber de dónde salió aunque se lea suelta.
      if (!esDeLaAbierta(rec.session) || !esDelWorkspaceAbierto(rec.workspace))
        return;
      setVentana(ventanaDe([rec]));
      cargarComandos(agent());
    });
    onCleanup(() => void usageEv.then((f) => f()));

    // Instalar un agente lo deja usable aquí, no solo en la pantalla
    // donde se instaló. Esta lista se leía una vez en `onMount`: quien
    // conectaba una cuenta desde Ajustes veía ahí su consumo, y en el
    // chat el mismo agente seguía diciendo «no está instalado», con el
    // campo muerto hasta cerrar y volver a abrir la app.
    const agentsEv = listen("agents", () => {
      void invoke<Agent[]>("list_agents").then(setAgents);
      // Y qué se puede usar, que es lo que decide el menú. Conectar una cuenta
      // desde Configuración añade una entrada aquí; desinstalar un CLI se la
      // lleva. Sin esto había que cerrar la app para verlo.
      void cargarSuperficies(false);
    });
    onCleanup(() => void agentsEv.then((f) => f()));

    // Cambió qué cuenta va a correr: cambió qué se puede usar.
    // `surfaces::sin_cuenta` pregunta por la cuenta activa, y la sonda de
    // estado la quita en cuanto una deja de responder
    // (`accounts::account_status`). Sin escuchar esto, el selector sigue
    // ofreciendo un agente que ya no puede correr, y el turno muere
    // contra el guarda con un muro de texto.
    const cuentaEv = listen("account", () => {
      void cargarSuperficies(false);
      // El reloj de cupo cambia la activa sin pasar por Configuración: sin esto la franja enseña la agotada.
      setCuentasTocadas((n) => n + 1);
    });
    onCleanup(() => void cuentaEv.then((f) => f()));

    // La otra ventana escribió en esta carpeta de datos: hay que releer,
    // igual que el `done` de un turno propio, con dos diferencias. Rust
    // ya descartó el eco (`sync::arrancar` compara la firma); y un turno
    // vivo AQUÍ manda —si esta ventana contesta esa misma tarea, releer
    // con `vaciarVivo` borraría `vivo` a media respuesta.

    // Lo que la ventana no puede pintar. Ver `abrirEnlace`.
    const sitioPedido = listen<string>("sitio-pedido", (e) => {
      void abrirEnlace(e.payload);
    });
    onCleanup(() => void sitioPedido.then((f) => f()));
    const enlaceDelChat = (e: Event) => {
      void abrirEnlace((e as CustomEvent<string>).detail);
    };
    window.addEventListener("harness:abrir-sitio", enlaceDelChat);
    onCleanup(() => window.removeEventListener("harness:abrir-sitio", enlaceDelChat));
    const localFileLink = (e: Event) => {
      const path = (e as CustomEvent<string>).detail;
      if (typeof path === "string") void abrirRuta(path);
    };
    window.addEventListener("harness:open-file", localFileLink);
    onCleanup(() => window.removeEventListener("harness:open-file", localFileLink));
    // «Que lo arregle el agente» en un documento Typst: sale como si la persona lo escribiera, en su tarea.
    const pedirAlAgente = (e: Event) => {
      const pedido = (e as CustomEvent<{ project: string; session: string; texto: string } | null>).detail;
      if (!pedido?.texto || !pedido.session) return;
      void (async () => {
        if (sessionId() !== pedido.session) await abrirSesion(pedido.project, pedido.session);
        if (sessionId() === pedido.session) await mandarTexto(pedido.texto);
      })();
    };
    window.addEventListener("harness:pedir-al-agente", pedirAlAgente);
    onCleanup(() => window.removeEventListener("harness:pedir-al-agente", pedirAlAgente));
    const taskLink = (e: Event) => {
      const target = (e as CustomEvent<InternalTaskLink>).detail;
      if (!target || target.workspace !== workspaceActivo()) {
        setError(t("markdown.link.other_workspace"));
        return;
      }
      void invoke<Session>("load_session", { project: target.folder, id: target.task })
        .then(() => {
          if (target.workspace === workspaceActivo()) void abrirSesion(target.folder, target.task);
        })
        .catch((error) => setError(prosaDe(error)));
    };
    window.addEventListener("harness:open-task-link", taskLink);
    onCleanup(() => window.removeEventListener("harness:open-task-link", taskLink));
    // Con proyecto lo avisa un gesto de `Sessions.tsx`; sin él, `cli-changed`.
    const tasksChanged = (event: Event) => {
      void ((event as CustomEvent<{ project?: string } | null>).detail?.project ? refreshSessions : refreshSessionsOnEvent)(grupos());
    };
    window.addEventListener("harness:tasks-changed", tasksChanged);
    onCleanup(() => window.removeEventListener("harness:tasks-changed", tasksChanged));
    // La otra mitad de la elección del enlace (`ui/Markdown.tsx`): sale al
    // navegador de la persona por una puerta más estrecha que la de dentro.
    // Ver `sites::abrible_fuera`.
    const enlaceFuera = (e: Event) => {
      void invoke("site_open_external", {
        url: (e as CustomEvent<string>).detail,
      }).catch(() => {});
    };
    window.addEventListener("harness:abrir-fuera", enlaceFuera);
    onCleanup(() => window.removeEventListener("harness:abrir-fuera", enlaceFuera));

    const cliChanged = listen<{ workspace: string | null; command: string }>("cli-changed", (e) => {
      window.dispatchEvent(new CustomEvent("harness:workspace-name"));
      if (!esDelWorkspaceAbierto(e.payload.workspace ?? undefined)) return;
      const workspace = workspaceActivo();
      void invoke<Project[]>("list_projects").then((items) => {
        if (workspace === workspaceActivo()) setProjectList(items);
      }).catch((error) => setError(prosaDe(error)));
      void reloadSpaces();
      void cargarSuperficies(false);
      setCuentasTocadas((n) => n + 1);
      window.dispatchEvent(new CustomEvent("harness:tasks-changed"));
      // El mismo aviso que dan `NewAgent.tsx` y `AgentProfile.tsx`: sin él, lo
      // creado o cambiado desde el CLI no sale en el riel hasta cambiar de carpeta.
      if (e.payload.command === "handler.create" || e.payload.command === "handler.update") {
        window.dispatchEvent(new CustomEvent("harness:encargados"));
        window.dispatchEvent(new CustomEvent("harness:profiles"));
      }
      if (e.payload.command === "config.set") {
        void invoke<Startup>("list_workspaces").then((startup) => {
          if (workspace !== workspaceActivo()) return;
          const current = startup.workspaces.find((w) => w.id === workspace);
          aplicarLenguaDeWorkspace(current?.lengua ?? null);
          setWorkspaceMode(current?.default_permission_mode ?? null);
        }).catch((error) => setError(prosaDe(error)));
      }
    });
    onCleanup(() => void cliChanged.then((stop) => stop()));
    const cliOpen = listen<{ workspace: string; folder: string; task: string; operation: string; by_agent?: boolean }>("cli-open-task", (e) => {
      void (async () => {
        if (e.payload.workspace !== workspaceActivo()) {
          // Un agente que abre una tarea de otro workspace no se lleva a la
          // persona del que está mirando: lo pidió ella para lo suyo.
          if (e.payload.by_agent) {
            await invoke("cli_task_opened", { operation: e.payload.operation, error: "workspace_not_shown" });
            return;
          }
          await invoke("set_active_workspace", { id: e.payload.workspace });
          await aplicar(await invoke<Startup>("list_workspaces"));
        }
        await abrirSesion(e.payload.folder, e.payload.task, e.payload.task, true);
        const opened = sessionId() === e.payload.task && project() === e.payload.folder;
        await invoke("cli_task_opened", { operation: e.payload.operation, error: opened ? null : "open_superseded" });
      })().catch((error) => {
        setError(prosaDe(error));
        void invoke("cli_task_opened", { operation: e.payload.operation, error: prosaDe(error) }).catch(() => {});
      });
    });
    onCleanup(() => void cliOpen.then((stop) => stop()));

    const sesionEv = listen<SessionEvent>("session", (e) => {
      const generation = sessionGeneration;
      const { session, project, workspace } = e.payload;
      if (!esDelWorkspaceAbierto(workspace)) return;
      // El historial primero, y para todos: una tarea que la otra ventana
      // acaba de crear no está en ningún hilo de esta. Releer solo la abierta
      // la dejaría invisible hasta cambiar de proyecto.
      void refreshSessionsOnEvent(grupos());
      // La otra instancia escribió esa tarea: su árbol también pudo moverse.
      // Mismo motivo que en el cierre de turno.
      avisarDeLosArboles(session);
      // Borrada desde el CLI con su vista de Typst abierta: su Tinymist no tiene ya árbol que servir.
      if (hayVistasDe(session))
        void invoke<Session>("load_session", { project, id: session }).catch(() => void apagarVistasDe(session));
      if (vivas().includes(session)) return;
      if (esDeLaAbierta(session)) {
        void invoke<Session>("load_session", { project, id: session })
          .then((s) => loadResult(session, s, true, generation))
          .catch(() => {});
        return;
      }
      const pestana = pestanas.open().find((p) => p.id === session);
      if (pestana)
        void invoke<Session>("load_session", {
          project: pestana.project,
          id: session,
        })
          .then((s) => loadResult(session, s, true, generation))
          .catch(() => {});
    });
    onCleanup(() => void sesionEv.then((f) => f()));
    serviceListenersReady = Promise.all([chat, question, usageEv, agentsEv, cuentaEv, cliChanged, cliOpen, sesionEv]);
  });

  async function responderPermiso(p: PermissionRequest, allow: boolean) {
    setRespondiendoPermiso(true);
    setPermissionError(null);
    try {
      const guardado = await invoke<Turn>("respond_permission", {
        session: p.session,
        requestId: p.requestId,
        allow,
      });
      asentar(p.session, (ms) => [
        ...ms,
        {
          role: "user",
          text: guardado.text,
          turno: guardado.id ?? undefined,
          permission: guardado.permission ?? undefined,
          author: guardado.author ?? undefined,
        },
      ]);
      setPermissions((ps) => ps.filter((x) => x.requestId !== p.requestId));
    } catch (e) {
      setPermissionError(prosaDe(e));
    } finally {
      setRespondiendoPermiso(false);
    }
  }

  function ponerTerminal(session: string, comando: ComandoEnVivo) {
    setTerminales((ts) => ({ ...ts, [session]: comando }));
  }

  function soltarTerminal(session: string) {
    setTerminales((ts) => {
      if (!(session in ts)) return ts;
      const { [session]: _, ...resto } = ts;
      return resto;
    });
  }

  function quitarDeLaCola(session: string, id: string) {
    const saved = savedQueues.get(session);
    if (saved) savedQueues.set(session, { ...saved, items: saved.items.filter((q) => q.id !== id) });
    if (session === sessionId()) setCola((c) => c.filter((q) => q.id !== id));
  }

  // Lo que se pinta de un `!` en marcha. Más atrás no se lee y volver a pintarlo
  // entero en cada trozo es lo que cuesta.
  const SALIDA_EN_VIVO = 64_000;

  function alComando(session: string, kind: string, ev: { id: string; text: string; meta?: string | null; target?: string | null }) {
    if (kind === "shell_started") {
      adoptarComando(ev.id, session);
      const previo = terminales()[session];
      batch(() => {
        pendingStarts.delete(session);
        advanceTurn(session);
        setSettlingTurns((ids) => ids.filter((id) => id !== session));
        finishedTurns.delete(session);
        marcarViva(session);
        // El diario repite el arranque y los trozos al recargar: se empieza de cero.
        ponerTerminal(session, {
          id: ev.id,
          command: ev.text,
          cwd: ev.target ?? null,
          output: "",
          truncated: false,
          desde: previo?.id === ev.id ? previo.desde : Date.now(),
        });
        const carpeta = ev.target;
        if (carpeta) setCarpetasDeTerminal((cs) => ({ ...cs, [session]: carpeta }));
        const enCola = comandosDeLaCola.get(session);
        if (enCola) quitarDeLaCola(session, enCola);
      });
      return;
    }
    if (kind === "shell_output") {
      setTerminales((ts) => {
        const vivo = ts[session];
        if (!vivo || vivo.id !== ev.id) return ts;
        const output = vivo.output + ev.text;
        const sobra = output.length - SALIDA_EN_VIVO;
        return {
          ...ts,
          [session]: {
            ...vivo,
            output: sobra > 0 ? output.slice(sobra) : output,
            truncated: vivo.truncated || sobra > 0 || ev.meta === "truncated",
          },
        };
      });
      return;
    }
    const vivo = terminales()[session];
    const lanzado = lanzados.get(session);
    lanzados.delete(session);
    comandosDeLaCola.delete(session);
    const detenido = detenidos.delete(session);
    const codigo = ev.meta ? Number(ev.meta) : null;
    const restantes = session === sessionId() ? cola() : savedQueues.get(session)?.items ?? [];
    // Sin superficie utilizable nadie contesta: la salida viaja con el primer mensaje.
    const hayQuienConteste = (superficies() ?? []).some((s) => s.usable && s.agent === lanzado?.agent);
    const contestar = lanzado && codigo !== null && contestaALaTerminal(restantes, detenido, hayQuienConteste) ? lanzado : null;
    // Hasta que se relea el disco: sin esto la tarjeta desaparece un instante.
    if (vivo && codigo !== null) anexar(session, (ms) => [...ms, mensajeDeTerminal(vivo, codigo)]);
    if (contestar) setPorContestar((ss) => [...ss, session]);
    void settleTurn(session, true).then(() => {
      if (contestar) void contestarALaTerminal(session, contestar);
    });
  }

  function mensajeDeTerminal(vivo: ComandoEnVivo, codigo: number): Msg {
    const shell = {
      cwd: vivo.cwd ?? "",
      output: vivo.output,
      exit_code: codigo,
      truncated: vivo.truncated,
      duration_ms: Date.now() - vivo.desde,
    };
    return {
      role: "system",
      text: vivo.command,
      meta: "usó",
      shell,
      paso: pasoDe("command_execution", vivo.command, {
        ok: codigo === 0,
        detalle: { kind: "output", text: shell.output, exit_code: codigo, truncated: shell.truncated, cwd: shell.cwd },
      }),
    };
  }

  // Sin esta marca, entre releer el disco y abrir la respuesta la tarjeta dice que nadie contesta.
  const [porContestar, setPorContestar] = createSignal<readonly string[]>([]);
  /** El turno en que el agente contesta a la salida de la terminal, sin que nadie escriba. */
  async function contestarALaTerminal(session: string, lanzado: TerminalLanzada) {
    try {
      await abrirRespuestaALaTerminal(session, lanzado);
    } finally {
      setPorContestar((ss) => ss.filter((s) => s !== session));
    }
  }

  async function abrirRespuestaALaTerminal(session: string, lanzado: TerminalLanzada) {
    if (vivas().includes(session) || settlingTurns().includes(session)) return;
    pendingStarts.set(session, Symbol());
    marcarViva(session);
    try {
      const abrio = await invoke<boolean>("answer_shell_output", {
        agent: lanzado.agent,
        project: lanzado.project,
        session,
        model: lanzado.model,
        effort: lanzado.effort,
        permissionMode: lanzado.permission_mode,
      });
      if (abrio) {
        asentar(session, (ms) => [...ms, { role: "system", text: "", meta: "shell_reply", agent: lanzado.agent }]);
        return;
      }
    } catch (error) {
      anexar(session, (ms) => [...ms, { role: "system", text: prosaDe(error), meta: "fallo" }]);
    }
    pendingStarts.delete(session);
    marcarQuieta(session);
  }

  /** Corre un `!` y devuelve el error, o `null` si corrió. */
  async function ejecutarComando(session: string, lanzado: TerminalLanzada, command: string, queueId: string | null) {
    lanzados.set(session, lanzado);
    pendingStarts.set(session, Symbol());
    // Sin id hasta `shell_started`: hasta entonces la tarea tampoco es del agente.
    batch(() => {
      marcarViva(session);
      ponerTerminal(session, {
        id: "",
        command: command.trim(),
        cwd: carpetasDeTerminal()[session] ?? null,
        output: "",
        truncated: false,
        desde: Date.now(),
      });
    });
    try {
      await invoke<Corrida>("run_shell_command", { project: lanzado.project, session, command, queueId });
      return null;
    } catch (error) {
      if (lanzados.get(session) === lanzado) {
        lanzados.delete(session);
        pendingStarts.delete(session);
        if (!terminales()[session]?.id) {
          soltarTerminal(session);
          marcarQuieta(session);
        }
      }
      anexar(session, (ms) => [...ms, { role: "system", text: prosaDe(error), meta: "fallo" }]);
      return error;
    }
  }

  /** La tarea que abrió un `!` de esta ventana toma su fila, su pestaña y, si se sigue mirando, la vista. */
  function adoptarComando(runId: string, session: string) {
    const nace = nacenConComando.get(runId);
    if (!nace) return false;
    nacenConComando.delete(runId);
    nace.session = session;
    if (nace.generation !== sessionGeneration) return true;
    lanzados.set(session, nace.lanzado);
    batch(() => {
      soltarTerminal("");
      setArrancando(false);
      adoptarNacida(session, { provisional: nace.provisional, proyecto: nace.lanzado.project, titulo: nace.titulo, claveBorrador: nace.claveBorrador });
      if (claveAbierta() !== nace.claveBorrador) return;
      setSessionId(session);
      setHablandoCon(null);
      setColaDe(session);
    });
    return true;
  }

  /** Corre un `!` escrito sin tarea: Rust la abre con lo que la caja tiene puesto. Dice si corrió. */
  async function abrirConComando(command: string): Promise<boolean> {
    const proyecto = project();
    const claveBorrador = claveAbierta();
    const encargado = hablandoCon()?.name ?? null;
    const lanzado = { project: proyecto, agent: agent(), model: model() || null, effort: effort() || null, permission_mode: modo() || null };
    const titulo = tituloProvisional(command);
    const runId = crypto.randomUUID();
    const nace: ComandoQueNace = {
      lanzado,
      provisional: pintarNaciendo(proyecto, titulo, lanzado, encargado),
      titulo,
      claveBorrador,
      generation: sessionGeneration,
      session: null,
    };
    nacenConComando.set(runId, nace);
    lifecycleRevision++;
    batch(() => {
      setArrancando(true);
      ponerTerminal("", { id: "", command: command.trim(), cwd: null, output: "", truncated: false, desde: Date.now() });
    });
    try {
      const corrida = await invoke<Corrida>("run_shell_command", {
        project: proyecto,
        session: null,
        command,
        queueId: null,
        agent: lanzado.agent,
        model: lanzado.model,
        effort: lanzado.effort,
        permissionMode: lanzado.permission_mode,
        space: escritorio(),
        encargado,
        baseRef: draftBases()[claveBorrador] ?? null,
        runId,
      });
      // Sin su `shell_started` no hay nada pintado: se adopta aquí y se lee del disco.
      if (adoptarComando(runId, corrida.session) && nace.generation === sessionGeneration) void settleTurn(corrida.session, true);
      return true;
    } catch (error) {
      // Tras arrancar, la tarea queda con el fallo escrito y llega al releerla.
      if (nace.session) return false;
      nacenConComando.delete(runId);
      batch(() => {
        soltarTerminal("");
        setArrancando(false);
        retirarNaciendo(nace.provisional);
        pestanas.close(nace.provisional);
        olvidarPestana(nace.provisional);
      });
      if (nace.generation !== sessionGeneration) return false;
      // La frase de un modo que el agente no sostiene nombra al agente.
      const label = agents().find((a) => a.id === lanzado.agent)?.label ?? lanzado.agent;
      anexar("", (ms) => [...ms, { role: "system", text: prosaDe(error, { agent: label }), meta: "fallo" }]);
      return false;
    }
  }

  // Sale de la cola al arrancar (`shell_started`), no al terminar: mientras corre
  // ya se ve en su tarjeta.
  async function ejecutarDeLaCola(item: Encolado) {
    const abierta = sessionId();
    if (!abierta) return;
    setInjecting((items) => [...items, { session: abierta, id: item.id }]);
    comandosDeLaCola.set(abierta, item.id);
    const lanzado = {
      project: project(),
      agent: item.agent,
      model: item.model,
      effort: item.effort,
      permission_mode: item.permission_mode,
    };
    const error = await ejecutarComando(abierta, lanzado, item.text.trimStart().slice(1), item.id);
    if (comandosDeLaCola.get(abierta) === item.id) comandosDeLaCola.delete(abierta);
    setInjecting((items) => items.filter((q) => q.id !== item.id));
    const clave = error === null ? null : claveDe(error);
    if (error === null || clave === "chat.shell.not_queued" || clave === "chat.shell.not_from_person") {
      quitarDeLaCola(abierta, item.id);
    } else if (sessionId() === abierta) setRetenida("fallo");
  }

  async function detener() {
    const id = sessionId();
    if (!busy() || !id || stopping()) return;
    setDeteniendo(id);
    setPermissionError(null);
    if (terminales()[id] || lanzados.has(id)) {
      detenidos.add(id);
      try {
        if (!(await invoke<boolean>("stop_shell_command", { session: id }))) {
          detenidos.delete(id);
          setDeteniendo(null);
        }
      } catch (e) {
        detenidos.delete(id);
        setDeteniendo(null);
        anexar(id, (m) => [...m, { role: "system", text: t("shell.turn.stop_failed", { error: prosaDe(e) }), meta: "fallo" }]);
      }
      return;
    }
    try {
      await invoke("stop_turn", { project: project(), session: id });
      await reconcileActiveTurns();
      // Rust ya quitó el gate y cerró su stdin. La hoja desaparece en el mismo
      // gesto, sin esperar a que el proceso termine de emitir su cierre.
      setPermissions((ps) => ps.filter((p) => p.session !== id));
    } catch (e) {
      await reconcileActiveTurns();
      if (!vivas().includes(id)) return;
      setDeteniendo(null);
      anexar(id, (m) => [
        ...m,
        {
          role: "system",
          text: t("shell.turn.stop_failed", { error: prosaDe(e) }),
          meta: "fallo",
        },
      ]);
    }
  }

  // La cola se guarda en la carpeta de la sesión, no en esta máquina: es
  // del trabajo, no una preferencia, y se va con ella al borrarla. Sin
  // sesión el guardado se salta —el primer turno la crea y se guarda de
  // golpe. Lo que NO escribe es una mano vacía que estrena dueño —la
  // sesión recién abierta—: si su `.cola.json` no se pudo leer, guardarla
  // encima borraría lo único que quedaba dentro.
  createEffect(
    on([cola, colaDe] as const, ([items, de], antes) => {
      // `on` corre su cuerpo sin rastrear: leer aquí qué se está mirando
      // no suscribe este efecto a la sesión abierta.
      if (!guardable(de, sessionId())) return;
      // La mano no cambió y está vacía: esto es el estreno de dueño y nada más.
      if (antes && antes[0] === items && items.length === 0) return;
      invoke("save_queue", {
        project: project(),
        session: de,
        queued: items,
      }).catch((e) =>
        anexar(de, (m) => [
          ...m,
          {
            role: "system",
            text: t("shell.queue.save_failed", { error: prosaDe(e) }),
            meta: "aviso",
          },
        ]),
      );
    }),
  );

  createEffect(() => {
    const id = sessionId();
    if (id && sueltaElBorrador(retenida(), vivas().includes(id), draftFromDisk === id)) {
      draftFromDisk = null;
      setRetenida(null);
    }
  });

  createEffect(() => {
    if (retenida() !== "session" || !cola().length || !sessionId()) return;
    const id = sessionId();
    const proyecto = project();
    const generation = sessionGeneration;
    let cancelled = false;
    let checking = false;
    const timer = setInterval(async () => {
      if (checking) return;
      checking = true;
      try {
        const ready = await invoke<boolean>("queue_ready", { project: proyecto, session: id });
        if (ready && !cancelled && generation === sessionGeneration && id === sessionId()) {
          setRetenida(null);
        }
      } catch {
        // Un fallo al consultar no demuestra que la tarea ya esté disponible.
      } finally {
        checking = false;
      }
    }, 1000);
    onCleanup(() => { cancelled = true; clearInterval(timer); });
  });

  // El lote se retira y reserva en la misma actualización: no pueden salir dos turnos.
  createEffect(
    on(
      [cola, colaDe, sessionId, queueBusy, editando, retenida, esperando, cierres] as const,
      ([items, de, mirando, ocupado, edit, ret, esp, cierre]) => {
        if (items.length === 0) {
          // Sin nada en cola no hay nada que retener. Si no se soltara aquí, un
          // fallo dejaría detenida para siempre la cola que venga después.
          if (ret) setRetenida(null);
          return;
        }
        // El cierre permite reintentar una sesión reservada por otro turno.
        if (ret === "session") {
          if (cierre === cierreDeLaRetencion) return;
          setRetenida(null);
          return;
        }
        // `esperando` retiene la cola igual que un fallo: lo que está en
        // cola se escribió antes de que el agente preguntara. Soltarlo
        // haría correr el turno siguiente sin el dato que pidió.
        if (
          !despachable({
            pendientes: items.length,
            de,
            mirando,
            ocupado,
            editando: edit,
            retenida: ret,
            esperando: esp,
          })
        )
          return;
        const { mensaje, lote, resto } = siguienteLote(items);
        if (!mensaje) return;
        if (esDeLaTerminal(lote[0])) {
          void ejecutarDeLaCola(lote[0]);
          return;
        }
        batch(() => {
          // Lo que no cabe en este turno —lo que viene de otro remitente— se
          // queda en la cola y sale en el siguiente, no se pierde ni se cuela
          // firmado por quien no lo escribió.
          setCola(resto);
          void enviar(mensaje);
        });
      },
    ),
  );

  async function drainHiddenQueue(session: string) {
    const queued = savedQueues.get(session);
    if (!queued?.items.length || session === sessionId() || vivas().includes(session) || drainingQueues.has(session) ||
      settlingTurns().includes(session) || injecting().some((item) => item.session === session)) return;
    if (queued.retained && queued.retained !== "session") return;
    const history = hilos()[session];
    if (!history || preguntasPendientes([...history.base, ...history.vivo])) return;
    const { mensaje: message, lote, resto } = siguienteLote(queued.items);
    // Un `!` no corre en una tarea que nadie mira: espera a que se abra.
    if (!message || esDeLaTerminal(lote[0])) return;
    const generation = sessionGeneration;
    drainingQueues.add(session);
    savedQueues.set(session, { ...queued, items: resto, retained: null });
    marcarViva(session);
    try {
      await invoke("save_queue", { project: queued.project, session, queued: resto });
      if (generation !== sessionGeneration) return;
      if (!await enviar(message, undefined, { project: queued.project, session })) throw new Error("queue-send-failed");
    } catch (error) {
      if (generation !== sessionGeneration) return;
      const restored = {
        ...queued,
        // Lo que salió vuelve delante de lo que quedó esperando: `savedQueues`
        // ya tiene el resto, y reponer la lista entera lo duplicaría.
        items: [...lote, ...(savedQueues.get(session)?.items ?? [])],
        retained: claveDe(error) === "history.error.busy" ? "session" as const : "fallo" as const,
      };
      savedQueues.set(session, restored);
      if (session === sessionId()) batch(() => {
        setRetenida(restored.retained);
        setCola(restored.items);
        setColaDe(session);
      });
      marcarQuieta(session);
      void invoke("save_queue", { project: queued.project, session, queued: restored.items }).catch((error) => {
        anexar(session, (messages) => [...messages, { role: "system", text: t("shell.queue.save_failed", { error: prosaDe(error) }), meta: "aviso" }]);
      });
    } finally {
      drainingQueues.delete(session);
    }
  }

  onMount(() => {
    const timer = setInterval(() => {
      for (const [session, queued] of savedQueues) {
        if (queued.retained === "session") void drainHiddenQueue(session);
      }
    }, 1000);
    onCleanup(() => clearInterval(timer));
  });

  // Al cerrar un turno se refresca el historial, y la carpeta: una tarea
  // recién nacida no pasó por `abrirSesion`, y sin carpeta la tarjeta de
  // entrega no tiene contra qué armar la ruta.
  createEffect(
    on([busy, sessionId], ([ocupado, id], antes) => {
      if (ocupado || !id) return;
      // Pasar de una tarea a otra no: `abrirSesion` ya lee su carpeta, y el
      // historial entero parsea cada `session.json` del workspace.
      const previa = antes?.[1];
      if (previa && previa !== id && !esProvisional(previa)) return;
      void refreshFolder(project(), id);
      void refreshSessions(grupos());
    }),
  );

  // Cambiar de tarea NO cierra la tercera columna: todo lo que enseña viene
  // por props derivadas de la tarea (`session()`) y se repinta sola.

  // El historial se recarga cuando cambia la lista de proyectos, no el activo.
  createEffect(on(grupos, (g) => void refreshSessions(g)));

  // El catálogo depende del agente. No se resetea el modelo elegido aquí: al
  // abrir una sesión se fijan agente y modelo juntos, y un efecto que limpiara
  // el modelo correría después y borraría el que se acaba de restaurar.
  //
  // Cada petición cuesta un proceso del CLI (`models::opencode_catalog`) y esto
  // corre por cambio de agente y por panel montado: se reusa el catálogo que ya
  // está, y dos peticiones del mismo agente a la vez son una.
  //
  // `forzar` es de quien sabe que cambió de qué depende la respuesta: la cuenta
  // activa, la clave o el consentimiento del workspace.
  const catalogosEnVuelo = new Map<string, Promise<void>>();
  function cargarModelos(a: string, forzar = false) {
    if (!forzar && untrack(() => catalogos()[a])) return Promise.resolve();
    const yaVa = catalogosEnVuelo.get(a);
    if (yaVa) return yaVa;
    const pedido = invoke<AgentModels>("list_models", { agent: a })
      .then((catalogo) => {
        setCatalogos((actuales) => ({ ...actuales, [a]: catalogo }));
        // La primera carga tiene que dejar una elección ejecutable. Este punto
        // conoce qué petición terminó; un catálogo de otro agente no puede
        // completar por accidente el modelo del agente activo.
        if (a !== agent()) return;
        const actual = superficies()?.find((s) => s.id === superficie());
        const disponibles = catalogo.models.filter((m) => esDe(actual, m));
        if (
          disponibles.length > 0 &&
          !disponibles.some((m) => m.id === model())
        ) {
          setModel(disponibles[0].id);
        }
      })
      .catch(() => {
        setCatalogos((actuales) => ({ ...actuales, [a]: null }));
      })
      .finally(() => catalogosEnVuelo.delete(a));
    catalogosEnVuelo.set(a, pedido);
    return pedido;
  }

  // Envuelto y no pasado suelto: `on` le daría al segundo parámetro el valor
  // anterior del agente, que es una cadena y fuerza la recarga siempre.
  createEffect(on(agent, (a) => void cargarModelos(a)));

  // Qué modos puede el agente elegido, y que el elegido siga siendo uno
  // de ellos: cambiar de agente puede dejar el modo actual sin sostén
  // —Codex y Antigravity solo pueden automático—, y un desplegable en
  // «Manual» con Codex delante prometería un control que no existe. El
  // backend niega el turno igual (`chat::send_message`), pero enterarse
  // al mandar es tarde: se baja al primero disponible, y se ve.
  createEffect(
    on(agent, (a) => {
      if (!a) {
        setModos([]);
        return;
      }
      void invoke<ModoDePermiso[]>("list_permission_modes", { agent: a })
        .then((lista) => {
          if (a !== agent()) return;
          batch(() => {
            setModos(lista);
            const puede = lista.filter((m) => !m.falta);
            if (!puede.some((m) => m.id === modo())) {
              // Lo elige `modoInicial`: el del workspace o el último que la
              // persona eligió a mano, y si este agente no lo sostiene, el que
              // resolvió el backend.
              setModo(modoInicial(lista, workspaceMode() ?? modoRecordado()));
            }
          });
        })
        .catch(() => setModos([]));
    }),
  );

  /**
   * La caja en blanco arranca con el modo del workspace si eligió uno, salvo
   * que su borrador ya traiga uno elegido en ella.
   */
  function startWithWorkspaceMode() {
    const mode = workspaceMode();
    if (!mode || sessionId() || borrador().configuration?.mode) return;
    const list = modos();
    setModo(list.some((m) => !m.falta) ? modoInicial(list, mode) : mode);
  }
  createEffect(on(workspaceMode, startWithWorkspaceMode, { defer: true }));

  onMount(() => {
    const onDefaultMode = (e: Event) => {
      const change = (e as CustomEvent<DefaultPermissionModeChange>).detail;
      if (change.workspace === workspaceActivo()) setWorkspaceMode(change.mode);
    };
    window.addEventListener(DEFAULT_PERMISSION_MODE_EVENT, onDefaultMode);
    onCleanup(() => window.removeEventListener(DEFAULT_PERMISSION_MODE_EVENT, onDefaultMode));
  });

  // Qué se puede elegir para trabajar. `inicial` solo en el arranque: ahí no
  // hay nada elegido y hay que empezar por algo que se pueda usar. Después no
  // se toca lo elegido: quien acaba de elegir una superficie no ve cómo se le
  // mueve el selector por una consulta que termina tarde.
  async function cargarSuperficies(inicial: boolean) {
    try {
      const s = await invoke<Superficie[]>("list_surfaces");
      const primera = s.find((x) => x.usable);
      batch(() => {
        setSuperficies(s);
        if (!inicial) return;
        // El arranque no hereda el agente ni el modelo del workspace anterior.
        // Si nada sirve, no se fabrica una selección con la primera fila del
        // catálogo: la caja ofrece conectar algo y ningún modelo se finge.
        setSuperficie(primera?.id ?? "");
        if (!primera) {
          setModel("");
          setEffort("");
        } else if (primera.agent !== agent()) {
          setAgent(primera.agent);
          setModel("");
          setEffort("");
        }
      });
      const agentes = new Set(
        s.filter((x) => x.usable || x.agent === agent()).map((x) => x.agent),
      );
      // Envuelto por lo mismo que el efecto de arriba: `map` le pasaría el
      // índice como `forzar`, y el primero de la lista no forzaría nunca.
      await Promise.all([...agentes].map((a) => cargarModelos(a, !inicial)));
    } catch {
      setSuperficies([]);
    }
  }

  // La superficie sigue al agente y al modelo, y no al revés: los tres
  // pueden moverse sin pasar por el selector —abrir una tarea fija
  // agente y modelo, y el catálogo llega después de preguntarle al CLI.
  // Sin esto, una tarea de modelo gratuito abriría enseñando «OpenCode»
  // con su desplegable vacío. `superficieDe` conserva lo ya elegido si
  // sigue sirviendo.
  createEffect(
    on([superficies, agent, model, models, sessionId], ([sups, a, m, cat, sesion]) => {
      if (!sups) return;
  // Una conversación nueva empieza por algo que pueda responder. Si la
  // selección dejó de servir tras volver de Configuración, se mueve a la
  // primera usable; si no hay ninguna, se vacía. Solo una tarea guardada
  // conserva su superficie caída: cambiarle el agente en silencio cambiaría
  // la tarea.
      if (!sesion) {
        const elegida = sups.find((s) => s.id === superficie());
        if (!elegida?.usable) {
          const primera = sups.find((s) => s.usable);
          batch(() => {
            setSuperficie(primera?.id ?? "");
            if (primera && primera.agent !== a) {
              setAgent(primera.agent);
              setModel("");
              setEffort("");
            }
          });
          return;
        }
      }
      // Sin ninguna para este agente —una fila retirada de la tabla, o una que
      // la app dejó de saber conducir— la selección se vacía en vez de quedarse
      // en la anterior: enseñar otra superficie sería decir que la tarea corre
      // con algo que no es lo suyo. La caja lo dice y no deja mandar.
      const id = superficieDe(sups, a, m, cat?.models ?? [], superficie());
      if ((id ?? "") !== superficie()) setSuperficie(id ?? "");
    }),
  );

  // El modelo elegido tiene que ser de la superficie elegida: ningún CLI
  // publica con qué modelo corre si no se le pasa, y la única forma de
  // que lo leído sea lo que corre es elegirlo y pasarlo. Se elige dentro
  // de la superficie y no con `models[0]`: con el catálogo partido en
  // dos, el primero de la lista entera puede ser de pago en «Modelos
  // Free». Uno que ya no está en el catálogo sí se cambia.
  createEffect(
    on([superficie, superficies, models], ([id, sups, cat]) => {
      const s = sups?.find((x) => x.id === id);
      const lista = (cat?.models ?? []).filter((m) => esDe(s, m));
      if (lista.length === 0) return;
      if (!lista.some((m) => m.id === model())) setModel(lista[0].id);
    }),
  );

  // Lo que el menú del chat ofrece, y `null` mientras no se ha leído. Se
  // compone aquí y no dentro del JSX: un prop compuesto con `&&` entrega
  // `false`, no `null`, mientras `superficies()` no tiene valor —el
  // compilador de Solid lo booleaniza para memoizarlo—, y `false.find` lanza
  // en el primer render. Mismo defecto que documenta AGENTS.md § monta, con
  // `Setup`.
  const menuDeSuperficies = () => {
    const todas = superficies();
    return todas && paraElMenu(todas, superficie());
  };

  // Autorizar en Configuración cambia qué hay que ofrecer aquí: el catálogo
  // de un agente que manda material fuera sin pedir credencial sale vacío
  // hasta que este workspace lo consiente (`runtime/models.rs`). Sin esto, la caja de
  // chat se quedaba con la lista vacía hasta cambiar de agente y volver.
  // Aceptar es además lo que hace aparecer «Modelos Free»: la misma consulta
  // que decide si se puede usar es la que hay que rehacer.
  onMount(() => {
    const refrescar = () => {
      void cargarSuperficies(false);
    };
    window.addEventListener("harness:consentimiento", refrescar);
    onCleanup(() =>
      window.removeEventListener("harness:consentimiento", refrescar),
    );
  });

  // Lo que el menú de la barra ofrece depende del agente y del workspace, no
  // del proyecto: sus comandos, y las skills que la proyección pone en su carpeta.
  createEffect(on(agent, (a) => cargarComandos(a)));

  /**
   * Lo que esta tarea le va a adjuntar al turno: lo que ya lee más lo que está
   * puesto en la caja y todavía no ha viajado.
   */
  const fuentesDeLaTarea = createMemo(
    () => unirFuentes(adjuntas(), sourceIds()),
    undefined,
    { equals: sameSources },
  );

  // Las menciones @ salen de la carpeta de trabajo (`session`) y de lo adjunto.
  // Se relee al cambiar de tarea o de fuentes, no en cada turno: recorrer
  // una fuente entera es caro, y el material es de SOLO LECTURA. Se le pasa
  // el proyecto, la sesión y las fuentes, no las rutas ya resueltas: armarlo
  // aquí escribiría la misma regla en dos lenguajes, y su divergencia no
  // daría error, solo resolvería a otro archivo al mandar la mención.
  createEffect(
    on([project, fuentesDeLaTarea, excludedSourceIds, sessionId], ([p, fs, excluidas, session]) => {
      let current = true;
      onCleanup(() => {
        current = false;
      });
      invoke<MentionSources>("list_mentions", {
        project: p,
        sources: fs,
        excludedSources: excluidas,
        session,
      })
        .then((result) => {
          if (current) setMentionSources(result);
        })
        .catch(() => {
          if (current) setMentionSources(null);
        });
    }),
  );

  // La ocupación de la ventana se deriva del registro cada vez que se abre. No
  // se guarda en la sesión ni se acumula: manda el último turno registrado.
  createEffect(
    on([sessionId, project], ([id, p]) => {
      if (!id || !p) {
        setVentana(null);
        return;
      }
      invoke<SessionUsage>("session_usage", { project: p, session: id })
        .then((s) => setVentana(ventanaDe(s.records)))
        .catch(() => setVentana(null));
    }),
  );

  /** La fuente de contexto del workspace: su raíz de gobierno, una sola. */
  async function elegirCarpetaDelWorkspace() {
    const r = await open({ directory: true, multiple: false });
    if (typeof r !== "string") return;
    try {
      await invoke("set_workspace_source", { kind: "folder", locator: r });
      await aplicar(await invoke<Startup>("list_workspaces"));
    } catch (e) {
      setError(prosaDe(e));
    }
  }

  /**
   * Relee la lista del disco sin tocar nada. El tipo de una carpeta se mide
   * en disco: la que el agente convirtió en repositorio con `git init` se
   * seguía viendo como carpeta hasta reabrir la app, y sin repositorio no hay
   * ni árbol propio ni rama base.
   */
  async function releerProyectos() {
    const workspace = workspaceActivo();
    try {
      const items = await invoke<Project[]>("list_projects");
      if (workspace === workspaceActivo()) setProjectList(items);
    } catch {
      // La lista anterior sigue sirviendo: releer es una puesta al día.
    }
  }

  async function renombrarProyecto(id: string, name: string) {
    try {
      await invoke("rename_project", { id, name });
      setProjectList(await invoke<Project[]>("list_projects"));
    } catch (e) {
      setError(prosaDe(e));
    }
  }

  // Abre el proyecto en el panel principal. Cambia además el contexto activo
  // —es `elegirProyecto`—: la tarea que se empiece desde aquí es suya, y
  // mirar un proyecto mientras se escribe contra otro es justo el error que
  // el selector de la caja existe para evitar.
  function abrirProyecto(id: string) {
    elegirProyecto(id);
    setProyectoAbierto(id);
  }

  /** Material que leerá toda tarea del proyecto, no solo la abierta. */
  async function adjuntarAlProyecto(id: string, source: string) {
    try {
      await invoke("attach_known_source", { project: id, source });
      setProjectList(await invoke<Project[]>("list_projects"));
    } catch (e) {
      setError(prosaDe(e));
    }
  }

  async function quitarDelProyecto(id: string, source: string) {
    try {
      await invoke("detach_source", { project: id, source });
      setProjectList(await invoke<Project[]>("list_projects"));
    } catch (e) {
      setError(prosaDe(e));
    }
  }

  // Registra —o quita— la carpeta de trabajo del proyecto. Avisa al panel del
  // árbol de trabajo, que la enseña sin que alguien reabra nada.
  async function carpetaEditable(id: string, dir: string | null) {
    try {
      await invoke("set_project_work_tree", { id, dir });
      setProjectList(await invoke<Project[]>("list_projects"));
      window.dispatchEvent(new CustomEvent("harness:copia"));
    } catch (e) {
      setError(prosaDe(e));
    }
  }

  async function borrarProyecto(id: string) {
    try {
      await invoke("delete_project", { id });
      if (proyectoAbierto() === id) setProyectoAbierto(null);
      if (project() === id) {
        nuevaSesion();
        setProject("");
      }
      const quedan = await invoke<Project[]>("list_projects");
      setProjectList(quedan);
      void reloadSpaces();
      await refreshSessions(["", ...quedan.map((p) => p.id)]);
    } catch (e) {
      setError(prosaDe(e));
    }
  }

  // Elegir proyecto en el selector cambia el contexto entero: sesiones, chat
  // y artefactos son del proyecto y no se arrastran. Es un gesto, no un valor
  // derivado de un efecto sobre `project`: ahí no se distingue elegir de
  // restituir, y abrir una sesión de otro proyecto cambia el mismo valor,
  // corriendo el efecto después y quitándole el id a la sesión recién
  // abierta.
  function elegirProyecto(name: string) {
    // Lo que la tarea que se deja ya lee no es de la conversación en blanco.
    // Su borrador —lo pendiente, lo escrito— se queda en su pestaña y no viaja:
    // el de la conversación en blanco es el suyo, y si tenía algo puesto antes
    // de nombrar el trabajo, sigue ahí.
    batch(() => {
      setAdjuntas([]);
      setProject(name);
      setSessionId(null);
      restoreDraftConfiguration();
      setFolder(null);
      soltarCola();
    });
  }

  // Sin cola en la mano: se llama al moverse de sesión o de proyecto, en un
  // solo lote —de eso depende que no se borre lo que se deja atrás—. Cada
  // asignación suelta corre los efectos antes de la siguiente: `setCola([])`
  // con `colaDe` todavía nombrando la sesión que se abandona es un
  // `save_queue` con la cola vacía, y el `.cola.json` de esa tarea desaparece
  // con lo que se había escrito para ella.
  function soltarCola() {
    batch(() => {
      setColaDe(null);
      setCola([]);
      setRetenida(null);
      setEditando(false);
    });
  }

  // Abrir una sesión de otro proyecto cambia el contexto entero: la sesión
  // pertenece a su proyecto y arrastrarla al activo la sacaría de sitio.
  async function abrirSesion(proyecto: string, id: string, activar = id, propagateError = false) {
    // Rust no sabe de ella todavía: leerla daría un fallo por una fila que la
    // pantalla pinta a propósito.
    if (esProvisional(id)) return;
    setHablandoCon(null);
    // Una tarea se abre en su escritorio: su pestaña va en esa tira.
    const suyo = escritorioDeFila(filaDe(id), spaces());
    if (suyo && suyo !== escritorio()) cambiarEscritorio(suyo, false);
    // Abrir es tener a mano: la tarea gana pestaña si no la tenía, y si la
    // tenía se activa esa — nunca una segunda.
  // Antes de cargar nada: `activar` es un parámetro. Poner la pestaña delante
  // después del `await` enseñaría la conversación un cuadro antes que el
  // archivo que se acaba de pulsar. Juntas: entre una y otra la pestaña nueva
  // queda detrás de la que estaba, y `montadas` la desmontaría.
    batch(() => {
      pestanas.ensure({ id, project: proyecto, titulo: filaDe(id)?.title ?? "" });
      pestanas.activate(activar);
    });
    if (id === sessionId() && proyecto === project()) {
      // Ya estaba cargada: volver a ella desde una pestaña suya no relee la
      // transcripción ni la cola. Releerlas tiraría lo que el turno vivo lleva
      // dicho y volvería a poner en la caja lo que quedó encolado.
      setProyectoAbierto(null);
      return;
    }
    setProyectoAbierto(null);
    setProject(proyecto);
    setSessionId(id);
    soltarCola();
  // Antes del `await`: el hueco que hay que tapar empieza en el
  // `setSessionId` de arriba, no cuando la lectura del disco tarda. Ver
  // `cargandoHilo`. Solo se marca si su hilo NO está ya en memoria: con
  // varias ventanas, pulsar en una para darle el mando vuelve a pasar por
  // aquí aunque su transcripción lleve rato pintada, y marcarla como «viene
  // en camino» la mandaría al esqueleto y de vuelta.
    if (!hilos()[id]) setCargandoHilo(id);
    const generation = sessionGeneration;
    const current = () => generation === sessionGeneration && sessionId() === id && project() === proyecto;
    try {
      const s = await invoke<Session>("load_session", { project: proyecto, id });
      if (!current()) return;
      // Reanudar conserva con qué corrió: una sesión continuada con otro agente
      // o con otro modelo ya no es la misma sesión.
      setAgent(s.agent);
      setModel(modeloDeSubtarea(s) ?? "");
      setEffort(s.effort ?? "");
      // El chat de un encargado no es una tarea que se reabre para releer
      // su historial: es su conversación de siempre, y su perfil dice con
      // qué prefiere seguir. Una preferencia guardada gana a lo último que
      // corrió — sin tocar los turnos ya escritos, solo la caja.
      if (s.chat_de_agente && s.encargado) {
        try {
          const perfiles = await invoke<Record<string, AgentProfileData>>(
            "list_agent_profiles",
            { project: proyecto },
          );
          const perfil = perfiles[s.encargado];
          if (!current()) return;
          if (perfil?.agent) setAgent(perfil.agent);
          if (perfil?.model) setModel(perfil.model);
          if (perfil?.effort) setEffort(perfil.effort);
        } catch {
          // Un perfil que no se pudo leer deja la caja con lo de la sesión.
        }
      }
  // Y con cuánta vigilancia corrió: una tarea escrita antes de que esto
  // existiera no lo dice, y ahí se deja vacío. El efecto de arriba lo baja al
  // que el agente sostenga, lo mismo que hace el backend con lo que nadie
  // eligió (`agents::Permisos::resolver`).
      setModo(s.permission_mode ?? "");
      // Lo que esta tarea ya lee. No son pendientes: están guardados en ella.
      setAdjuntas(s.sources ?? []);
      editarBorrador(id, (b) => ({
        ...b,
        excludedSourceIds: s.excluded_sources ?? [],
      }));
      // Y encima, lo que se eligió en su caja sin llegar a mandar nada.
      restoreSessionConfiguration();
      // Lo del disco, y sin vaciar lo vivo: si está contestando, lo que lleva
      // dicho sigue en su hilo y se pinta detrás.
      loadResult(id, s, false, generation);
      void refreshFolder(proyecto, id);
    } catch (e) {
      releer(id, [{ role: "system", text: prosaDe(e) }], false);
      if (propagateError) throw e;
    } finally {
      // Solo si sigue siendo esta la que se espera: con dos aperturas
      // solapadas, la respuesta tardía de la primera apagaría el
      // indicador de la segunda y su hilo se pintaría a medias.
      setCargandoHilo((c) => (c === id ? null : c));
    }
    // Después de la transcripción, que la reemplaza entera: un aviso
    // escrito antes de este punto no dejaría rastro.
    try {
      const cached = savedQueues.get(id);
      const q = cached?.items ?? await invoke<Encolado[]>("load_queue", {
        project: proyecto,
        session: id,
      });
      if (!current()) return;
      const restored = savedQueues.get(id);
      const retentions = workspaceRetentions.get(workspaceActivo() ?? "");
      const kept = retentions?.get(id);
      retentions?.delete(id);
      const retained = restored ? restored.retained : retencionAlCargar(q.length, kept);
      draftFromDisk = !restored && kept === undefined && retained === "borrador" ? id : null;
      batch(() => {
        setCola(restored?.items ?? q);
        setColaDe(id);
        setRetenida(retained);
      });
    } catch (e) {
      if (!current()) return;
      // Sin esto la cola queda sin dueño: no es «no pude leerla», es que
      // la de esta tarea deja de funcionar —el despacho exige que la cola
      // en la mano sea la de la tarea abierta. Lo no leído se conserva en
      // su archivo: el guardado cuelga del contenido, y adoptar una mano
      // vacía no lo pisa.
      setColaDe(id);
      anexar(id, (m) => [
        ...m,
        {
          role: "system",
          text: t("shell.queue.load_failed", { error: prosaDe(e) }),
          meta: "aviso",
        },
      ]);
    }
  }

  /**
   * Trae la transcripción de una tarea sin abrirla: la usan las ventanas que
   * vuelven de un reparto guardado, para que su panel enseñe lo suyo aunque el
   * mando esté en otra. No toca la sesión abierta —eso lo hace `abrirSesion` al
   * pulsarla—: solo deja su hilo en memoria.
   */
  async function loadThread(project: string, id: string) {
    if (esProvisional(id) || hilos()[id]) return;
    const generation = sessionGeneration;
    try {
      const s = await invoke<Session>("load_session", { project, id });
      if (generation !== sessionGeneration) return;
      loadResult(id, s, false, generation);
    } catch {
      // Sin hilo, su panel queda vacío hasta pulsarla, y ahí `abrirSesion` lo
      // reintenta. No hay nada que avisar de una ventana que nadie pidió.
    }
  }

  /**
   * Carga la tarea de delante de cada ventana del reparto, menos `skip`, que es
   * la que abre `abrirSesion`. Es lo que hace que volver a un espacio no deje
   * sus ventanas en blanco, sin cargar ninguna pestaña que no esté delante.
   */
  function loadWindowThreads(skip: string | null) {
    for (const site of paneles.sites()) {
      const id = paneles.activeTabAt(site);
      if (!id || id === skip || id === sessionId()) continue;
      const tab = pestanas.open().find((p) => p.id === id);
      if (tab && isTaskTab(tab)) void loadThread(tab.project, tab.session);
    }
  }

  function hablarConEncargado(enProyecto: string, name: string) {
    abrirBorradorDeAgente(enProyecto, name);
  }

  /** Una tarea nueva con la carpeta y el agente ya elegidos. */
  function abrirBorradorDeAgente(enProyecto: string, name: string) {
    setHablandoCon({ project: enProyecto, name });
    irAlBlanco(enProyecto);
    // El borrador tampoco arranca a ciegas: si ya declaró con qué
    // prefiere trabajar, la caja en blanco lo trae puesto en vez del
    // último agente que se usó en cualquier otra conversación.
    void invoke<Record<string, AgentProfileData>>("list_agent_profiles", { project: enProyecto })
      .then((perfiles) => {
        const sigue = hablandoCon();
        if (sigue?.project !== enProyecto || sigue.name !== name) return;
        const perfil = perfiles[name];
        if (!perfil) return;
        batch(() => {
          if (perfil.agent) setAgent(perfil.agent);
          if (perfil.model) setModel(perfil.model);
          if (perfil.effort) setEffort(perfil.effort);
        });
      })
      .catch(() => {});
  }

  /**
   * Qué perfil se pide abrir desde el riel. Lo consume la celda que acaba
   * teniendo delante a ese agente: su conversación se abre antes, y sin esta
   * espera el perfil se pediría a una celda que todavía enseña otra cosa.
   */
  const [requestedProfile, setRequestedProfile] = createSignal<{
    project: string;
    name: string;
  } | null>(null);

  function cerrarAjustes() {
    setSettings(null);
    setCuentasTocadas((n) => n + 1);
    // Conectar una cuenta, pegar una clave o activar los gratuitos
    // ocurre ahí dentro, y es justo lo que decide qué ofrece el menú del
    // chat. Sin esto habría que reabrir la app para verlo.
    void cargarSuperficies(false);
  }

  function openAgentProfile(enProyecto: string, name: string) {
    setRequestedProfile({ project: enProyecto, name });
    hablarConEncargado(enProyecto, name);
  }

  /**
   * Qué fila del riel se señala al abrir un chat o un borrador de agente.
   */
  const agenteSenalado = createMemo(() => {
    const id = sessionId();
    if (id) {
      for (const [proyecto, filas] of Object.entries(sesiones())) {
        const fila = filas.find((r) => r.id === id);
        if (fila)
          return fila.chat_de_agente && fila.encargado
            ? { project: proyecto, name: fila.encargado }
            : null;
      }
      return null;
    }
    return hablandoCon();
  });

  function nuevaSesion(enProyecto?: string) {
    // Empezar una tarea es cuando más barato sale enterarse de que el
    // material se movió: si esta tarea va a leer un repositorio, ¿está al
    // día? Se comprueba, no se trae —traer mueve el árbol que otras
    // tareas leen, y esa decisión es de quien mira el aviso.
    window.dispatchEvent(new CustomEvent("harness:tarea-nueva"));
    // Una tarea nueva a secas no es de nadie: si la anterior se abrió desde
    // la fila de un agente, ese nombre no puede arrastrarse hasta esta.
    setHablandoCon(null);
    irAlBlanco(proyectoDeNuevaTarea(enProyecto, carpetaDelEscritorio(project())));
  }

  /**
   * La conversación en blanco: lo que el panel enseña sin tarea abierta.
   * `nuevaSesion` es esto más el aviso de que se va a empezar algo. No es
   * una pestaña: «Nueva tarea» sería el rótulo de algo que no existe. Su
   * borrador —separado por proyecto— espera hasta el primer turno.
   */
  function irAlBlanco(enProyecto = project()) {
    batch(() => {
      setProject(enProyecto);
      setProyectoAbierto(null);
      pestanas.activate(null);
    // Y la ventana también se queda sin pestaña delante: `pestanas` y
    // `paneles` llevan la cuenta por separado. Sin esto, la ventana
    // seguía enseñando la conversación anterior bajo la pantalla en blanco.
      paneles.showDraft();
      setSessionId(null);
      restoreDraftConfiguration();
      startWithWorkspaceMode();
      setFolder(null);
    // Lo que la tarea que se deja ya lee es suyo; el borrador de la
    // conversación en blanco es el suyo y no se toca.
      setAdjuntas([]);
      soltarCola();
      // El hilo sin id es el del primer turno. Si Rust lo negó, se quedaba
      // pintado en toda tarea nueva, de este proyecto o de otro.
      if (!arrancando()) soltarHilo("");
    });
    pedirElCampo();
  }

  function closeActiveTab() {
    if (settings() !== null || alta() !== null) return;
    const id = pestanaActiva();
    if (id) cerrarPestana(id);
  }

  /**
   * Cerrar una pestaña no cierra la sesión: la quita de la tira y suelta
   * su borrador. Su turno, si sigue corriendo, sigue corriendo —Rust no
   * sabe de pestañas—; si era la activa pasa a la vecina y sin vecinas,
   * al blanco: el reparto de un navegador.
   */
  function cerrarPestana(id: string) {
    cerrarPestanas([id]);
  }

  /**
   * Varias a la vez, desde el menú de la tira: una escritura y una vecina. Si en
   * lo que se va hay un archivo sin guardar, primero se pregunta.
   */
  function cerrarPestanas(ids: string[]) {
    const sinGuardar = pestanas.dirtyTabsToClose(ids);
    if (sinGuardar.length > 0) {
      setCierreSinGuardar({ ids, archivos: sinGuardar.map((a) => a.ruta), sucios: sinGuardar.map((a) => a.id) });
      return;
    }
    cerrarPestanasYa(ids);
  }

  /** Lo que la tira tenía sin guardar cuando alguien pidió cerrar. */
  const [cierreSinGuardar, setCierreSinGuardar] = createSignal<
    { ids: string[]; archivos: string[]; sucios: string[] } | null
  >(null);

  async function resolverCierre(decision: "guardar" | "descartar") {
    const cierre = cierreSinGuardar();
    if (!cierre) return;
    setCierreSinGuardar(null);
    // Si guardar falla, no se cierra y se trae delante el archivo que falló: su
    // visor enseña el fallo y el borrador sigue en su editor.
    if (decision === "guardar" && !(await pestanas.saveFiles(cierre.sucios))) {
      const pendiente = pestanas.dirtyTabsToClose(cierre.ids)[0];
      if (pendiente) void activarPestana(pendiente);
      return;
    }
    cerrarPestanasYa(cierre.ids);
  }

  function cerrarPestanasYa(ids: string[]) {
    const pedidas = new Set(ids);
    const cerradas = pestanas.open().filter((x) => pedidas.has(x.id));
    if (cerradas.length === 0) return;
    const activaAntes = pestanaActiva();
    const vecina = pestanas.closeMany(ids);
    // Closing a task also removes its documents, which can empty several panels.
    paneles.sync(pestanas.open().map((x) => x.id));
    // El borrador y el hilo son de la tarea: cerrar un archivo o un
    // artefacto suyo no los toca, la tarea sigue abierta detrás.
    for (const p of cerradas.filter(isTaskTab)) {
      soltarBorrador(p.id);
      olvidarPestana(p.id);
      if (!vivas().includes(p.id)) soltarHilo(p.id);
    }
    // Se pregunta si el cierre se llevó lo que se estaba mirando, no si
    // el id cerrado era el activo: una tarea arrastra sus archivos, y
    // cerrándola con uno delante, comparar ids da «no era la activa» y
    // no carga nada —la tira marca la vecina y el chat sigue enseñando
    // la tarea recién cerrada.
    if (activaAntes === null) return;
    if (pestanas.open().some((x) => x.id === activaAntes)) return;
    if (vecina) void activarPestana(vecina);
    else irAlBlanco(carpetaDelEscritorio(project()));
  }

  /**
   * Poner una pestaña delante, sea de lo que sea. Toda pestaña lleva su
   * tarea dentro: activar el archivo de otra tarea abre esa tarea detrás.
   * `abrirSesion` no relee nada cuando ya es la abierta: pasar de un
   * archivo a su conversación no cuesta un viaje al disco.
   */
  async function activarPestana(p: Tab) {
    // La ventana que la tiene pasa a mandar, y la enseña. Es lo que ata las
    // tres cosas que decide el mando —la caja, la columna derecha y dónde caen
    // las pestañas nuevas— a un solo gesto (`lib/panels.ts`).
    paneles.activate(p.id);
    setProyectoAbierto(null);
    // El navegador del «+» tampoco cuelga de ninguna tarea: detrás no se
    // abre nada.
    if (p.clase === "observabilidad" || (p.clase === "sitio" && p.navegador)) {
      pestanas.activate(p.id);
      return;
    }
    // Un archivo abierto antes de que la tarea existiera no cuelga de ninguna:
    // detrás queda la conversación en blanco de su proyecto, que es la que
    // decide de qué commit se lee.
    if (p.session === "") {
      if (project() !== p.project || sessionId() !== null) irAlBlanco(p.project);
      paneles.activate(p.id);
      pestanas.activate(p.id);
      return;
    }
    await abrirSesion(p.project, p.session, p.id);
  }

  /**
   * El atajo de teclado, sobre la tira de la ventana activa y no sobre la
   * tira entera: partida la pantalla, cada ventana lleva la suya y el número
   * cuenta lo que se ve (`lib/panels.ts`).
   */
  function irAPestanaDe(nav: NavegacionDePestanas) {
    const sitio = paneles.activeSite();
    const id = destinoDePestana(
      nav,
      paneles.tabsAt(sitio),
      paneles.activeTabAt(sitio),
    );
    const p = id ? pestanas.open().find((x) => x.id === id) : null;
    if (p) void activarPestana(p);
  }

  /**
   * Cambiar de ventana con el teclado, que es lo que el ratón hace pulsando
   * en ella. Con la ventana estrecha solo se pinta la activa, y esto es lo
   * único que llega a lo que hay en las demás.
   */
  function irAVentanaVecina(salto: 1 | -1) {
    const recorrido = panelReadingOrder(paneles.rowsPerColumn());
    if (recorrido.length < 2) return;
    const i = recorrido.findIndex((s) => sameSite(s, paneles.activeSite()));
    mandarVentana(recorrido[(i + salto + recorrido.length) % recorrido.length]);
  }

  function abrirObservabilidad() {
    setProyectoAbierto(null);
    pestanas.openObservability(t("observability.tab"));
  }

  /**
   * Pone una ventana al mando pulsando en cualquier sitio de ella, no
   * solo en una pestaña, y abre lo que tiene delante: columna derecha y
   * caja de escritura cuelgan de la sesión abierta, y enfocar sin abrir
   * dejaría el mando en una ventana y el contexto en otra.
   */
  function mandarVentana(sitio: SitioDePanel) {
    if (sameSite(sitio, paneles.activeSite())) return;
    paneles.focus(sitio);
    const id = paneles.activeTabAt(sitio);
    const p = id ? pestanas.open().find((x) => x.id === id) : null;
    if (p) void activarPestana(p);
  }

  /**
   * Parte la ventana activa: su pestaña de delante se va a una ventana
   * nueva. No parte si esa ventana se quedaría vacía: mover su única
   * pestaña cerraría la de origen, el mismo resultado en otro sitio. Es
   * lo que apaga el botón (`lib/panels.ts`).
   */
  function partirLaActiva() {
    partirVentana(paneles.activeSite());
  }

  /**
   * Parte esa ventana, no la que esté al mando. Un botón en la fila de
   * título no pertenece a ninguna ventana —con la rejilla, no diría cuál
   * partir—; puesto en la tira de cada una, es de su ventana. El atajo de
   * teclado sigue partiendo la activa: ahí sí es la única respuesta.
   */
  function partirVentana(sitio: SitioDePanel) {
    const id = paneles.activeTabAt(sitio);
    if (!id) return;
    paneles.split(id);
  }

  /**
   * Si esa ventana puede partirse ahora mismo. Con una sola pestaña
   * dentro no se parte, y el botón lo dice: la de origen se cerraría al
   * vaciarse, el mismo resultado en otro sitio. Partir es dejar algo a
   * la vista mientras se trabaja en otra cosa; sin otra cosa no hay gesto.
   */
  const puedeSepararseDe = (sitio: SitioDePanel) =>
    !paginaDeAgente() && paneles.tabsAt(sitio).length > 1 && paneles.canSplit();

  /** Recoge la ventana activa en la de al lado. Es el atajo de deshacer. */
  function juntarLaActiva() {
    if (!paneles.join()) return;
    const id = paneles.activeTabAt(paneles.activeSite());
    const p = id ? pestanas.open().find((x) => x.id === id) : null;
    if (p) void activarPestana(p);
  }

  /**
   * Qué zona del cuerpo de una ventana hay bajo el cursor: sus cuatro bordes
   * parten hacia ahí y el medio mueve. Se mide contra el rectángulo real y no
   * contra un tamaño fijo: un panel repartido es más estrecho que su vecino.
   */
  function edgeZone(el: Element, x: number, y: number) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return "center" as const;
    const qx = (x - r.left) / r.width;
    const qy = (y - r.top) / r.height;
    const m = 0.25;
    if (qx > m && qx < 1 - m && qy > m && qy < 1 - m) return "center" as const;
    const sides: [PanelSide, number][] = [
      ["left", qx],
      ["right", 1 - qx],
      ["up", qy],
      ["down", 1 - qy],
    ];
    return sides.reduce((best, c) => (c[1] < best[1] ? c : best))[0];
  }

  /**
   * Qué ventana hay bajo el cursor, y en qué hueco de su tira o en qué zona de
   * su cuerpo. Se pregunta al documento y no a un `dragover` por elemento: el
   * gesto lo conduce `window`, y `elementFromPoint` hace que soltar valga tanto
   * sobre la tira como sobre el cuerpo del cuadrante.
   */
  function ventanaBajo(x: number, y: number) {
    const leer = (el: Element) => {
      const [col, fila] = (el.getAttribute("data-ventana") ?? "")
        .split(",")
        .map(Number);
      return Number.isFinite(col) && Number.isFinite(fila)
        ? { col, fila }
        : null;
    };
    const el = document.elementFromPoint(x, y);
    const tira = el?.closest?.("[data-tira]");
    if (tira) {
      const sitio = leer(tira);
      if (!sitio) return null;
      // Antes de qué pestaña cae, según de qué lado de ella esté el cursor.
      const tabs = [...tira.querySelectorAll("[data-pestana]")];
      let indice = tabs.length;
      for (let n = 0; n < tabs.length; n++) {
        const r = tabs[n].getBoundingClientRect();
        if (x < r.left + r.width / 2) {
          indice = n;
          break;
        }
      }
      return { sitio, indice };
    }
    const panel = el?.closest?.("[data-ventana]");
    if (!panel) return null;
    const sitio = leer(panel);
    return sitio ? { sitio, zone: edgeZone(panel, x, y) } : null;
  }

  const tabDrag = createPointerDrag({
    scope: () => `${workspaceActivo()}\u0000${escritorio()}`,
    canStart: id => pestanas.open().some(tab => tab.id === id),
    locate: point => ventanaBajo(point.x, point.y),
    scroll(point) {
      const element = document.elementFromPoint(point.x, point.y)
        ?.closest("[data-tira]")?.querySelector<HTMLElement>('[role="tablist"]');
      return element ? { element, axis: "x" } : null;
    },
    drop(id, destino) {
      if (destino.zone && destino.zone !== "center" && paneles.splitAt(id, destino.sitio, destino.zone)) {
        const p = pestanas.open().find(tab => tab.id === id);
        if (p) void activarPestana(p);
        return;
      }
      const from = paneles.siteOf(id);
      const index = destino.indice;
      const origin = paneles.tabsAt(destino.sitio).indexOf(id);
      const insertion = index !== undefined && sameSite(from, destino.sitio) && origin >= 0 && origin < index
        ? index - 1
        : index;
      soltarPestana(id, destino.sitio, insertion);
    },
  });
  const arrastrando = tabDrag.source;
  const cursor = tabDrag.cursor;
  const donde = tabDrag.destination;
  const arrastrarPestana = tabDrag.start;

  /**
   * Cómo se llama una pestaña, para el fantasma del arrastre. La tira
   * compone el suyo con la carpeta cuando dos archivos se llaman igual;
   * aquí basta el nombre: solo hay que reconocer qué se está moviendo.
   */
  const tituloDePestana = (id: string) => {
    const p = pestanasEnPantalla().find((x) => x.id === id);
    if (!p) return "";
    if (isTaskTab(p)) return p.titulo;
    if (p.clase === "observabilidad") return p.titulo;
    if (p.clase === "sitio" && !p.url) return t("sites.new_tab");
    const r = p.clase === "archivo" ? p.ruta : p.clase === "artefacto" ? p.rel : p.url;
    return r.slice(r.lastIndexOf("/") + 1);
  };

  /** Dónde cae la marca dentro de la tira de `sitio`, o `null`. */
  const marcaDe = (sitio: SitioDePanel) => {
    const d = donde();
    return d && sameSite(d.sitio, sitio) ? (d.indice ?? null) : null;
  };

  /**
   * El lado por el que caería la pestaña arrastrada, o `null` si cae dentro o
   * sobre una tira. Solo hay lado si la rejilla lo admite: cuando no cabe, el
   * marco de siempre dice «entra aquí» y soltar mueve.
   */
  const dropSide = () => {
    const d = donde();
    const id = arrastrando();
    if (!d?.zone || d.zone === "center" || !id) return null;
    return paneles.canSplitAt(id, d.sitio, d.zone) ? d.zone : null;
  };

  /**
   * Suelta una pestaña arrastrada en una ventana y la pone delante.
   * Arrastrar no desmonta nada: los visores cuelgan del mismo padre y
   * solo cambia su celda (`features/shell/Panels.tsx`), lo que permite
   * arrastrar un archivo con cambios sin guardar.
   */
  function soltarPestana(id: string, a: SitioDePanel, indice?: number) {
    if (!paneles.move(id, a, indice)) return;
    const p = pestanas.open().find((x) => x.id === id);
    if (p) void activarPestana(p);
  }

  /** La tarea cuyo borrado espera a que se decida qué hacer con sus archivos. */
  const [borradoConTrabajo, setBorradoConTrabajo] = createSignal<
    { project: string; id: string; files: string[] } | null
  >(null);

  async function borrarSesion(proyecto: string, id: string, force = false) {
    // Borrar desde la vista del proyecto no debe echarte de ella: `nuevaSesion`
    // la cierra —es la acción de ir a escribir— y aquí solo se está usando para
    // soltar la conversación que se acaba de borrar.
    const vista = proyectoAbierto();
    try {
      // En Windows un Tinymist vivo bloquea la carpeta de la tarea.
      await apagarVistasDe(id);
      await invoke("delete_session", { project: proyecto, id, force });
      // Borrada, no tiene pestaña ni hilo ni borrador que conservar.
      const vecina = pestanas.close(id);
      // Igual que al cerrar la pestaña: el panel que la enseñaba se cierra.
      const quedan = new Set(pestanas.open().map((x) => x.id));
      paneles.sync([...quedan]);
      soltarHilo(id);
      soltarBorrador(id);
      olvidarPestana(id);
      if (id === sessionId()) {
        // Desde la vista del proyecto no se salta a otra conversación: se
        // suelta la borrada y la vista se queda. Desde la tira, a la vecina.
        if (!vista && vecina) void activarPestana(vecina);
        else {
          irAlBlanco();
          setProyectoAbierto(vista);
        }
      }
      void refreshSessions(grupos());
      return true;
    } catch (e) {
      // El árbol tiene archivos que no están en Git. No se deja en disco sin
      // dueño: se enseñan y decide la persona (`worktrees::retirar_con`).
      if (claveDe(e) === "worktrees.error.work_in_tree") {
        const detalle = e && typeof e === "object" && "detail" in e ? String(e.detail) : "";
        setBorradoConTrabajo({ project: proyecto, id, files: detalle.split("\n").filter(Boolean) });
        return false;
      }
      setError(prosaDe(e));
      return false;
    }
  }

  /**
   * Mueve una tarea a otro proyecto, o la saca de todos. Si es la que
   * está abierta se cambia también el proyecto en pantalla: el
   * siguiente turno se guarda donde ahora vive la tarea.
   */
  async function moverSesion(de: string, id: string, a: string) {
    try {
      await invoke("move_session", { project: de, id, to: a });
      if (id === sessionId()) setProject(a);
      pestanas.moveToProject(id, a);
      void refreshSessions(grupos());
      setProjectList(await invoke<Project[]>("list_projects"));
    } catch (e) {
      setError(prosaDe(e));
    }
  }

  /**
   * Marca en qué etapa está una tarea, o le quita la marca con `null`.
   * Relee la lista del disco en vez de tocarla en memoria, igual que
   * mover y borrar: con dos ventanas sobre el mismo workspace, la que
   * no marcó se quedaría con la fila de antes.
   */
  async function etaparSesion(
    proyecto: string,
    id: string,
    etapa: Etapa | null,
  ) {
    try {
      await invoke("set_session_stage", { project: proyecto, id, stage: etapa });
      void refreshSessions(grupos());
    } catch (e) {
      setError(prosaDe(e));
    }
  }

  async function fijarSesion(proyecto: string, id: string, pinned: boolean) {
    await invoke("set_session_pinned", { project: proyecto, id, pinned });
    void refreshSessions(grupos());
  }

  /**
   * Le cambia el nombre a una tarea. Relee la lista, igual que
   * `etaparSesion`, y de paso llega a las pestañas
   * (`pestanasEnPantalla`): sin releer, la abierta seguiría rotulada con
   * el nombre viejo hasta el siguiente arranque.
   */
  async function renombrarSesion(proyecto: string, id: string, title: string) {
    try {
      await invoke("rename_session", { project: proyecto, id, title });
      void refreshSessions(grupos());
      return true;
    } catch (e) {
      setError(prosaDe(e));
      return false;
    }
  }

  /**
   * Una fuente que entra a la tarea. No escribe en disco: lo pendiente viaja
   * con el turno, y `send_message` lo suma a la tarea. El agente la lee por
   * `--add-dir`; dónde escribe es la carpeta de trabajo del proyecto.
   */
  const adjuntarFuente = async (id: string) => {
    editarBorrador(claveAbierta(), (b) => ({
      ...b,
      sourceIds:
        idsDelProyecto().includes(id) ||
        b.sourceIds.includes(id) ||
        adjuntas().includes(id)
          ? b.sourceIds
          : [...b.sourceIds, id],
      excludedSourceIds: b.excludedSourceIds.filter((x) => x !== id),
    }));
    // `harness:sources` y no `harness:workspace`: aquel cierra la
    // conversación abierta; adjuntar material a mitad de una tarea no muda de
    // cliente.
    window.dispatchEvent(new CustomEvent("harness:sources"));
  };

  /**
   * Quitar una fuente de esta tarea: deja de ofrecerse de aquí en adelante.
   * No deshace lo que el agente ya leyó (`ARCHITECTURE.md` § 4): el control
   * dice «quitar», no «olvidar».
   */
  const quitarFuente = async (id: string) => {
    editarBorrador(claveAbierta(), (b) => ({
      ...b,
      sourceIds: b.sourceIds.filter((x) => x !== id),
      excludedSourceIds:
        idsDelProyecto().includes(id) && !b.excludedSourceIds.includes(id)
          ? [...b.excludedSourceIds, id]
          : b.excludedSourceIds,
    }));
    setAdjuntas((v) => v.filter((x) => x !== id));
    const sid = sessionId();
    if (!sid) return;
    try {
      await invoke("detach_session_source", {
        project: project(),
        session: sid,
        source: id,
      });
    } catch (e) {
      asentar(sid, (ms) => [
        ...ms,
        {
          role: "system",
          text: t("chat.scope.source.remove_failed", { error: prosaDe(e) }),
          meta: "fallo",
        },
      ]);
    }
  };

  /**
   * Cambiar la rama de una fuente sustituyéndola: su identidad incluye la
   * rama (`context::repo_identity`), otra rama es otra fuente. La nueva entra
   * antes de que salga la anterior: un fallo de `add_repo_url` deja las dos,
   * y se ve.
   */
  const cambiarRama = async (fuente: Source, rama: string) => {
    if (fuente.kind !== "git" || fuente.branch === rama) return;
    const nueva = await invoke<{ id: string }>("add_repo_url", {
      cloneUrl: fuente.location,
      branch: rama,
    });
    await adjuntarFuente(nueva.id);
    await quitarFuente(fuente.id);
    window.dispatchEvent(new CustomEvent("harness:sources"));
  };

  /**
   * Abrir un artefacto es abrir una pestaña del centro, con su propio
   * visor (`ArtifactViewer.tsx`). Llega por aquí lo que el hilo anunció
   * y la conversación exportada: lo que la tarea produjo, nunca un adjunto.
   */
  function abrirArtefacto(
    rel: string,
    path: string,
    kind: ArtifactTab["kind"] = "output",
    codigo = false,
  ) {
    const id = sessionId();
    if (!id) return;
    pestanas.openContent({
      clase: "artefacto",
      id: artifactTabId({ session: id, rel }),
      project: project(),
      session: id,
      rel,
      path,
      kind,
      ...(codigo ? { codigo } : {}),
    });
  }

  /**
   * Un archivo por su ruta absoluta. Dentro de un repositorio de la tarea abre
   * en su árbol, donde se escribe; fuera de todo árbol, en una tarea de código
   * se lee en la vista de código y en una documental como documento.
   */
  async function abrirRuta(path: string, rel = path.replaceAll("\\", "/")) {
    const id = sessionId();
    if (!id) return;
    const arboles = await arbolesDe(project(), id).catch(() => []);
    // Abrir después del await en otra tarea pondría esta ruta, editable, en el repositorio de aquella.
    if (sessionId() !== id) return;
    const dentro = ubicar(arboles, path);
    if (dentro && esDeCodigo(dentro.arbol.kind)) {
      return abrirArchivo(dentro.arbol.key, dentro.rel, false);
    }
    const f = folder();
    const enLaTarea = Boolean(dentro) || (f !== null && contiene(f, path));
    abrirArtefacto(
      rel,
      path,
      enLaTarea ? "output" : "external",
      !dentro && arboles.some((a) => esDeCodigo(a.kind)),
    );
  }

  /**
   * Un archivo del árbol de código, en su pestaña del centro. Sin tarea aún lo
   * mismo: la pestaña lee el commit base y el primer turno la reata
   * (`lib/tabs.ts`). Un archivo no se enseña de dos maneras según cuándo se
   * abra.
   */
  function abrirArchivo(arbol: string, ruta: string, cambiado: boolean) {
    const proyecto = project();
    const id = sessionId() ?? "";
    if (!proyecto && !id) return;
    pestanas.openContent({
      clase: "archivo",
      id: fileTabId({ project: proyecto, session: id, arbol, ruta }),
      project: proyecto,
      session: id,
      arbol,
      ruta,
      cambiado,
      ...(id ? {} : { base: draftBases()[claveAbierta()] }),
    });
  }

  function archivoMovido(session: string, arbol: string, desde: string, hasta: string) {
    paneles.renameTabs(pestanas.renameFiles(session, arbol, desde, hasta));
  }

  function archivoBorrado(session: string, arbol: string, ruta: string) {
    const fuera = pestanas
      .open()
      .filter(
        (p) =>
          p.clase === "archivo" &&
          p.session === session &&
          p.arbol === arbol &&
          (p.ruta === ruta || p.ruta.startsWith(`${ruta}/`)),
      );
    for (const p of fuera) cerrarPestana(p.id);
  }

  /**
   * Los archivos que se miraban antes del primer turno pasan a la tarea que ese
   * turno creó. La clave del árbol no se adivina: se pide, y es una
   * (`development::list_task_trees`).
   */
  async function reatarVistaPrevia(proyecto: string, session: string) {
    const sueltas = pestanas
      .open()
      .some((p) => p.clase === "archivo" && p.session === "" && p.project === proyecto);
    if (!sueltas) return;
    try {
      const arboles = await invoke<ArbolEnTarea[]>("list_task_trees", {
        project: proyecto,
        session,
      });
      const arbol = arboles[0]?.key;
      if (!arbol) return;
      paneles.renameTabs(pestanas.attachPreviewFiles(proyecto, session, arbol));
    } catch {
      // Sin clave de árbol las pestañas se quedan en el commit del que nació la
      // copia: enseñan el archivo, no un error.
    }
  }

  /**
   * El servidor que levantó una tarea, pestaña más del centro. Se abre
   * la tarea primero: `pestanas.abrir` mete la de contenido detrás de
   * las de su tarea, o dejaría un hueco al cerrarla (`lib/tabs.ts`).
   * El puerto puede ser de una tarea no abierta: pasa por `abrirSesion`.
   */

  /**
   * Un enlace, en una pestaña de esta ventana. Dos entradas y un solo
   * camino: el clic en un enlace del chat (evento `harness:abrir-sitio`)
   * y el guarda de navegación (`lib.rs` · `sitio-pedido`) —así el
   * «abrir enlace» del menú nativo acaba en el mismo sitio que un clic.
   */

  /**
   * Un sitio cuelga de una tarea (`lib/tabs.ts`): se cuelga de la que
   * esté delante. Sin ninguna se entrega al navegador del sistema: un
   * enlace que no hace nada se lee como que la app está rota.
   */
  async function abrirEnlace(url: string) {
    // `activa()` es el id, no la pestaña: se busca en las abiertas.
    const p = pestanas.open().find((x) => x.id === pestanas.active());
    // Delante hay un navegador suelto: no hay tarea de la que colgarlo, así
    // que va a otra pestaña de navegador.
    if (p?.clase === "sitio" && p.navegador) return abrirNavegador(url);
    if (p) return void abrirSitio(url, p.project, p.session);
    await invoke("open_external", { target: url }).catch(() => {});
  }

  /**
   * Una pestaña de navegador suelta, la del «+» de la tira. Sin dirección
   * abre vacía, con la barra lista para teclear (`features/sites/Site.tsx`).
   */
  function abrirNavegador(url = "") {
    setProyectoAbierto(null);
    pestanas.openContent({
      clase: "sitio",
      id: browserTabId(),
      project: "",
      session: "",
      url,
      navegador: true,
    });
  }

  /**
   * Las carpetas que ofrece el «+» de la tira: las del riel de este espacio.
   * Se calcula aquí y no con `proyectosDelRiel`, que se declara después de
   * la cabecera que lo usa.
   */
  const carpetasDelMas = () =>
    carpetasDelEscritorio(projectList(), activeSpace(), sesiones()).map((p) => ({
      id: p.id,
      name: p.name,
    }));

  const botonDeNuevaPestana = () => (
    <NewTabButton
      projects={carpetasDelMas()}
      onNewTask={(id) => nuevaSesion(id)}
      onBrowser={() => abrirNavegador()}
    />
  );

  async function abrirSitio(url: string, proyecto: string, session: string) {
    await abrirSesion(proyecto, session);
    const p: SiteTab = {
      clase: "sitio",
      id: siteTabId({ session, url }),
      project: proyecto,
      session,
      url,
    };
    pestanas.openContent(p);
  }

  /**
   * Abrir lo que el hilo anunció, por su ruta. La absoluta se arma con la
   * carpeta de hoy y no se guarda en la transcripción: la carpeta de datos
   * se mueve, y una ruta escrita envejece sin avisar. Sin carpeta se abre
   * la columna en vez de un error.
   */
  function abrirPorRel(rel: string) {
    const f = folder();
    if (!f) {
      // Revelar escribe la preferencia igual que el conmutador: con ella en
      // cerrada, abrir transitoriamente dejaría el gesto sin nada que enseñar.
      setArtOpen(true);
      return;
    }
    // El separador es el de la carpeta: `rel` viaja con barras normales.
    const sep = f.includes("\\") ? "\\" : "/";
    void abrirRuta(f + sep + rel.split("/").join(sep), rel);
  }

  /**
   * La conversación, como artefacto de la tarea. Escribe siempre el
   * mismo archivo: exportar dos veces deja dos versiones de la misma
   * cadena, no dos archivos (`workspace/artifacts.rs` · `CHAT_EXPORT`). Después
   * se abre el artefacto: el acto tiene que verse.
   */

  /**
   * No atrapa el fallo: lo pinta quien tiene el botón (`WorkTreeColumn.tsx`),
   * que es donde se está mirando. El árbol recuenta por `harness:copia`,
   * como al guardar un archivo desde su pestaña.
   */
  async function exportarChat() {
    const id = sessionId();
    if (!id) return;
    const salida = await invoke<ChatExportado>("export_chat", {
      project: project(),
      id,
    });
    abrirArtefacto(salida.rel, salida.path);
    window.dispatchEvent(new CustomEvent("harness:copia"));
  }


  async function forkDesde(turno: string, mode: "full" | "focused", encargado: string | null) {
    const workspace = workspaceActivo();
    const id = sessionId();
    const proyecto = project();
    if (!id) return;
    const context = await invoke<{
      path: string; last_prompt: string; last_reply: string;
      sources: string[]; excluded_sources: string[];
    }>("prepare_session_continuation", { project: proyecto, id, turno })
      .catch((e) => { throw prosaDe(e); });
    if (workspace !== workspaceActivo() || id !== sessionId() || proyecto !== project()) return;
    const prompt = mode === "full"
      ? t("chat.continuation.full_prompt", { path: context.path })
      : t("chat.continuation.focused_prompt", {
          path: context.path, prompt: context.last_prompt, reply: context.last_reply,
        });
    // Con agente, el borrador es el suyo, como al pulsar su fila en el riel:
    // la tarea nace con él y con el proveedor y modelo de su perfil.
    if (encargado) abrirBorradorDeAgente(proyecto, encargado);
    else nuevaSesion(proyecto);
    editarBorrador(claveAbierta(), (b) => ({
      ...b,
      input: [prompt, b.input].filter(Boolean).join("\n\n"),
      archivos: [...b.archivos, context.path],
      sourceIds: [...new Set([...b.sourceIds, ...context.sources])],
      excludedSourceIds: [...new Set([...b.excludedSourceIds, ...context.excluded_sources])],
    }));
  }

  /**
   * Elegir en el único menú del chat: la fila ya trae agente,
   * superficie y modelo, que forman una sola elección. Actualizarlos
   * en un batch impide un render intermedio con el modelo de Claude
   * bajo Codex, o el gratuito bajo la de pago de OpenCode.
   */
  function saveDraftConfiguration(mode?: string) {
    editarBorrador(claveAbierta(), (draft) => ({
      ...draft,
      configuration: {
        agent: agent(), surface: superficie(), model: model(), effort: effort(),
        // Solo elegido a mano: guardado al elegir modelo, taparía el del workspace.
        mode: mode ?? draft.configuration?.mode,
      },
    }));
  }

  /**
   * Lo elegido en la caja de una tarea abierta, que `session.json` no guarda:
   * ahí vive con qué corrió el último turno, no con qué va a correr el
   * siguiente. Sin esto, salir de la tarea y volver revierte la elección.
   *
   * El agente no entra: en una tarea empezada no se cambia, y el suyo es el
   * que dice la sesión.
   */
  function restoreSessionConfiguration() {
    const configuration = borrador().configuration;
    if (!configuration) return;
    setModel(configuration.model);
    setEffort(configuration.effort);
    if (configuration.mode) setModo(configuration.mode);
  }

  function restoreDraftConfiguration() {
    const configuration = borrador().configuration;
    if (!configuration) return;
    setAgent(configuration.agent);
    setSuperficie(configuration.surface);
    setModel(configuration.model);
    setEffort(configuration.effort);
    if (configuration.mode) setModo(configuration.mode);
  }

  // Sin elegir sale escrito el nivel que el catálogo dice que el agente usa:
  // Codex conserva en su hilo el último pedido, y callarlo dejaba la caja
  // diciendo «medium» con el turno corriendo en el anterior.
  const effortDelTurno = () =>
    effort() || models()?.models.find((m) => m.id === model())?.default_effort || null;

  function chooseEffort(id: string) {
    setEffort(id);
    saveDraftConfiguration();
    // Como el modo en `elegirModo`: el turno vivo arrancó con el nivel de
    // entonces y no lo relee.
    const sesion = sessionId();
    if (sesion && busy()) {
      void invoke("set_effort", {
        project: project(),
        session: sesion,
        effort: effortDelTurno(),
      }).catch((e) => {
        anexar(sesion, (m) => [...m, { role: "system", text: prosaDe(e), meta: "aviso" }]);
      });
    }
    // Como el modelo en `elegirModelo`: es lo que heredan sus temas nuevos.
    const fila = sessionId() ? filaDe(sessionId()!) : undefined;
    if (fila && esChatDeAgente(fila) && fila.encargado) {
      void invoke("set_agent_model", {
        project: project(),
        name: fila.encargado,
        agent: agent(),
        model: model() || null,
        effort: id || null,
      }).then(notifyProfiles).catch((error) => setError(prosaDe(error)));
    }
  }

  const proveedorFijo = (id: string) => vivas().includes(id) || filaDe(id)?.native_work === true;

  function elegirModelo(opcion: OpcionDeModelo) {
    const fila = sessionId() ? filaDe(sessionId()!) : undefined;
    const chatDeAgente = fila && esChatDeAgente(fila);
    // Cambiar de AGENTE en una tarea abierta sigue siendo otra cosa: es
    // un traspaso —olvidar la reanudación y devolverle lo hablado al
    // nuevo—, no un ajuste del selector. Se niega si el agente ya
    // contestó; el modelo dentro del mismo agente sí cambia,
    // cada turno guarda con cuál se contestó.
    if (sessionId() && !chatDeAgente && opcion.agent !== agent() && proveedorFijo(sessionId()!)) return;
    const nivel = effortAlCambiarDeModelo(effort(), opcion.model);
    batch(() => {
      setSuperficie(opcion.superficie);
      setAgent(opcion.agent);
      setModel(opcion.model.id);
      setEffort(nivel);
      saveDraftConfiguration();
    });
    if (chatDeAgente && fila.encargado) {
      void invoke("set_agent_model", {
        project: project(),
        name: fila.encargado,
        agent: opcion.agent,
        model: opcion.model.id,
        effort: nivel || null,
      }).then(notifyProfiles).catch((error) => setError(prosaDe(error)));
    }
  }

  /**
   * Elegir modo en la caja, que además queda recordado para la tarea
   * siguiente. Solo por aquí: `load_session` y el ajuste al cambiar de agente
   * también mueven `modo`, y guardar esos convertiría abrir una tarea vieja en
   * cambiar con qué arrancan las próximas.
   */
  function elegirModo(id: string) {
    recordarModo(id);
    setModo(id);
    saveDraftConfiguration(id);
    const sesion = sessionId();
    if (!sesion || !busy()) return;
    // El turno vivo arrancó con el modo de entonces y no lo relee: sin
    // pedírselo al proceso, la caja diría una cosa y el agente haría otra.
    void invoke("set_permission_mode", {
      project: project(),
      session: sesion,
      mode: id,
    })
      .then(() => {
        if (id === MODO_AUTOMATICO) return aprobarPendientes(sesion);
      })
      .catch((e) => {
        anexar(sesion, (m) => [...m, { role: "system", text: prosaDe(e), meta: "aviso" }]);
      });
  }

  /**
   * Cambiar de modo no contesta lo que el turno ya pidió: su gate sigue
   * abierto y el turno, esperando. Se contesta como el botón «Aprobar».
   */
  async function aprobarPendientes(sesion: string) {
    for (const p of permissions().filter((x) => x.session === sesion)) {
      // Otro modo elegido mientras volvía el cambio: aprobar ya no es lo pedido.
      if (sessionId() === sesion && modo() !== MODO_AUTOMATICO) return;
      if (!permissions().some((x) => x.requestId === p.requestId)) continue;
      await responderPermiso(p, true);
    }
  }

  /** La fila y la pestaña de una tarea que Rust todavía no creó. Devuelve su id provisional. */
  function pintarNaciendo(proyecto: string, titulo: string, con: { agent: string; model: string | null }, encargado: string | null): string {
    const provisional = idProvisional();
    const ahora = Date.now();
    setNaciendo((ns) => [
      ...ns,
      {
        project: proyecto,
        row: {
          id: provisional,
          title: titulo,
          agent: con.agent,
          model: con.model,
          refs: [],
          created_at: ahora,
          updated_at: ahora,
          turns: 1,
          parent: null,
          subagent: null,
          esperando: false,
          stage: null,
          encargado,
          encargado_del_padre: null,
          chat_de_agente: false,
        },
      },
    ]);
    // Y delante, en el mismo gesto: el efecto que reparte las pestañas vuelve
    // a activar la que ya estaba. Nacer sin activarse devuelve la vista a la
    // tarea anterior hasta que Rust contesta.
    batch(() => {
      pestanas.ensure({ id: provisional, project: proyecto, titulo });
      pestanas.activate(provisional);
    });
    return provisional;
  }

  /** La tarea que nació toma lo que la ventana sin id tenía suyo: hilo, borrador, fila y pestaña. */
  function adoptarNacida(id: string, nacida: { provisional: string | null; proyecto: string; titulo: string; claveBorrador: string }) {
    const { provisional, proyecto, claveBorrador } = nacida;
    setDraftBases((bases) => {
      const next = { ...bases };
      delete next[claveBorrador];
      return next;
    });
    // La conversación que nació: su hilo se muda de `""` a su id. Los
    // eventos del turno pueden haber llegado ANTES que el id —Rust crea la
    // sesión y emite con ella mientras el `invoke` vuelve— y ya están en
    // `hilos[id]`; se conservan detrás de lo propio.
    setHilos((hs) => {
      const { [""]: sinId, ...resto } = hs;
      const previo = hs[id] ?? SIN_HILO;
      return {
        ...resto,
        [id]: {
          base: [...(sinId?.base ?? []), ...previo.base],
          vivo: [...(sinId?.vivo ?? []), ...previo.vivo],
        },
      };
    });
    // Y su borrador: lo que quedó sin mandar sigue con ella.
    setBorradores((bs) => {
      const { [claveBorrador]: suyo, ...resto } = bs;
      return suyo ? { ...resto, [id]: suyo } : resto;
    });
    if (provisional) {
      // La fila antes que la pestaña: una pestaña sin fila pide la lista.
      setNaciendo((ns) =>
        ns.map((n) => (n.row.id === provisional ? { ...n, row: { ...n.row, id } } : n)),
      );
      mudarPestana(provisional, id);
      pestanas.commitDraft(provisional, { id, project: proyecto, titulo: nacida.titulo });
      olvidarPestana(provisional);
    } else pestanas.ensure({ id, project: proyecto, titulo: "" });
    void reatarVistaPrevia(proyecto, id);
  }

  /**
   * Lanza un turno. Devuelve si llegó a arrancar: con `false`, quien
   * vació la caja le devuelve los adjuntos. Toma con qué correr del
   * mensaje, no de los selectores: mover el selector con la cola llena
   * no reescribe lo que esos mensajes van a hacer.
   */
  async function enviar(
    m: Omit<Encolado, "id">,
    /**
     * Lo que se contesta, en sus dos formas: `manda` son referencias que Rust
     * resuelve contra la transcripción, y `pinta` es lo mismo ya legible para
     * no dejar la pantalla en blanco mientras vuelve.
     */
    respuestas?: { manda: RespuestaEnviada[]; pinta: Respuesta[] },
    destination?: { project: string; session: string },
  ): Promise<boolean> {
    // Antes de cualquier `await`: es lo que impide que el despacho de
    // la cola saque dos mensajes en el mismo respiro.

    // Se marca la sesión si ya existe, y si no, la ventana sin id: un
    // turno que reanuda tiene su id desde el principio; el primero de
    // una tarea nueva lo recibe al volver de Rust, más abajo.
    const generation = sessionGeneration;
    const abierta = destination?.session ?? sessionId();
    if (abierta) advanceTurn(abierta);
    else lifecycleRevision++;
    const start = Symbol();
    if (abierta) pendingStarts.set(abierta, start);
    if (abierta) finishedTurns.delete(abierta);
    const proyecto = destination?.project ?? project();
    const agenteDelBorrador = abierta ? null : hablandoCon()?.name ?? null;
    // De qué hilo y de qué borrador es este turno, capturado aquí: el
    // primero de una tarea nueva cambia la sesión abierta a mitad de
    // camino, y hay que soltar la clave con la que se mandó.
    const clave = abierta ?? "";
    const claveBorrador = destination?.session ?? claveAbierta();
    const selectedBase = draftBases()[claveBorrador] ?? null;
    const pendientes = destination ? borradores()[claveBorrador]?.sourceIds ?? [] : sourceIds();
    const excluidas = destination ? borradores()[claveBorrador]?.excludedSourceIds ?? [] : excludedSourceIds();
    if (abierta) marcarViva(abierta);
    else setArrancando(true);
    // La tarea se pinta antes de que Rust la cree. Lo que la retrasaba no era
    // su nombre —`mentions::titulo_desde` lo saca del encargo antes de lanzar
    // nada— sino el evento `started`, que `chat::acp` emite cuando el proceso
    // del agente ya contestó al saludo.
    const provisional = abierta ? null : pintarNaciendo(proyecto, tituloProvisional(m.text), m, agenteDelBorrador);
    // Con qué se firma este turno. Se pregunta por el agente de ESTE mensaje y
    // no por el del selector: la cola guarda con qué se escribió cada uno, y
    // moverlo a mitad de un turno no puede reescribir hacia atrás quién
    // contestó los que ya estaban esperando.
    const signatureReady = invoke<Signatures>("turn_authors", {
      agent: m.agent,
    }).catch(() => null);
    const firmaDelTurno = respuestas ? await signatureReady : null;
    firmas[abierta ?? ""] = firmaDelTurno?.agent ?? null;
    modelosEnVivo[abierta ?? ""] = m.model || null;
    // El material que entra con este mensaje se dice en el hilo y
    // ahora, no al reabrir la tarea. Solo en una conversación
    // empezada: en el primer turno el preámbulo enumera el material
    // entero.
    const entrando: Msg[] =
      abierta && pendientes.length > 0
        ? [
            {
              role: "system",
              text: "",
              contexto: { entraron: pendientes },
            },
          ]
        : [];
    // El globo puede existir mientras se manda; su procedencia no. Afirmar aquí
    // que una persona contestó fabricaría ese dato si Rust rechazara la
    // relación. Se conserva la misma referencia para completarlo solo después
    // de que `send_message` haya validado y persistido la respuesta.
    const turnoPropio: Msg = {
      role: "user",
      text: m.text,
      task_mentions: m.task_mentions,
      // La línea de dirección se pinta con el globo y no al recargar: quien
      // manda tiene que ver a quién se le entregó en el momento de mandarlo.
      recipients: m.recipients?.length ? m.recipients : undefined,
      author: firmaDelTurno?.person ?? null,
      // Las rutas absolutas preparadas al adjuntar también sirven al releer del disco.
      attachments: m.attachments.length ? m.attachments : undefined,
    };
    // A `base` y no a `vivo`: `send_message` lo persiste antes de volver, así
    // que releer el disco lo trae — y si estuviera en `vivo` se pintaría dos
    // veces al volver a esta tarea mientras contesta.
    asentar(clave, (ms) => [...ms, ...entrando, turnoPropio]);
    try {
      // La respuesta de una persona no existe en la interfaz hasta que Rust la
      // validó y la escribió: primero persistir, y solo entonces pintarla.
      const id = await invoke<string>("send_message", {
        agent: m.agent,
        project: proyecto,
        session: abierta,
        prompt: m.text,
        taskMentions: m.task_mentions ?? [],
        // A quién va dirigido. Lista aparte del material: con destinatarios,
        // el turno no lo contesta esta conversación —`chat::send_message` lo
        // entrega al buzón de cada uno y deja aquí a quién se entregó—.
        recipients: m.recipients ?? [],
        model: m.model,
        effort: m.effort,
        permissionMode: m.permission_mode,
        attachments: m.attachments,
        // Viaja con el turno: en el primero la tarea aún no existe, y guardarlo
        // después llegaba tarde a su propio contexto.
        sources: pendientes,
        excludedSources: excluidas,
        respuestas: respuestas?.manda ?? null,
        baseRef: abierta ? null : selectedBase,
        // Solo al crear: el encargado sale de haber pulsado su fila en el
        // riel, no de un selector. Una tarea ya abierta lleva el suyo
        // sellado y volver a mandarlo lo reescribiría.
        encargado: agenteDelBorrador,
        taskFromAgent: !!agenteDelBorrador,
        // Quién escribió esto, cuando no fue la persona: una entrega que la
        // cola guardó mientras el chat contestaba sale por aquí, y sin este
        // renglón aterriza firmada por quien mira la pantalla.
        fromEncargado: m.encargado ?? null,
        // Y por dónde lo escribió la persona: sin esto, lo que llegó por
        // Telegram mientras el chat contestaba ya no vuelve por Telegram.
        fromChannel: m.channel ?? null,
        // Y la otra mitad del sobre. El remitente sin dirección de retorno
        // firma la entrega pero no dice dónde se contesta: quien preguntó se
        // queda esperando una respuesta que no vuelve
        // (`docs/specs/handler-mentions.md` § 3).
        replyTo: m.reply_to ?? null,
        hops: m.hops ?? null,
        fromTask: m.from_task ?? null,
        // El escritorio que la persona tenía delante al escribirlo, sellado en el
        // mensaje; lo que llega de otro canal no trae ninguno.
        space: m.space ?? null,
      });
      if (generation !== sessionGeneration) return true;
      if (respuestas) {
        asentar(clave, (ms) =>
          ms.map((mensaje) =>
            mensaje === turnoPropio
              ? { ...mensaje, respuestas: respuestas.pinta }
              : mensaje,
          ),
        );
      }
      // El turno ya tiene a qué colgarse: deja de ser «la ventana sin id».
      firmas[id] = firmas[id] ?? firmas[""] ?? null;
      modelosEnVivo[id] = modelosEnVivo[id] ?? modelosEnVivo[""] ?? null;
      if (!abierta) adoptarNacida(id, { provisional, proyecto, titulo: tituloProvisional(m.text), claveBorrador });
      if (!finishedTurns.has(id)) marcarViva(id);
      void signatureReady.then((signature) => {
        if (generation !== sessionGeneration) return;
        firmas[id] = signature?.agent ?? null;
        if (!respuestas) {
          asentar(id, (messages) => messages.map((message) =>
            message === turnoPropio ? { ...message, author: signature?.person ?? null } : message,
          ));
        }
      });
      if (!abierta) setArrancando(false);
      // Las fuentes de este mensaje salen del borrador; las de otro
      // que siga esperando, no. Va por id: da igual qué se esté mirando.
      editarBorrador(id, (b) => ({
        ...b,
        sourceIds: b.sourceIds.filter((x) => !pendientes.includes(x)),
      }));
      // Lo que cuelga de la vista, solo si la vista sigue donde
      // arrancó el turno: el primer mensaje crea la tarea en Rust
      // mientras se puede mirar otra, y ponerla delante aquí dejaba
      // `colaDe` nombrando la recién nacida con la cola de la que se
      // mira en la mano —lo escrito para aquélla se guardaba en la
      // carpeta de ésta. Lo de la tarea ya quedó hecho arriba, por id.
      if (
        abierta
          ? sessionId() === abierta
          : claveAbierta() === claveBorrador
      ) {
        setSessionId(id);
        if (!abierta) setHablandoCon(null);
        // Ya viajaron: dejan de ser pendientes y pasan a ser el contexto de la
        // conversación, que se sigue viendo mientras esté abierta.
        if (pendientes.length > 0)
          setAdjuntas((v) => [...new Set([...v, ...pendientes])]);
        // La cola escrita durante el primer turno es de la sesión que ese turno
        // acaba de crear.
        setColaDe(id);
      }
      if (finishedTurns.has(id)) void settleTurn(id, finishedTurns.get(id));
      return true;
    } catch (e) {
      // Sin esto queda una tarea que nadie creó: la fila y la pestaña se
      // pintaron contando con que Rust aceptara el turno.
      if (provisional) {
        retirarNaciendo(provisional);
        pestanas.close(provisional);
        olvidarPestana(provisional);
      }
      if (generation !== sessionGeneration) return false;
      if (destination && claveDe(e) === "history.error.busy") {
        asentar(clave, (ms) => ms.filter((message) => message !== turnoPropio && !entrando.includes(message)));
        marcarQuieta(destination.session);
        throw e;
      }
      if (!respuestas && claveDe(e) === "history.error.busy" && abierta === sessionId()) {
        asentar(clave, (ms) => ms.filter((mensaje) => mensaje !== turnoPropio && !entrando.includes(mensaje)));
        retainBusySession(m, { title: filaDe(abierta ?? "")?.title ?? "" }, abierta);
        return true;
      }
      if (abierta === sessionId()) setRetenida("fallo");
      if (!abierta) setArrancando(false);
      if (abierta) marcarQuieta(abierta);
      asentar(clave, (ms) =>
        // Una respuesta rechazada no deja ni un globo vacío que parezca un
        // turno humano. Los mensajes ordinarios sí se conservan: su texto se
        // escribió de verdad y ayuda a reintentar el fallo.
        respuestas ? ms.filter((mensaje) => mensaje !== turnoPropio) : ms,
      );
      anexar(clave, (ms) => [
        ...ms,
        {
          role: "system",
          // Una negativa de comando llega como clave: la frase nombra lo escrito.
          text: prosaDe(e, {
            command: comandoEscrito(m.text),
            agent: agents().find((a) => a.id === m.agent)?.label ?? m.agent,
          }),
          meta: "fallo",
        },
      ]);
      if (respuestas) throw e;
      return false;
    } finally {
      if (abierta && pendingStarts.get(abierta) === start) pendingStarts.delete(abierta);
      void reconcileActiveTurns();
    }
  }

  type Pendientes = {
    questions: { request_id: string; turn: string }[];
    permissions: { request_id: string; tool: string; target: string | null }[];
  };
  /** Lo que esa tarea tiene esperando. No lanza: sin respuesta, no hay nada. */
  const pendientesDe = (session: string) =>
    invoke<Pendientes>("pending_requests", { session }).catch(() => null);

  /**
   * El `request_id` de la pregunta viva de este turno, si alguien espera.
   * Sin él queda el camino de archivo.
   */
  async function atadura(
    session: string | null,
    turno: string,
  ): Promise<string | undefined> {
    if (!session) return undefined;
    const pendientes = await pendientesDe(session);
    return pendientes?.questions.find((q) => q.turn === turno)?.request_id;
  }

  /**
   * Repinta los gates que esta ventana no vio: el evento del permiso viajó
   * mientras no había nadie escuchando, y sin gate el turno espera una
   * decisión que nadie puede tomar.
   */
  async function reponerGates(session: string) {
    const pendientes = await pendientesDe(session);
    if (!pendientes?.permissions.length) return;
    setPermissions((ps) => [
      ...ps,
      ...pendientes.permissions
        .filter((p) => !ps.some((x) => x.requestId === p.request_id))
        .map((p) => ({
          session,
          requestId: p.request_id,
          tool: p.tool,
          target: p.target,
          origin: null,
        })),
    ]);
  }

  /**
   * Cierra una pregunta sin contestarla. Al agente se le dice que no hay
   * respuesta: mientras espere, no vuelve la caja de escribir.
   */
  async function cancelarPregunta(turno: string): Promise<void> {
    const sid = sessionId();
    if (!sid) throw new Error(t("shell.answer.no_session"));
    try {
      const guardado = await invoke<Turn>("cancel_question", {
        project: project(),
        session: sid,
        turn: turno,
      });
      soltarPreguntas(sid, turno);
      asentar(sid, (ms) => [
        ...ms,
        {
          role: "user",
          text: guardado.text,
          turno: guardado.id ?? undefined,
          respuestas: guardado.answers ?? undefined,
          author: guardado.author ?? undefined,
        },
      ]);
    } catch (error) {
      anexar(sid, (ms) => [
        ...ms,
        { role: "system", text: prosaDe(error), meta: "fallo" },
      ]);
      throw error;
    }
  }

  /**
   * Contesta lo que el agente preguntó. Es un turno como cualquier
   * otro —gasta tokens, se registra, reanuda la sesión— y sale por el
   * mismo camino. Lo distingue que va atado a la pregunta que lo
   * provocó, y esa atadura es el entregable.
   */
  async function responder(
    turno: string,
    manda: RespuestaEnviada[],
  ): Promise<boolean> {
    const mensaje = msgs().find((m) => m.turno === turno);
    if (!mensaje)
      throw new Error(t("shell.answer.question_missing"));
    // Las preguntas por archivo llegan después de que el proceso cerró, pero
    // `done` puede tardar un instante más en apagar `busy`. No se debe exigir
    // `questionRequestId`: ese campo solo existe para el canal vivo de Claude.
    if (busy() && !(mensaje.preguntas && mensaje.preguntas.length > 0))
      throw new Error(t("shell.answer.turn_busy"));
    const preguntas = mensaje?.preguntas ?? [];
    // Sin atadura en esta ventana, la tiene Rust: su registro dura lo que el
    // proceso.
    const viva = mensaje?.questionRequestId
      ? mensaje.questionRequestId
      : await atadura(sessionId(), turno);
    if (viva) {
      const sid = sessionId();
      if (!sid) throw new Error(t("shell.answer.no_session"));
      try {
        const guardado = await invoke<Turn>("answer_question", {
          session: sid,
          requestId: viva,
          respuestas: manda,
        });
        soltarPreguntas(sid, turno);
        asentar(sid, (ms) => [
          ...ms,
          {
            role: "user",
            text: guardado.text,
            turno: guardado.id ?? undefined,
            respuestas: guardado.answers ?? undefined,
            author: guardado.author ?? undefined,
          },
        ]);
        return true;
      } catch (error) {
        anexar(sid, (ms) => [
          ...ms,
          { role: "system", text: prosaDe(error), meta: "fallo" },
        ]);
        throw error;
      }
    }
    const cuando = Date.now();
    const pinta: Respuesta[] = manda.flatMap((r) => {
      const p = preguntas.find((x) => x.id === r.question);
      if (!p) return [];
      const partes = [
        ...r.chosen.map(
          (v: string) => p.options.find((o) => o.value === v)?.label ?? v,
        ),
        ...(r.free_text ? [r.free_text] : []),
      ];
      return [
        {
          turn: turno,
          question: r.question,
          question_text: p.question,
          chosen: r.chosen,
          text: partes.join(" · "),
          // Dicha por una persona, nunca inferida.
          source: "persona",
          when: cuando,
        },
      ];
    });
    if (pinta.length === 0)
      throw new Error(t("shell.answer.options_missing"));
    const sesion = sessionId();
    const salio = await enviar(
      {
        text: "",
        agent: mensaje.agent ?? agent(),
        model: model() || null,
        effort: effortDelTurno(),
        permission_mode: modo() || null,
        attachments: [],
      },
      { manda, pinta },
    );
    if (salio && sesion) soltarPreguntas(sesion, turno);
    return salio;
  }

  /** Manda si no hay turno corriendo; encola si lo hay. */
  async function mandar(attachments: string[]): Promise<boolean> {
    // Las dos listas se recortan con el mismo gesto: recortar solo las
    // menciones dejaría las etiquetas de destinatario apuntando al texto de
    // antes del `trim`, y el backend rechaza el tramo que no case.
    const message = trimDraft({ text: input(), task_mentions: borrador().task_mentions, recipients: borrador().recipients });
    const prompt = message.text;
    // Sin proyecto también se manda: elegirlo era un peaje para
    // escribir la primera línea. Nombrar el trabajo se decide cuando
    // hay algo que nombrar: la tarea nace suelta y se mueve después.
    if (!prompt && attachments.length === 0) return false;
    // No es un turno: no toca la cola ni el turno vivo, y los adjuntos se quedan.
    const pregunta = preguntaAlMargen(prompt, sideCommand());
    if (pregunta !== null) {
      setInput("");
      void preguntarAlMargen(pregunta);
      return true;
    }
    if (prompt.startsWith("!")) {
      if (!prompt.slice(1).trim()) return false;
      setInput("");
      // Con el agente trabajando espera su turno, como en Claude Code. Los
      // adjuntos se quedan en el borrador: un comando no los lleva.
      if (queueBusy() || cola().length > 0) {
        encolar(prompt, []);
        return true;
      }
      const id = sessionId();
      if (!id) {
        const corrio = await abrirConComando(prompt.slice(1));
        if (!corrio && !input()) setInput(prompt);
        return corrio;
      }
      const lanzado = { project: project(), agent: agent(), model: model() || null, effort: effort() || null, permission_mode: modo() || null };
      return (await ejecutarComando(id, lanzado, prompt.slice(1), null)) === null;
    }
    if (queueBusy() || cola().length > 0) {
      encolarYSoltar(prompt, attachments, message.task_mentions, message.recipients);
      setInput("");
      // Encolado se los lleva puestos: salen del borrador ya.
      setArchivos(archivos().filter((a) => !attachments.includes(a)));
      return true;
    }
    const draftKey = claveAbierta();
    const generation = sessionGeneration;
    setInput("");
    // Salen con el texto: el globo los pinta antes de que `send_message` vuelva.
    editarBorrador(draftKey, (b) => ({ ...b, archivos: adjuntosSinMandar(b.archivos, attachments) }));
    const sent = await enviar({
      text: prompt,
      task_mentions: message.task_mentions,
      recipients: message.recipients,
      agent: agent(),
      model: model() || null,
      effort: effortDelTurno(),
      permission_mode: modo() || null,
      attachments,
      space: escritorio(),
    });
    if (!sent && generation === sessionGeneration) {
      editarBorrador(draftKey, b => ({
        ...(b.input ? b : { ...b, input: message.text, task_mentions: message.task_mentions, recipients: message.recipients }),
        archivos: adjuntosDevueltos(b.archivos, attachments),
      }));
    }
    return sent;
  }

  /**
   * Una respuesta rápida del agente, mandada como si la persona la hubiera
   * escrito. No toca el borrador, y nunca es un comando `!`: el texto lo
   * escribió el agente y un clic no puede correrlo en la máquina de la persona.
   */
  async function mandarTexto(texto: string): Promise<boolean> {
    if (queueBusy() || cola().length > 0) {
      // En la cola, un `!` de la persona y uno del agente no se distinguen.
      if (texto.trimStart().startsWith("!")) return false;
      encolarYSoltar(texto, []);
      return true;
    }
    return enviar({
      text: texto,
      agent: agent(),
      model: model() || null,
      effort: effortDelTurno(),
      permission_mode: modo() || null,
      attachments: [],
    });
  }

  function encolarYSoltar(text: string, attachments: string[], task_mentions?: TaskMention[], recipients?: Recipient[]) {
    const libre = cola().length === 0 && enFondo().includes(sessionId() ?? "") &&
      !injecting().some((item) => item.session === sessionId());
    const encolado = encolar(text, attachments, task_mentions, recipients);
    if (libre) void mandarAhora(encolado);
  }

  /**
   * Volver a mandar lo último que escribió la persona: es el mismo
   * camino que la caja, no uno paralelo. Repone el texto en el
   * borrador y manda con `mandar`, con el agente, modelo y modo de
   * ahora. Un reenvío por su cuenta divergiría en cuanto algo cambiara.
   */

  /**
   * No reintenta solo, ni encadena: lo dispara un clic en la fila del
   * fallo, solo donde puede arreglar algo (`Chat.tsx`, `gestoDelFallo`).
   * Automático gastaría la suscripción de otra persona sin gesto.
   */

  /**
   * Si no hay nada que reponer —una tarea abierta cuyo primer turno
   * murió antes de guardarse— no hace nada visible en vez de mandar
   * un mensaje vacío.
   */

  /**
   * Reenvía el texto y no los adjuntos: diferencia real de rutas. La
   * caja manda rutas de origen; el turno guarda rutas relativas a la
   * carpeta de trabajo, donde el archivo ya está. Pasarle las
   * relativas al camino de las de origen buscaría donde no hay nada.
   */
  async function reintentar() {
    const previos = msgs();
    for (let i = previos.length - 1; i >= 0; i--) {
      const m = previos[i];
      if (m.meta === "fallo" && m.resume === "deliveries") {
        const abierta = sessionId();
        if (!abierta) return;
        setRetenida(null);
        try {
          await invoke("reintentar_reanudacion_por_entregas", { project: project(), session: abierta });
        } catch (e) {
          setError(prosaDe(e));
        }
        return;
      }
      if (m.role !== "user" || !m.text.trim()) continue;
      editarBorrador(claveAbierta(), b => ({ ...b, input: m.text, task_mentions: m.task_mentions }));
      setRetenida(null);
      await mandar([]);
      return;
    }
  }

  // Con qué se escribió, capturado aquí: el mensaje se lleva agente, modelo y
  // esfuerzo del momento. Los adjuntos viajan como ruta de origen, copiados
  // al enviar: quitarlo de la cola no deja archivos sueltos.
  function encolar(text: string, attachments: string[], task_mentions?: TaskMention[], recipients?: Recipient[]) {
    const id = `${Date.now().toString(36)}-${++encolados}`;
    setCola((c) => [
      ...c,
      {
        id,
        text,
        task_mentions,
        recipients,
        agent: agent(),
        model: model() || null,
        effort: effortDelTurno(),
        permission_mode: modo() || null,
        attachments,
        space: escritorio(),
      },
    ]);
    return id;
  }

  /**
   * Devuelve el mensaje al frente de la cola y la retiene por `session`. En un
   * solo lote: la sesión deja de estar viva en la misma pasada en que la cola
   * queda retenida, o el despacho la sacaría otra vez en el hueco.
   */
  function retainBusySession(
    m: Omit<Encolado, "id"> & { id?: string },
    titular: { title: string },
    abierta: string | null,
  ) {
    cierreDeLaRetencion = cierres();
    batch(() => {
      setCola((c) => [
        { ...m, id: m.id ?? `${Date.now().toString(36)}-${++encolados}` },
        ...c,
      ]);
      setEsperandoA(titular.title);
      setRetenida("session");
      setArrancando(false);
      if (abierta) marcarQuieta(abierta);
    });
  }

  function editarEncolado(id: string, text: string, mentions?: TaskMention[]) {
    if (injecting().some((item) => item.id === id)) return;
    setCola((c) => c.map((q) => (q.id === id ? { ...q, text, task_mentions: mentions ?? editMentions(q, text) } : q)));
  }

  function quitarEncolado(id: string) {
    if (injecting().some((item) => item.id === id)) return;
    setCola((c) => c.filter((q) => q.id !== id));
  }

  /**
   * Mete un encolado en el turno que ya corre. Solo sale de la cola si el
   * backend lo aceptó: un mensaje que se borra de la lista sin haber entrado
   * en ningún sitio desaparece sin que nadie sepa que se perdió.
   */
  async function mandarAhora(id: string) {
    const abierta = sessionId();
    const m = cola().find((q) => q.id === id);
    if (!abierta || !m || !inyectable(m) || injecting().some((item) => item.id === id)) return;
    const sourceProject = project();
    const sourceWorkspace = workspaceActivo();
    setInjecting((items) => [...items, { session: abierta, id }]);
    try {
      await invoke("inject_message", {
        project: sourceProject,
        session: abierta,
        prompt: m.text,
        taskMentions: m.task_mentions ?? [],
        queueId: id,
        attachments: m.attachments,
      });
      if (workspaceActivo() !== sourceWorkspace) return;
      // El turno sigue siendo el mismo, pero lo que contesta cambió: sin esto
      // el rótulo sigue contando desde el arranque hasta el próximo sondeo, y
      // bajo el mensaje recién escrito afirma una espera que no es suya.
      // Solo si ya había reloj: apuntarlo aquí encendería una fila quieta.
      setDesdeDeTurno((d) => (abierta in d ? { ...d, [abierta]: Date.now() } : d));
      const saved = savedQueues.get(abierta);
      if (saved) savedQueues.set(abierta, { ...saved, items: saved.items.filter((item) => item.id !== id) });
      if (sessionId() === abierta && project() === sourceProject) setCola((c) => c.filter((q) => q.id !== id));
      anexar(abierta, (ms) => [...ms, { role: "user", text: m.text, task_mentions: m.task_mentions, attachments: m.attachments.length ? m.attachments : undefined }]);
    } catch (e) {
      anexar(abierta, (ms) => [
        ...ms,
        { role: "system", text: prosaDe(e), meta: "fallo" },
      ]);
    } finally {
      setInjecting((items) => items.filter((item) => item.id !== id));
      if (workspaceActivo() === sourceWorkspace && finishedTurns.get(abierta) === true) void drainHiddenQueue(abierta);
    }
  }

  /** El proyecto que ocupa el panel principal, ya resuelto. */
  const proyectoDeLaVista = () =>
    projectList().find((p) => p.id === proyectoAbierto()) ?? null;

  // Una conversación escondida recibe el streaming de su turno y retiene todo
  // lo que se leyó en ella: solo se monta la que se ve. Volver a una desmontada
  // la pinta desde `hilos`, la deja en su `lectura` y con lo plegado en su `vista`.
  const seVeLaTarea = (id: string) =>
    celdaDe(id) !== undefined && !tapadoPorElProyecto(paneles.siteOf(id));
  // Mueren al cerrar la pestaña y no al dejar de verse: una pestaña de otra tira
  // o de otro workspace sigue abierta.
  const lecturas = new Map<string, Lectura>();
  const vistas = new Map<string, VistaDeLaConversacion>();
  const vistaDe = (session: string) => {
    const hay = vistas.get(session);
    if (hay) return hay;
    const nueva = vistaNueva();
    vistas.set(session, nueva);
    return nueva;
  };
  const montadas = createMemo<Set<string>>(() => {
    // La que acaba de abrirse todavía no tiene ventana: montarla ya y no un
    // efecto después ahorra pintar dos veces su apertura (`open-task-cost`).
    // Y una ventana que no manda y no tiene hilo —ni viene en camino— es de un
    // reparto que volvió: montarla pintaría una conversación vacía que no es la
    // suya. Se monta al pulsarla, que es cuando su lectura sale (`abrirSesion`).
    const visibles = tareasEnVentanas().filter((p) => {
      const sitio = paneles.siteOf(p.id);
      if (!sitio) return true;
      if (!seVeLaTarea(p.id)) return false;
      return (
        sameSite(sitio, paneles.activeSite()) ||
        hilos()[p.id] !== undefined ||
        cargandoHilo() === p.id
      );
    });
    return new Set(visibles.map((p) => p.id));
  }, new Set(), { equals: (a, b) => a.size === b.size && [...a].every((id) => b.has(id)) });
  const guardarLectura = (session: string | null, lectura: Lectura | null) => {
    if (!session) return;
    if (lectura) lecturas.set(session, lectura);
    else lecturas.delete(session);
  };
  function olvidarPestana(session: string) {
    const soltar = () => {
      lecturas.delete(session);
      vistas.delete(session);
    };
    soltar();
    // Su conversación puede desmontarse después, en la misma actualización, y
    // entregar entonces su lectura.
    queueMicrotask(soltar);
    soltarPreguntas(session);
  }
  // Al nacer, la pestaña cambia de id y su celda se recrea con el nuevo: lo suyo
  // se muda antes, para que la celda nueva lo encuentre.
  function mudarPestana(de: string, a: string) {
    const vista = vistas.get(de);
    if (vista && !vistas.has(a)) vistas.set(a, vista);
    const lectura = lecturas.get(de);
    if (lectura && !lecturas.has(a)) lecturas.set(a, lectura);
    setPreguntasAMedias((m) => {
      const suyas = [...m].filter(([k]) => k.startsWith(`${de}\u0000`));
      if (suyas.length === 0) return m;
      const mudado = new Map(m);
      for (const [k, v] of suyas) {
        mudado.delete(k);
        mudado.set(`${a}${k.slice(de.length)}`, v);
      }
      return mudado;
    });
  }

  /**
   * Con qué proyecto se trabaja, debajo de la caja y no en la cabecera.
   * Componente y no variable con JSX (SYSTEM.md § Las reglas de Solid,
   * regla 9): se pasa como prop a `Chat`.
   */
  const SelectorDeProyecto = (props: { branch?: JSX.Element; locked?: boolean }) => (
    // Del ancho de la caja, no del contenido: `justify-items-center` encoge
    // la rejilla a su hijo más ancho —el aviso «sin fuente de contexto»,
    // 416 px— y la franja del proyecto (`w-full`) queda a esos 416 px bajo
    // una caja de 856: control suelto y centrado, lo que `ProjectPicker` evita.
    <div class="grid w-full max-w-[860px] gap-1">
        <ProjectPicker
          branch={props.branch}
          locked={props.locked}
          projects={projectList()}
          project={project()}
          sources={sources()}
          onPick={elegirProyecto}
          onNuevoProyecto={() => setAnadiendoCarpeta(true)}
        />
      {/* A General, no a GitHub: la fuente principal del workspace se elige
          en Configuración → General; mandar a GitHub lleva a conectar un
          proveedor, dejando a la persona en una pantalla sin lo que buscaba. */}
      <Show when={!contextRoot()}>
        <div class="justify-self-center">
          <EmptyContext
            onPickFolder={() => void elegirCarpetaDelWorkspace()}
            onConnect={() => setSettings("general")}
          />
        </div>
      </Show>
    </div>
  );

  /**
   * El atajo tal y como se escribe en el tooltip. Va en el rótulo del botón:
   * es lo único que enseña `⌘D` sin una pantalla de ayuda dedicada.
   */
  const atajoDePartir = (junta: boolean) =>
    isWindows()
      ? `Ctrl+${junta ? "Shift+" : ""}D`
      : `\u2318${junta ? "\u21e7" : ""}D`;

  /**
   * Cómo se nombra el botón de separar, con su atajo dentro: con una sola
   * pestaña no hay «otra cosa» que ver aparte, y un botón apagado sin motivo
   * se lee como un fallo (`AGENTS.md` § Diseño).
   */
  const nombreDeSeparar = (sitio: SitioDePanel) => {
    if (paginaDeAgente()) return t("projects.split.agent_page");
    if (!paneles.canSplit()) return t("projects.split.full");
    if (paneles.tabsAt(sitio).length <= 1)
      return t("projects.split.alone");
    return t("projects.split.detach", { key: atajoDePartir(false) });
  };
  const nombreDelArbol = () =>
    agenteSenalado()
      ? artOpen() ? t("projects.agent_tasks.close") : t("projects.agent_tasks.open")
      : artOpen() ? t("shell.work_tree.close") : t("shell.work_tree.open");

  /**
   * La conversación de UNA tarea, para poder montar más de una: se
   * pinta en el panel principal y en cada tarea separada
   * (`lib/panels.ts`), cada una con su sesión (SYSTEM.md § Las reglas
   * de Solid, regla 9). Arma su propia transcripción, no lee `msgs()`.
   */
  const [threadSearchTargets, setThreadSearchTargets] = createSignal(new Map<string, ThreadSearchTarget>());
  const [delegatedToolbarTargets, setDelegatedToolbarTargets] = createSignal(new Map<string, () => JSX.Element>());
  const PanelDeChat = (pp: {
    sesion: string | null;
    /** El proyecto de esa tarea. `null` en la ventana en blanco, que no tiene. */
    proyecto?: string | null;
    soloLectura?: boolean;
  }) => {
    /**
     * Mensajes de ESTA ventana, memoizados en dos pasos: leer `hilos()`
     * directo baja al fondo TODAS las ventanas al moverse una. El
     * primer memo aísla la entrada de esta por `===`; no usa `msgs()`
     * aunque sea la abierta, que cambiaría de identidad al mudar.
     */
    const suyo = createMemo(() => hilos()[pp.sesion ?? ""]);
    // Un ternario en la prop crea un memo en cada lectura, y la que llega fuera de un dueño no se suelta nunca.
    const esperandoAqui = () => !pp.soloLectura && esperando();
    const proyectoDeLaCelda = () =>
      projectList().find((p) => p.id === (pp.proyecto ?? project()));
    const [estadoDelTrabajo, { refetch: refreshWork }] = createTaskWork(() => pp.sesion
      ? { project: proyectoDeLaCelda()?.id ?? "", id: pp.sesion }
      : undefined);
    const hasDelegation = createMemo(() => !!pp.sesion && (
      filaDe(pp.sesion)?.has_delegates
      || Object.values(sesiones()).flat().some(row => (row.parent ?? row.launched_by) === pp.sesion)
      || [...(suyo()?.base ?? []), ...(suyo()?.vivo ?? [])].some(message => message.meta === "task_launched")
    ));
    const delegationScope = createMemo(() => pp.sesion && hasDelegation()
      ? JSON.stringify([workspaceActivo(), proyectoDeLaCelda()?.id ?? "", pp.sesion,
        Object.entries(sesiones()).map(([folder, rows]) => [folder, rows.map(row => [row.id, row.updated_at, row.archived, row.pinned, row.title])])])
      : undefined);
    const [delegation, { refetch: refreshDelegation }] = createResource(delegationScope, async key => {
      const [workspace, folder, id] = JSON.parse(key) as [string, string, string];
      try {
        const rows = await invoke<SessionRow[]>("list_delegated_sessions", { project: folder, id });
        return { workspace, id, rows, error: undefined as unknown };
      } catch (error) {
        return { workspace, id, rows: [] as SessionRow[], error };
      }
    });
    const delegationData = () => {
      const value = delegation();
      return value?.workspace === workspaceActivo() && value?.id === pp.sesion ? value : undefined;
    };
    const delegatedRows = createMemo<SessionRow[]>((previous) => {
      const all = Object.values(sesionesConEstado()).flat();
      const known = new Map(all.map(row => [row.id, row]));
      const rows = new Map((delegationData()?.rows ?? []).map(row => [row.id, row]));
      for (const row of delegatedDescendants(all, pp.sesion ?? "")) rows.set(row.id, row);
      const unseen = attention.unseen(workspaceActivo());
      const waiting = new Set(preguntadas());
      return conservar(previous ?? [], [...rows.values()].map(row => ({
        ...row, ...known.get(row.id), esperando: known.get(row.id)?.esperando ?? (waiting.has(row.id) || row.esperando),
        sin_ver: unseen.has(row.id),
      })), row => row.id);
    }, []);
    const delegatedList = (folder: string): DelegatedListProps => ({
      relatedSessions: [...Object.values(sesionesConEstado()).flat(), ...delegatedRows()],
      de: folder, current: pp.sesion ?? null, vivas: vivas(), aprobando: permissions().map(item => item.session),
      destinos: projectList().filter(item => item.id !== folder).map(item => ({ id: item.id, name: item.name })),
      onPick: id => { void abrirSesion(folder, id); },
      onDelete: id => void borrarSesion(folder, id),
      onMove: (id, destination) => void moverSesion(folder, id, destination),
      onEtapa: (id, stage) => void etaparSesion(folder, id, stage),
      onRenombrar: (id, title) => void renombrarSesion(folder, id, title),
      onPin: (id, pinned) => fijarSesion(folder, id, pinned),
    });
    const delegatedToolbar = () => <DelegatedActivity context={`${workspaceActivo()}/${pp.sesion}`}
      rows={delegatedRows()} list={delegatedList} live={vivas()} approvals={permissions().map(item => item.session)}
      loading={delegation.loading} error={delegationData()?.error} onRetry={() => void refreshDelegation()} />;
    createEffect(() => {
      if (!pp.sesion || !hasDelegation()) return;
      const key = `${workspaceActivo()}/${pp.sesion}`;
      setDelegatedToolbarTargets(previous => new Map(previous).set(key, delegatedToolbar));
      onCleanup(() => setDelegatedToolbarTargets(previous => {
        if (previous.get(key) !== delegatedToolbar) return previous;
        const next = new Map(previous);
        next.delete(key);
        return next;
      }));
    });
    const coordinatorScope = createMemo(() => {
      const row = filaDe(pp.sesion ?? "");
      return pp.sesion && (row?.parent || row?.launched_by)
        ? JSON.stringify([workspaceActivo(), proyectoDeLaCelda()?.id ?? "", pp.sesion, row.updated_at, row.launcher_available, tareaDelRiel(row.parent ?? row.launched_by ?? "")])
        : undefined;
    });
    const [coordinator] = createResource(coordinatorScope, async key => {
      const [workspace, folder, id] = JSON.parse(key) as [string, string, string];
      try {
        const reference = await invoke<SenderTask | null>("task_coordinator", { project: folder, id });
        return { workspace, id, reference };
      } catch { return { workspace, id, reference: null }; }
    });
    const coordinatingTask = () => {
      const value = coordinator();
      return value?.workspace === workspaceActivo() && value.id === pp.sesion ? value.reference : null;
    };
    const recuperable = () => !pp.soloLectura && !!estadoDelTrabajo()?.recreatable;
    const origenArchivada = () => (estadoDelTrabajo()?.history.archived ? origenes()[pp.sesion ?? ""] : undefined);
    /**
     * Qué cuenta como resultado de un turno lo decide la carpeta, y cada una
     * tiene una sola forma de decirlo: con git, el diff del turno; sin git, los
     * artefactos. Los dos bloques miden lo mismo con criterios que no coinciden
     * —el rango de `development::rangos` frente al tamaño y la fecha de
     * `workspace/artifacts.rs`—, así que juntos no suman, se contradicen.
     */
    const esRepositorio = () => proyectoDeLaCelda()?.kind === "git";
    /** Con quién se habla en esta celda, si lo que hay abierto es su chat. */
    const encargadoDeLaCelda = createMemo(() => {
      if (!pp.sesion) {
        const conversacion = hablandoCon();
        if (!conversacion || conversacion.project !== proyectoDeLaCelda()?.id) return null;
        return conversacion.name;
      }
      const fila = filaDe(pp.sesion ?? "");
      return fila && esChatDeAgente(fila) ? (fila.encargado ?? null) : null;
    });
    const identidadVisualDeLaCelda = () => pp.sesion
      ? (filaDe(pp.sesion)?.encargado ?? null)
      : encargadoDeLaCelda();
    /**
     * El estado que enseña la cabecera es el MISMO que pinta su fila del riel.
     * Derivarlo de «esta conversación tiene turno vivo» decía «Despierto» de
     * un agente que el riel daba por dormido, y nunca decía «Trabajando»
     * cuando lo que corría era una tarea que él lanzó.
     */
    const estadoDelEncargado = watchHandlerStatus(() => {
      const name = identidadVisualDeLaCelda();
      const proyecto = proyectoDeLaCelda()?.id;
      return name && proyecto ? { project: proyecto, name } : null;
    });
    /* Dentro de un memo: la celda del panel principal sigue al proyecto
       abierto, y mirarlo una sola vez al montar dejaba los perfiles del
       proyecto de antes — la cabecera caía al nombre crudo y a la cara del
       hash mientras el riel pintaba la elegida. Al cambiar de proyecto, el
       `onCleanup` de `watchProfiles` suelta la lectura anterior. */
    const perfilesDelProyecto = createMemo(() => watchProfiles(pp.proyecto ?? project()));
    const profiles = () => perfilesDelProyecto()();
    const cellProfile = () => {
      const name = identidadVisualDeLaCelda();
      return (name ? profiles()[name] : undefined) ?? DEFAULT_PROFILE;
    };
    /* El fondo viaja como `data:` URI: la política de la ventana no deja
       pintar un `file://` (`AGENTS.md` § el guarda `csp`). */
    const [chatBackground] = createResource(
      () => cellProfile().background ?? undefined,
      async (ruta) => {
        try {
          return (await invoke<Preview>("preview_file", { path: ruta, rel: ruta })).data_url;
        } catch {
          return null;
        }
      },
    );
    const [declared] = createResource(
      () => {
        const name = identidadVisualDeLaCelda();
        const id = proyectoDeLaCelda()?.id;
        return name && id ? `${id}\u0000${name}` : undefined;
      },
      async (clave) => {
        const [id, name] = clave.split("\u0000");
        try {
          const listado = await invoke<HandlerList>("list_encargados", { project: id });
          return listado.encargados.find((e) => e.name === name) ?? null;
        } catch {
          return null;
        }
      },
    );
    const [viewingProfile, setViewingProfile] = createSignal(false);
    createEffect(() => {
      // Cambiar de conversación cierra el perfil: seguiría abierto sobre un
      // chat que ya es de otro agente.
      identidadVisualDeLaCelda();
      setViewingProfile(false);
    });
    createEffect(() => {
      const pedido = requestedProfile();
      if (!pedido) return;
      if (pedido.name !== identidadVisualDeLaCelda()) return;
      if (pedido.project !== proyectoDeLaCelda()?.id) return;
      setRequestedProfile(null);
      setViewingProfile(true);
    });
    const lecturaDeLaCelda = () => lecturas.get(pp.sesion ?? "") ?? null;
    const preguntasDeLaCelda = almacenDePreguntas(() => pp.sesion);
    const vistaDeLaCelda = vistaDe(pp.sesion ?? "");
    const mensajes = createMemo<Msg[]>(() => {
      const h = suyo();
      const todos = h ? [...h.base, ...h.vivo] : [];
      return esRepositorio()
        ? todos.filter((m) => !m.artefactos?.length)
        : todos;
    });
    const historialAnteriorEnReposo = () => {
      const id = pp.sesion;
      return !!id && !!filaDe(id)?.chat_de_agente && !vivas().includes(id)
        && !permissions().some(item => item.session === id)
        && !(colaDe() === id && cola().length > 0);
    };
    const soloPorSerAnterior = () => historialAnteriorEnReposo() && !pp.soloLectura
      && !estadoDelTrabajo()?.history.archived && estadoDelTrabajo()?.available !== false;
    const seguirConElAgente = () => {
      const name = encargadoDeLaCelda();
      const proyecto = proyectoDeLaCelda()?.id;
      if (name && proyecto) hablarConEncargado(proyecto, name);
    };
    return (
    <Show
      when={viewingProfile() && declared()}
      fallback={
    <Chat
        onSearchReady={target => {
          if (!pp.sesion) return;
          setThreadSearchTargets(previous => {
            const next = new Map(previous);
            if (target) next.set(pp.sesion!, target);
            else next.delete(pp.sesion!);
            return next;
          });
        }}
        soloLectura={pp.soloLectura || !!estadoDelTrabajo()?.history.archived || estadoDelTrabajo()?.available === false || historialAnteriorEnReposo()}
        recovery={pp.sesion && (recuperable() || origenArchivada() !== undefined || soloPorSerAnterior()) ? <>
          <Show when={recuperable()}>
            <ResumeTask project={proyectoDeLaCelda()?.id ?? ""} id={pp.sesion ?? ""} onChanged={() => {
              void refreshWork();
              if (pp.sesion) {
                avisarDeLosArboles(pp.sesion);
                void refreshFolder(proyectoDeLaCelda()?.id ?? "", pp.sesion);
              }
            }} />
          </Show>
          <Show when={origenArchivada() !== undefined}>
            <TranscriptSource origin={origenArchivada() ?? null} agents={agents()} />
          </Show>
          <Show when={soloPorSerAnterior()}>
            <PreviousAgentChat name={encargadoDeLaCelda() ? displayName(encargadoDeLaCelda() ?? "", cellProfile()) : null}
              onContinue={seguirConElAgente} />
          </Show>
        </> : undefined}
        delegatedTask={reference => <DelegatedLaunch reference={reference} rows={delegatedRows()}
          list={delegatedList} loading={delegation.loading} error={delegationData()?.error} />}
        coordinator={coordinatingTask() ? <div class="shrink-0 px-4 py-1">
          <Button variant="ghost" size="sm" class="max-w-full truncate text-xs" data-task-coordinator
            onClick={() => void abrirSesion(coordinatingTask()!.folder, coordinatingTask()!.task)}>
            {t("chat.delegation.back", { title: coordinatingTask()!.title })}
          </Button>
        </div> : undefined}
        msgs={mensajes()}
        /* Identidad de lo que tiene delante, no ids de proyecto/tarea: es lo
           único con lo que distingue «entró un mensaje» de «otra
           conversación». La caja es la misma instancia al cambiar de tarea:
           sin esto el fondo del hilo anterior quedaría puesto. */
        conversacion={pp.sesion ?? ""}
        lectura={lecturaDeLaCelda()}
        onLectura={(lectura) => guardarLectura(pp.sesion, lectura)}
        chatEncargado={identidadVisualDeLaCelda()}
        agentDraft={!pp.sesion && !!encargadoDeLaCelda()}
        recentTasks={<Show when={!pp.sesion && encargadoDeLaCelda()}>{agent =>
          <RecentAgentChats project={proyectoDeLaCelda()?.id ?? ""} agent={agent()}
            sessions={sesionesConEstado()[proyectoDeLaCelda()?.id ?? ""] ?? []}
            onPick={id => { setHablandoCon(null); void abrirSesion(proyectoDeLaCelda()?.id ?? "", id); }} />
        }</Show>}
        agentTasks={<Show when={!pp.sesion && encargadoDeLaCelda()}>{agent => {
          const de = () => proyectoDeLaCelda()?.id ?? "";
          return <AgentPageTasks
            context={`${de()}/${agent()}`}
            tasks={createdTasks(sesionesConEstado()[de()] ?? [], agent(), null)}
            list={{
              de: de(), current: null, vivas: vivas(), aprobando: permissions().map(item => item.session),
              destinos: projectList().filter(item => item.id !== de()).map(item => ({ id: item.id, name: item.name })),
              onDelete: id => void borrarSesion(de(), id),
              onMove: (id, destination) => void moverSesion(de(), id, destination),
              onEtapa: (id, stage) => void etaparSesion(de(), id, stage),
              onRenombrar: (id, title) => void renombrarSesion(de(), id, title),
            }}
            onPick={id => { setHablandoCon(null); void abrirSesion(de(), id); }} />;
        }}</Show>}
        chatEstado={!pp.sesion && encargadoDeLaCelda() ? "awake" : estadoDelEncargado()}
        chatName={filaDe(pp.sesion ?? "")?.agent_thread
          ? t("projects.threads.heading", { name: displayName(identidadVisualDeLaCelda() ?? "", cellProfile()), title: threadTitle(filaDe(pp.sesion ?? "")) })
          : displayName(identidadVisualDeLaCelda() ?? "", cellProfile())}
        chatBody={cellProfile().body}
        chatDescription={declared()?.description}
        chatAvatar={cellProfile().avatar}
        bodyOf={(name) => profiles()[name]?.body ?? null}
        avatarOf={(name) => profiles()[name]?.avatar ?? null}
        chatBackground={chatBackground() ?? null}
        chatVeil={cellProfile().veil}
        onOpenProfile={() => setViewingProfile(true)}
        /* Que el hilo viene, no que no hay: sin esto el chat lee el vacío en
           vuelo como conversación nueva y salta al fondo (#315). Va por
           sesión y no por `hiloEnVuelo()` —global, solo pregunta por la
           abierta—: una celda separada tiene su propia lectura en vuelo. Es
           opcional: `tsc` no avisa si se pierde. */
        cargando={cargandoHilo() !== null && cargandoHilo() === pp.sesion}
        /* El medidor de memoria es de la sesión abierta —`ventana` se
           recalcula al abrir otra—: una celda separada no tiene el suyo. Va
           `null`, que el contrato lee como «todavía no hay ninguno». Pasarle
           `ventana()` enseñaría el de OTRA conversación, con un número
           creíble y equivocado. */
        ventana={pp.sesion === sessionId() ? ventana() : null}
        busy={pp.sesion === sessionId() ? busy() : vivas().includes(pp.sesion ?? "")}
        stopping={deteniendo() !== null && deteniendo() === pp.sesion}
        agents={agents()}
        proyecto={
          <SelectorDeProyecto locked={!!encargadoDeLaCelda()} branch={
            <Show when={!pp.sesion && esRepositorio()}>
              <BaseBranchPicker
                project={project()}
                directory={carpetaDeTrabajo(proyectoDeLaCelda() ?? {})}
                value={draftBases()[claveAbierta()]}
                disabled={busy()}
                onChange={(reference) => {
                  setDraftBases((bases) => ({ ...bases, [claveAbierta()]: reference }));
                  saveDraftConfiguration();
                }}
              />
            </Show>
          } />
        }
        /* Tarea de ESTA ventana, no la que tenga el mando: cerraba sobre los
            globales `sessionId()`/`project()` aunque el bloque se pinta
            DENTRO del hilo (`Chat.tsx`, bajo cada turno con archivos) —
            mostraba el diff de otra tarea, y cambiar de ventana reevaluaba
            este ámbito en TODOS los paneles montados. */
        cambiosDelTurno={(code) => (
          /* Sin git el rango no dice lo que parece: la foto la toma un
             repositorio que monta la app para la tarea (`development::trees` ·
             `asegurar_tienda`), así que una carpeta suelta también produce
             diff — de todo lo que se movió dentro, sea o no del turno. */
          <Show when={esRepositorio() ? pp.sesion : null}>
            {(id) => (
              <CambiosDelTurno
                project={pp.proyecto ?? project()}
                session={id()}
                code={code}
                /* `cambiado` va siempre en true: lo que sale de este bloque
                   lo cambió el turno por definición; su pestaña nace con
                   vista de diff. */
                onAbrir={(arbol, ruta) => abrirArchivo(arbol, ruta, true)}
              />
            )}
          </Show>
        )}
        material={materialPendiente()}
        contexto={contexto()}
        catalogo={sources()}
        onAdjuntarFuente={adjuntarFuente}
        onQuitarFuente={quitarFuente}
        onCambiarRama={cambiarRama}
        onAbrirArtefacto={abrirPorRel}
        onOpenTask={(folder, task) => void abrirSesion(folder, task)}
        tareaPorId={tareaDelRiel}
        /* Solo con tarea abierta y con el turno cerrado: exportar a mitad de una
           respuesta se llevaría una conversación sin ella. */
        onForkDesde={sessionId() ? forkDesde : null}
        forkAgents={(rosterDelProyecto() ?? []).map((e) => e.name)}
        forkAgent={sessionId() ? (filaDe(sessionId()!)?.encargado ?? null) : null}
        onError={setError}
        adjuntos={archivos()}
        onAdjuntos={setArchivos}
        onAgregarAdjuntos={agregarArchivos}
        agent={agent()}
        /* Lo utilizable, más la superficie de la tarea abierta si dejó de
           serlo: una tarea viva no puede cambiar de agente en silencio. El
           `&&` va dentro del accesor y no aquí — ver `menuDeSuperficies`. */
        superficies={menuDeSuperficies()}
        superficie={superficie()}
        /* La salida del estado vacío: es la sección, no una superficie.
           Apuntaba al id de la primera —«claude», «opencode-zen»—, válido
           cuando cada proveedor tenía panel propio; agrupada la
           configuración por secciones, ese id ya no nombra ningún panel y
           el primer arranque salía a ninguna parte, justo el peor sitio
           para romperse: lo primero que ve alguien sin nada conectado. */
        onConectar={() => setSettings("proveedores-ia")}
        onReintentar={() => void reintentar()}
        // El renglón de estado es de la tarea de esta celda, no de la del
        // panel activo: con la pantalla partida, leerlo de `sessionId()` hacía
        // que la misma tarea dijera «Libre» o «Cavilando» según el foco.
        reintento={
          reintento()?.session === pp.sesion ? reintento() : null
        }
        enFondo={enFondo().includes(pp.sesion ?? "")}
        inicioDelTurno={desdeDeTurno()[pp.sesion ?? ""] ?? null}
        terminal={terminales()[pp.sesion ?? ""] ?? null}
        carpetaDeTerminal={carpetasDeTerminal()[pp.sesion ?? ""] ?? null}
        models={models()}
        catalogos={catalogos()}
        model={model()}
        nativeSubagent={Boolean(pp.sesion && filaDe(pp.sesion)?.subagent)}
        /* Sólo mientras contesta, no con cualquier tarea abierta: cada
           turno guarda con qué modelo se contestó (`Turn::modelo_usado`),
           y la transcripción dice la verdad turno a turno; cambiar de
           modelo no la hace mentir. Lo del agente queda fijo, y lo
           sostiene `elegirModelo`. */
        modelLocked={Boolean(pp.sesion && filaDe(pp.sesion)?.subagent)}
        agentLocked={Boolean(pp.sesion) && !encargadoDeLaCelda() && proveedorFijo(pp.sesion ?? "")}
        onModel={elegirModelo}
        effort={effort()}
        onEffort={chooseEffort}
        modo={modo()}
        modos={modos()}
        onModo={elegirModo}
        skills={skills()}
        commands={comandosConAlMargen({ commands: cliCommands(), skills: [], side_question: sideCommand() }, t("chat.side.menu"))}
        sideCommand={sideCommand()}
        contestandoALaTerminal={porContestar().includes(pp.sesion ?? "")}
        alMargen={alMargen()?.session === (pp.sesion ?? "") ? alMargen() : null}
        onCerrarAlMargen={cerrarAlMargen}
        onPasarAlHilo={pasarAlHilo}
        mentionSources={mentionSources()}
        input={input()}
        taskCandidates={taskCandidates()}
        onTaskMenuOpen={() => void refreshTaskCandidates()}
        taskMentions={borrador().task_mentions}
        mentionProject={project()}
        mentionSession={sessionId()}
        onMentionHistory={navigateMentionHistory}
        placeCandidates={placeCandidates()}
        recipientCandidates={recipientCandidates()}
        recipients={borrador().recipients}
        /* Llamar a alguien y adjuntar material entran por caminos distintos y
           acaban en listas distintas; lo que comparten es que insertar en el
           texto corre a la otra lista. */
        onRecipient={(name, label, trigger) => editarBorrador(claveAbierta(), b => {
          const next = insertRecipient({ text: b.input, task_mentions: b.task_mentions, recipients: b.recipients }, trigger, name, label);
          return { ...b, input: next.text, task_mentions: next.task_mentions, recipients: next.recipients,
            mentionHistory: [...(b.mentionHistory ?? []), { text: b.input, task_mentions: b.task_mentions, recipients: b.recipients }].slice(-100), mentionFuture: [] };
        })}
        onReference={(target, label, trigger) => editarBorrador(claveAbierta(), b => {
          const next = insertMention({ text: b.input, task_mentions: b.task_mentions, recipients: b.recipients }, trigger, target, label);
          return { ...b, input: next.text, task_mentions: next.task_mentions, recipients: next.recipients,
            mentionHistory: [...(b.mentionHistory ?? []), { text: b.input, task_mentions: b.task_mentions, recipients: b.recipients }].slice(-100), mentionFuture: [] };
        })}
        onInput={setInput}
        onSend={mandar}
        onRespuestaRapida={mandarTexto}
        onMiniatura={miniaturaDeAdjunto}
        onPegarImagen={pegarImagen}
        onStop={detener}
        /* Solo el de la tarea que se está mirando: con el primero de la
           lista, dos turnos a la vez ponen la hoja de aprobar pegada a una
           conversación que no es la suya —el permiso sigue yendo a su
           sesión, pero se lee el comando de otra tarea sobre este hilo. No
           se pierde: la fila de esa tarea lo dice en el historial. */
        permission={permissions().find((p) => p.session === pp.sesion) ?? null}
        permissionError={permissionError()}
        respondingPermission={respondiendoPermiso()}
        onPermission={(permission, allow) =>
          void responderPermiso(permission, allow)
        }
        esperando={esperandoAqui()}
        onResponder={responder}
        onCancelarPregunta={cancelarPregunta}
        preguntasAMedias={preguntasDeLaCelda}
        vista={vistaDeLaCelda}
        cola={{
          items: cola(),
          pending: injecting().filter((item) => item.session === sessionId()).map((item) => item.id),
          agentes: agents(),
          actual: { agent: agent(), model: model() },
          // La pregunta abierta manda sobre las otras dos razones: es la única
          // que no se puede soltar a mano.
          retenida: esperando() ? "pregunta" : retenida(),
          esperandoA: esperandoA(),
          onEditar: editarEncolado,
          onBorrar: quitarEncolado,
          onEditando: setEditando,
          onMandar: () => setRetenida(null),
          // Solo con un turno vivo: sin él, lo escrito sale por el camino
          // normal y el gesto no significaría nada.
          onMandarAhora: pp.sesion && vivas().includes(pp.sesion)
            ? (id: string) => mandarAhora(id)
            : null,
        }}
        />
      }
    >
      {(e) => (
        <AgentProfile
          project={proyectoDeLaCelda()?.id ?? ""}
          encargado={e()}
          profile={cellProfile()}
          status={estadoDelEncargado()}
          background={chatBackground() ?? null}
          superficies={superficies() ?? []}
          catalogos={catalogos()}
          currentAgent={filaDe(pp.sesion ?? "")?.agent ?? null}
          onModelChosen={(elegidoAgent, elegidoModel) => {
            // Solo si es la conversación que tiene el mando: las demás
            // celdas no tienen composer propio con quien aplicarlo, y
            // pisarían el agente/modelo de la que sí lo tiene.
            if (pp.sesion !== sessionId() || busy()) return;
            batch(() => {
              if (elegidoAgent) setAgent(elegidoAgent);
              setModel(elegidoModel ?? "");
              saveDraftConfiguration();
            });
          }}
          onDeleted={() => setViewingProfile(false)}
          onClose={() => setViewingProfile(false)}
        />
      )}
    </Show>
    );
  };

  /* La imagen propia del fondo global, leída como `data:` URI: la
     política de la ventana no deja pintar un `file://`. Sin imagen —o si
     no se puede leer— la sección cae al atardecer. El fondo propio de un
     agente se pinta encima, dentro de su chat. */
  const [fondoPropioUrl] = createResource(fondoPropio, async (ruta) => {
    if (!ruta) return null;
    try {
      return (await invoke<Preview>("preview_file", { path: ruta, rel: ruta })).data_url;
    } catch {
      return null;
    }
  });

  const Conversacion = () => (
    <section class="relative flex h-full min-h-0 flex-col overflow-hidden">
      {/* El fondo vive aquí y no dentro de cada chat: así cubre también la
          tira de pestañas de la cabecera, que está fuera del hilo. Cada chat
          solo pinta encima el fondo propio de su agente, si lo tiene. */}
      <Show
        when={fondoDeChat() === "propia" ? fondoPropioUrl() : null}
        fallback={
          <div class={cn("pointer-events-none absolute inset-0", claseDeFondo("dusk"))} aria-hidden="true">
            <div
              class="absolute inset-0 bg-surface"
              style={{ opacity: String(veloDeFondo()) }}
            />
          </div>
        }
      >
        {(url) => (
          <div
            class="pointer-events-none absolute inset-0 bg-cover bg-center"
            style={{ "background-image": `url("${url()}")` }}
            aria-hidden="true"
          >
            <div
              class="absolute inset-0 bg-surface"
              style={{ opacity: String(veloDeFondo()) }}
            />
          </div>
        )}
      </Show>
      {/* Sin línea divisora y sin rótulo de sección: arriba va DE QUÉ es esta
          conversación y el único control que abre algo. El selector de agente no
          vive aquí: con qué agente corre un mensaje se decide al escribirlo. */}

      {/* El mismo eje que la cabecera del historial —el del semáforo,
          ver `lib/window.ts`— y con su hueco cuando la esquina superior
          izquierda es suya: al colapsar el historial a ancho cero, esta
          fila lleva el conmutador para traerlo de vuelta. Antes flotaba
          con `position: absolute`, sin compartir eje con nada. */}
      <div
        ref={cabeceraDeConversacion}
        class={cn("relative flex shrink-0 items-center gap-3 pr-4",
          HEADER_HEIGHT,
          "pl-4",
        )}
        data-tauri-drag-region=""
        onDblClick={toggleMaximizeFromHeader}
      >
        <div ref={controlesIzquierdos} class="relative z-40 flex shrink-0 items-center gap-3">
        <Show when={sidebar.colapsado()}>
          <BotonConAtajo
            variant="ghost"
            size="icon"
            class="size-7 shrink-0 text-neutral-500"
            onClick={sidebar.alternar}
            aria-pressed={false}
            aria-label={t("shell.sidebar.show")}
            accion="sidebar"
            etiqueta={t("shell.sidebar.show")}
          >
            <PanelLeftOpen size={16} />
          </BotonConAtajo>
        </Show>
        <Show when={sidebar.colapsado() && spaces().length > 0}>
          <Button
            variant="ghost"
            size="icon"
            class="size-7 shrink-0 text-neutral-500"
            data-archived-collapsed=""
            aria-pressed={viendoArchivadas()}
            aria-label={t("spaces.archived.title")}
            title={t("spaces.archived.foot_title")}
            onClick={alternarArchivadas}
          >
            <Archive size={16} />
          </Button>
        </Show>
        </div>
        {/* Las pestañas, donde estaba el título de la conversación: con
            una se ve como el título de siempre; con varias, las tareas
            a mano. El historial de la izquierda sigue siendo el
            historial entero; esto son las abiertas. Con el split, las
            de abajo llevan su tira en la cuadrícula, sin pagar una
            fila propia. */}

        {/* Sin partir hay una sola ventana y una sola tira. Su envoltorio y
            el «+» quedan fuera del `For`, que vuelve a montar la tira al
            abrir una tarea: así el «+» no cuesta nodos en cada apertura. */}
        <Show when={!paneles.isSplit()}>
          <div
            class="flex min-w-0 flex-1 items-center self-stretch"
            data-tira=""
            data-ventana="0,0"
            onPointerDown={() => mandarVentana({ col: 0, fila: 0 })}
          >
            <For each={paneles.columns().map((_, col) => ({ col, fila: 0 }))}>
              {(sitio) => (
                <TabStrip
                  session={filaDe}
                  tabs={pestanasDe(sitio)}
                  activeId={paneles.activeTabAt(sitio)}
                  liveIds={vivas()}
                  approvingIds={permissions().map((p) => p.session)}
                  waitingIds={preguntadas()}
                  onPick={(id) => {
                    const p = pestanas.open().find((x) => x.id === id);
                    if (p) void activarPestana(p);
                  }}
                  onClose={cerrarPestana}
                  dirtyIds={pestanas.dirty()}
                  onCloseMany={cerrarPestanas}
                  onDrag={arrastrarPestana}
                  dropIndex={marcaDe(sitio)}
                />
              )}
            </For>
            {botonDeNuevaPestana()}
          </div>
        </Show>
        {/* Partida, las tiras se alinean por las pistas reales de las
            ventanas: `pistas(anchosEnPantalla())`, igual que `Paneles`. */}
        <Show when={paneles.isSplit()}>
          <div
            class="pointer-events-none absolute inset-0 z-30 grid"
            style={{ "grid-template-columns": gridTracks(anchosEnPantalla()) }}
          >
            <For each={ventanas().filter((sitio) => sitio.fila === 0)}>
              {(sitio) => (
                <div
                  class="pointer-events-auto flex h-8 min-w-0 items-center px-2"
                  style={{
                    "grid-column": `${sitio.col * 2 + 1}`,
                    "padding-left":
                      sitio.col === 0
                        ? `${Math.max(8, reservaIzquierdaDeTiras())}px`
                        : undefined,
                    "padding-right":
                      sitio.col === anchosEnPantalla().length - 1
                        ? `${Math.max(8, reservaDerechaDeTiras())}px`
                        : undefined,
                  }}
                  data-tira=""
                  data-ventana={`${sitio.col},${sitio.fila}`}
                  onPointerDown={() => mandarVentana(sitio)}
                >
                  <TabStrip
                    session={filaDe}
                    tabs={pestanasDe(sitio)}
                    activeId={paneles.activeTabAt(sitio)}
                    liveIds={vivas()}
                    approvingIds={permissions().map((p) => p.session)}
                    waitingIds={preguntadas()}
                    onPick={(id) => {
                      const p = pestanas.open().find((x) => x.id === id);
                      if (p) void activarPestana(p);
                    }}
                    onClose={cerrarPestana}
                    dirtyIds={pestanas.dirty()}
                    onCloseMany={cerrarPestanas}
                    onDrag={arrastrarPestana}
                    dropIndex={marcaDe(sitio)}
                  />
                  {botonDeNuevaPestana()}
                  <span class="flex-1" />
                  <Show when={pestanas.open().find(p => p.id === paneles.activeTabAt(sitio))?.clase !== "tarea"}>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="size-6 shrink-0 text-neutral-500"
                    disabled={!puedeSepararseDe(sitio)}
                    onClick={() => partirVentana(sitio)}
                    aria-label={nombreDeSeparar(sitio)}
                    title={nombreDeSeparar(sitio)}
                  >
                    <Columns2 size={14} />
                  </Button>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
        {/* Solo con la columna cerrada: abierta, su conmutador vive en la
            cabecera del panel derecho (`features/shell/RightPanelHeader.tsx`). */}
        <div ref={controlesDerechos} class="relative z-40 ml-auto flex shrink-0 items-center gap-3">
        <Show when={!artOpen() && !paginaDeAgente()}>
          <BotonConAtajo
            variant="ghost"
            size="icon"
            class="relative size-7 shrink-0 text-neutral-500"
            disabled={!columnaConContenido()}
            onClick={() => setArtOpen(true)}
            aria-pressed={false}
            aria-label={nombreDelArbol()}
            accion="workTree"
            etiqueta={columnaConContenido() ? nombreDelArbol() : t("shell.work_tree.no_session")}
          >
            <PanelRightOpen size={16} />
          </BotonConAtajo>
        </Show>
        </div>
      </div>

      {/* La columna del árbol de trabajo no reemplaza al chat: lo angosta. La
          vista de proyecto sí, y es la única cosa que lo hace: es lo que
          ocupa el panel cuando lo que se está mirando no es una conversación. */}

      {/* La conversación se esconde, no se desmonta, cuando hay un documento
          delante: un archivo y un artefacto son pestañas del mismo sitio que
          las tareas y ocupan este hueco; volver a la conversación devuelve
          el hilo donde iba y lo escrito sin mandar. Desmontarla tiraría las
          dos cosas. */}

      {/* Esa misma propiedad sostiene la cuadrícula: separar una pestaña no
          mueve estos nodos a otro padre, les asigna una celda con
          `grid-column`/`grid-row` dentro de la misma cuadrícula
          (`features/shell/Panels.tsx`). Cambia dónde se pinta cada uno y
          cuál está escondido, no quién lo pintó. */}
      <Paneles
        anchos={anchosEnPantalla()}
        altos={altosEnPantalla()}
        filasPorColumna={filasEnPantalla()}
        minimoAncho={MIN_PANEL_WIDTH}
        minimoAlto={MIN_PANEL_HEIGHT}
        etiquetaAncho={t("projects.split.divider")}
        etiquetaAlto={t("projects.split.divider_rows")}
        onRepartirAncho={paneles.resizeColumns}
        onRepartirAlto={paneles.resizeRows}
      >
      <Index each={ventanas()}>{site => {
        const task = () => pestanas.open().find(p => p.id === paneles.activeTabAt(site()) && p.clase === "tarea");
        const target = () => threadSearchTargets().get(task()?.session ?? "");
        return <Show when={Boolean(task()) && !tapadoPorElProyecto(site())}>
          <div class="z-20 min-w-0 max-w-full self-start justify-self-end px-4 py-1" style={estiloDeLaCelda(site())}
            classList={{ "mt-8": llevaTiraInterior(site()) }} onPointerDown={() => mandarVentana(site())}>
            <ThreadSearch conversation={task()?.session ?? ""} active={sameSite(site(), paneles.activeSite()) && settings() === null && alta() === null}
              messages={target()?.messages() ?? []} thread={() => target()?.thread()}
              onJump={block => target()?.jump(block)}
              leadingTools={<Button variant="chrome" size="iconCompact" class="size-7 text-neutral-500"
                disabled={!paneles.isSplit() && !puedeSepararseDe(site())}
                title={paneles.isSplit() ? t("chat.search.join") : t("chat.search.split_hint", { key: atajoDePartir(false) })}
                aria-label={paneles.isSplit() ? t("chat.search.join") : t("chat.search.split")}
                onClick={() => {
                  if (paneles.isSplit()) { mandarVentana(site()); juntarLaActiva(); }
                  else partirVentana(site());
                }}><Columns2 size={14} /></Button>}
              tools={<Show keyed when={delegatedToolbarTargets().get(`${workspaceActivo()}/${task()?.session ?? ""}`)}>{render => render()}</Show>} />
          </div>
        </Show>;
      }}</Index>

      {/* Aquí solo viven las tiras de las filas inferiores: la primera usa
          la cabecera del chasis, que una fila inferior no comparte. Va
          encima de su celda con `align-self: start` y no en un contenedor
          propio: meter tira y contenido en un mismo padre por ventana los
          sacaría del padre común que arrastrar un visor necesita
          (`features/shell/Panels.tsx`). */}

      {/* Partir vive un nivel por debajo de las pestañas, a la derecha de
          su ventana, como en un terminal: pertenece al panel que va a
          partir, no a una fila compartida donde un botón único no diría
          cuál. Flota sobre la esquina (`self-start justify-self-end`) en
          vez de ocupar una fila propia de 32 px que separaría las
          pestañas del texto. */}

      {/* El icono son dos columnas y no una flecha: es una forma, no un
          movimiento. No es un conmutador —sin `aria-pressed`—: la vuelta
          atrás es cerrar la última pestaña de la ventana. */}
      <For each={ventanas().filter((sitio) => sitio.fila > 0 && pestanas.open().find(p => p.id === paneles.activeTabAt(sitio))?.clase !== "tarea")}>
        {(sitio) => (
          <div
            class="z-20 flex self-start justify-self-end p-1"
            style={estiloDeLaCelda(sitio)}
          >
            <Button
              variant="ghost"
              size="icon"
              class="size-6 text-neutral-500"
              disabled={!puedeSepararseDe(sitio)}
              onClick={() => partirVentana(sitio)}
              aria-label={nombreDeSeparar(sitio)}
              title={nombreDeSeparar(sitio)}
            >
              <Columns2 size={14} />
            </Button>
          </div>
        )}
      </For>

      <Show when={paneles.isSplit()}>
        <For each={ventanas().filter((sitio) => sitio.fila > 0)}>
          {(sitio) => (
            <div
              class="z-30 flex h-8 min-w-0 items-center self-start px-2"
              style={estiloDeLaCelda(sitio)}
              // Cómo la encuentra el arrastre: `ventanaBajo` pregunta al
              // documento por estos dos atributos, que es lo que hace que soltar
              // valga tanto aquí como en el cuerpo del cuadrante.
              data-tira=""
              data-ventana={`${sitio.col},${sitio.fila}`}
              // Pulsar en cualquier sitio de la tira pone su ventana al mando,
              // aunque no se pulse una pestaña. Es lo que hace que la caja y la
              // columna derecha sigan al clic y no solo al cambio de pestaña.
              onPointerDown={() => mandarVentana(sitio)}
            >
              <TabStrip
                session={filaDe}
                tabs={pestanasDe(sitio)}
                activeId={paneles.activeTabAt(sitio)}
                liveIds={vivas()}
                approvingIds={permissions().map((p) => p.session)}
                waitingIds={preguntadas()}
                onPick={(id) => {
                  const p = pestanas.open().find((x) => x.id === id);
                  if (p) void activarPestana(p);
                }}
                onClose={cerrarPestana}
                dirtyIds={pestanas.dirty()}
                onCloseMany={cerrarPestanas}
                onDrag={arrastrarPestana}
                dropIndex={marcaDe(sitio)}
              />
            </div>
          )}
        </For>
      </Show>

      {/* La pestaña que se está llevando, pegada al cursor: sin ella el
          gesto no dice que lleve nada. El arrastre nativo del navegador
          pinta este fantasma solo; el nuestro es por puntero
          (`arrastrarPestana`) y hay que pintarlo aquí, no en la tira, que
          no sabe dónde acabó el cursor. */}
      <Show when={arrastrando() !== null && cursor() !== null}>
        <div
          aria-hidden="true"
          class="pointer-events-none fixed z-[60] max-w-[220px] truncate rounded-[var(--radius-sm)] border border-border-strong bg-surface-raised px-2 py-1 text-sm font-medium text-neutral-950 shadow-md"
          style={{
            left: `${cursor()!.x + 12}px`,
            top: `${cursor()!.y + 12}px`,
          }}
        >
          {tituloDePestana(arrastrando()!)}
        </div>
      </Show>

      {/* A qué ventana va a caer lo que se arrastra. En el centro —o sobre una
          tira, donde manda la barra de inserción— es el marco del cuadrante
          entero; en un borde que admite partida, media ventana, que es donde
          va a nacer la nueva. No recibe puntero: taparía el gesto que lo pinta. */}
      <Show when={arrastrando() !== null && donde() !== null}>
        <Show
          when={dropSide()}
          fallback={
            <div
              aria-hidden="true"
              class="pointer-events-none z-50 rounded-[var(--radius-sm)] border-2 border-primary/70 bg-primary/5"
              style={estiloDeLaCelda(donde()!.sitio)}
            />
          }
        >
          {(side) => (
            <div
              aria-hidden="true"
              class="pointer-events-none relative z-50"
              style={estiloDeLaCelda(donde()!.sitio)}
            >
              <div
                class={cn(
                  "absolute rounded-[var(--radius-sm)] border-2 border-primary/70 bg-primary/5",
                  side() === "left" && "inset-y-0 left-0 w-1/2",
                  side() === "right" && "inset-y-0 right-0 w-1/2",
                  side() === "up" && "inset-x-0 top-0 h-1/2",
                  side() === "down" && "inset-x-0 bottom-0 h-1/2",
                )}
              />
            </div>
          )}
        </Show>
      </Show>

      {/* Una conversación por tarea abierta, no por ventana: la clave es la
          tarea. Arrastrarla a otra ventana solo le cambia la celda —no se
          desmonta, no se vuelve a pedir el hilo, no se pierde lo escrito sin
          mandar. Con una por ventana, arrastrar costaría las tres cosas. */}

      {/* Se lee y no se escribe salvo en la activa (`PanelDeChat` ·
          `soloLectura`): la caja de escritura es una sola y vive donde está
          el mando, evitando que dos cajas manden con el agente y el modelo
          que eligió una (`lib/panels.ts`). */}
      <For each={tareasEnVentanas()}>
        {(p) => {
          const sitio = () => paneles.siteOf(p.id);
          /** Se ve si su ventana la tiene delante y esa ventana se pinta. */
          const celda = () => celdaDe(p.id);
          const placement = createMemo<ReturnType<typeof celda>>(previous => celda() ?? previous);
          const manda = () => sameSite(sitio(), paneles.activeSite())
            && celda() !== undefined && !tapadoPorElProyecto(sitio());
          return (
            <div
              class="flex min-h-0 min-w-0 flex-col"
              classList={{
                hidden: celda() === undefined || tapadoPorElProyecto(sitio()),
                "pt-8": llevaTiraInterior(sitio()),
              }}
              style={placement()}
              data-ventana={
                sitio() ? `${sitio()!.col},${sitio()!.fila}` : undefined
              }
              onPointerDown={() => {
                const d = sitio();
                if (d) mandarVentana(d);
              }}
            >
              <Show when={montadas().has(p.id)}>
                <PanelDeChat
                  sesion={p.session}
                  proyecto={p.project}
                  soloLectura={!manda()}
                />
              </Show>
            </div>
          );
        }}
      </For>

      {/* Toda ventana enseña algo: su pestaña de delante, o la conversación
          en blanco. La vista de proyecto ocupa la activa; una ventana sin
          pestaña delante pinta el blanco en su propia celda. */}

      {/* El blanco es de la celda, no de la ventana activa: `paneles.blanquear()`
          deja la ventana con sus pestañas y sin ninguna delante, y la celda
          hace la pregunta —no una señal global— para que enfocar otra
          ventana no se lleve el blanco con ella. */}

      {/* Dos ventanas en blanco del mismo proyecto comparten borrador y solo
          escribe la que manda. Proyectos distintos conservan borradores
          distintos. */}

      {/* El `For` de arriba pinta una conversación por tarea abierta: sin
          tareas no pinta ninguna. Sin este bloque, cerrar la última pestaña
          deja la ventana en negro sin que `tsc` lo detecte. */}
      <Show when={viendoArchivadas()}>
        <div
          class="flex min-h-0 min-w-0 flex-col"
          classList={{ "pt-8": llevaTiraInterior(paneles.activeSite()) }}
          style={estiloDeLaCelda(paneles.activeSite())}
          data-ventana={`${paneles.activeSite().col},${paneles.activeSite().fila}`}
        >
          <ArchivedTasks
            spaces={spaces()}
            proyectos={projectList()}
            onAbrir={(p, id) => void abrirSesion(p, id)}
          />
        </div>
      </Show>

      <Show when={proyectoDeLaVista()}>
        {(p) => (
          <div
            class="flex min-h-0 min-w-0 flex-col"
            classList={{ "pt-8": llevaTiraInterior(paneles.activeSite()) }}
            style={estiloDeLaCelda(paneles.activeSite())}
            data-ventana={`${paneles.activeSite().col},${paneles.activeSite().fila}`}
          >
            <VistaDeProyecto
              proyecto={p()}
              modelos={modelosParaAgentes()}
              sources={sources()}
              agents={agents()}
              sessions={sesionesConEstado()[p().id] ?? []}
              current={sessionId()}
              vivas={vivas()}
              aprobando={permissions().map((x) => x.session)}
              destinos={projectList()
                .filter((x) => x.id !== p().id)
                .map((x) => ({ id: x.id, name: x.name }))}
              onNueva={() => nuevaSesion(p().id)}
              onAbrir={(id) => void abrirSesion(p().id, id)}
              onHablarCon={(name) => hablarConEncargado(p().id, name)}
              onDelete={(id) => void borrarSesion(p().id, id)}
              onMove={(id, a) => void moverSesion(p().id, id, a)}
              onEtapa={(id, etapa) => void etaparSesion(p().id, id, etapa)}
              onPin={(id, pinned) => fijarSesion(p().id, id, pinned)}
              onRenombrar={(id, title) =>
                void renombrarSesion(p().id, id, title)
              }
              onAdjuntar={(source) => adjuntarAlProyecto(p().id, source)}
              onQuitar={(source) => quitarDelProyecto(p().id, source)}
              onCarpetaEditable={(dir) => carpetaEditable(p().id, dir)}
            />
          </div>
        )}
      </Show>

      {/* `Index` y no `For`: la lista son sitios, y `sitios()` construye
          objetos nuevos en cada lectura. Con `For` —que compara por
          referencia— activar una pestaña en OTRA ventana volvería a montar
          este blanco, perdiendo foco y punto de inserción del cursor.
          `Index` va por posición y reutiliza el nodo mientras la cuenta de
          ventanas en blanco no cambie. */}
      <Index each={sitiosEnBlanco()}>
        {(sitio) => (
          <div
            class="flex min-h-0 min-w-0 flex-col"
            classList={{ "pt-8": llevaTiraInterior(sitio()) }}
            style={estiloDeLaCelda(sitio())}
            data-ventana={`${sitio().col},${sitio().fila}`}
            onPointerDown={() => mandarVentana(sitio())}
          >
            <PanelDeChat
              sesion={null}
              soloLectura={!sameSite(sitio(), paneles.activeSite())}
            />
          </div>
        )}
      </Index>

      {/* Cada documento queda montado, escondido cuando no es el que se
          está mirando: cambiar de pestaña y volver no vuelve a pedir el
          archivo, no pierde qué vista se había elegido ni el borrador sin
          guardar. */}

      {/* Se montan todos, no solo los de la tarea abierta: la tira es una,
          y activar el archivo de otra tarea abre esa tarea detrás
          (`activarPestana`); su visor sigue vivo mientras su pestaña
          exista. */}
      <For each={idsDeContenido()}>
        {(id) => {
          const p = () => pestanas.open().find((x) => x.id === id) ?? null;
          /**
           * En qué panel se enseña este documento, `-1` si en ninguno. No es
           * `id === pestanaActiva()`: con un solo panel son lo mismo, pero con
           * la pantalla partida un documento del panel de al lado se ve sin
           * ser la activa, y esa pregunta lo dejaría escondido.
           */
          const celda = () => celdaDe(id);
          const visible = () => celda() !== undefined;
          return (
            <Show when={p()}>
              {(abierta) => (
                <div
                  class="min-h-0 min-w-0 overflow-y-auto"
                  classList={{
                    hidden: !visible() || tapadoPorElProyecto(paneles.siteOf(id)),
                    "pt-8": llevaTiraInterior(paneles.siteOf(id)),
                  }}
                  style={celda()}
                  data-ventana={(() => {
                    const d = paneles.siteOf(id);
                    return d ? `${d.col},${d.fila}` : undefined;
                  })()}
                  onPointerDown={() => {
                    const d = paneles.siteOf(id);
                    if (d) mandarVentana(d);
                  }}
                >
                  {/* `Switch` y no dos `Show` anidados: con tres clases,
                      el `fallback` de un `Show` deja de significar «la otra»
                      y pasa a significar «alguna de las otras dos». Aquí
                      cada clase se nombra. */}
                  <Switch>
                    {/* El estrechamiento va en el `when`, no dentro del
                        hijo: aquí el cuerpo corre una vez y lo que decide qué
                        se pinta es la expresión reactiva (`SYSTEM.md` § Las
                        reglas de Solid · 7). Con el `as` dentro del hijo, la
                        rama del archivo se construía también para una pestaña
                        de sitio, con `arbol` y `ruta` en `undefined`. */}
                    <Match
                      when={
                        abierta().clase === "archivo"
                          ? (abierta() as FileTab)
                          : null
                      }
                    >
                      {(a) => (
                        <VisorDeArchivo
                          project={a().project}
                          session={a().session}
                          base={a().base}
                          arbol={a().arbol}
                          ruta={a().ruta}
                          cambiado={a().cambiado}
                          visible={visible()}
                          onSucio={(sucio) => pestanas.setDirty(id, sucio)}
                          onGuardador={(guardar) => pestanas.registerSaver(id, guardar)}
                          onAbrirOtro={(ruta) =>
                            pestanas.openContent({
                              clase: "archivo",
                              id: fileTabId({ project: a().project, session: a().session, arbol: a().arbol, ruta }),
                              project: a().project,
                              session: a().session,
                              arbol: a().arbol,
                              ruta,
                              cambiado: false,
                            })
                          }
                          onGuardado={() => {
                            // Guardar convierte el archivo en uno cambiado: su
                            // pestaña gana la vista de cambios y el árbol
                            // relee su estado, que es de donde la pestaña saca
                            // su letra de git.
                            pestanas.markChanged(id);
                            window.dispatchEvent(
                              new CustomEvent("harness:copia"),
                            );
                          }}
                        />
                      )}
                    </Match>
                    <Match
                      when={
                        abierta().clase === "sitio"
                          ? (abierta() as SiteTab)
                          : null
                      }
                    >
                      {(s) => (
                        <Sitio
                          url={s().url}
                          visible={visible()}
                          navegador={s().navegador}
                          onNavego={(url) => s().navegador && pestanas.navigate(id, url)}
                        />
                      )}
                    </Match>
                    <Match
                      when={
                        abierta().clase === "artefacto"
                          ? (abierta() as ArtifactTab)
                          : null
                      }
                    >
                      {(a) => (
                        <Show
                          when={a().codigo}
                          fallback={<VisorDeArtefacto path={a().path} rel={a().rel} kind={a().kind} />}
                        >
                          <VisorDeArchivo
                            project={a().project}
                            session={a().session}
                            arbol=""
                            ruta={a().path}
                            suelto
                            cambiado={false}
                            visible={visible()}
                            onSucio={() => {}}
                            onGuardador={() => {}}
                            onGuardado={() => {}}
                          />
                        </Show>
                      )}
                    </Match>
                  </Switch>
                </div>
              )}
            </Show>
          );
        }}
      </For>

      <Show when={pestanas.open().some((p) => p.id === OBSERVABILITY_TAB_ID)}>
        <div
          class="min-h-0 min-w-0"
          classList={{ hidden: celdaDe(OBSERVABILITY_TAB_ID) === undefined || tapadoPorElProyecto(paneles.siteOf(OBSERVABILITY_TAB_ID)), "pt-8": llevaTiraInterior(paneles.siteOf(OBSERVABILITY_TAB_ID)) }}
          style={celdaDe(OBSERVABILITY_TAB_ID)}
        >
          <Observability onManage={() => setSettings("plugins")} />
        </div>
      </Show>

      </Paneles>

    </section>
  );

  // El riel del escritorio activo. Sin escritorio es el de siempre.
  const proyectosDelRiel = createMemo(() => carpetasDelEscritorio(projectList(), activeSpace(), sesiones()));
  const delegationFamilies = createMemo(() => delegatedFamilies(Object.values(sesiones()).flat()));
  const sesionesDelRiel = () => {
    const current = sesionesConEstado();
    const all = Object.values(current).flat();
    const approvals = permissions().map(item => item.session);
    const known = new Map(all.map(row => [row.id, row]));
    const families = delegationFamilies();
    const todas = Object.fromEntries(Object.entries(current).map(([folder, rows]) => [folder, rows.map(row => {
      const children = (families.get(row.id) ?? []).flatMap(id => known.get(id) ?? []);
      return children.length ? { ...row,
        delegated_activity: delegatedAttention([row, ...children], vivas(), approvals) } : row;
    })]));
    const desk = escritorio();
    if (!desk) return todas;
    return Object.fromEntries(Object.entries(todas).map(([k, filas]) => [k, filas.filter((r) => enEscritorio(r, desk))]));
  };
  const opcionesDeMover = () =>
    multipleSpaces() ? spaces().map((i) => ({ id: i.id, name: spaceName(i) })) : [];

  const Principal = () => (
    // UNA superficie continua, no tres tarjetas flotando: las columnas
    // pegan con el chat y se separan con hairline y divisor arrastrable
    // (shells → surfaces → components).

    // Continua no quiere decir de un solo tono: los rieles llevan `bg`
    // y el chat `surface` (`ColumnaLateral`), y lo que la regla prohíbe
    // —hueco, sombra, esquina redondeada— sigue prohibido.

    // Sin cabecera y sin título de app, como Claude: la ventana ya se
    // llama Terminus.
    <div class="relative flex h-full flex-col overflow-hidden bg-surface">
      <ToastStack>
        {/* Aquí y no en Configuración: ahí no entra nadie a buscar
            actualizaciones. El panel de «Estado del entorno» dice lo
            mismo para quien va a mirar; esto es para quien no va a ir. */}
        <AvisoDeVersion />
        {/* Debajo del de versión y con la misma forma: los dos son avisos
            que no interrumpen. Si coinciden, el de versión queda arriba:
            reiniciar afecta a lo que estés haciendo, y traer material no. */}
        <AvisoDeMaterial />
        <AvisoDeCarpeta project={project()} session={sessionId()} />
        <McpSignInNotice session={sessionId()} />
        {/* El error del último gesto, y no caduca solo: uno que se va a los
            segundos no se llega a leer. Lo quita su cruz o el cambio de
            workspace. */}
        <Show when={error()}>
          {(e) => (
            <Toast tone="error" onDismiss={() => setError(null)}>
              <p class="m-0 break-words text-xs text-error-strong">{e()}</p>
            </Toast>
          )}
        </Show>
        <Show when={aviso()}>
          {(a) => (
            <Toast data-space-toast="" onDismiss={() => setAviso(null)}>
              <p class="m-0 break-words text-xs text-neutral-950">{a().texto}</p>
              <Show when={a().ir}>
                {(ir) => (
                  <div>
                    <Button variant="outline" size="compact" onClick={() => { setAviso(null); ir()(); }}>
                      {a().boton}
                    </Button>
                  </div>
                )}
              </Show>
            </Toast>
          )}
        </Show>
      </ToastStack>

      <Show when={spaces().find((i) => i.id === deletingSpace())}>
        {(i) => (
          <DeleteSpace
            space={i()}
            proyectos={projectList()}
            onCerrar={() => setDeletingSpace(null)}
            onAbrir={(folder, task) => {
              setDeletingSpace(null);
              void abrirSesion(folder, task);
            }}
            onEliminada={(n) => spaceDeleted(i(), n)}
            onTocadas={(folders) => void refreshSessions(folders)}
          />
        )}
      </Show>

      <Show when={borradoConTrabajo()}>{(b) => (
        <Dialog open onOpenChange={(abierto) => { if (!abierto) setBorradoConTrabajo(null); }}>
          <DialogContent class="flex flex-col gap-3">
            <DialogTitle class="text-sm font-semibold">{t("projects.sessions.delete_work_title")}</DialogTitle>
            <p class="m-0 text-[13px] text-neutral-700">{t("projects.sessions.delete_work")}</p>
            <ul class="m-0 flex max-h-[40vh] list-none flex-col overflow-y-auto p-0">
              <For each={b().files}>{(f) => (
                <li class="shrink-0 truncate font-mono text-[11px] text-neutral-500" title={f}>{f}</li>
              )}</For>
            </ul>
            <div class="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setBorradoConTrabajo(null)}>
                {t("projects.sessions.keep")}
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  const a = b();
                  setBorradoConTrabajo(null);
                  void borrarSesion(a.project, a.id, true);
                }}
              >
                {t("projects.sessions.delete")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}</Show>

      {/* Cancelar va primero: es el que recibe el foco, y Enter por inercia no
          puede tirar ni escribir nada. */}
      <Show when={cierreSinGuardar()}>{(c) => (
        <Dialog open onOpenChange={(abierto) => { if (!abierto) setCierreSinGuardar(null); }}>
          <DialogContent class="flex flex-col gap-3">
            <DialogTitle class="text-sm font-semibold">{t("projects.tabs.unsaved.title")}</DialogTitle>
            <p class="m-0 text-[13px] text-neutral-700">{t("projects.tabs.unsaved.body")}</p>
            <ul class="m-0 flex max-h-[40vh] list-none flex-col overflow-y-auto p-0">
              <For each={c().archivos}>{(ruta) => (
                <li class="shrink-0 truncate font-mono text-[11px] text-neutral-500" title={ruta}>{ruta}</li>
              )}</For>
            </ul>
            <div class="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setCierreSinGuardar(null)}>
                {t("projects.tabs.unsaved.cancel")}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => void resolverCierre("descartar")}>
                {t("projects.tabs.unsaved.discard")}
              </Button>
              <Button size="sm" onClick={() => void resolverCierre("guardar")}>
                {t("projects.tabs.unsaved.save")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}</Show>

      {/* Sin workspace no hay carpeta donde escribir: aquí sí se tapa
          todo, riel incluido. Es la única pantalla que lo hace —el
          estado vacío de contexto se puede usar; esto no tiene dónde
          guardar nada. */}
      <Show
        when={!alta()}
        fallback={
          <>
            <Onboarding
              /* Agregar un workspace es la misma alta, no un formulario aparte: el
                 segundo cliente necesita lo mismo que el primero —sus cuentas y su
                 material, que cuelgan de él— y tener dos altas distintas garantiza
                 que una se quede corta. */
              nuevo={alta() === "nueva"}
              onCancelar={alta() === "nueva" ? () => setAlta(null) : undefined}
              /* Por el mismo evento que usa el selector de workspace: quien acaba
                 de crear el primero no tiene por qué saber cómo se recarga esta
                 pantalla. */
              onListo={() => {
                setAlta(null);
                window.dispatchEvent(new CustomEvent("harness:workspace"));
              }}
            />
          </>
        }
      >
        {/* El chasis se monta SIEMPRE, tenga o no fuente de contexto:
            detrás de `contextRoot`, un workspace recién creado no tenía
            riel lateral ni forma de escribir hasta señalar una carpeta,
            y eso contradecía el modelo —un proyecto dejó de ser un
            repo. */}

        {/* Las dos columnas son hermanas de ancho propio y usan
            `ColumnaLateral`, que documenta sus límites. */}
        <TitleBar
          attention={attention.list()}
          onManage={() => setSettings("workspaces")}
          escritorios={
            spaces().length > 0
              ? (nombre) => (
                  <SpaceBar
                    workspace={nombre()}
                    workspaceId={workspaceActivo() ?? ""}
                    spaces={spaces()}
                    activa={escritorio()}
                    proyectos={projectList()}
                    sesiones={sesiones()}
                    senal={(id) => senalDe(id)}
                    onElegir={cambiarEscritorio}
                    onCrear={createSpace}
                    onRenombrar={renameSpace}
                    onCarpetas={updateSpaceFolders}
                    onEliminar={(id) => setDeletingSpace(id)}
                  />
                )
              : undefined
          }
        />
        <div class="relative flex min-h-0 flex-1 overflow-visible">
          <WorkspaceColumn attention={attention.list()} onManage={() => setSettings("workspaces")} />
          {/* Los topes los pone quien monta: el ancho por debajo del
              cual algo deja de caber solo lo sabe su contenido. Por
              debajo de 220 los títulos del historial dejan de caber; por
              encima de 420 la barra empieza a comer la conversación. */}
          <ColumnaLateral
            lado="left"
            colapsada={sidebar.colapsado()}
            clave="sidebar.width"
            ancho={260}
            min={220}
            max={420}
            etiqueta={t("shell.column.sidebar_width")}
          >
            <Sidebar
              projects={proyectosDelRiel()}
              modelos={modelosParaAgentes()}
              sessions={sesionesDelRiel()}
              escritorio={activeSpace() ? spaceName(activeSpace()) : null}
              viendoArchivadas={viendoArchivadas()}
              onArchivadas={spaces().length > 0 ? alternarArchivadas : undefined}
              spaces={opcionesDeMover()}
              onMoveToSpace={(p, id, i) => void moveToSpace(p, id, i)}
              current={sessionId()}
              vivas={vivas()}
        /* Qué tareas esperan que apruebes algo, aparte de `vivas`: pesa
           más, una que trabaja no necesita nada de ti, y una parada
           esperando tu aprobación no avanza hasta que vayas. */
        aprobando={permissions().map((p) => p.session)}
              collapsed={sidebar.colapsado()}
              onToggle={sidebar.alternar}
              onPick={(p, id) => {
                // Abrir una tarea suelta la marca del agente: su fila no
                // puede seguir señalada cuando ya se mira otra cosa.
                setHablandoCon(null);
                void abrirSesion(p, id);
              }}
              onNew={() => nuevaSesion()}
              onRenombrarProyecto={(id, name) =>
                void renombrarProyecto(id, name)
              }
              onBorrarProyecto={borrarProyecto}
              onRemoveFromSpace={multipleSpaces() ? removeFromActiveSpace : undefined}
              onAnadirCarpeta={() => setAnadiendoCarpeta(true)}
              clon={clonEnCurso()}
              onAbrirClon={() => setAnadiendoCarpeta(true)}
              proyectoAbierto={proyectoAbierto()}
              onAbrirProyecto={abrirProyecto}
              hablandoCon={agenteSenalado()}
              onHablarCon={hablarConEncargado}
              onAgentProfile={openAgentProfile}
              /* El proyecto viaja en el mismo gesto que abre el borrador. */
              onNuevaTareaEn={(id) => nuevaSesion(id)}
              onDelete={(p, id) => borrarSesion(p, id)}
              onMove={(p, id, a) => void moverSesion(p, id, a)}
              onEtapa={(p, id, etapa) => void etaparSesion(p, id, etapa)}
              onPin={fijarSesion}
              onRenombrar={(p, id, title) =>
                renombrarSesion(p, id, title)
              }
              onSettings={(panel) => setSettings(panel ?? "")}
            />
          </ColumnaLateral>

          {/* 30rem es lo que cabe en la caja sin partir el modelo ni el modo.
              Las columnas laterales encogen mil veces más rápido, hasta su
              mínimo; un factor menor que 1 aquí dejaría desbordar la fila. */}
          <div class="min-h-0 min-w-0 flex-[1_1_30rem] overflow-hidden" data-conversacion>
            <Conversacion />
          </div>

          {/* El ancho se recuerda como número de píxeles, por
              `lib/prefs.ts`, igual que el historial —no como fracción
              del grupo (`harness.split.artefactos`), que daba anchos
              distintos según el tamaño de ventana. La clave vieja queda
              huérfana en `localStorage`: su formato no se lee como
              píxeles. */}

          {/* 300 y 420 son el mínimo y el ancho de partida
              (`rightMinSize`/`rightDefaultSize`): por debajo de 300 la
              fila del árbol deja de caber. */}

          {/* El tope es 560: un archivo se abre como pestaña del centro,
              a ancho entero, y esta columna solo enseña un árbol de
              rutas —no hace falta más ancho para elegir en él. */}

          {/* `ColumnaLateral` clampa el ancho recordado al montar: sin
              eso, un ancho guardado en 900 se quedaría ahí para
              siempre —el tope solo se aplica al arrastrar— tapando la
              conversación sin explicación. */}
          <ColumnaLateral
            lado="right"
            colapsada={!artOpen()}
            clave="artefactos.width"
            ancho={420}
            min={300}
            max={560}
            etiqueta={t("shell.column.work_tree_width")}
          >
            <Show when={agenteSenalado()} fallback={<ColumnaDeTrabajo
              folderActions={
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="size-7 shrink-0 text-neutral-500"
                    disabled={!folder()}
                    onClick={abrirCarpeta}
                    aria-label={t("shell.folder.open")}
                    title={t("shell.folder.open")}
                  >
                    <FolderOpen size={16} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="size-7 shrink-0 text-neutral-500"
                    disabled={!folder()}
                    onClick={() => void copiarRuta()}
                    aria-label={rutaCopiada() ? t("shell.folder.copied") : t("shell.folder.copy")}
                    title={rutaCopiada() ? t("shell.folder.copied") : t("shell.folder.copy")}
                  >
                    <Show when={rutaCopiada()} fallback={<Copy size={16} />}>
                      <Check size={16} />
                    </Show>
                  </Button>
                </>
              }
              project={project()}
              session={sessionId()}
              baseRef={draftBases()[claveAbierta()]}
              tabs={pestanas.open()}
              visible={artOpen()}
              onExportarChat={exportarChat}
              onAbrirArchivo={abrirArchivo}
              onArchivoMovido={archivoMovido}
              onArchivoBorrado={archivoBorrado}
              onClose={() => setArtOpen(false)}
            />}>
              {owner => <AgentTasks
                context={`${owner().project}/${sessionId() ?? owner().name}`}
                tasks={createdTasks(sesionesConEstado()[owner().project] ?? [], owner().name, filaDe(sessionId() ?? "")?.agent_thread ? sessionId() : null)}
                list={{
                  de: owner().project, current: sessionId(), vivas: vivas(), aprobando: permissions().map(item => item.session),
                  destinos: projectList().filter(item => item.id !== owner().project).map(item => ({ id: item.id, name: item.name })),
                  onDelete: id => void borrarSesion(owner().project, id),
                  onMove: (id, destination) => void moverSesion(owner().project, id, destination),
                  onEtapa: (id, stage) => void etaparSesion(owner().project, id, stage),
                  onRenombrar: (id, title) => void renombrarSesion(owner().project, id, title),
                }}
                onClose={() => setArtOpen(false)}
                onPick={id => {
                  const destination = { project: owner().project, id };
                  setHablandoCon(null);
                  void abrirSesion(destination.project, id);
                }}
              />}
            </Show>
          </ColumnaLateral>
        </div>
      </Show>

      {/* Chrome de la app, por debajo de todo: no está dentro del chat ni de
          ninguna columna. La ventana es 28 px más corta, no una columna más
          angosta. Lo que enseña es del workspace —las cuentas cuelgan de él—
          pero no del proyecto. */}
      <UsageBar
        agents={agents()}
        agent={agent()}
        busy={busy()}
        reload={cuentasTocadas()}
        /* El destino es la sección, no el agente: los ids de panel
           eran del agente —«claude», «codex»—, uno por proveedor; con
           Configuración agrupada por secciones dejaron de existir.
           Ahora lleva a «Proveedores de IA». */
        onGestionarCuentas={() => setSettings("proveedores-ia")}
        /* El panel de puertos vive ahí abajo, y la pestaña se abre
           aquí: el gesto cruza toda la app —lo que se abre es del
           espacio principal, no de la barra. */
        onAbrirSitio={(url, proyecto, session) =>
          void abrirSitio(url, proyecto, session)
        }
        onObservability={abrirObservabilidad}
        onReportarBug={() => setInput(t("chat.composer.bug_report_starter"))}
        trabajando={vivas()}
        conPestana={sesionesConPestana()}
        onAbrirTarea={(proyecto, session) => void abrirSesion(proyecto, session)}
      />

      <AnadirCarpeta
        abierto={anadiendoCarpeta()}
        workspace={workspaceActivo()}
        space={escritorio()}
        onClon={setClonEnCurso}
        onCerrar={() => setAnadiendoCarpeta(false)}
        onHecho={async (p, activate) => {
          setProjectList(await invoke<Project[]>("list_projects"));
          // El backend ya la fijó en el escritorio desde el que se pidió: un
          // clon en segundo plano termina cuando la ventana puede mirar otro.
          await reloadSpaces();
          if (activate) elegirProyecto(p.id);
        }}
      />

      {/* El nombre del workspace ya no se deduce de la ruta: lo lee el propio
          menú de la cabecera, que es quien sabe cuál está activo. */}
      <Show when={settings() !== null}>
        <Settings
          panel={settings() || undefined}
          modelos={modelosParaAgentes()}
          proyecto={proyectoAbierto() ?? project()}
          agentesEnUso={agentesEnUso()}
          onClose={cerrarAjustes}
          onAgentProfile={(enProyecto, name) => {
            cerrarAjustes();
            openAgentProfile(enProyecto, name);
          }}
        />
      </Show>
    </div>
  );

  // **La ventana que no puede abrir estos datos no pinta la app,
  // la sustituye.** Un aviso encima dejaría debajo una app usable sobre la
  // carpeta que se acaba de negar a tocar. Ver `PantallaDeBloqueo`.
  return (
    <Show when={bloqueo()} fallback={<Principal />}>
      {(b) => <PantallaDeBloqueo frase={b()} />}
    </Show>
  );
}
