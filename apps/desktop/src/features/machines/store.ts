import { createRoot, createSignal } from "solid-js";
import { invoke } from "../../lib/invoke";
import { t } from "../../lib/i18n";
import { createPref } from "../../lib/prefs";
import { isMac } from "../../lib/window";
import { capabilities } from "../../lib/platform";

/**
 * `machine_list`: `hosts` es si tiene el workspace abierto (`null`, que no se sabe
 * sin encenderla); `materializes`, si puede hacerlo suyo con el mismo id al crear ahí.
 */
export type Machine = { id: string; local: boolean; active: boolean; on: boolean; hosts: boolean | null; materializes?: boolean };

/** Lo que el picker sabe del proyecto de la tarea nueva: las máquinas con su carpeta y su remoto. */
export type ProjectPlace = { name: string; machines?: string[]; remote_url?: string | null } | null | undefined;

/** Por qué una máquina no puede correr la tarea nueva, o `null` si puede. */
export function unavailable(m: Machine, project: ProjectPlace): "workspace" | "project" | null {
  if (m.hosts === false && !m.materializes) return "workspace";
  if (project?.machines && !project.remote_url && !project.machines.includes(m.id)) return "project";
  return null;
}

// Una sola lista para toda la ventana. Señal y no `createResource`, que
// suspendería la vista entera mientras contestan.
const [machines, setMachines] = createRoot(() => createSignal<Machine[]>([]));
export { machines };

export const refetchMachines = () =>
  invoke<Machine[]>("machine_list")
    .then(setMachines)
    .catch(() => setMachines([]));

/**
 * Dónde se crea la próxima tarea, por workspace; sin entrada, en la máquina de la
 * ventana. Se recuerda con las preferencias de la ventana (`lib/prefs.ts`).
 */
const [elegidas, guardarElegidas] = createRoot(() =>
  createPref<Record<string, string>>("machines.run_on", {}),
);

/** La máquina elegida para `workspace`, si sigue en la lista y puede correr una tarea de `project`. */
export function runOn(workspace: string | null, project?: ProjectPlace): string | null {
  const id = workspace ? elegidas()[workspace] : undefined;
  const machine = id ? machines().find((m) => m.id === id) : undefined;
  if (!id || machine?.active || (machine && unavailable(machine, project))) return null;
  return machines().length === 0 || machine ? id : null;
}

export function setRunOn(workspace: string | null, id: string | null) {
  if (!workspace) return;
  const { [workspace]: _, ...resto } = elegidas();
  guardarElegidas(id ? { ...resto, [workspace]: id } : resto);
}

/** Con esta cabecera el proxy crea la tarea en esa máquina sin salir del workspace (`fleet.rs`). */
export function runOnOptions(workspace: string | null, project?: ProjectPlace) {
  const id = runOn(workspace, project);
  return id ? { headers: { "x-terminus-machine": id } } : undefined;
}

export const machineName = (id: string, local = id === "local") =>
  local ? (isMac() ? t("shell.machines.this_mac") : t("shell.machines.this_computer")) : (capabilities().machineName?.(id) ?? id);
