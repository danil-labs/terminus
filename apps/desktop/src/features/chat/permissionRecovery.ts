/** Solo corre cuando responder a un permiso falla: fuera de la carga inicial. */
import type { PermissionRequest } from "./Chat";
import { mensajeDeFallo } from "./failures";

type Pendiente = { id: string; request_id: string; closed?: unknown };
type Pendientes = { permissions: Pendiente[]; records?: { permissions: Pendiente[] } };

/** La fila de fallo si la petición ya no espera; `null` si sigue viva y se puede reintentar. */
export function sinRespuesta(p: PermissionRequest, pendientes: Pendientes | null, error: unknown) {
  if (!pendientes || pendientes.permissions.some((x) => x.id === p.durableId || x.request_id === p.requestId)) return null;
  const record = pendientes.records?.permissions.find((x) => (p.durableId ? x.id === p.durableId : x.request_id === p.requestId));
  return {
    role: "system" as const,
    ...mensajeDeFallo({
      what: { clave: record?.closed === "owner_lost" ? "cli.error.pending_owner_lost" : "shell.turn.permission_no_reply" },
      detail: { error, record: record ?? null },
    }),
    meta: "fallo",
  };
}
