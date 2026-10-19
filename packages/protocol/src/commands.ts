/**
 * Los comandos que la app móvil manda al motor de una máquina, por cualquiera
 * de sus dos caminos: el relay de Danil Computers y el bridge de desarrollo.
 * Son funciones de ventana (`service invoke`, `commands.json`), con los nombres
 * del contrato renombrado (`agent` = agente con nombre, `provider` = Codex,
 * Claude…). Es una lista cerrada: el bridge rechaza el resto con 403 y el
 * cliente del relay ni lo envía (`command_not_allowed`). Un comando nuevo se
 * agrega aquí a propósito, nunca un pase genérico al motor.
 */
export const APP_READS = [
  "list_workspaces",
  "list_projects",
  "list_spaces",
  "list_live_sessions",
  "list_agents",
  "list_agent_status",
  "list_providers",
  "load_session",
  "pending_requests",
  "list_active_turns",
  "list_workspace_attention",
] as const;

export const APP_ACTIONS = [
  "send_message",
  "inject_message",
  "stop_turn",
  "respond_permission",
  "answer_question",
  "mark_task_seen",
] as const;

export const APP_COMMANDS: readonly AppCommand[] = [...APP_READS, ...APP_ACTIONS];

export type AppCommand = (typeof APP_READS)[number] | (typeof APP_ACTIONS)[number];

export function isAppCommand(command: string): command is AppCommand {
  return (APP_COMMANDS as readonly string[]).includes(command);
}

/** Estados de atención que avisan cuando una tarea entra en ellos. */
export const NEEDS_YOU = ["approving", "asked", "failed"] as const;
