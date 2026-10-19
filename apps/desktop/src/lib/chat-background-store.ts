import { createPref } from "./prefs.ts";
import { invoke } from "./invoke.ts";
import {
  fondoDe,
  VELO_DE_FONDO,
  VELO_DE_PESTANAS,
  VELO_DE_PESTANAS_MAX,
  VELO_DE_PESTANAS_MIN,
  VELO_DE_PANELES,
  VELO_DE_PANELES_MAX,
  VELO_DE_PANELES_MIN,
  type FondoDeChat,
} from "./chat-background.ts";

const [guardado, setGuardado] = createPref<string>("chat-background", "dusk");
const [rutaPropia, setRutaPropia] = createPref<string | null>("chat-background-custom", null);
const [veloGuardado, setVeloGuardado] = createPref<number>("chat-background-veil", VELO_DE_FONDO);
const [veloDePestanasGuardado, setVeloDePestanasGuardado] = createPref<number>("tabs-veil", VELO_DE_PESTANAS);
const [veloDePanelesGuardado, setVeloDePanelesGuardado] = createPref<number>("panels-veil", VELO_DE_PANELES);

function acotarVeloDePestanas(valor: unknown): number {
  return typeof valor === "number" && Number.isFinite(valor)
    ? Math.min(VELO_DE_PESTANAS_MAX, Math.max(VELO_DE_PESTANAS_MIN, valor))
    : VELO_DE_PESTANAS;
}

export function veloDePestanas(): number {
  return acotarVeloDePestanas(veloDePestanasGuardado());
}

export function elegirVeloDePestanas(valor: number): number {
  const siguiente = acotarVeloDePestanas(valor);
  setVeloDePestanasGuardado(siguiente);
  aplicarVeloDePestanas();
  return siguiente;
}

/** Pinta los velos guardados (pestañas y paneles). La llama el arranque, antes del primer pintado. */
export function aplicarVeloDePestanas() {
  document.documentElement.style.setProperty("--tab-veil", String(veloDePestanas()));
  document.documentElement.style.setProperty("--panel-veil", String(veloDePaneles()));
}

export function veloDePaneles(): number {
  const valor = veloDePanelesGuardado();
  return typeof valor === "number" && Number.isFinite(valor)
    ? Math.min(VELO_DE_PANELES_MAX, Math.max(VELO_DE_PANELES_MIN, valor))
    : VELO_DE_PANELES;
}

export function elegirVeloDePaneles(valor: number): number {
  setVeloDePanelesGuardado(Number.isFinite(valor) ? valor : VELO_DE_PANELES);
  aplicarVeloDePestanas();
  return veloDePaneles();
}

export function veloDeFondo(): number {
  const valor = veloGuardado();
  return typeof valor === "number" && Number.isFinite(valor)
    ? Math.min(1, Math.max(0, valor))
    : VELO_DE_FONDO;
}

export function elegirVeloDeFondo(valor: number): number {
  const siguiente = Number.isFinite(valor) ? Math.min(1, Math.max(0, valor)) : VELO_DE_FONDO;
  setVeloGuardado(siguiente);
  return siguiente;
}

export function fondoDeChat(): FondoDeChat {
  const fondo = fondoDe(guardado());
  return fondo === "propia" && !rutaPropia() ? "dusk" : fondo;
}

export function elegirFondoDeChat(id: string): FondoDeChat {
  const siguiente = fondoDe(id);
  setGuardado(siguiente === "propia" && !rutaPropia() ? "dusk" : siguiente);
  return fondoDeChat();
}

/** La imagen propia, si se subió alguna. Vive en disco; aquí solo su ruta. */
export function fondoPropio(): string | null {
  return rutaPropia();
}

export async function elegirFondoPropio(ruta: string): Promise<FondoDeChat> {
  const copia = await invoke<string>("import_chat_background", { source: ruta });
  setRutaPropia(copia);
  setGuardado("propia");
  return "propia";
}

export function quitarFondoPropio(): FondoDeChat {
  setRutaPropia(null);
  setGuardado("dusk");
  return "dusk";
}
