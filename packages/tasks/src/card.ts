/**
 * La tarjeta de dos líneas de una tarea (sidebar del escritorio, #151).
 *
 * Línea 1: la marca de estado en su columna fija, el título y la chincheta.
 * Línea 2: lo que te piden si espera aprobación o respuesta (el último
 * mensaje); si no, también si falló, la marca del proveedor, la carpeta, la máquina (solo si no es la de la ventana)
 * y la cara del agente. En «Compacta» no hay línea 2.
 *
 * Cada cliente pinta esto a su manera; qué entra y en qué orden sale de aquí.
 * Lo que solo el escritorio sabe (git, PR, worktree) lo añade él.
 */
import { type TaskActivity, type TaskState, taskPriority } from "../../design/src/index.ts";
import { type SidebarContext, type SidebarTask, activityOf, isPinned, needsYou } from "./view.ts";

export type CardTask = SidebarTask & {
  title: string;
  last_message?: string | null;
  /** Con qué proveedor de IA corre (`claude`, `codex`…). */
  provider?: string | null;
  /** La máquina que la corre, si se enseña; `machine_on: false` es apagada. */
  machine?: string | null;
  machine_on?: boolean;
};

export type TaskCard = {
  activity: TaskActivity;
  state: TaskState | null;
  /** Sin estado y entregada: la marca de entregada en vez del círculo vacío. */
  delivered: boolean;
  pinned: boolean;
  needsYou: boolean;
  /** Línea 2 si espera aprobación o respuesta: lo que pide. Una fallida no
   *  pide nada: su último mensaje no es la causa, la marca roja ya lo dice. */
  request: string | null;
  /** El proveedor de IA, va primero en la línea 2. */
  provider: string | null;
  /** La carpeta de la fila, si se enseña (`""` es sin carpeta y no se enseña). */
  folder: string | null;
  /** La cara del agente; no en su propio chat, que ya es suyo. */
  agent: string | null;
  machine: { id: string; on: boolean } | null;
};

export type CardOptions<T extends CardTask> = Pick<SidebarContext<T>, "live" | "approving" | "folderOf"> & {
  /** Bajo la cabecera de su carpeta, la fila no repite la carpeta. */
  hideFolder?: boolean;
};

export function taskCard<T extends CardTask>(task: T, options: CardOptions<T>): TaskCard {
  const activity = activityOf(task, options);
  const state = taskPriority(activity);
  const folder = options.hideFolder ? null : ((options.folderOf ? options.folderOf(task) : task.folder) || null);
  return {
    activity,
    state,
    delivered: !state && activity.outcome === "delivered",
    pinned: isPinned(task),
    needsYou: needsYou(state),
    request: state === "approving" || state === "asked" ? (task.last_message || null) : null,
    provider: task.provider || null,
    folder,
    agent: task.agent && !task.chat_de_agente ? task.agent : null,
    machine: task.machine ? { id: task.machine, on: task.machine_on !== false } : null,
  };
}
