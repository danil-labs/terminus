import { getCurrentWindow } from "@tauri-apps/api/window";
import { type Accessor, createSignal, onCleanup, onMount } from "solid-js";

// Resolver macOS de forma asíncrona taparía los controles durante el primer render.
export const isMac = () =>
  typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);

export const isWindows = () =>
  typeof navigator !== "undefined" && /Windows/.test(navigator.userAgent);

export function toggleMaximizeFromHeader(event: MouseEvent) {
  if (!isWindows()) return;
  const target = event.target as HTMLElement | null;
  if (target?.closest("button, a, input, select, textarea")) return;
  try {
    void getCurrentWindow().toggleMaximize().catch(() => {});
  } catch {
  }
}

// El semáforo medido termina en x=77,5 pt: 84 px dejan 6,5 pt de separación.
// Su posición no se puede consultar; hay que volver a medir si macOS la cambia.
export const TRAFFIC_LIGHT_PADDING = "pl-[84px]";

// Una fila de 32 px alinea sus controles con el centro del semáforo, y=15,75 pt.
export const HEADER_HEIGHT = "h-8";

export const needsTrafficLightPadding = (
  ownsCorner: () => boolean,
  fullscreen: Accessor<boolean>,
) => () => isMac() && !fullscreen() && ownsCorner();

// El título nativo con Overlay se superpone a los controles; hiddenTitle deja pintarlo aquí.
export function createWindowTitle(): Accessor<string> {
  const [title, setTitle] = createSignal("");

  onMount(() => {
    // getCurrentWindow() puede lanzar sin metadata; un catch de la promesa no lo captura.
    try {
      void getCurrentWindow()
        .title()
        .then(setTitle)
        .catch(() => {});
    } catch {
    }
  });

  return title;
}

// Tauri no emite cambios de pantalla completa; el cambio de tamaño permite consultarla.
export function createFullscreen(): Accessor<boolean> {
  const [fullscreen, setFullscreen] = createSignal(false);

  onMount(() => {
    // getCurrentWindow() puede lanzar antes de crear la promesa y abortar otros onMount.
    try {
      const window = getCurrentWindow();
      const check = () =>
        window
          .isFullscreen()
          .then(setFullscreen)
          .catch(() => {});
      void check();
      const off = window.onResized(() => void check());
      onCleanup(() => void off.then((f) => f()).catch(() => {}));
    } catch {
    }
  });

  return fullscreen;
}

export const COMPACT_VIEWPORT_QUERY =
  "(max-width: 900px), (orientation: portrait) and (max-width: 1100px)";

// Devolver el valor en vez del getter impediría que Solid rastreara los cambios.
export function createCompactViewport() {
  const media = window.matchMedia(COMPACT_VIEWPORT_QUERY);
  const [compact, setCompact] = createSignal(media.matches);

  const update = () => setCompact(media.matches);
  media.addEventListener("change", update);
  onCleanup(() => media.removeEventListener("change", update));

  return compact;
}
