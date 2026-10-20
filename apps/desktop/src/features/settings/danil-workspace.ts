/**
 * La cuenta de Danil de un workspace: con qué cuenta se ve desde la web y el
 * teléfono, aparte de la cuenta de la computadora. El vínculo vive en el motor
 * (`danil_workspace_*`, workspace del sobre); aquí solo se lee y se pide.
 */
import { invoke } from "../../lib/invoke.ts";
import { failureCode } from "./danil-account.ts";

export type DanilWorkspaceLinkStatus = {
  linked: boolean;
  user_id?: string | null;
  email?: string | null;
  name?: string | null;
  /** Si esta computadora tiene sesión de Danil: sin ella no se vincula nada. */
  machine_connected: boolean;
  machine_email?: string | null;
  /** El correo de la sesión de Radiant de este workspace, si tiene una. */
  radiant_email?: string | null;
  /** Un código de «Otra cuenta» esperando aprobación. */
  pending?: { user_code: string; verification_uri_complete?: string | null; expires_at?: number | null } | null;
};

/** El evento `danil-workspace-link`: cómo va el código de «Otra cuenta». */
export type DanilWorkspaceLinkEvent = { workspace: string; state: "pending" | "linked" | "error"; error?: string | null };

export type DanilWorkspaceLinkStart = { user_code: string; verification_uri: string; verification_uri_complete?: string | null; expires_at?: number | null };

/** `null` si el motor todavía no vincula workspaces. */
export async function readWorkspaceLink(): Promise<DanilWorkspaceLinkStatus | null> {
  try {
    return await invoke<DanilWorkspaceLinkStatus>("danil_workspace_link_status");
  } catch (e) {
    if (failureCode(e) === "command") return null;
    throw e;
  }
}

/** `owner`: la cuenta de esta computadora. `radiant`: la sesión de Radiant del workspace. */
export function linkWorkspace(mode: "owner" | "radiant"): Promise<DanilWorkspaceLinkStatus> {
  return invoke<DanilWorkspaceLinkStatus>("danil_workspace_link", { mode });
}

/** Otra cuenta: el motor pide un código y espera; la ventana abre la página de aprobación. */
export async function linkWorkspaceWithBrowser(): Promise<DanilWorkspaceLinkStart> {
  const started = await invoke<DanilWorkspaceLinkStart>("danil_workspace_link_start");
  const url = started.verification_uri_complete ?? started.verification_uri;
  if (url) await invoke("open_external", { target: url }).catch(() => {});
  return started;
}

export function cancelWorkspaceLink(): Promise<unknown> {
  return invoke("danil_workspace_link_cancel");
}

export function unlinkWorkspace(): Promise<unknown> {
  return invoke("danil_workspace_unlink");
}

/** Lo que se ve de la cuenta vinculada: su correo, si no su nombre. */
export function linkedLabel(status: Pick<DanilWorkspaceLinkStatus, "email" | "name" | "user_id">): string {
  return status.email?.trim() || status.name?.trim() || status.user_id || "";
}
