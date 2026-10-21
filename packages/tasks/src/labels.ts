/**
 * Las frases de la vista con las palabras compartidas de `@terminus/design`.
 * El escritorio arma las mismas con su `t()` y sus catálogos; el guard
 * `shared-design` comprueba que las palabras coinciden.
 */
import { word } from "../../design/src/index.ts";
import type { DockAgent } from "./dock.ts";
import type { SidebarGroup, SidebarGrouping, SidebarSection, SidebarStatusKey, SidebarView } from "./view.ts";

type Lang = "es" | "en";

export function groupingLabel(lang: Lang, group: SidebarGrouping): string {
  switch (group) {
    case "folder": return word(lang, "shell.sidebar.view.group_folder");
    case "status": return word(lang, "shell.sidebar.view.group_status");
    case "agent": return word(lang, "shell.sidebar.view.group_agent");
    default: return word(lang, "shell.sidebar.view.group_none");
  }
}

/** La línea que dice qué se enseña. */
export function scopeLabel(lang: Lang, view: SidebarView, folderName: (id: string) => string): string {
  const parts = [view.folders.length ? view.folders.map(folderName).join(", ") : word(lang, "shell.sidebar.view.all_folders")];
  if (view.agent) parts.push(view.agent);
  switch (view.group) {
    case "folder": parts.push(word(lang, "shell.sidebar.view.scope_by_folder")); break;
    case "status": parts.push(word(lang, "shell.sidebar.view.scope_by_status")); break;
    case "agent": parts.push(word(lang, "shell.sidebar.view.scope_by_agent")); break;
  }
  return parts.join(" · ");
}

export function sectionLabel(lang: Lang, _section: SidebarSection): string {
  return word(lang, "shell.sidebar.view.section_active");
}

export function statusGroupLabel(lang: Lang, key: SidebarStatusKey): string {
  switch (key) {
    case "approving": return word(lang, "shell.sidebar.view.status_approving");
    case "asked": return word(lang, "shell.sidebar.view.status_asked");
    case "working": return word(lang, "shell.sidebar.view.status_working");
    case "failed": return word(lang, "shell.sidebar.view.status_failed");
    case "unseen": return word(lang, "shell.sidebar.view.status_unseen");
    case "finished": return word(lang, "shell.sidebar.view.status_finished");
    default: return word(lang, "shell.sidebar.view.status_idle");
  }
}

export function groupLabel(lang: Lang, group: SidebarGroup<unknown>, folderName: (id: string) => string): string {
  switch (group.kind) {
    case "section": return sectionLabel(lang, group.key as SidebarSection);
    case "status": return statusGroupLabel(lang, group.key as SidebarStatusKey);
    case "folder": return group.key ? folderName(group.key) : word(lang, "shell.sidebar.view.no_folder");
    default: return group.key || word(lang, "shell.sidebar.view.no_agent");
  }
}

/** Lo que dice el dock bajo la cara de un agente: las mismas palabras que el escritorio. */
export function dockStatusText(lang: Lang, agent: DockAgent): string {
  if (!agent.status || agent.status === "asleep") return word(lang, "projects.sessions.agent_asleep");
  if (agent.status === "working") {
    return agent.liveTasks > 0
      ? word(lang, "projects.sessions.agent_working", { count: agent.liveTasks })
      : word(lang, "projects.sessions.agent_working_alone");
  }
  return agent.minutesSinceLastTurn != null
    ? word(lang, "projects.sessions.agent_awake_since", { minutes: agent.minutesSinceLastTurn })
    : word(lang, "projects.sessions.agent_awake");
}
