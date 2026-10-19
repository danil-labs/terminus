/**
 * El estado del alta y la fila que instala los proveedores elegidos.
 *
 * Vive en el contenedor y no en cada paso: Atrás desmonta el paso, y lo elegido
 * tiene que seguir ahí al volver. La fila sigue aunque la persona avance.
 */
import { createStore } from "solid-js/store";
import { invoke } from "../../lib/invoke.ts";
import { semillaDelAlta, t } from "../../lib/i18n";
import { prosaDe } from "../../ui/Failure";

export type Paso = "agents" | "workspace" | "accounts" | "sources" | "context" | "workdir";
export type Instalacion = { estado: "instalando" | "lista" | "fallo"; error?: string };

export type EstadoDelAlta = {
  paso: Paso;
  elegidos: string[];
  instalacion: Record<string, Instalacion>;
  nombre: string;
  workspace: { id: string; nombre: string } | null;
  /**
   * `modo: null` es que todavía se está eligiendo en el selector de repositorios.
   * `usado` es la ruta o URL que ya se dio de alta: volver sin cambiarla no la repite.
   */
  contexto: { modo: "folder" | "clone" | null; ruta: string; url: string; fuente: string | null; usado: string };
  /** `proveedor` es la conexión con que se clona un repositorio elegido de la lista; `repositorio`, su nombre. */
  carpeta: {
    modo: "new" | "existing" | "clone" | null;
    nombre: string;
    ruta: string;
    url: string;
    proveedor: string | null;
    repositorio: string;
    proyecto: string | null;
  };
};

export const URL_DE_REPO = /^(https:\/\/|ssh:\/\/|git@)\S+$/;

export function crearAlta(nueva: boolean) {
  const [estado, set] = createStore<EstadoDelAlta>({
    paso: nueva ? "workspace" : "agents",
    elegidos: [],
    instalacion: {},
    nombre: "",
    workspace: null,
    contexto: { modo: null, ruta: "", url: "", fuente: null, usado: "" },
    carpeta: { modo: null, nombre: "", ruta: "", url: "", proveedor: null, repositorio: "", proyecto: null },
  });
  let fila: Promise<void> = Promise.resolve();

  // En serie: las dos filas de OpenCode comparten carpeta, y la segunda la encuentra ya instalada.
  function instalar(ids: string[]) {
    for (const id of ids) {
      if (estado.instalacion[id]?.estado === "instalando") continue;
      set("instalacion", id, { estado: "instalando", error: undefined });
      fila = fila.then(async () => {
        try {
          const agentes = await invoke<{ id: string; available: boolean }[]>("list_agents");
          if (!agentes.find((a) => a.id === id)?.available) {
            await invoke("install_agent", { agent: id });
          }
          set("instalacion", id, { estado: "lista", error: undefined });
        } catch (e) {
          set("instalacion", id, { estado: "fallo", error: prosaDe(e) });
        }
      });
    }
  }

  return { estado, set, instalar };
}

export type Alta = ReturnType<typeof crearAlta>;

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

/** La fila local se nombra por lo que da; Antigravity lleva también Gemini, que es como más se le conoce. */
export const nombreDeAgente = (a: { id: string; label: string }) => {
  if (a.id === "opencode-local") return t("onboarding.agent.local");
  if (a.id === "antigravity") return t("onboarding.agent.antigravity");
  return a.label;
};
