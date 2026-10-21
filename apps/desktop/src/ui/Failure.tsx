import { Show } from "solid-js";
import { clavesConocidas, t } from "../lib/i18n";
import { prosa, type Prosa } from "../lib/prose";

/**
 * Un error de pantalla: qué pasó y qué hacer, y nada más a la vista. Lo que
 * dijo el proceso de abajo queda plegado, que es donde sirve: hace falta para
 * reportar el fallo y no significa nada para quien lo tiene delante. Suelto
 * ponía un `git rev-parse --abbrev-ref HEAD` en la cara de quien abrió una
 * tarea. Misma forma que el fallo del actualizador (`settings/Update.tsx`).
 */

/**
 * Lo arma Rust: dos campos y no una cadena, porque solo abajo se sabe si un
 * 401 fue al pegar el token o una semana después.
 */
export type Failure = {
  /**
   * Qué pasó y qué hacer; se lee en pantalla. Es una `Prosa`, no una cadena:
   * un módulo migrado manda clave y datos y traduce este proceso, el único que
   * sabe en qué lengua está la ventana (`lib/prose.ts`). Un módulo sin migrar
   * manda la cadena y se pinta tal cual.
   */
  what: Prosa;
  /** Lo que dijo el proceso de abajo. Puede ir vacío. */
  detail: string;
};

/**
 * Normaliza cualquier cosa que se pueda tirar a un `Failure`: lo que no viene
 * del backend no trae frase con acción, así que se le pone la genérica y el
 * crudo baja al renglón de abajo.
 *
 * La frase genérica se resuelve aquí dentro, no en una constante de módulo:
 * una constante se arma una vez al importarse y se quedaría con la lengua del
 * arranque, sin error.
 */
export function asFailure(e: unknown): Failure {
  if (e && typeof e === "object" && "what" in e) return e as Failure;
  return { what: t("common.failure.generic"), detail: String(e) };
}

/**
 * El renglón de prosa, ya traducido, para los sitios que pintan uno solo. No
 * es `prosa(asFailure(e).what)`: lo que no es un `Failure` se devuelve tal
 * cual — sin segundo renglón, caer al genérico borraría lo único que se dijo.
 * `datos` rellena una clave suelta: un comando que rechaza con `String` no
 * puede mandarlos.
 */
export function prosaDe(e: unknown, datos?: Record<string, string | number>): string {
  if (e && typeof e === "object" && "what" in e) return prosa((e as Failure).what);
  const clave = claveDe(e);
  return clave ? t(clave, datos) : String(e);
}

/**
 * El renglón crudo, para los sitios que ya ponen su propia frase arriba y solo
 * necesitan qué dijo el proceso de abajo. Un `Failure` del backend trae el suyo;
 * cuando viene vacío se baja su prosa, que es lo único que dice algo — `String()`
 * sobre ese objeto escribía «[object Object]» en el único renglón con motivo.
 */
export function detalleDe(e: unknown): string {
  if (e && typeof e === "object" && "what" in e) {
    const f = e as Failure;
    return f.detail || prosa(f.what);
  }
  return String(e);
}

/**
 * La clave de catálogo que trae un error, o `null`. El mismo motivo llega como
 * clave suelta desde un módulo sin migrar y dentro de un `Failure` desde uno
 * migrado —`history.error.busy` sale de las dos formas—, y compararlo con
 * `String(e)` solo acierta con la primera.
 */
export function claveDe(e: unknown): string | null {
  const what = e && typeof e === "object" && "what" in e ? (e as Failure).what : e;
  const clave = typeof what === "string" ? what : (what as { clave?: string })?.clave;
  return clave && clavesConocidas().has(clave) ? clave : null;
}

export function FailureNote(props: { f: Failure }) {
  return (
    <div class="flex flex-col gap-1 py-3 pr-3.5 font-mono text-xs text-error-strong">
      <span class="font-sans text-[0.8125rem]">{prosa(props.f.what)}</span>
      <Show when={props.f.detail}>
        <details>
          <summary class="cursor-pointer font-sans text-[0.6875rem] text-neutral-500">
            {t("common.failure.detail")}
          </summary>
          <p class="m-0 mt-1 font-mono text-[0.6875rem] break-all whitespace-pre-wrap text-neutral-500">
            {props.f.detail}
          </p>
        </details>
      </Show>
    </div>
  );
}
