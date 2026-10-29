/**
 * Cómo pide el panel «Carpeta» su árbol: sin amontonar lecturas, sin tirar lo
 * último bueno y sin enseñar un error que un segundo intento habría resuelto.
 *
 * Una vez pasó: un `tree_files` tardó 180–240 s, volvió `io` y el panel se
 * quedó en «Terminus no respondió… reinicia la app» aunque la siguiente
 * lectura contestaba en un segundo. No reintentaba nunca.
 *
 * Aquí está la decisión, aparte de la fontanería de Solid, para probarla sola
 * (`tests/unit/tree-loader.test.ts`):
 *
 * - **Una lectura a la vez.** Lo que se pide mientras hay una en vuelo se
 *   junta en una sola al terminar. Si la que está en vuelo pasa de `lentaTras`,
 *   se deja de esperarla y sale otra: el motor no cancela la vieja, pero que
 *   una tarde no bloquea las siguientes.
 * - **Gana la respuesta buena más nueva.** Una lectura vieja que contesta
 *   después de una más nueva no pisa nada; un fallo solo cuenta si es de la
 *   última que salió.
 * - **Un fallo del transporte se reintenta solo** con espera creciente
 *   (`esperas`), sin avisar. Solo si se agotan se llama a `fail`. Un fallo del
 *   comando (carpeta borrada, permiso) se dice a la primera.
 */

/** Los fallos que dicen «no llegó» o «no contestó a tiempo», no «no se puede». */
const TRANSITORIOS = new Set([
  "io",
  "app_unavailable",
  "managed_service_unavailable",
  "service_busy",
  "task_busy",
  "invalid_token",
  "engine_down",
]);
const CLAVES_TRANSITORIAS = new Set([
  "shell.service.unreachable",
  "shell.service.busy",
  "shell.service.engine_down",
]);

const record = (e: unknown): e is Record<string, unknown> => e !== null && typeof e === "object";

export function esTransitorio(e: unknown): boolean {
  if (!record(e)) return false;
  if (typeof e.detail === "string" && TRANSITORIOS.has(e.detail)) return true;
  const what = e.what;
  const clave = record(what) ? what.clave : what;
  return typeof clave === "string" && CLAVES_TRANSITORIAS.has(clave);
}

/** Uno, tres, diez y treinta segundos: unos 45 s antes de enseñar el fallo. */
export const ESPERAS = [1_000, 3_000, 10_000, 30_000];
/** Una lectura que pasa de esto ya no frena a las demás. `tree_files` suele tardar ~1 s. */
export const LENTA_TRAS = 15_000;

export type Lector<T> = {
  /** Pedir una lectura (un turno que acabó, volver a la ventana, abrir una carpeta). */
  pedir: () => void;
  /** Lo mismo pero empezando la cuenta de reintentos de cero: el botón «Reintentar». */
  reintentar: () => void;
  /** Si queda un reintento programado o un fallo sin resolver: volver a la ventana pide otra. */
  pendiente: () => boolean;
  soltar: () => void;
};

export function crearLector<T>(opts: {
  leer: () => Promise<T>;
  /** Llegó una respuesta buena: se pinta y se borra el fallo que hubiera. */
  aplicar: (valor: T) => void;
  /** Se agotaron los reintentos, o el fallo no es de los que se reintentan. */
  fallar: (e: unknown) => void;
  ahora?: () => number;
  programar?: (fn: () => void, ms: number) => () => void;
  esperas?: readonly number[];
  lentaTras?: number;
}): Lector<T> {
  const ahora = opts.ahora ?? (() => Date.now());
  const programar = opts.programar ?? ((fn: () => void, ms: number) => {
    const id = setTimeout(fn, ms);
    return () => clearTimeout(id);
  });
  const esperas = opts.esperas ?? ESPERAS;
  const lentaTras = opts.lentaTras ?? LENTA_TRAS;

  let salidas = 0;
  let aplicada = 0;
  let enVuelo: { turno: number; desde: number } | null = null;
  let otraVez = false;
  let fallos = 0;
  let fallida = false;
  let cancelarReintento: (() => void) | null = null;
  let suelto = false;

  const quitarReintento = () => {
    cancelarReintento?.();
    cancelarReintento = null;
  };

  const salir = () => {
    if (suelto) return;
    quitarReintento();
    const turno = ++salidas;
    enVuelo = { turno, desde: ahora() };
    otraVez = false;
    opts.leer().then(
      (valor) => {
        if (suelto) return;
        if (enVuelo?.turno === turno) enVuelo = null;
        if (turno > aplicada) {
          aplicada = turno;
          fallos = 0;
          fallida = false;
          // Una buena basta: el reintento que quedara ya no hace falta.
          quitarReintento();
          opts.aplicar(valor);
        }
        if (otraVez && !enVuelo) salir();
      },
      (e: unknown) => {
        if (suelto) return;
        if (enVuelo?.turno === turno) enVuelo = null;
        // Solo cuenta el fallo de la última que salió, y si nada más nuevo ya contestó bien.
        if (turno !== salidas || aplicada > turno) {
          if (otraVez && !enVuelo) salir();
          return;
        }
        if (otraVez) {
          salir();
          return;
        }
        if (esTransitorio(e) && fallos < esperas.length) {
          const espera = esperas[fallos++];
          cancelarReintento = programar(() => {
            cancelarReintento = null;
            if (!enVuelo) salir();
          }, espera);
          return;
        }
        fallida = true;
        opts.fallar(e);
      },
    );
  };

  const pedir = () => {
    if (suelto) return;
    if (enVuelo && ahora() - enVuelo.desde < lentaTras) {
      otraVez = true;
      return;
    }
    salir();
  };

  return {
    pedir,
    reintentar: () => {
      fallos = 0;
      pedir();
    },
    pendiente: () => fallida || cancelarReintento !== null,
    soltar: () => {
      suelto = true;
      quitarReintento();
    },
  };
}
