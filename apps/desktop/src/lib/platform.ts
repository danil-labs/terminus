/**
 * Lo que este front puede hacer donde corre. El escritorio lo puede todo y es
 * el valor por defecto; la entrada web (`src/web/main.ts`) lo fija antes de
 * importar la app y no cambia después.
 */
export type Capabilities = {
  /** Controles de ventana propios, semáforo de macOS y bandeja. */
  nativeWindow: boolean;
  /** El actualizador firmado de la app. */
  updater: boolean;
};

const DESKTOP: Capabilities = { nativeWindow: true, updater: true };

let current = DESKTOP;

export const capabilities = (): Capabilities => current;

export function setCapabilities(next: Capabilities) {
  current = next;
}
