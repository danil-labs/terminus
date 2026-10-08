import { invoke as tauri, type InvokeArgs, type InvokeOptions } from "@tauri-apps/api/core";

/**
 * El único `invoke` de la ventana: el de Tauri, que espera al servicio en vez
 * de rendirse con él. El backend ya insiste por su cuenta
 * (`cli/service/mod.rs`, `RETRY_BUDGET`); esta es la segunda red, para el
 * relevo que tarda más. Un fallo del comando —permiso denegado, rama que no
 * existe— cruza tal cual y sin demora.
 */

/**
 * Los códigos con los que el backend afirma que la orden no llegó a correr.
 * Viajan en el `detail` del `Failure` (`para_la_ventana`). `io` no está: ahí la
 * orden pudo ejecutarse y perderse la respuesta, y repetirla la duplicaría.
 */
const NEVER_RAN = new Set(["app_unavailable", "invalid_token", "service_busy"]);

/** Cinco esperas que suman unos cuatro segundos y medio. */
export const WAITS = [150, 300, 600, 1200, 2400];

const detailOf = (e: unknown): unknown =>
  e && typeof e === "object" && "detail" in e ? (e as { detail: unknown }).detail : null;

export function neverRan(e: unknown): boolean {
  const detail = detailOf(e);
  return typeof detail === "string" && NEVER_RAN.has(detail);
}

/**
 * Una lectura se repite también tras `io`: repetirla no duplica nada. Sin esto,
 * la lista que falló una vez —workspaces, cuentas— deja su panel muerto hasta
 * que algo lo recargue.
 */
const READ = /^(list_|load_|read_|get_)|_status$/;

export function canRepeat(command: string, e: unknown): boolean {
  return neverRan(e) || (READ.test(command) && detailOf(e) === "io");
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** El reintento suelto del transporte que usa `invoke`, para poder probarlo. */
export async function retrying<T>(
  call: () => Promise<T>,
  wait: (ms: number) => Promise<unknown> = sleep,
  repeatable: (e: unknown) => boolean = neverRan,
): Promise<T> {
  for (const ms of WAITS) {
    try {
      return await call();
    } catch (e) {
      if (!repeatable(e)) throw e;
      await wait(ms);
    }
  }
  return await call();
}

export const invoke = <T>(command: string, args?: InvokeArgs, options?: InvokeOptions): Promise<T> =>
  retrying(() => tauri<T>(command, args, options), sleep, (e) => canRepeat(command, e));
