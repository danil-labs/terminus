import { onCleanup } from "solid-js";

const RADIUS = 6;

/** The veil of `.tab-veil` minus the hole of each active tab, with concave corners at its foot. */
function hole(box: HTMLElement): string | null {
  const width = box.clientWidth;
  const height = box.clientHeight;
  // Without layout (jsdom, hidden window) there is nothing to cut and nothing is written.
  if (!width || !height) return null;
  const origin = box.getBoundingClientRect();
  let d = `M0 0H${width}V${height}H0Z`;
  for (const tab of box.querySelectorAll<HTMLElement>(".tab-active")) {
    const rect = tab.getBoundingClientRect();
    const view = tab.closest('[role="tablist"]')?.getBoundingClientRect() ?? rect;
    const x0 = Math.max(rect.left, view.left) - origin.left;
    const x1 = Math.min(rect.right, view.right) - origin.left;
    const y0 = rect.top - origin.top;
    const foot = Math.min(height, rect.bottom - origin.top);
    if (x1 - x0 <= 2 * RADIUS) continue;
    const r = RADIUS;
    d +=
      `M${x0 - r} ${foot}A${r} ${r} 0 0 0 ${x0} ${foot - r}V${y0 + r}A${r} ${r} 0 0 1 ${x0 + r} ${y0}` +
      `H${x1 - r}A${r} ${r} 0 0 1 ${x1} ${y0 + r}V${foot - r}A${r} ${r} 0 0 0 ${x1 + r} ${foot}Z`;
  }
  return `path(evenodd, "${d}")`;
}

/**
 * Keeps the veil hole under the active tabs of `box`. The strip remounts on every
 * activation, so the hole follows the DOM and scroll, not a prop. Needs a Solid owner.
 */
export function veilTabs(box: HTMLElement) {
  let frame = 0;
  let last = "";
  // Mover el divisor entre ventanas cambia el ancho de cada tira, no el de la caja.
  const watched = new WeakSet<Element>();
  const draw = () => {
    frame = 0;
    for (const strip of box.querySelectorAll('[role="tablist"]')) {
      if (watched.has(strip)) continue;
      watched.add(strip);
      resize?.observe(strip);
    }
    const clip = hole(box);
    if (clip === null || clip === last) return;
    last = clip;
    box.style.setProperty("--tab-hole", clip);
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(draw);
  };
  box.addEventListener("scroll", schedule, true);
  window.addEventListener("resize", schedule);
  const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
  resize?.observe(box);
  const changes = new MutationObserver(schedule);
  changes.observe(box, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
  schedule();
  onCleanup(() => {
    if (frame) cancelAnimationFrame(frame);
    box.removeEventListener("scroll", schedule, true);
    window.removeEventListener("resize", schedule);
    resize?.disconnect();
    changes.disconnect();
  });
}
