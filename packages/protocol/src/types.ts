/**
 * Lo que contestan los comandos de `APP_COMMANDS`, con los nombres de campo del
 * motor (`esperando`, `chat_de_agente`): ni el relay ni el bridge los renombran.
 * Solo los campos que usan los clientes; el motor manda más.
 */
export type EngineError = { code: string; message_key?: string; detail?: unknown };

/** La cuenta de Danil vinculada a un workspace (`danil` de `list_workspaces`). */
export type WorkspaceDanil = { user_id: string; email?: string | null; name?: string | null };
/**
 * Un workspace tiene el mismo id en cada máquina que lo tiene (`groupWorkspaces`).
 * `default_permission_mode`, el modo con que arranca una tarea nueva si la
 * persona eligió uno (`workspaces::Workspace::default_permission_mode`).
 */
export type Workspace = { id: string; name: string; provider?: string | null; remote?: string | null; danil?: WorkspaceDanil | null; default_permission_mode?: string | null };
/** `list_workspaces`. */
export type MachineResources = {
  measured_at: number;
  error?: "measurement_failed" | "unsupported";
  storage: { id: string; label: string; total_bytes: number; free_bytes: number; available_bytes: number; terminus_bytes: null; attribution: "unknown" }[];
};
export type WorkspaceStorage = {
  bytes: number; recuperable: number; medido_en: number; aviso: string | null;
  tareas: { session: string; project: string; tarea: string; proyecto: string | null; bytes: number }[];
  compartido: { bytes: number }[]; sueltos: { bytes: number }[];
};
export type Startup = { workspaces: Workspace[]; active: string | null; machine_resources?: MachineResources };
/** `list_projects`: una carpeta del workspace. */
export type Project = { id: string; name: string; working_directory?: string | null; kind?: "git" | "folder"; remote_url?: string | null };
/**
 * Evento `project_clone` y respuesta de `project_clone_status`: el clon que pidió
 * `start_project_clone`. Termina con `done` y `project`, o con `error` (un
 * `Failure` del motor; `projects.error.clone_cancelled` si se canceló).
 */
export type ProjectCloneEvent = {
  workspace?: string;
  operation: string;
  phase: string;
  percent: number | null;
  done: boolean;
  project?: Project;
  error?: { what?: Frase; detail?: string } | string;
};
/** `list_spaces`. */
export type Space = { id: string; name: string | null; folders: string[]; account?: boolean };

/** `list_live_sessions`: una tarea abierta de una carpeta. */
export type SessionRow = {
  id: string;
  title: string;
  provider: string;
  model: string | null;
  last_message?: string | null;
  created_at: number;
  updated_at: number;
  esperando: boolean;
  outcome?: "delivered" | "failed" | null;
  /** El agente con nombre que la lleva. */
  agent: string | null;
  space?: string | null;
  pinned?: boolean | null;
  archived?: boolean | null;
  chat_de_agente?: boolean;
  /** Un hilo nuevo del agente (no su chat de siempre). */
  agent_thread?: boolean;
  inbox?: boolean;
  parent?: string | null;
  launched_by?: string | null;
  launcher_available?: boolean;
  stage?: "in_progress" | "review" | "done" | null;
};

/** `list_agents`: los agentes con nombre de una carpeta. */
export type AgentList = { agents: { name: string; description?: string | null }[] };
export type AgentPresence = "working" | "awake" | "asleep";
/** `list_agent_status`. */
export type AgentStatusRow = { name: string; status: AgentPresence; minutes_since_last_turn: number | null; live_tasks: number };

/** `list_providers`: Codex, Claude… */
export type ProviderInfo = { id: string; label: string; available: boolean; driver: boolean };

export type Option = { value: string; label: string; detail?: string | null };
export type Question = { id: string; question: string; header?: string | null; options: Option[]; multiple: boolean; free_text: boolean };
/** `answer_question`: una respuesta por pregunta. */
export type Answer = { turn: string; question: string; chosen: string[]; free_text: string | null };

/** Un turno de `load_session`. */
export type Turn = {
  id?: string;
  role: string;
  text: string;
  at?: number;
  meta?: string | null;
  model?: string | null;
  tools?: TurnTool[];
  questions?: Question[] | null;
  answers?: Answer[] | null;
  /** Rutas en la máquina de lo que la persona adjuntó (las viejas, `entradas/…`). */
  attachments?: string[] | null;
  /** El turno en su orden: lo que el agente dijo, con las herramientas (`tool` indexa `tools`) donde las usó. */
  pieces?: TurnPiece[] | null;
  /** Un `!`: el comando va en `text`. */
  shell?: { cwd: string; output: string; exit_code: number | null; duration_ms: number; truncated: boolean } | null;
  /** El encargado que escribió este input, si no fue la persona (`Turn::agent`). */
  agent?: string | null;
  /** La tarea que lo escribió por el CLI (`Turn::from_task`). */
  from_task?: SenderTask | null;
};
/** La tarea que escribió un input, como era al escribirlo (`sessions::SenderTask`). */
export type SenderTask = { folder: string; task: string; title: string; provider: string; model?: string | null };
/** Un paso del turno; `images` son data URLs que produjo la herramienta. `ok: false` si falló. */
export type TurnTool = { name?: string; target?: string | null; images?: string[]; ok?: boolean | null };
/** Un trozo de `Turn.pieces`. */
export type TurnPiece = { text: string } | { tool: number };
/** `preview_file` y `attachment_preview`. */
export type FilePreview = {
  rel: string;
  kind: "html" | "image" | "text" | "pdf" | "binary";
  text?: string | null;
  data_url?: string | null;
  /** El PDF en base64. */
  pdf?: string | null;
  bytes: number;
  truncated: boolean;
};
/** `tree_show`: un archivo de un árbol de la tarea. */
export type TreeContent = { kind: string; text: string; bytes: number; truncated: boolean };
/** `load_session`. */
export type OpenedSession = { id: string; provider: string; model: string | null; agent?: string | null; permission_mode?: string | null; turns: Turn[] };

/** `pending_requests`. */
export type PendingRequests = {
  questions: { request_id: string; turn: string }[];
  permissions: { request_id: string; tool: string; target: string | null }[];
};

export type AttentionState = "approving" | "asked" | "failed" | "unseen";
/** `list_workspace_attention` y el evento `attention`. */
export type WorkspaceAttention = { workspace: string; tasks: { session: string; project: string; state: AttentionState }[] };

/** El evento `chat`. */
export type ChatEvent = {
  workspace?: string;
  session: string;
  kind: string;
  text: string;
  meta: string | null;
  ok: boolean | null;
  request_id: string | null;
  target?: string | null;
  starts_message?: boolean;
};
/** Un evento del motor tal como llega (`service events`). */
export type EngineEvent = { name: string; payload: unknown; workspace?: string | null };

// --- El cuadro de escribir ---------------------------------------------------

/** Un texto del motor: ya escrito, o una clave del catálogo del escritorio con sus datos. */
export type Frase = string | { clave: string; datos?: Record<string, string | number> | null };

/** Un modelo de `list_models`; `efforts` vacío es que no se elige razonamiento. */
export type ModelOption = { id: string; label: string; note?: Frase | null; efforts: string[]; default_effort: string | null };
/** `list_models`. */
export type ProviderModels = { provider: string; models: ModelOption[]; fallback?: boolean | null };
/** `list_permission_modes`: `por_omision` es el que toma una tarea nueva; `falta` dice por qué no se puede usar. */
export type PermissionModeOption = { id: string; label: Frase; falta?: Frase | null; por_omision?: boolean };
/** `list_slash_menu`: los comandos del CLI y las skills. */
export type SlashMenu = { commands: { name: string; description?: string | null }[]; skills: { name: string; description?: string | null }[]; side_question?: string | null };
/** `list_mentions`: archivos y carpetas que se pueden nombrar con `@`. */
export type MentionList = { fuentes: { ruta: string; tipo: string; fuente?: string | null }[]; truncado?: boolean };
/** `project_base_branches`. */
export type BaseBranches = { branches: { reference: string; name: string; remote?: string | null }[]; selected: string | null; fetched_at?: number | null };
/** `task_blockers`: lo que impide archivar sin preguntar. */
export type TaskBlockers = { unsaved: { session: string; title: string; files: string[] }[]; not_finished?: boolean };

// --- Cuentas de IA ---------------------------------------------------------------

/** Una cuenta de `list_accounts`; `identity` es el correo, si el CLI lo dice. */
export type AiAccount = { id: string; label: string; created_at?: number | null; identity: string | null; authenticated_at: number | null };
/** `list_accounts(provider)`. */
export type AccountList = { provider: string; active: string | null; accounts: AiAccount[] };
/** `account_status`. */
export type AccountStatus = { id: string; authenticated: boolean; detail?: string | null };
/** Una ventana de consumo: `used_pct` usado (0–100) y cuándo vuelve a empezar, en ms. */
export type UsageWindow = { label: string; used_pct: number; resets_at: number | null };
/** `account_limits`: el consumo, si se pudo leer. */
export type AccountLimits =
  | { mode: "read"; windows: UsageWindow[]; plan: string | null; fetched_at: number }
  | { mode: "waiting"; retry_at: number; detail?: unknown; last?: { windows: UsageWindow[]; plan: string | null; fetched_at: number } | null }
  | { mode: "no_account" | "revoked" | "failed" | "in_use"; what?: unknown; detail?: unknown };
/** `run_shell_command`: la tarea (nueva si se mandó sin sesión) y su turno. */
export type ShellRun = { session: string; turn: string };
/** El evento `account` de un inicio de sesión por tubería (enlace y código); `account` es el id de la cuenta. */
export type LoginEvent = { account: string; kind: "url" | "confirm" | "code" | "notice" | "done"; text: string };
