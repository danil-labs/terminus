import { invoke } from "../../lib/invoke.ts";
import { semillaDelAlta } from "../../lib/i18n";

/** Crea el workspace con la lengua elegida en el alta y lo activa: lo que se conecte después cuelga del activo. */
export async function crearWorkspace(nombre: string) {
  const w = await invoke<{ id: string }>("add_workspace", { name: nombre });
  // "sistema" no se guarda: un workspace sin lengua es el que sigue al sistema.
  const semilla = semillaDelAlta();
  if (semilla !== "sistema") await invoke("set_workspace_language", { id: w.id, lengua: semilla });
  await invoke("set_active_workspace", { id: w.id });
  window.dispatchEvent(new CustomEvent("harness:workspace"));
  return w;
}
