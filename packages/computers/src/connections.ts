/**
 * Las conexiones de orquestadores externos de la persona (Hermes, OpenClaw,
 * ChatGPT…) que usan Danil por el MCP remoto de Danil Computers. Una conexión
 * nace `pending` cuando el orquestador llama por primera vez y no hace nada
 * hasta que la persona le da máquinas, workspace y modo de permisos.
 */
import { type Answer, apiUrl, type Fetch, globalFetch, request } from "./api.ts";

export type ConnectionState = "pending" | "active" | "paused" | "revoked";

export type ConnectionMachine = { computer_id: string; workspace: string; folder: string; root: string | null };

export type Connection = {
  id: string;
  client_id: string;
  client_name: string;
  state: ConnectionState;
  permission_mode: string | null;
  machines: ConnectionMachine[];
  limits: { tasks_per_day: number; concurrent_calls: number };
  created_at: number;
  updated_at: number;
  last_used_at: number | null;
  usage: { day: string; tasks_created: number };
};

export type AuditEntry = {
  at: number;
  connection: string;
  tool: string;
  computer_id: string | null;
  request_id: string | null;
  outcome: "ok" | "error";
  code: string | null;
};

export type ConnectionPatch = {
  state?: "active" | "paused";
  permission_mode?: string | null;
  machines?: Array<{ computer_id: string; workspace: string; folder?: string }>;
  limits?: Partial<Connection["limits"]>;
  client_name?: string;
};

/** Los modos del motor, del más estricto al más permisivo; el de la conexión es su techo. */
export const PERMISSION_MODES = ["lectura", "manual", "ediciones", "auto"] as const;

/** La URL que se pega en el orquestador. */
export function mcpUrl(endpoint: string): string {
  return apiUrl(endpoint, "/mcp");
}

const rows = (body: unknown): Connection[] =>
  Array.isArray(body) ? (body.filter((c) => typeof c?.id === "string" && typeof c?.state === "string") as Connection[]) : [];

export function listConnections(endpoint: string, token: string, f: Fetch = globalFetch): Promise<Answer<Connection[]>> {
  return request(apiUrl(endpoint, "/v1/connections"), token, "GET", rows, f);
}

export function updateConnection(
  endpoint: string,
  token: string,
  id: string,
  patch: ConnectionPatch,
  f: Fetch = globalFetch,
): Promise<Answer<Connection | null>> {
  return request(
    apiUrl(endpoint, `/v1/connections/${encodeURIComponent(id)}`),
    token,
    "PATCH",
    (body) => (body && typeof (body as Connection).id === "string" ? (body as Connection) : null),
    f,
    patch,
  );
}

export function revokeConnection(endpoint: string, token: string, id: string, f: Fetch = globalFetch): Promise<Answer<null>> {
  return request(apiUrl(endpoint, `/v1/connections/${encodeURIComponent(id)}`), token, "DELETE", () => null, f);
}

export function connectionAudit(endpoint: string, token: string, id: string, f: Fetch = globalFetch): Promise<Answer<AuditEntry[]>> {
  return request(
    apiUrl(endpoint, `/v1/connections/${encodeURIComponent(id)}/audit`),
    token,
    "GET",
    (body) => (Array.isArray(body) ? (body as AuditEntry[]) : []),
    f,
  );
}
