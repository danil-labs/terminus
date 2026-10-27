/**
 * Toda espera tiene tope y termina con un error con nombre. Los plazos son los
 * del relay (`computers`): lecturas 60 s allá y 15 s aquí, para que la rebanada
 * se marque «sin respuesta» antes; acciones 60 s; lo que enciende una VM 330 s.
 */
import { INTENT_COMMANDS } from "../../computers/src/index.ts";

export const READ_DEADLINE = 15_000;
export const ACTION_DEADLINE = 60_000;
export const INTENT_DEADLINE = 330_000;

export type Deadlines = { read: number; action: number; intent: number };
export const DEADLINES: Deadlines = { read: READ_DEADLINE, action: ACTION_DEADLINE, intent: INTENT_DEADLINE };

const READ = /^(list_|load_|read_|get_|preview_)|_status$|^(workspaces_startup|session_usage|task_history|session_folder|setup_required|check_environment|account_limits|chat_background|file_size|pending_requests|task_coordinator|turn_authors)$/;

export type CommandClass = "read" | "action" | "intent";

export function classOf(command: string): CommandClass {
  if (INTENT_COMMANDS.has(command)) return "intent";
  return READ.test(command) ? "read" : "action";
}

export const isRead = (command: string) => classOf(command) === "read";
