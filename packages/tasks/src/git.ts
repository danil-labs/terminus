import type { TaskGit } from "./pull.ts";

export type ReviewState = "unknown" | "unreviewed" | "approved" | "changes_requested";
export type KnState = "clean" | "draft" | "saved";

export type TaskGitStatus = Omit<TaskGit, "pull"> & {
  kind: "none" | "unknown" | "branch" | "detached" | "kn";
  kn: KnState | null;
  branch: string | null;
  alias: string | null;
  repository: string;
  pull: (NonNullable<TaskGit["pull"]> & { git_host?: string; review?: ReviewState }) | null;
  checked_at: number | null;
  has_remote: boolean;
  merged_locally: boolean;
};

export const UNKNOWN_TASK_GIT: TaskGitStatus = {
  kind: "unknown", kn: null, branch: null, alias: null, head: null, repository: "", shared_with: null,
  pull: null, pull_known: false, checked_at: null, stale: false, has_remote: false, merged_locally: false,
};

/** `remote` actualiza las ramas observadas: por sí solo no descubre los árboles de las tareas. */
export async function readTaskGit<T>(
  read: (remote: boolean) => Promise<T>,
  options: { phase?: "local" | "remote" | "both"; onLocal?: (rows: T) => void; current?: () => boolean } = {},
): Promise<T> {
  const phase = options.phase ?? "both";
  if (phase === "remote") return read(true);
  const local = await read(false);
  options.onLocal?.(local);
  if (phase === "local" || options.current?.() === false) return local;
  return read(true);
}

/** La UI ofrece la acción; `finish_task` vuelve a validar y ejecuta el cierre en el motor. */
export function canFinishTask(
  session: { archived?: boolean | null; subagent?: string | null },
  status: TaskGitStatus | null | undefined,
  busy: boolean,
): boolean {
  if (!status || session.archived || busy || status.stale) return false;
  if (status.kind === "kn") return status.kn === "saved";
  if (status.kind !== "branch" || !status.head) return false;
  if (status.pull) return status.pull_known && status.pull.state === "merged" && status.pull.head_sha === status.head;
  return status.merged_locally && (status.pull_known || !status.has_remote);
}
