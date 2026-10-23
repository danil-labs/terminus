/**
 * Qué chips lleva la línea 2 de la tarjeta del teléfono y en qué orden, como el
 * riel del escritorio (`FilaDelRiel` en `Sessions.tsx`): si te necesita, lo que
 * pide, el PR y el cuadrado de su carpeta; si no, proveedor · carpeta · máquina
 * · cara del agente · PR. En «Compacta» no hay línea 2. Qué trae cada chip lo
 * decide `taskCard` (`@terminus/tasks`); el PR, `cardPull`.
 */
import { agentMarkId } from "@terminus/design";
import type { CardPull, TaskCard } from "@terminus/tasks";

export type LineChip = "request" | "provider" | "folder" | "folder-square" | "machine" | "agent" | "pull";

export function secondLine(card: TaskCard, pull: CardPull | null, compact: boolean): LineChip[] {
  if (compact) return [];
  const chips: (LineChip | false)[] = card.needsYou
    ? ["request", !!pull && "pull", !!card.folder && "folder-square"]
    : [
        // Un proveedor sin marca conocida no deja un hueco.
        !!agentMarkId(card.provider) && "provider",
        !!card.folder && "folder",
        !!card.machine && "machine",
        !!card.agent && "agent",
        !!pull && "pull",
      ];
  return chips.filter((c): c is LineChip => !!c);
}
