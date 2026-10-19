/** CLI-level commands a remote client may ask for: the Terminus CLI surface. */
export const CLI_COMMANDS = [
  "workspace list",
  "folder list",
  "space list",
  "handler list",
  "agent list",
  "agent models",
  "task list",
  "task show",
  "task read",
  "task create",
  "task send",
  "task stop",
  "operation show",
] as const;

/** Window commands a person answers; the bridge sends them through `service invoke`. */
export const INVOKE_COMMANDS = [
  "respond_permission",
  "answer_question",
  "mark_task_seen",
  "list_workspace_attention",
  "list_active_turns",
] as const;

export type BridgeCommand = (typeof CLI_COMMANDS)[number] | (typeof INVOKE_COMMANDS)[number];

/** Attention states that become a notice when a task enters them. */
export const NEEDS_YOU = ["approving", "asked", "failed"] as const;
