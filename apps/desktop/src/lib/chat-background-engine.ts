/**
 * El fondo de los chats es del workspace: su motor lo guarda
 * (`set_chat_background`) y lo devuelve al abrirlo (`chat_background`), aquí,
 * en la web y en el teléfono. `set_chat_background` reemplaza siempre el
 * patrón y el velo y deja la imagen salvo que llegue otra; la imagen se quita
 * con `choose_chat_background` sin ruta, que es también lo único que entiende
 * un motor anterior.
 */
import { type ChatBackgroundChange, chatBackgroundView } from "@terminus/protocol";
import { VELO_DE_FONDO, fondoDe, type FondoDeChat } from "./chat-background.ts";
import * as store from "./chat-background-store.ts";
import { invoke } from "./invoke.ts";

const velos = () => ({ chat: store.veloDeFondo(), tabs: store.veloDePestanas(), panels: store.veloDePaneles() });

async function guardarEnElMotor(cambio: ChatBackgroundChange): Promise<void> {
  try {
    await invoke("set_chat_background", { ...cambio });
  } catch {
    await invoke("choose_chat_background", { path: cambio.path ?? null }).catch(() => {});
  }
}

/** Lo elegido, entero: un patrón tapa la imagen guardada; la propia viaja por su ruta si es nueva. */
function eleccion(): ChatBackgroundChange {
  const ruta = store.fondoPropio();
  if (store.fondoDeChat() !== "propia") return { preset: "dusk", veil: velos() };
  return ruta && !store.imagenDelWorkspace() ? { preset: null, path: ruta, veil: velos() } : { preset: null, veil: velos() };
}

let veloPendiente: ReturnType<typeof setTimeout> | null = null;

let lectura = 0;

/**
 * Al abrir un workspace: su fondo y sus velos, de su motor. Sin nada elegido
 * ni en el workspace ni en la máquina queda lo de esta ventana; un motor que
 * no conoce la orden también lo deja como estaba.
 */
export async function cargarFondoDelWorkspace(): Promise<void> {
  const esta = ++lectura;
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
  const nada = respuesta === null || respuesta === undefined || (!(respuesta as { data_url?: unknown }).data_url && !vista.preset && (respuesta as { veil?: unknown }).veil == null);
  if (nada) return;
  store.setImagenDelWorkspace(vista.image);
  store.elegirFondoDeChat(vista.image ? "propia" : fondoDe(vista.preset));
  store.elegirVeloDeFondo(vista.veil.chat ?? VELO_DE_FONDO);
  if (vista.veil.tabs !== null) store.elegirVeloDePestanas(vista.veil.tabs);
  if (vista.veil.panels !== null) store.elegirVeloDePaneles(vista.veil.panels);
}

/** Lo elegido en Estilo, al workspace abierto. */
export function guardarFondo(): Promise<void> {
  return guardarEnElMotor(eleccion());
}

/** Quitar la imagen propia: el workspace vuelve al patrón de la app. */
export async function quitarFondoPropio(): Promise<void> {
  await invoke("choose_chat_background", { path: null }).catch(() => {});
  await guardarFondo();
}

/** La imagen que eligió la persona: el motor la copia, y queda en el workspace. */
export async function elegirFondoPropio(ruta: string): Promise<FondoDeChat> {
  const copia = await invoke<string>("import_chat_background", { source: ruta });
  store.ponerFondoPropio(copia);
  await guardarFondo();
  return "propia";
}

/** Los deslizadores cambian a cada paso: al motor va el último, un momento después. */
export function guardarVelos() {
  if (veloPendiente) clearTimeout(veloPendiente);
  veloPendiente = setTimeout(() => {
    veloPendiente = null;
    void guardarEnElMotor(eleccion());
  }, 400);
}
