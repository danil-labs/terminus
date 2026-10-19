/**
 * The control plane's HTTP side: the person's computers and their power. It
 * also explains what a failed WebSocket upgrade cannot say (no license, not
 * your computer).
 */

export type Computer = {
  computer_id: string;
  name?: string | null;
  plan?: string | null;
  state: string;
  last_seen?: string | null;
};

export type Answer<T> =
  | { kind: "ok"; value: T }
  | { kind: "unauthorized" }
  | { kind: "license" }
  | { kind: "missing" }
  | { kind: "error"; status: number | null };

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export function apiUrl(endpoint: string, path: string): string {
  const base = /^[a-z]+:\/\//i.test(endpoint) ? endpoint : `https://${endpoint}`;
  const url = new URL(base.replace(/^ws/i, "http"));
  url.pathname = `${url.pathname.replace(/\/+$/, "")}${path}`;
  return url.toString();
}

async function request<T>(url: string, token: string, method: string, read: (body: unknown) => T, f: Fetch): Promise<Answer<T>> {
  let response: Response;
  try {
    response = await f(url, { method, headers: { authorization: `Bearer ${token}` } });
  } catch {
    return { kind: "error", status: null };
  }
  if (response.status === 401) return { kind: "unauthorized" };
  if (response.status === 403) return { kind: "license" };
  if (response.status === 404) return { kind: "missing" };
  if (!response.ok) return { kind: "error", status: response.status };
  const body = await response.json().catch(() => null);
  return { kind: "ok", value: read(body) };
}

export function listComputers(endpoint: string, token: string, f: Fetch = fetch): Promise<Answer<Computer[]>> {
  return request(apiUrl(endpoint, "/v1/computers"), token, "GET", (body) => {
    const list = Array.isArray(body) ? body : (body as { computers?: unknown } | null)?.computers;
    return Array.isArray(list) ? (list.filter((c) => typeof c?.computer_id === "string") as Computer[]) : [];
  }, f);
}

export function startComputer(endpoint: string, token: string, id: string, f: Fetch = fetch): Promise<Answer<null>> {
  return request(apiUrl(endpoint, `/v1/computers/${encodeURIComponent(id)}/start`), token, "POST", () => null, f);
}
