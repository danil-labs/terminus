/**
 * Fondos que la app trae para los chats: el atardecer, que se enseña como
 * «Por defecto», el neutro sin imagen y la imagen propia. Lo guardado antes
 * cae al atardecer: ningún fondo anterior deja de pintarse al actualizar.
 */
export const FONDOS = ["dusk", "neutro", "propia"] as const;

/** El marco nuevo pinta el fondo solo en el área de trabajo, no detrás de toda la ventana. */
export const FONDO_SOLO_EN_EL_TRABAJO = true;
export type FondoDeChat = (typeof FONDOS)[number];

/** El mismo velo que el fondo de un agente, para que el texto siga leyéndose. */
export const VELO_DE_FONDO = 0.82;

/** El velo de la cabecera de pestañas: por debajo del mínimo deja de verse la banda. */
export const VELO_DE_PESTANAS = 0.3;
export const VELO_DE_PESTANAS_MIN = 0.15;
export const VELO_DE_PESTANAS_MAX = 0.6;

/** El vidrio de las columnas y barras (`.glass-panel`): a 0 se ve el fondo entero, a 1 son sólidas. */
export const VELO_DE_PANELES = 0.4;
export const VELO_DE_PANELES_MIN = 0;
export const VELO_DE_PANELES_MAX = 1;

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


