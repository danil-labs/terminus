import { createRoot, createSignal } from "solid-js";
import { invoke } from "../../lib/invoke";
import { t } from "../../lib/i18n";
import { isMac } from "../../lib/window";

/** `machine_list`: `linked` es si tiene el workspace abierto; `null`, que no se sabe sin encenderla. */
export type Machine = { id: string; local: boolean; active: boolean; on: boolean; linked: boolean | null };

// Una sola lista para toda la ventana. Señal y no `createResource`, que
// suspendería la vista entera mientras contestan.
const [machines, setMachines] = createRoot(() => createSignal<Machine[]>([]));
export { machines };

export const refetchMachines = () =>
  invoke<Machine[]>("machine_list")
    .then(setMachines)
    .catch(() => setMachines([]));

/** Dónde se crea la próxima tarea; `null` es la máquina de la ventana. */
const [runOn, setRunOn] = createRoot(() => createSignal<string | null>(null));
export { runOn, setRunOn };

/** Con esta cabecera el proxy crea la tarea en esa máquina sin salir del workspace (`fleet.rs`). */
export function runOnOptions() {
  const id = runOn();
  return id ? { headers: { "x-terminus-machine": id } } : undefined;
}

export const machineName = (id: string, local = id === "local") =>
  local ? (isMac() ? t("shell.machines.this_mac") : t("shell.machines.this_computer")) : id;
