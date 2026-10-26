/** Chips de la línea 2: metadatos de la tarea, sin vista previa del mensaje. */
import { agentMarkId } from "@terminus/design";
import type { CardPull, TaskCard } from "@terminus/tasks";

export type LineChip = "provider" | "folder" | "machine" | "agent" | "pull";

export function secondLine(card: TaskCard, pull: CardPull | null, compact: boolean): LineChip[] {
  if (compact) return [];
  const chips: (LineChip | false)[] = [
    // Un proveedor sin marca conocida no deja un hueco.
    !!agentMarkId(card.provider) && "provider",
    !!card.folder && "folder",
    !!card.machine && "machine",
    !!card.agent && "agent",
    !!pull && "pull",
  ];
  return chips.filter((c): c is LineChip => !!c);
}
