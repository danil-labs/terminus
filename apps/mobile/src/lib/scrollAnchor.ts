/**
 * Lo que `overflow-anchor` hace solo en Chrome y Firefox, para Safari: lo que se está
 * leyendo no se mueve aunque el hilo cambie de alto por abajo. Recuerda el elemento
 * del centro y cuánto se movió es lo que se devuelve; por eso no acumula error
 * aunque la lista virtualizada vuelva a medir después de corregir.
 */
export const NEEDS_SCROLL_ANCHOR = typeof CSS !== "undefined" && !CSS.supports("overflow-anchor", "auto");

export type ScrollAnchor = { element: Element; top: number } | null;

/** El elemento del centro de `scroller`, para compararlo después. */
export function anchorOf(scroller: Element): ScrollAnchor {
  const { left, top, width, height } = scroller.getBoundingClientRect();
  const element = document.elementFromPoint(left + width / 2, top + height / 2);
  return element && scroller.contains(element) ? { element, top: element.getBoundingClientRect().top } : null;
}

/** Devuelve a su sitio lo anclado en una lista invertida, donde subir el scroll baja lo que se ve. */
export function restoreAnchor(scroller: Element, anchor: ScrollAnchor): void {
  if (!anchor?.element.isConnected) return;
  const moved = anchor.element.getBoundingClientRect().top - anchor.top;
  if (Math.abs(moved) >= 1) scroller.scrollTop -= moved;
}
