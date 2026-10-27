import type { AccountWorkspace } from "./api.ts";

export type SpaceOrderSource = {
  read(workspace: string): Promise<string[] | null>;
  save(workspace: string, ids: readonly string[]): Promise<string[]>;
};

/** Un solo orden de la cuenta; los spaces creados después se agregan al final. */
export function spaceOrder(workspace: AccountWorkspace): string[] {
  const spaces = [...(workspace.spaces ?? [])].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  let saved: unknown;
  try { saved = JSON.parse(workspace.settings?.space_order ?? "null"); } catch { saved = null; }
  const remaining = new Set(spaces.map(space => space.id));
  const ordered: string[] = [];
  if (Array.isArray(saved)) for (const id of saved) {
    if (typeof id === "string" && remaining.delete(id)) ordered.push(id);
  }
  return [...ordered, ...remaining];
}

export function arrangeSpaces<T extends { id: string }>(items: readonly T[], ids: readonly string[]): T[] {
  const remaining = new Map(items.map(item => [item.id, item]));
  const ordered: T[] = [];
  for (const id of ids) {
    const item = remaining.get(id);
    if (item) { ordered.push(item); remaining.delete(id); }
  }
  return [...ordered, ...remaining.values()];
}

