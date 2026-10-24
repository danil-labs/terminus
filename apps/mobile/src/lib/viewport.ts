/** En el teléfono el teclado lo resuelve `KeyboardScreen`; solo el navegador necesita fijar la página (`viewport.web.ts`). */
export function pinToVisibleArea(): () => void {
  return () => {};
}
