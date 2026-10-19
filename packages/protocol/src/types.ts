/**
 * Lo que contestan los comandos de `APP_COMMANDS`, con los nombres de campo del
 * motor (`esperando`, `chat_de_agente`): ni el relay ni el bridge los renombran.
 * Solo los campos que usan los clientes; el motor manda más.
 */
export type EngineError = { code: string; message_key?: string; detail?: unknown };

export type Workspace = { id: string; name: string };
/** `list_workspaces`. */
export type Startup = { workspaces: Workspace[]; active: string | null };
/** `list_projects`: una carpeta del workspace. */
export type Project = { id: string; name: string; working_directory?: string | null };
/** `list_spaces`. */
export type Space = { id: string; name: string | null; folders: string[] };

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
  tools?: unknown[];
  questions?: Question[] | null;
};
/** `load_session`. */
export type OpenedSession = { id: string; provider: string; model: string | null; agent?: string | null; turns: Turn[] };

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
export type EngineEvent = { name: string; payload: unknown };
