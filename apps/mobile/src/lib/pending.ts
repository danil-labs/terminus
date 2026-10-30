/**
 * Lo que la UI nueva necesita y el teléfono todavía no puede mandar: crear,
 * renombrar y eliminar espacios, Mantener despierta, Puertos y las
 * archivadas. Los comandos los agrega otra rama a `APP_COMMANDS`
 * (`feat/mobile-new-ui-commands`); mientras no estén en la lista cerrada,
 * `can()` dice que no y la interfaz que los usa no se enseña. Nada aquí pasa
 * por alto la lista: `Host.call` sigue rechazando lo que no está en ella.
 * Los tipos repiten los de esa rama hasta que llegue a `@terminus/protocol`.
 */
import { type AppCommand, isAppCommand, type SessionRow } from "@terminus/protocol";
import type { Host } from "./hosts.ts";

/** Si el teléfono puede mandar el comando (está en `APP_COMMANDS`). */
export const can = (command: string) => isAppCommand(command);

export const FEATURES = {
  spaces: ["create_space", "rename_space", "space_delete_preview", "delete_space"],
  keepAwake: ["keep_awake_status", "set_keep_awake"],
  ports: ["list_ports"],
  archived: ["archived_tasks"],
  /** Mover una tarea a otro espacio, del menú de la fila. */
  move: ["move_task_to_space"],
} as const;

/** Si todos los comandos de una función están en la lista cerrada. */
export const ready = (feature: keyof typeof FEATURES) => FEATURES[feature].every(can);

const call = <T>(host: Host, command: string, workspace: string | null, args: object = {}) =>
  host.call<T>(command as AppCommand, workspace, args).then((answer) => answer.value);

export type SpaceRef = { id: string; name: string | null; deleted?: boolean };
export type TaskSeen = { folder: string; task: string; root: string; title: string; working: boolean; files: { path: string; hash: string }[]; kn_pending: string[] };
export type DeletePreview = { space: SpaceRef; last: boolean; tasks: TaskSeen[] };
export type DeleteOutcome = { deleted: boolean; changed: DeletePreview | null };
export type KeepAwakeMode = "on" | "agent" | "off";
export type KeepAwakeStatus = { mode: KeepAwakeMode; active: boolean; supported: boolean };
export type OpenPort = { id: string; pid: number; puerto: number; direccion: string; url: string; comando: string };
export type OpenPorts = { tareas: { session: string; project: string; tarea: string; proyecto: string | null; puertos: OpenPort[] }[]; externos: OpenPort[]; aviso: string | null };
export type ArchivedTasks = { tasks: (SessionRow & { folder: string })[]; spaces: SpaceRef[] };

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
