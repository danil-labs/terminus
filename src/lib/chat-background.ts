/**
 * Fondos que la app trae para los chats. Son dos: el atardecer, que se
 * enseña como «Por defecto», y la imagen propia. Lo guardado antes cae al
 * atardecer: ningún fondo anterior deja de pintarse al actualizar.
 */
export const FONDOS = ["dusk", "propia"] as const;
export type FondoDeChat = (typeof FONDOS)[number];

/** El mismo velo que el fondo de un agente, para que el texto siga leyéndose. */
export const VELO_DE_FONDO = 0.82;

const CLASE: Partial<Record<FondoDeChat, string>> = {
  dusk: "chat-bg-dusk",
};

export function fondoDe(guardado: string | null | undefined): FondoDeChat {
  return (FONDOS as readonly string[]).includes(guardado ?? "")
    ? (guardado as FondoDeChat)
    : "dusk";
}

/** La clase del patrón, o `null` si sale de su propio archivo. */
export function claseDeFondo(id: string | null | undefined): string | null {
  return CLASE[fondoDe(id)] ?? null;
}


