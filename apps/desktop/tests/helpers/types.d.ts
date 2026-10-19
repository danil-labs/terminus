/**
 * Tipos para los imports que el chequeo de `scripts/` no resuelve solo.
 *
 * `queue.test.ts` importa el build ya compilado de Solid (`dist/solid.js`) a
 * propósito: en Node no hay transform de JSX y el paquete raíz apunta al
 * fuente. El build expone la misma API, así que se le dan los tipos del raíz.
 */
declare module "solid-js/dist/solid.js" {
  export * from "solid-js";
}
