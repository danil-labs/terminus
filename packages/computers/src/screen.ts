/**
 * La pantalla de una computadora (protocolo v1, «Pantalla»): un WebSocket aparte
 * del de sesión que lleva RFB (VNC) en frames binarios. Abrirlo no
 * enciende la computadora: con ella apagada el relay lo cierra con 4010.
 */
import { sessionUrl } from "./relay.ts";

/** Nombre RFB anunciado por los motores que admiten entrada sin compartir el portapapeles. */
export const SCREEN_CONTROL_DESKTOP = "Terminus VM control v1";

export const SCREEN_SUBPROTOCOL = "danil.screen.v1";

/** Por qué se cerró el visor; `ended`, cuando ya se había visto la pantalla o por un cierre normal. */
export type ScreenEnd = "offline" | "unavailable" | "busy" | "ended";

export function screenUrl(endpoint: string, computerId: string): string {
  return sessionUrl(endpoint, computerId).replace(/\/session$/, "/screen");
}

/** Los subprotocolos del visor: el del protocolo y el token, que un WebSocket de navegador no puede poner en una cabecera. */
export function screenProtocols(token: string): string[] {
  return [SCREEN_SUBPROTOCOL, `bearer.${token}`];
}

export function screenEnd(code: number): ScreenEnd {
  if (code === 4010) return "offline";
  if (code === 4011) return "unavailable";
  if (code === 4013) return "busy";
  return "ended";
}
