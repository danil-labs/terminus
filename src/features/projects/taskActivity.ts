export type TaskActivity = {
  aprobando: boolean; esperando: boolean; viva: boolean;
  outcome?: "delivered" | "failed" | null;
  /** Un turno cerró después de la última vez que se abrió (`workspace/attention.rs`). */
  sinVer?: boolean;
};
export function taskPriority(s: TaskActivity) {
  if (s.aprobando) return "approving";
  if (s.esperando) return "asked";
  if (s.viva) return "working";
  if (s.outcome === "failed") return "failed";
  if (s.sinVer) return "unseen";
  return null;
}
