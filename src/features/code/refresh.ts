import { createEffect, createSignal, on, onCleanup } from "solid-js";

/** El evento del DOM, y lo que lleva dentro. */
export const ARBOLES = "harness:arboles";

/** La tarea cuyo árbol se movió. Basta la sesión: su id es único. */
export type DetalleDeArboles = { session: string };

/** Avisar de que lo que esta tarea escribió puede haber cambiado en disco. */
export function avisarDeLosArboles(session: string) {
  window.dispatchEvent(
    new CustomEvent<DetalleDeArboles>(ARBOLES, { detail: { session } }),
  );
}

/**
 * Qué hace un refresco con lo que hay escrito sin guardar.
 *
 * **Pisar lo que alguien estaba escribiendo es el mismo defecto que no
 * refrescar, al revés**, así que con el borrador tocado el refresco no entra:
 * avisa, y quien escribe elige —guardar encima o descartar y quedarse con lo del
 * agente—. Con el borrador intacto sí entra y **se lleva el borrador con él**:
 * ahí no hay nada que perder, y dejar el archivo viejo dentro del editor delante
 * de quien está a punto de guardarlo es exactamente el accidente que esto viene
 * a cerrar.
 *
 * Está aparte del componente porque es la decisión, no la fontanería: se prueba
 * sola (`scripts/code-refresh.test.ts`).
 */
export type Entrada = "avisa" | "entra" | "arrastra";

export function comoEntra(hayBorrador: boolean, sucio: boolean): Entrada {
  if (sucio) return "avisa";
  return hayBorrador ? "arrastra" : "entra";
}

/**
 * Qué hacer con la señal según quién la reciba, y **el estado que deja**.
 *
 * Las cuatro combinaciones importan y solo una lee: la de la pestaña que se está
 * mirando. Escondida, la señal se apunta —`pendiente`— y se cobra al volver, que
 * es lo que impide que una tarea con ocho pestañas pague ocho pares de pasadas
 * de git en cada turno sin que nadie las vea.
 */
export function decidir(
  estado: { mio: boolean; visible: boolean; pendiente: boolean },
  senal: "aviso" | "asoma",
): { pendiente: boolean; refrescar: boolean } {
  if (senal === "aviso") {
    if (!estado.mio) return { pendiente: estado.pendiente, refrescar: false };
    return estado.visible
      ? { pendiente: false, refrescar: true }
      : { pendiente: true, refrescar: false };
  }
  // Asomarse solo cobra lo apuntado; sin nada apuntado no lee.
  if (!estado.visible || !estado.pendiente) {
    return { pendiente: estado.pendiente, refrescar: false };
  }
  return { pendiente: false, refrescar: true };
}

/**
 * Refresca cuando el árbol de `session` se mueva, **si esto se está mirando**.
 *
 * Escondido, la señal queda apuntada y el refresco ocurre al hacerse visible.
 * Devuelve nada: se llama en el cuerpo del componente y se limpia con él.
 */
export function alMoverseElArbol(
  session: () => string,
  visible: () => boolean,
  refrescar: () => void,
  copies = false,
) {
  const [pendiente, setPendiente] = createSignal(false);

  const aplicar = (senal: "aviso" | "asoma", mio: boolean) => {
    const r = decidir({ mio, visible: visible(), pendiente: pendiente() }, senal);
    setPendiente(r.pendiente);
    if (r.refrescar) refrescar();
  };

  const alLlegar = (e: Event) => {
    const detalle = (e as CustomEvent<DetalleDeArboles>).detail;
    aplicar("aviso", detalle?.session === session());
  };
  window.addEventListener(ARBOLES, alLlegar);
  onCleanup(() => window.removeEventListener(ARBOLES, alLlegar));

  if (copies) {
    const copied = () => aplicar("aviso", true);
    window.addEventListener("harness:copia", copied);
    onCleanup(() => window.removeEventListener("harness:copia", copied));
  }

  createEffect(on(visible, () => aplicar("asoma", true), { defer: true }));
}
