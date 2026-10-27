import type { MachineResources, Startup, WorkspaceStorage } from "@terminus/protocol";
import type { Host } from "./hosts.ts";

/** Una lectura de disco nunca elige otra máquina ni despierta ésta. */
export async function storageSummary(host: Host) {
  if (host.power() !== "on") throw new Error("machine_off");
  const answer = await host.call<Startup>("list_workspaces", null, {});
  return { resources: answer.value?.machine_resources, workspaces: answer.value?.workspaces ?? [], stale: answer.cachedAt !== null };
}

export async function storageDetail(host: Host, workspace: string) {
  if (host.power() !== "on" || (host.linked !== null && !host.linked.has(workspace))) throw new Error("workspace_missing");
  return host.call<WorkspaceStorage>("list_storage", workspace, { refrescar: true });
}

export function diskUsage(disk: MachineResources["storage"][number]) {
  const { total_bytes: total, free_bytes: free, available_bytes: available } = disk;
  if (![total, free, available].every((n) => Number.isFinite(n) && n >= 0) || total <= 0 || free > total || available > free) return null;
  return { used: total - free, percent: (total - free) / total * 100 };
}
