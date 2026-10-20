/**
 * The device flow on the control plane: what a code is asking for, and approving it.
 * A `workspace` code links one workspace of a registered computer to the approver; it creates no computer.
 */
import { apiUrl } from "../computers.ts";

export type DeviceRequest = {
  kind: "computer" | "workspace";
  hostname: string;
  platform: string;
  name: string | null;
  expires_at: string | number | null;
  /** `workspace` codes: what is being linked and on which computer. */
  workspace_name?: string | null;
  computer_name?: string | null;
};

export type DeviceAnswer<T> =
  | { kind: "ok"; value: T }
  | { kind: "unauthorized" }
  | { kind: "license" }
  | { kind: "no_account" }
  | { kind: "expired" }
  | { kind: "invalid" }
  | { kind: "used" }
  | { kind: "ambiguous" }
  | { kind: "error"; status: number | null };

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const EXPIRED = /expired/i;

async function send<T>(url: string, token: string, init: RequestInit, read: (body: unknown) => T | undefined, f: Fetch): Promise<DeviceAnswer<T>> {
  let response: Response;
  try {
    response = await f(url, { ...init, headers: { ...init.headers, authorization: `Bearer ${token}` } });
  } catch {
    return { kind: "error", status: null };
  }
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  const error = typeof body?.error === "string" ? body.error : "";
  if (response.status === 401) return { kind: "unauthorized" };
  if (response.status === 403) return { kind: error === "unknown_user" ? "no_account" : "license" };
  if (response.status === 409) return { kind: error === "ambiguous_danil_account" ? "ambiguous" : "used" };
  if (response.status === 410 || EXPIRED.test(error)) return { kind: "expired" };
  if (response.status === 404 || response.status === 400) return { kind: "invalid" };
  if (!response.ok) return { kind: "error", status: response.status };
  const value = read(body);
  return value === undefined ? { kind: "error", status: response.status } : { kind: "ok", value };
}

/** The code as the person typed or the link carried it: `abcd-efgh` → `ABCD-EFGH`. */
export const normalizeCode = (code: string | null | undefined): string => (code ?? "").trim().toUpperCase().replace(/\s+/g, "");

export function lookupDevice(endpoint: string, token: string, code: string, f: Fetch = fetch): Promise<DeviceAnswer<DeviceRequest>> {
  const url = `${apiUrl(endpoint, "/v1/devices/lookup")}?user_code=${encodeURIComponent(code)}`;
  return send(url, token, { method: "GET" }, (body) => {
    const b = body as Record<string, unknown> | null;
    const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
    const expires_at = typeof b?.expires_at === "string" || typeof b?.expires_at === "number" ? b.expires_at : null;
    if (b?.kind === "workspace") {
      const computer = text(b.computer_name) ?? text(b.name) ?? text(b.hostname);
      if (!text(b.workspace_name) && !computer) return undefined;
      return {
        kind: "workspace",
        hostname: text(b.hostname) ?? computer ?? "",
        platform: text(b.platform) ?? "",
        name: text(b.name),
        expires_at,
        workspace_name: text(b.workspace_name),
        computer_name: computer,
      };
    }
    if (typeof b?.hostname !== "string") return undefined;
    return {
      kind: "computer",
      hostname: b.hostname,
      platform: typeof b.platform === "string" ? b.platform : "",
      name: typeof b.name === "string" ? b.name : null,
      expires_at,
    };
  }, f);
}

/** `name` is the computer's; a workspace code is approved without one. */
export function approveDevice(endpoint: string, token: string, code: string, name: string | null, f: Fetch = fetch): Promise<DeviceAnswer<null>> {
  return send(apiUrl(endpoint, "/v1/devices/approve"), token, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(name === null ? { user_code: code } : { user_code: code, name }),
  }, () => null, f);
}

/** The engine's next poll answers `access_denied`. */
export function denyDevice(endpoint: string, token: string, code: string, f: Fetch = fetch): Promise<DeviceAnswer<null>> {
  return send(apiUrl(endpoint, "/v1/devices/deny"), token, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ user_code: code }),
  }, () => null, f);
}
