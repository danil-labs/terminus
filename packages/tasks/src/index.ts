export {
  type AgentOption,
  type SidebarContext,
  type SidebarDensity,
  type SidebarGroup,
  type SidebarGrouping,
  type SidebarSection,
  type SidebarStatusKey,
  type SidebarTask,
  type SidebarView,
  DEFAULT_SIDEBAR_VIEW,
  DENSITIES,
  GROUPINGS,
  activityOf,
  agentOptions,
  applySidebarView,
  isPinned,
  needsYou,
  nonDefaultCount,
  sameAgent,
  sanitizeSidebarView,
  statusKeyOf,
} from "./view.ts";
export { type FlatRow, type FlatTask, type LauncherRow, flattenTasks, folderCounts, shownUnderLauncher } from "./flat.ts";
export {
  type AgentPresence,
  type DockAgent,
  DOCK_DEFAULT_CAPACITY,
  DOCK_GAP,
  DOCK_SLOT,
  agentFolder,
  dockCapacity,
  orderDockAgents,
  planDock,
} from "./dock.ts";
export { type CardOptions, type CardTask, type TaskCard, taskCard } from "./card.ts";
export { dockStatusText, groupLabel, groupingLabel, scopeLabel, sectionLabel, statusGroupLabel } from "./labels.ts";
export {
  type ModelCatalog,
  type PreviewAction,
  type PreviewTask,
  type TaskPreview,
  type TitledTask,
  modelName,
  previewLabel,
  taskPreview,
  taskTitle,
} from "./preview.ts";
export { type CardPull, type CheckState, type PullTone, type TaskGit, cardPull } from "./pull.ts";
