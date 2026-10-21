/**
 * Si un workspace se ve en la web y el teléfono: como elegir una carpeta que
 * se sincroniza con tu cuenta. Solo hay una cuenta, la de esta computadora.
 * El vínculo vive en el motor (`danil_workspace_*`, workspace del sobre);
 * aquí solo se lee y se pide.
 */
import { invoke } from "../../lib/invoke.ts";
import { failureCode } from "./danil-account.ts";

export type DanilWorkspaceLinkStatus = {
  linked: boolean;
  email?: string | null;
  name?: string | null;
  /** Si esta computadora tiene sesión de Danil: sin ella no se vincula nada. */
  machine_connected: boolean;
  machine_email?: string | null;
};

/** `null` si el motor todavía no vincula workspaces. */
export async function readWorkspaceLink(): Promise<DanilWorkspaceLinkStatus | null> {
  try {
    return await invoke<DanilWorkspaceLinkStatus>("danil_workspace_link_status");
  } catch (e) {
    if (failureCode(e) === "command") return null;
    throw e;
  }
}

/** Siempre con la cuenta de esta computadora. */
export function linkWorkspace(): Promise<DanilWorkspaceLinkStatus> {
  return invoke<DanilWorkspaceLinkStatus>("danil_workspace_link");
}

export function unlinkWorkspace(): Promise<unknown> {
  return invoke("danil_workspace_unlink");
}

/** El correo de la cuenta con que se ve: la del vínculo o, si no hay, la de la computadora. */
export function accountEmail(status: Pick<DanilWorkspaceLinkStatus, "email" | "name" | "machine_email">): string {
  return status.email?.trim() || status.machine_email?.trim() || status.name?.trim() || "";
}
