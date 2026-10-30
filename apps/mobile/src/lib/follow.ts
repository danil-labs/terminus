/**
 * Cuándo el chat del teléfono sigue el final, con la misma regla que el hilo
 * del escritorio (`apps/desktop/src/features/chat/paste.ts`, `seguirElFondo`):
 *
 * - Seguir es una decisión, no una distancia: sobrevive a que el contenido
 *   crezca y aleje el final. Mientras se sigue, cada cambio de tamaño baja de
 *   un corte.
 * - Subir lejos del final suelta el hilo. Crecer por abajo no mueve el scroll, y
 *   encoger lo acota al fondo nuevo: un movimiento hacia arriba lejos del final
 *   es de la persona. Salvo el redondeo: al crecer, el navegador puede mover el
 *   scroll un píxel hacia arriba, y eso no es un gesto (ver [`SLOP`]).
 * - Volver a mano a menos de `MARGIN` del final, o tocar «Ir al final», vuelve a
 *   seguir.
 * - El botón existe mientras no se sigue y el final no se ve (`alFondo` del
 *   escritorio: `sigue || cerca`). Si entraron respuestas desde que se soltó,
 *   el botón las cuenta.
 *
 * Pura, sin React: la pantalla le pasa medidas y hace lo que contesta.
 */

/** Como `MARGEN_DE_FONDO` del escritorio: menos de una línea de párrafo. */
export const MARGIN = 70;

/**
 * Cuánto hay que subir, desde lo más abajo que llegó mientras seguía, para
 * soltar el hilo. Medido en la web del teléfono: al abrir, la lista crece por
 * tramos y el scroll baja 1 px mientras el contenido ya creció 665 px, lejos
 * del final. Se compara contra lo más bajo y no contra el evento anterior: un
 * arrastre lento de un píxel por evento también suma.
 */
export const SLOP = 8;

export type Follow = {
  /** Si el hilo persigue el final. */
  following: boolean;
  /** Si el final está a menos de [`MARGIN`]. */
  near: boolean;
  /** El último desplazamiento leído; siguiendo, el más abajo desde que se sigue. */
  offset: number;
  /** Respuestas del agente que había al soltarse; `null` mientras se sigue. */
  seen: number | null;
};

/** Lo que se lee de un `onScroll`, en píxeles. */
export type Metrics = { offset: number; content: number; viewport: number };

/**
 * Al abrir una tarea: abajo y siguiendo. La lista invertida abre sin ningún evento de scroll: sin un `offset` que
 * ganarle, el primer gesto que aleja del final no soltaría el hilo.
 */
export const OPENED: Follow = { following: true, near: true, offset: Infinity, seen: null };

/** El desplazamiento desde arriba de una lista invertida, cuyo 0 es el final. */
export const fromTop = (offset: number, { content, viewport }: Omit<Metrics, "offset">) => content - viewport - offset;

export const distanceToEnd = ({ offset, content, viewport }: Metrics) => Math.max(0, content - viewport - offset);

/** Un evento de scroll, venga de la persona o de nosotros. `replies` son las respuestas del agente que hay. */
export function scrolled(state: Follow, metrics: Metrics, replies: number): Follow {
  const near = distanceToEnd(metrics) <= MARGIN;
  if (near) return { following: true, near, offset: metrics.offset, seen: null };
  if (!state.following) return { ...state, near, offset: metrics.offset };
  if (metrics.offset < state.offset - SLOP) return { following: false, near, offset: metrics.offset, seen: replies };
  return { ...state, near, offset: Math.max(state.offset, metrics.offset) };
}

/** Si un cambio de tamaño (contenido o ventana) debe bajar al final. */
export const shouldStick = (state: Follow) => state.following;

/** Tocar «Ir al final» o mandar un mensaje: se vuelve a seguir. */
export const jumped = (state: Follow): Follow => ({ ...state, following: true, seen: null });

/** Si se ofrece el botón de ir al final. */
export const showJump = (state: Follow) => !state.following && !state.near;

/** Respuestas nuevas desde que se soltó, para el rótulo del botón. */
export const unseen = (state: Follow, replies: number) => (state.seen === null ? 0 : Math.max(0, replies - state.seen));
