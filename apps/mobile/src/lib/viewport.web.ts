/**
 * Fija la app al área visible del navegador. Con el teclado abierto, Safari en
 * iOS (y Chrome en Android) no achica la página: la desplaza hacia arriba para
 * mostrar el cuadro de texto y la barra de arriba, con la flecha de regresar,
 * se sale de la pantalla. Aquí la raíz mide lo que se ve (`visualViewport`) y
 * sigue su desplazamiento, así que la barra queda arriba y el cuadro de texto
 * justo encima del teclado.
 */
export function pinToVisibleArea(): () => void {
  const viewport = window.visualViewport;
  const root = document.getElementById("root");
  if (!viewport || !root) return () => {};
  const previous = {
    position: root.style.position,
    left: root.style.left,
    right: root.style.right,
    top: root.style.top,
    height: root.style.height,
    overflow: root.style.overflow,
  };
  // Al enfocar, el navegador puede desplazar también el documento. Usamos sus
  // coordenadas (pageTop), sin depender del comportamiento de `fixed` con el teclado.
  Object.assign(root.style, { position: "absolute", left: "0", right: "0", overflow: "hidden" });
  const fit = () => {
    root.style.height = `${viewport.height}px`;
    root.style.top = `${viewport.pageTop}px`;
  };
  fit();
  viewport.addEventListener("resize", fit);
  viewport.addEventListener("scroll", fit);
  window.addEventListener("scroll", fit);
  window.addEventListener("resize", fit);
  return () => {
    viewport.removeEventListener("resize", fit);
    viewport.removeEventListener("scroll", fit);
    window.removeEventListener("scroll", fit);
    window.removeEventListener("resize", fit);
    Object.assign(root.style, previous);
  };
}
