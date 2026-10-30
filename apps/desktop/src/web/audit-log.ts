/**
 * The change log of the person's active Danil account, read in the browser with
 * their session: `POST /rest/v1/rpc/audit_log_list` (danil-workspace
 * `docs/architecture/audit-log.md`). The database checks `audit.read` and only
 * answers for the account the JWT has active (`active_account_id`).
 */

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export type AuditActorType = "user" | "member" | "ai" | "danil_support" | "system";

export type AuditEntry = {
  id: number;
  created_at: string;
  event_type: string;
  entity_type: string | null;
  action: "insert" | "update" | "delete" | null;
  changed_fields: string[];
  actor_type: AuditActorType;
  actor_name: string | null;
  actor_email: string | null;
  on_behalf_of_name: string | null;
  on_behalf_of_email: string | null;
  support_grant_id: number | null;
};

export type AuditPage =
  | { kind: "ok"; entries: AuditEntry[]; more: boolean }
  | { kind: "no_account" }
  | { kind: "forbidden" }
  | { kind: "unavailable" };

export type AuditLogSource = {
  /** Newest first; `before`, the smallest id already shown. */
  list(before?: number | null): Promise<AuditPage>;
};

export const AUDIT_PAGE = 50;

const ACTORS: AuditActorType[] = ["user", "member", "ai", "danil_support", "system"];
const ACTIONS = ["insert", "update", "delete"];

const text = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v : null);
const int = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) ? v : null);

/** `active_account_id` of the session's JWT; `null` if it has none. */
export function activeAccountOf(token: string): number | null {
  try {
    const part = token.split(".")[1] ?? "";
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "="));
    const id = Number((JSON.parse(json) as { active_account_id?: unknown }).active_account_id);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

export function entryOf(row: unknown): AuditEntry | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const id = int(r.id);
  const actor = ACTORS.find((a) => a === r.actor_type);
  const created = text(r.created_at);
  if (id === null || !actor || !created || !text(r.event_type)) return null;
  return {
    id,
    created_at: created,
    event_type: r.event_type as string,
    entity_type: text(r.entity_type),
    action: ACTIONS.includes(r.action as string) ? (r.action as AuditEntry["action"]) : null,
    changed_fields: Array.isArray(r.changed_fields) ? r.changed_fields.filter((f): f is string => typeof f === "string") : [],
    actor_type: actor,
    actor_name: text(r.actor_name),
    actor_email: text(r.actor_email),
    on_behalf_of_name: text(r.on_behalf_of_name),
    on_behalf_of_email: text(r.on_behalf_of_email),
    support_grant_id: int(r.support_grant_id),
  };
}

export function webAuditLog(
  supabaseUrl: string,
  supabaseKey: string,
  getToken: () => string | Promise<string>,
  onUnauthorized?: () => void,
  f: Fetch = (input, init) => fetch(input, init),
): AuditLogSource {
  const url = `${supabaseUrl.replace(/\/+$/, "")}/rest/v1/rpc/audit_log_list`;
  return {
    async list(before) {
      const token = await getToken();
      const account = activeAccountOf(token);
      if (account === null) return { kind: "no_account" };
      let response: Response;
      try {
        response = await f(url, {
          method: "POST",
          headers: { apikey: supabaseKey, authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ p_account_id: account, p_before_id: before ?? null, p_limit: AUDIT_PAGE }),
        });
      } catch {
        return { kind: "unavailable" };
      }
      if (response.status === 401) onUnauthorized?.();
      const body = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) {
        const code = body && typeof body === "object" ? (body as { code?: unknown }).code : null;
        return code === "42501" || response.status === 403 ? { kind: "forbidden" } : { kind: "unavailable" };
      }
      if (!Array.isArray(body)) return { kind: "unavailable" };
      const entries = body.map(entryOf).filter((e): e is AuditEntry => e !== null);
      return { kind: "ok", entries, more: body.length >= AUDIT_PAGE };
    },
  };
}
