/**
 * La cuenta de Danil de esta computadora: iniciar sesión (y con eso registrar
 * la máquina), ver con qué cuenta quedó y cerrar sesión. El flujo vive en el
 * motor (`danil_connect_*`); aquí solo se lee su estado y se lo pide.
 */
import { invoke } from "../../lib/invoke.ts";

export type DanilConnectState = "disconnected" | "pending" | "connected" | "error";

export type DanilConnectStatus = {
  state: DanilConnectState;
  computer_id?: string | null;
  /** Conectada: el nombre de esta computadora. Desconectada: el sugerido (su hostname). */
  name?: string | null;
  email?: string | null;
  user_code?: string | null;
  verification_uri?: string | null;
  verification_uri_complete?: string | null;
  /** Milisegundos de época en que vence el código. */
  expires_at?: number | null;
  /** El código del último fallo: `expired_token`, `access_denied`, `revoked`… */
  error?: string | null;
  /** Si la sesión con el relay de Danil está abierta. */
  online?: boolean;
};

/**
 * «Continuar como <correo>» sin navegador. Apagado mientras la cuenta de Danil
 * sea solo Supabase: depende del intercambio de WorkOS.
 */
export const ONE_CLICK_SIGN_IN = false;

/** Un workspace con sesión de Radiant y ese correo: con él se entra sin navegador. */
export type DanilConnectOption = { workspace: string; name?: string | null; email: string };

/** El código con que el motor rechazó la orden; `command` si no la conoce. */
export function failureCode(e: unknown): string | null {
  if (!e || typeof e !== "object") return null;
  const { detail, what } = e as { detail?: unknown; what?: { clave?: unknown } };
  if (typeof detail === "string" && detail) return detail;
  if (typeof what?.clave === "string") return what.clave.split(".").pop() ?? null;
  return null;
}

/** `null` si el motor todavía no trae este flujo. */
export async function readDanilAccount(): Promise<DanilConnectStatus | null> {
  try {
    return await invoke<DanilConnectStatus>("danil_connect_status");
  } catch (e) {
    if (failureCode(e) === "command") return null;
    throw e;
  }
}

/** Un correo una vez, con el primer workspace que lo tenga. */
export async function readDanilOptions(): Promise<DanilConnectOption[]> {
  const options = await invoke<DanilConnectOption[]>("danil_connect_options").catch(() => []);
  const seen = new Set<string>();
  return (Array.isArray(options) ? options : []).filter((o) => {
    const key = typeof o?.email === "string" ? o.email.trim().toLowerCase() : "";
    if (!key || typeof o.workspace !== "string" || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const nameArg = (name: string) => (name.trim() ? { name: name.trim() } : {});

/** Con el navegador: el motor deja el código pendiente y la ventana abre la página de aprobación. */
export async function signInWithBrowser(name: string): Promise<DanilConnectStatus> {
  const started = await invoke<DanilConnectStatus>("danil_connect_start", nameArg(name));
  const url = started.verification_uri_complete ?? started.verification_uri;
  if (url) await invoke("open_external", { target: url }).catch(() => {});
  return started;
}

/** Sin navegador, con la cuenta de Radiant que ya tiene ese workspace. */
export function signInWithWorkspace(name: string, workspace: string): Promise<DanilConnectStatus> {
  return invoke<DanilConnectStatus>("danil_connect_start", { ...nameArg(name), workspace });
}

/** Cerrar sesión, o cancelar un código pendiente. */
export function signOut(): Promise<DanilConnectStatus> {
  return invoke<DanilConnectStatus>("danil_disconnect");
}
