/**
 * Las funciones de la UI nueva que dependen de comandos que no todas las
 * máquinas conocen: crear, renombrar y eliminar espacios, Mantener despierta,
 * Puertos y las archivadas (`APP_FEATURES` en `@terminus/protocol`). Una
 * función se enseña si el teléfono puede mandar sus comandos (`APP_COMMANDS`)
 * y la máquina no dijo que no los conoce (`host.available`, `unknown` hasta
 * la primera respuesta). Mover una tarea a otro espacio todavía no está en la
 * lista cerrada y no se enseña. Nada aquí pasa por alto la lista: `Host.call`
 * sigue rechazando lo que no está en ella.
 */
import {
  type AppFeature,
  type ArchivedTasks,
  type DeleteOutcome,
  type DeletePreview,
  isAppCommand,
  type KeepAwakeMode,
  type KeepAwakeStatus,
  type OpenPorts,
  type SpaceRef,
} from "@terminus/protocol";
import type { Host } from "./hosts.ts";

export type { DeletePreview, KeepAwakeMode, KeepAwakeStatus, OpenPorts };

/** Si el teléfono puede mandar el comando (está en `APP_COMMANDS`). */
export const can = (command: string) => isAppCommand(command);

/** Las funciones con sus comandos; `move` no está en `APP_FEATURES`: solo se mira la lista. */
export const FEATURES = {
  spaces: ["create_space", "rename_space", "space_delete_preview", "delete_space"],
  keep_awake: ["keep_awake_status", "set_keep_awake"],
  ports: ["list_ports"],
  archived: ["archived_tasks"],
  move: ["move_task_to_space"],
} as const;

/**
 * Si la función se puede enseñar: sus comandos están en la lista cerrada y,
 * con una máquina, esa máquina no dijo que no los conoce.
 */
export function ready(feature: keyof typeof FEATURES, host?: Host | null): boolean {
  if (!FEATURES[feature].every(can)) return false;
  if (!host || feature === "move") return true;
  return host.available?.(feature as AppFeature) !== "no";
}

const call = <T>(host: Host, command: string, workspace: string | null, args: object = {}) => {
  if (!isAppCommand(command)) return Promise.reject(new Error("command_not_allowed"));
  return host.call<T>(command, workspace, args).then((answer) => answer.value);
};

export const createSpace = (host: Host, workspace: string, name: string) => call<SpaceRef>(host, "create_space", workspace, { name, folders: null });
export const renameSpace = (host: Host, workspace: string, id: string, name: string) => call<SpaceRef>(host, "rename_space", workspace, { id, name });
export const spaceDeletePreview = (host: Host, workspace: string, id: string) => call<DeletePreview>(host, "space_delete_preview", workspace, { id });
/** Elimina con lo que la persona vio en la previa; si el motor ve algo más, no borra y devuelve la previa nueva. */
export const deleteSpace = (host: Host, workspace: string, preview: DeletePreview) =>
  call<DeleteOutcome>(host, "delete_space", workspace, { id: preview.space.id, seen: { tasks: preview.tasks, discard: preview.tasks.some((task) => task.files.length > 0) } });
export const keepAwakeOf = (host: Host, workspace: string) => call<KeepAwakeStatus>(host, "keep_awake_status", workspace);
export const setKeepAwake = (host: Host, workspace: string, mode: KeepAwakeMode) => call<KeepAwakeStatus>(host, "set_keep_awake", workspace, { mode });
export const portsOf = (host: Host, workspace: string) => call<OpenPorts>(host, "list_ports", workspace);
export const archivedOf = (host: Host, workspace: string) => call<ArchivedTasks>(host, "archived_tasks", workspace);
