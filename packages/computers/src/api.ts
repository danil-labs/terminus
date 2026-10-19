/**
 * El lado HTTP del plano de control de Danil Computers: las computadoras de la
 * persona y su encendido. También explica lo que un upgrade de WebSocket
 * fallido no puede decir (sin licencia, no es tuya).
 *
 * Sin APIs del DOM: `fetch` se inyecta, así sirve en el navegador, en React
 * Native y en Node.
 */

/** Una fila de `GET /v1/computers` (protocolo v1, «Navegador/escritorio ↔ relay»). */
export type Computer = {
  computer_id: string;
  name?: string | null;
  plan?: string | null;
  /** Adaptador del orquestador (`aws-ec2`) en una VM administrada; vacío en una máquina propia. */
  provider?: string | null;
  /** `online | offline | starting | stopped | provisioning`. */
  state: string;
  last_seen?: string | null;
  host_version?: string | null;
};

export type Answer<T> =
  | { kind: "ok"; value: T }
  | { kind: "unauthorized" }
  | { kind: "license" }
  | { kind: "missing" }
  | { kind: "error"; status: number | null };

/** Lo mínimo de `fetch` que usa el cliente. */
export type Fetch = (input: string, init?: { method?: string; headers?: Record<string, string> }) => Promise<{
  status: number;
  ok: boolean;
  json(): Promise<unknown>;
}>;

/** El origen del plano de control de producción. */
export const COMPUTERS_ENDPOINT = "https://computers.danil.ai";

export function apiUrl(endpoint: string, path: string): string {
  const base = /^[a-z]+:\/\//i.test(endpoint) ? endpoint : `https://${endpoint}`;
  const url = new URL(base.replace(/^ws/i, "http"));
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}${path}`;
}

const globalFetch: Fetch = (input, init) => (globalThis.fetch as unknown as Fetch)(input, init);

async function request<T>(url: string, token: string, method: string, read: (body: unknown) => T, f: Fetch): Promise<Answer<T>> {
  let response: Awaited<ReturnType<Fetch>>;
  try {
    response = await f(url, { method, headers: { authorization: `Bearer ${token}` } });
  } catch {
    return { kind: "error", status: null };
  }
  if (response.status === 401) return { kind: "unauthorized" };
  if (response.status === 403) {
    // `unknown_user` también es 403: la persona no existe en Danil, que para ella es lo mismo que no tener licencia.
    return { kind: "license" };
  }
  if (response.status === 404) return { kind: "missing" };
  if (!response.ok) return { kind: "error", status: response.status };
  const body = await response.json().catch(() => null);
  return { kind: "ok", value: read(body) };
}

export function listComputers(endpoint: string, token: string, f: Fetch = globalFetch): Promise<Answer<Computer[]>> {
  return request(
    apiUrl(endpoint, "/v1/computers"),
    token,
    "GET",
    (body) => {
      const list = Array.isArray(body) ? body : (body as { computers?: unknown } | null)?.computers;
      return Array.isArray(list) ? (list.filter((c) => typeof c?.computer_id === "string") as Computer[]) : [];
    },
    f,
  );
}

/** Encendido explícito. La app no lo usa al abrir: una acción enciende la VM por el relay. */
export function startComputer(endpoint: string, token: string, id: string, f: Fetch = globalFetch): Promise<Answer<{ state: string } | null>> {
  return request(
    apiUrl(endpoint, `/v1/computers/${encodeURIComponent(id)}/start`),
    token,
    "POST",
    (body) => (body && typeof (body as { state?: unknown }).state === "string" ? { state: (body as { state: string }).state } : null),
    f,
  );
}
