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
  Object.assign(root.style, { position: "fixed", left: "0", right: "0", top: "0" });
  const fit = () => {
    root.style.height = `${viewport.height}px`;
    root.style.transform = `translateY(${viewport.offsetTop}px)`;
  };
  fit();
  viewport.addEventListener("resize", fit);
  viewport.addEventListener("scroll", fit);
  return () => {
    viewport.removeEventListener("resize", fit);
    viewport.removeEventListener("scroll", fit);
  };
}
