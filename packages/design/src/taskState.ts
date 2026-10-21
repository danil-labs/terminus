/** What the sidebar knows about a task to pick its mark. */
export type TaskActivity = {
  aprobando: boolean;
  esperando: boolean;
  viva: boolean;
  outcome?: "delivered" | "failed" | null;
  /** Un turno cerró después de la última vez que se abrió (`workspace/attention.rs`). */
  sinVer?: boolean;
};

export type TaskState = "approving" | "asked" | "working" | "failed" | "unseen";

/** The order is the priority: a folded row shows the first one any task has. */
export const TASK_STATES: readonly TaskState[] = ["approving", "asked", "working", "failed", "unseen"];

export function taskPriority(s: TaskActivity): TaskState | null {
  if (s.aprobando) return "approving";
  if (s.esperando) return "asked";
  if (s.viva) return "working";
  if (s.outcome === "failed") return "failed";
  if (s.sinVer) return "unseen";
  return null;
}

/** The most urgent state of a group, like a folded row of the sidebar. */
export function topState(states: readonly (TaskState | null)[]): TaskState | null {
  return TASK_STATES.find((state) => states.includes(state)) ?? null;
}
