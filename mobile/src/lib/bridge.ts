import type { BridgeEvent, EngineError, TaskPage, TaskRecord } from "@terminus/protocol";
import * as SecureStore from "expo-secure-store";

export type * from "@terminus/protocol";

/** Where the phone reaches the host and the token the bridge printed. */
export type Pairing = { url: string; token: string };

export class BridgeError extends Error {
  constructor(public code: string, public detail?: string | null) {
    super(detail ? `${code}: ${detail}` : code);
  }
}

const KEY = "terminus.pairing";

export async function loadPairing(): Promise<Pairing | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  return raw ? (JSON.parse(raw) as Pairing) : null;
}
export async function savePairing(pairing: Pairing | null) {
  if (pairing) await SecureStore.setItemAsync(KEY, JSON.stringify(pairing));
  else await SecureStore.deleteItemAsync(KEY);
}

async function request<T>(pairing: Pairing, path: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<T> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const response = await fetch(`${pairing.url.replace(/\/$/, "")}${path}`, {
      ...init,
      signal: abort.signal,
      headers: { authorization: `Bearer ${pairing.token}`, "content-type": "application/json" },
    });
    const body = (await response.json()) as T & { error?: EngineError | null };
    if (!response.ok) throw new BridgeError(body.error?.code ?? `http_${response.status}`, body.error?.detail);
    return body;
  } catch (error) {
    if (error instanceof BridgeError) throw error;
    throw new BridgeError("unreachable", error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
  }
}

export function status(pairing: Pairing) {
  return request<{ bridge: number; engine: { version: string; runtime: string } }>(pairing, "/v1/status", {}, 8_000);
}

type Scope = { workspace?: string; folder?: string };

/** One engine command through the bridge's allowlist; RPC1 errors become a `BridgeError`. */
export async function call<T>(pairing: Pairing, command: string, args: object = {}, scope: Scope = {}): Promise<T> {
  const body = await request<{ result: unknown; error: EngineError | null }>(pairing, "/v1/call", {
    method: "POST",
    body: JSON.stringify({ command, args, workspace: scope.workspace ?? null, folder: scope.folder ?? null }),
  });
  if (body.error) throw new BridgeError(body.error.code, body.error.detail);
  const result = body.result as { value?: unknown } | null;
  // `service invoke` wraps the command's answer in `value`.
  return (result && typeof result === "object" && "value" in result ? result.value : result) as T;
}

export function events(pairing: Pairing, after: number) {
  return request<{ events: BridgeEvent[]; after: number }>(pairing, `/v1/events?after=${after}`, {}, 35_000);
}

/** Reads the whole conversation page by page. */
export async function readAll(pairing: Pairing, scope: Required<Scope>, task: string, from = 0) {
  const records: TaskRecord[] = [];
  let cursor = from;
  for (let i = 0; i < 50; i++) {
    const page = await call<TaskPage>(pairing, "task read", { task, cursor: String(cursor), limit: "200" }, scope);
    records.push(...page.records);
    if (page.next_cursor <= cursor || page.next_cursor >= page.latest_cursor) return { records, cursor: page.next_cursor };
    cursor = page.next_cursor;
  }
  return { records, cursor };
}
