import {
  type SidebarGrouping,
  type SidebarGroup,
  type SidebarSection,
  type SidebarStatusKey,
  type SidebarView,
  sanitizeSidebarView,
} from "@terminus/tasks";
import { t } from "./i18n.ts";
import { escribirPref, leerPref } from "./prefs.ts";

// La vista (filtrar, agrupar) es la misma en el teléfono: vive en `@terminus/tasks`.
export {
  type AgentOption,
  type SidebarContext,
  type SidebarGroup,
  type SidebarGrouping,
  type SidebarSection,
  type SidebarStatusKey,
  type SidebarTask,
  type SidebarView,
  DEFAULT_SIDEBAR_VIEW,
  activityOf,
  agentOptions,
  applySidebarView,
  groupKey,
  isPinned,
  nonDefaultCount,
  sameAgent,
} from "@terminus/tasks";

/** La vista se guarda por workspace y espacio, como la tira de pestañas. */
export function sidebarViewKey(workspace: string | null, space: string | null): string {
  return space ? `sidebar.view.${workspace ?? ""}.${space}` : `sidebar.view.${workspace ?? ""}`;
}

export function loadSidebarView(key: string): SidebarView {
  return sanitizeSidebarView(leerPref<unknown>(key, null));
}

export function saveSidebarView(key: string, view: SidebarView) {
  escribirPref(key, sanitizeSidebarView(view));
}

export function groupingLabel(group: SidebarGrouping): string {
  switch (group) {
    case "folder": return t("shell.sidebar.view.group_folder");
    case "status": return t("shell.sidebar.view.group_status");
    case "agent": return t("shell.sidebar.view.group_agent");
    case "machine": return t("shell.sidebar.view.group_machine");
    default: return t("shell.sidebar.view.group_none");
  }
}

/** La línea bajo «Nueva tarea» que dice qué se enseña. */
export function scopeLabel(view: SidebarView, folderName: (id: string) => string): string {
  const parts = [view.folders.length ? view.folders.map(folderName).join(", ") : t("shell.sidebar.view.all_folders")];
  if (view.agent) parts.push(view.agent);
  switch (view.group) {
    case "folder": parts.push(t("shell.sidebar.view.scope_by_folder")); break;
    case "status": parts.push(t("shell.sidebar.view.scope_by_status")); break;
    case "agent": parts.push(t("shell.sidebar.view.scope_by_agent")); break;
    case "machine": parts.push(t("shell.sidebar.view.scope_by_machine")); break;
  }
  return parts.join(" · ");
}

export function sectionLabel(_section: SidebarSection): string {
  return t("shell.sidebar.view.section_active");
}

export function statusGroupLabel(key: SidebarStatusKey): string {
  switch (key) {
    case "approving": return t("shell.sidebar.view.status_approving");
    case "asked": return t("shell.sidebar.view.status_asked");
    case "working": return t("shell.sidebar.view.status_working");
    case "failed": return t("shell.sidebar.view.status_failed");
    case "interrupted": return t("shell.sidebar.view.status_interrupted");
    case "unseen": return t("shell.sidebar.view.status_unseen");
    case "finished": return t("shell.sidebar.view.status_finished");
    default: return t("shell.sidebar.view.status_idle");
  }
}

/** `machineName`: el nombre de una máquina; la clave `""` es la de la ventana, y sin nombre es «Esta máquina». */
export function groupLabel(
  group: SidebarGroup<unknown>,
  folderName: (id: string) => string,
  machineName: (id: string) => string = (id) => id,
): string {
  switch (group.kind) {
    case "machine": return machineName(group.key) || t("shell.sidebar.view.this_machine");
    case "section": return sectionLabel(group.key as SidebarSection);
    case "status": return statusGroupLabel(group.key as SidebarStatusKey);
    case "folder": {
      const folder = group.key ? folderName(group.key) : t("shell.sidebar.view.no_folder");
      // Partida por máquina: «Terminus · Esta Mac», «Terminus · vm-principal».
      if (group.machine === undefined) return folder;
      return `${folder} · ${machineName(group.machine) || t("shell.sidebar.view.this_machine")}`;
    }
    default: return group.key || t("shell.sidebar.view.no_agent");
  }
}
