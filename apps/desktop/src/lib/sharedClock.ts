/**
 * El reloj común de lo que se mueve por pasos: los astros y las marcas de la
 * tarjeta del riel. WebKit no lleva al compositor una animación con `steps()`:
 * cada paso es una actualización de la ventana en el hilo principal. Si cada
 * elemento cuenta sus pasos desde que montó, N elementos caen en N momentos
 * distintos y la ventana repinta hasta N veces más. Anclados a `startTime = 0`
 * y con pasos de 1/12 s (`global.css`), todos cambian en el mismo cuadro: 12
 * repintados por segundo con uno o con cuarenta.
 *
 * Entra al reloj lo que lleva `data-shared-clock`, con todo lo de dentro.
 */
function alignToSharedClock(event: AnimationEvent) {
  const root = (event.target as Element | null)?.closest?.("[data-shared-clock]");
  if (!root) return;
  for (const animation of root.getAnimations({ subtree: true })) {
    if ("animationName" in animation && animation.startTime !== 0) animation.startTime = 0;
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("animationstart", alignToSharedClock, true);
}
