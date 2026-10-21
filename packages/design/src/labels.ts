import type { TaskState } from "./taskState.ts";

export type StatusLabel = TaskState | "delivered";

/**
 * The sentence for each mark. The desktop reads the same words from
 * `projects.status.*` in its catalogs; `scripts/guards/shared-design.mjs` fails
 * when the two drift apart.
 */
export const STATUS_LABELS: Record<"es" | "en", Record<StatusLabel, string>> = {
  es: {
    approving: "Espera que apruebes una acción",
    asked: "Te preguntó algo",
    working: "Está trabajando",
    failed: "Fallo o interrupción",
    unseen: "Terminó y no la has abierto",
    delivered: "Resultado entregado",
  },
  en: {
    approving: "Waiting for you to approve an action",
    asked: "Asked you something",
    working: "Working",
    failed: "Failure or interruption",
    unseen: "Finished and not opened yet",
    delivered: "Result delivered",
  },
};
