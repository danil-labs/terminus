/**
 * Reglas de producto sobre una computadora, iguales en la web y en el teléfono:
 *
 * - Abrir la app nunca enciende una máquina. Solo una acción (lista de
 *   intención) despierta una VM administrada, a través del relay.
 * - Cada máquina se muestra solo como encendida, apagada o encendiéndose; un
 *   apagado es neutro, nunca un error.
 * - Una máquina propia (una Mac, otro VPS con Seldon Host) apagada no se puede
 *   despertar: el relay no tiene a quién pedírselo.
 * - Con la VM apagada, las lecturas del espejo vuelven de la copia del relay
 *   (`cached`); sin copia, `machine_off`.
 */
import type { Computer } from "./api.ts";

/** Lo que manda el relay más lo que pone la fila de `/v1/computers`. */
export type MachineState = "unknown" | "starting" | "online" | "offline" | "stopped" | "provisioning";

/** Lo único que se le muestra a la persona. */
export type Power = "on" | "off" | "starting";

export function powerOf(state: string): Power {
  if (state === "online") return "on";
  if (state === "starting") return "starting";
  return "off";
}

/**
 * Adaptadores del orquestador del plano de control (`KNOWN_PROVIDERS` en
 * `computers/src/orchestrator`). Solo una computadora de uno de ellos se puede
 * encender desde la nube.
 */
export const MANAGED_PROVIDERS: ReadonlySet<string> = new Set(["aws-ec2"]);

/** La VM que Danil administra para la persona, frente a una máquina suya conectada. */
export function isManaged(computer: Pick<Computer, "provider">): boolean {
  return typeof computer.provider === "string" && MANAGED_PROVIDERS.has(computer.provider);
}

/** La máquina por omisión: la VM administrada, si hay; si no, la primera. */
export function defaultComputer<T extends Pick<Computer, "provider" | "computer_id">>(computers: readonly T[]): T | null {
  return computers.find(isManaged) ?? computers[0] ?? null;
}

/**
 * Lo que enciende una computadora apagada en el relay (`INTENT_COMMANDS` de
 * `computers/src/protocol.ts`). Cualquier otra llamada con la máquina apagada
 * contesta desde el espejo o con `machine_off`.
 */
export const INTENT_COMMANDS: ReadonlySet<string> = new Set([
  "send_message",
  "inject_message",
  "create_project",
  "create_agent",
  "create_agent_thread",
  "login_account",
  "submit_login_code",
  "respond_permission",
  "answer_question",
  "answer_shell_output",
  "run_shell_command",
  "queue_ready",
  "resume_awaiting_quota",
  "recreate_task_work",
]);

/** Lecturas que el relay guarda y contesta desde su copia (`MIRROR_COMMANDS` de `computers/src/mirror.ts`). */
export const MIRROR_COMMANDS: ReadonlySet<string> = new Set([
  "workspaces_startup",
  "list_workspaces",
  "get_profile",
  "list_projects",
  "list_spaces",
  "list_live_sessions",
  "list_archived",
  "archived_tasks",
  "list_delegated_sessions",
  "task_coordinator",
  "list_agent_status",
  "list_providers",
  "load_session",
  "load_queue",
  "task_history",
  "session_usage",
  "pending_requests",
  "list_active_turns",
  "list_live_turns",
  "list_workspace_attention",
  "list_agents",
]);

/** Qué hacer con una acción según la máquina, antes de mandarla. */
export function canAct(computer: Pick<Computer, "provider">, state: string): "now" | "wakes" | "asleep" {
  const power = powerOf(state);
  if (power === "on") return "now";
  if (isManaged(computer)) return "wakes";
  // Encendiéndose sin orquestador: el conector de la máquina está llegando solo.
  return power === "starting" ? "wakes" : "asleep";
}
