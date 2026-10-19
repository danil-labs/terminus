/**
 * What the bridge answers, in the engine's own field names (`task list`,
 * `esperando`, `sin_ver`): the bridge forwards RPC1 results without renaming.
 */
export type EngineError = { code: string; message_key?: string; detail?: string | null };
export type Workspace = { id: string; name: string };
export type Space = { id: string; name: string | null; folders: string[] };
/** A named agent of the workspace; on the phone it reads like a person you message. */
export type Handler = {
  name: string;
  description: string | null;
  status: string;
  live_tasks: number;
  minutes_since_last_turn: number | null;
  folders: string[];
};
export type Folder = { id: string; name: string; working_directory: string };
export type TaskRow = {
  id: string;
  folder: string;
  workspace: string;
  title: string;
  provider: string;
  model: string | null;
  last_message: string | null;
  outcome: string | null;
  updated_at: number;
  esperando: boolean;
  archived: boolean;
  space: string | null;
  agent: string | null;
};
export type TaskRecord = {
  id: string;
  role: "user" | "agent" | "system";
  text: string;
  at: number;
  meta: string | null;
  tools?: unknown[];
  model?: string | null;
};
export type TaskPage = { records: TaskRecord[]; next_cursor: number; latest_cursor: number };
export type Permission = { request_id: string; tool: string; target: string | null; for_person: boolean };
export type Option = { value: string; label: string; detail?: string | null };
export type Question = { id: string; question: string; header?: string | null; options: Option[]; multiple: boolean; free_text: boolean };
export type QuestionSet = { request_id?: string | null; turno?: string; turn?: string; preguntas?: Question[]; questions?: Question[] };
export type TaskShow = {
  running: boolean;
  requests: { permissions: Permission[]; questions: QuestionSet[] };
  task: { id: string; title: string; provider: string; model: string | null };
};
export type Receipt = { id: string; status: string; result: { queued?: boolean; ahead?: number } | null; error: EngineError | null };
export type AttentionState = "approving" | "asked" | "failed" | "unseen";
export type WorkspaceAttention = { workspace: string; tasks: { session: string; project: string; state: AttentionState }[] };
export type Notice = { workspace: string; session: string; project: string | null; state: AttentionState | "finished" };
export type ChatEvent = { workspace?: string; session: string; kind: string; text: string; meta: string | null; ok: boolean | null; request_id: string | null; message_id?: string };
export type BridgeEvent = { seq: number; name: string; payload: unknown };
