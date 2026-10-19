/**
 * Lo que este front puede hacer donde corre. El escritorio lo puede todo y es
 * el valor por defecto; la entrada web (`src/web/main.tsx`) lo fija antes de
 * importar la app y no cambia después.
 */
import type { JSX } from "solid-js";

export type Capabilities = {
  /** Controles de ventana propios, semáforo de macOS y bandeja. */
  nativeWindow: boolean;
  /** El actualizador firmado de la app. */
  updater: boolean;
  /** La preparación del entorno con su instalador a la vista. */
  localSetup: boolean;
  /** Una computadora apagada o encendiéndose se ve en su indicador, no como error. */
  computerStatus: boolean;
  /** Botón extra al lado de la búsqueda de la barra lateral (en la web, volver a Danil Agents). */
  sidebarExtra?: () => JSX.Element;
};

const DESKTOP: Capabilities = { nativeWindow: true, updater: true, localSetup: true, computerStatus: false };

let current = DESKTOP;

export const capabilities = (): Capabilities => current;

export function setCapabilities(next: Capabilities) {
  current = next;
}
