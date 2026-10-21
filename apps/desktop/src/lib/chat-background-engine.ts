/**
 * El fondo de los chats es del workspace: su motor lo guarda
 * (`set_chat_background`) y lo devuelve al abrirlo (`chat_background`), aquí,
 * en la web y en el teléfono. `set_chat_background` reemplaza siempre el
 * patrón y el velo y deja la imagen salvo que llegue otra; la imagen se quita
 * con `choose_chat_background` sin ruta.
 *
 * Una ruta solo viaja justo después de importarla en el workspace abierto:
 * la copia de otro workspace nunca se manda. Un motor anterior, que no conoce
 * `set_chat_background`, solo recibe `choose_chat_background` con esa copia o,
 * si la persona quitó la imagen, sin ruta.
 */
import { type ChatBackgroundChange, chatBackgroundView } from "@terminus/protocol";
import { VELO_DE_FONDO, fondoDe, type FondoDeChat } from "./chat-background.ts";
import * as store from "./chat-background-store.ts";
import { invoke } from "./invoke.ts";

const velos = () => ({ chat: store.veloDeFondo(), tabs: store.veloDePestanas(), panels: store.veloDePaneles() });

/** El motor no conoce la orden (`command` del proxy o del relay): un motor anterior. */
export function ordenDesconocida(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { detail, what, code } = error as { detail?: unknown; what?: { clave?: unknown }; code?: unknown };
  return detail === "command" || detail === "unsupported" || code === "command" || what?.clave === "shell.service.command";
}

/** Guarda en el workspace; solo ante un motor que no conoce la orden pasa la copia recién importada por `choose_chat_background`. */
async function guardarEnElMotor(cambio: ChatBackgroundChange): Promise<void> {
  try {
    await invoke("set_chat_background", { ...cambio });
  } catch (error) {
    if (!ordenDesconocida(error)) throw error;
    if (cambio.path) await invoke("choose_chat_background", { path: cambio.path });
  }
}

/** El patrón y los velos elegidos; nunca una ruta: la imagen guardada en el workspace queda. */
function eleccion(): ChatBackgroundChange {
  return { preset: store.fondoDeChat() === "propia" ? null : "dusk", veil: velos() };
}

let veloPendiente: ReturnType<typeof setTimeout> | null = null;

let lectura = 0;

/**
 * Al abrir un workspace: su fondo y sus velos, de su motor. Sin nada elegido
 * ni en el workspace ni en la máquina vuelve el patrón de la app, sin imagen.
 * Un motor que no conoce la orden deja lo de esta ventana.
 */
export async function cargarFondoDelWorkspace(workspace: string | null): Promise<void> {
  const esta = ++lectura;
  // Antes de leer: aunque la lectura falle, lo que se importe después es de este workspace.
  store.setWorkspaceAbierto(workspace);
  let respuesta: unknown;
  try {
    respuesta = await invoke<unknown>("chat_background");
  } catch {
    if (esta === lectura) store.setImagenDelWorkspace(null);
    return;
  }
  if (esta !== lectura) return;
  store.setImagenDelWorkspace(null);
  const vista = chatBackgroundView(respuesta);
  const r = (respuesta ?? {}) as { data_url?: unknown; veil?: unknown };
  // La copia local solo vale para el workspace donde se importó y mientras su motor la tenga.
  if (!r.data_url) store.olvidarFondoPropio();
  const nada = !r.data_url && !vista.preset && r.veil == null;
  if (nada) {
    store.elegirFondoDeChat("dusk");
    return;
  }
  store.setImagenDelWorkspace(vista.image);
  store.elegirFondoDeChat(vista.image ? "propia" : fondoDe(vista.preset ?? "dusk"));
  store.elegirVeloDeFondo(vista.veil.chat ?? VELO_DE_FONDO);
  if (vista.veil.tabs !== null) store.elegirVeloDePestanas(vista.veil.tabs);
  if (vista.veil.panels !== null) store.elegirVeloDePaneles(vista.veil.panels);
}

/** Lo elegido en Estilo, al workspace abierto. */
export function guardarFondo(): Promise<void> {
  return guardarEnElMotor(eleccion()).catch(() => {});
}

/** Quitar la imagen propia (lo pidió la persona): el workspace vuelve al patrón de la app. */
export async function quitarFondoPropio(): Promise<void> {
  await invoke("choose_chat_background", { path: null }).catch(() => {});
  await guardarFondo();
}

/** La imagen que eligió la persona: el motor la copia en el workspace abierto, y esa copia es la única ruta que se manda. */
export async function elegirFondoPropio(ruta: string): Promise<FondoDeChat> {
  const workspace = store.workspaceAbierto();
  const copia = await invoke<string>("import_chat_background", { source: ruta });
  // Se cambió de workspace mientras se copiaba: la copia es del anterior y no se pinta ni se manda aquí.
  if (store.workspaceAbierto() !== workspace) return store.fondoDeChat();
  store.ponerFondoPropio(copia);
  await guardarEnElMotor({ ...eleccion(), preset: null, path: copia });
  return "propia";
}

/**
 * En la web la imagen viaja como `data:` dentro de `set_chat_background`: el
 * relay no deja pasar `import_chat_background` (una ruta de la máquina) y
 * nunca se manda una ruta.
 */
export async function elegirFondoDelNavegador(dataUrl: string): Promise<FondoDeChat> {
  const workspace = store.workspaceAbierto();
  const respuesta = await invoke<unknown>("set_chat_background", { ...eleccion(), preset: null, dataUrl });
  if (store.workspaceAbierto() !== workspace) return store.fondoDeChat();
  store.setImagenDelWorkspace(chatBackgroundView(respuesta).image ?? dataUrl);
  return store.elegirFondoDeChat("propia");
}

/** Los deslizadores cambian a cada paso: al motor va el último, un momento después. */
export function guardarVelos() {
  if (veloPendiente) clearTimeout(veloPendiente);
  veloPendiente = setTimeout(() => {
    veloPendiente = null;
    void guardarFondo();
  }, 400);
}
