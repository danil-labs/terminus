import { rolledOutcome, taskPriority, type TaskActivity } from "@terminus/design";
import type { SessionRow } from "../projects/Sessions";

export function delegatedAttention(rows: SessionRow[], live: readonly string[], approvals: readonly string[]): TaskActivity {
  return {
    aprobando: rows.some(row => approvals.includes(row.id)),
    esperando: rows.some(row => row.esperando),
    viva: rows.some(row => live.includes(row.id)),
    outcome: rolledOutcome(rows),
    sinVer: rows.some(row => row.sin_ver),
  };
}

/** El riel enseña lo pendiente: `list_delegated_sessions` trae también las archivadas, que solo pinta la tarjeta del lanzamiento. */
export function delegatedRailRows(rows: SessionRow[], all: boolean, live: readonly string[], approvals: readonly string[]): SessionRow[] {
  const pending = rows.filter(row => !row.archived);
  return all ? pending : pending.filter(row => taskPriority(delegatedAttention([row], live, approvals)));
}
