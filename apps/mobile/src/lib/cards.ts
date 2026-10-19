/**
 * Lo que la tarjeta compartida (`taskCard` de `@terminus/tasks`) necesita de
 * una tarea del teléfono. Entre máquinas el id puede repetirse: la tarjeta
 * trabaja con `host/id`.
 */
import type { AttentionState, WorkspaceAttention } from "@terminus/protocol";
import { type CardTask, type TaskCard, taskCard } from "@terminus/tasks";
import { type Task, taskKey } from "./engine";

export type Marks = {
  /** `host/id` → estado de atención del motor. */
  attention: Map<string, AttentionState>;
  /** `host/id` con un turno en marcha. */
  live: Set<string>;
};

export function marksOf(attention: Record<string, WorkspaceAttention[]>, workspace: string | null | undefined, live: Set<string>): Marks {
  const map = new Map<string, AttentionState>();
  for (const [host, list] of Object.entries(attention)) {
    for (const w of list) if (!workspace || w.workspace === workspace) for (const task of w.tasks) map.set(`${host}/${task.session}`, task.state);
  }
  return { attention: map, live };
}

/** La fila con el id de máquina y lo que dice la atención del motor. */
export function cardTask(task: Task, marks: Marks): CardTask & { key: string } {
  const key = taskKey(task);
  const state = marks.attention.get(key);
  return {
    ...task,
    id: key,
    key,
    esperando: task.esperando || state === "asked",
    outcome: state === "failed" ? "failed" : task.outcome,
    sin_ver: state === "unseen",
  };
}

export function cardOf(task: Task, marks: Marks, hideFolder = false): TaskCard {
  const approving = [...marks.attention].filter(([, s]) => s === "approving").map(([k]) => k);
  return taskCard(cardTask(task, marks), { live: marks.live, approving, hideFolder });
}
