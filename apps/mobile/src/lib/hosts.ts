/**
 * Una máquina a la que el teléfono le habla: una computadora de Danil Computers
 * (por el relay) o un Terminus de la red local (por el bridge de desarrollo).
 * Las dos hablan el mismo idioma, los comandos de `APP_COMMANDS`, y las dos se
 * niegan a mandar otro. Sin React Native: se prueba en Node.
 */
import {
  type Computer,
  type EventsPage,
  type Power,
  RelaySession,
  type RelayConfig,
  type SocketFactory,
  CALL_TIMEOUT,
  INTENT_COMMANDS,
  WAKE_TIMEOUT,
  cachedAt,
  canAct,
  isManaged,
  powerOf,
  requestId,
} from "@terminus/computers";
import { type AppCommand, type EngineError, type EngineEvent, APP_ACTIONS, isAppCommand } from "@terminus/protocol";

export class HostError extends Error {
  code: string;
  detail?: unknown;

  constructor(code: string, detail?: unknown) {
    super(detail && typeof detail === "string" ? `${code}: ${detail}` : code);
    this.code = code;
    this.detail = detail;
  }
}

export type CallAnswer<T> = { value: T; /** Copia del relay con la máquina apagada: cuándo se guardó, en ms. */ cachedAt: number | null };

export type Host = {
  /** `computer_id`, o `bridge` para el Terminus de la red. */
  readonly id: string;
  readonly label: string;
  readonly kind: "computer" | "bridge";
  /** La VM que Danil administra: una acción la enciende. */
  readonly managed: boolean;
  power(): Power;
  /** Si una acción se puede mandar ya, enciende la máquina, no tiene cómo o su motor está desactualizado. */
  canAct(): "now" | "wakes" | "asleep" | "outdated";
  onChange(listener: () => void): () => void;
  /** Eventos del motor; `gap` dice que se perdieron algunos y hay que releer. */
  onEvents(listener: (events: EngineEvent[], gap: boolean) => void): () => void;
  call<T>(command: AppCommand, workspace: string | null, args?: object): Promise<CallAnswer<T>>;
  close(): void;
};

function allowed(command: string) {
  if (!isAppCommand(command)) throw new HostError("command_not_allowed", command);
}

/** Una computadora a través del relay. Abrirla no la enciende: solo una acción lo hace. */
export function relayHost(computer: Computer, config: Omit<RelayConfig, "computerId">, factory?: SocketFactory): Host {
  const relay = new RelaySession({ ...config, computerId: computer.computer_id }, factory);
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const listener of listeners) listener();
  };
  relay.onState(changed);
  relay.onLink(changed);
  // Hasta que el relay diga su estado, vale el de la fila de `/v1/computers`.
  const state = () => (relay.state() === "unknown" ? computer.state : relay.state());
  const host: Host = {
    id: computer.computer_id,
    label: computer.name?.trim() || computer.computer_id,
    kind: "computer",
    managed: isManaged(computer),
    power: () => powerOf(state()),
    canAct: () => canAct(computer, state()),
    onChange(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    onEvents(listener) {
      return relay.onEvents((page: EventsPage) => listener(page.events ?? [], page.gap === true));
    },
    async call<T>(command: AppCommand, workspace: string | null, args: object = {}) {
      allowed(command);
      const intent = INTENT_COMMANDS.has(command);
      // Una máquina propia apagada no se puede despertar: ni se intenta, el relay contestaría `start_failed`.
      if (intent && host.canAct() === "asleep") throw new HostError("machine_asleep", host.label);
      // Un motor que no habla este contrato no recibe acciones, como en la web.
      if ((APP_ACTIONS as readonly string[]).includes(command) && host.canAct() === "outdated") throw new HostError("machine_outdated", host.label);
      try {
        const { value, cached } = await relay.call(requestId(), command, workspace, null, args, intent ? WAKE_TIMEOUT : CALL_TIMEOUT);
        return { value: value as T, cachedAt: cachedAt(cached) };
      } catch (error) {
        if (error instanceof HostError) throw error;
        const failure = (error ?? {}) as { code?: string; detail?: unknown; what?: unknown };
        throw new HostError(failure.code ?? "io", failure.detail ?? failure.what);
      }
    },
    close: () => relay.close(),
  };
  relay.start();
  relay.subscribe(null);
  return host;
}

/** Dirección y token que imprime el bridge de desarrollo. */
export type Pairing = { url: string; token: string };

type Fetch = typeof fetch;

async function bridgeRequest<T>(pairing: Pairing, path: string, init: { method?: string; body?: string } = {}, timeoutMs = 30_000, f: Fetch = fetch): Promise<T> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const response = await f(`${pairing.url.replace(/\/$/, "")}${path}`, {
      ...init,
      signal: abort.signal,
      headers: { authorization: `Bearer ${pairing.token}`, "content-type": "application/json" },
    });
    const body = (await response.json()) as T & { error?: EngineError | null };
    if (!response.ok) throw new HostError(body.error?.code ?? `http_${response.status}`, body.error?.detail);
    return body;
  } catch (error) {
    if (error instanceof HostError) throw error;
    throw new HostError("unreachable", error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
  }
}

export function bridgeStatus(pairing: Pairing) {
  return bridgeRequest<{ bridge: number; engine: { version: string; runtime: string } }>(pairing, "/v1/status", {}, 8_000);
}

/** El Terminus de la red local por el bridge. Siempre está encendido o no se alcanza. */
export function bridgeHost(pairing: Pairing, label: string): Host {
  const changeListeners = new Set<() => void>();
  const eventListeners = new Set<(events: EngineEvent[], gap: boolean) => void>();
  let online = false;
  let stopped = false;
  const setOnline = (next: boolean) => {
    if (online === next) return;
    online = next;
    for (const listener of changeListeners) listener();
  };
  void (async () => {
    let after = -1;
    while (!stopped) {
      try {
        const page = await bridgeRequest<{ events: (EngineEvent & { seq: number })[]; after: number }>(pairing, `/v1/events?after=${after}`, {}, 35_000);
        const gap = after < 0 || page.events.some((e) => e.name === "resync");
        after = page.after;
        setOnline(true);
        const events = page.events.filter((e) => e.name !== "resync");
        if (events.length || gap) for (const listener of eventListeners) listener(events, gap);
      } catch {
        setOnline(false);
        after = -1;
        await new Promise((r) => setTimeout(r, 3_000));
      }
    }
  })();
  return {
    id: "bridge",
    label,
    kind: "bridge",
    managed: false,
    power: () => (online ? "on" : "off"),
    canAct: () => (online ? "now" : "asleep"),
    onChange(listener) {
      changeListeners.add(listener);
      return () => void changeListeners.delete(listener);
    },
    onEvents(listener) {
      eventListeners.add(listener);
      return () => void eventListeners.delete(listener);
    },
    async call<T>(command: AppCommand, workspace: string | null, args: object = {}) {
      allowed(command);
      const body = await bridgeRequest<{ result: unknown; error: EngineError | null }>(pairing, "/v1/call", {
        method: "POST",
        body: JSON.stringify({ command, args, workspace }),
      });
      if (body.error) throw new HostError(body.error.code, body.error.detail);
      const result = body.result as { value?: unknown } | null;
      // `service invoke` envuelve la respuesta del comando en `value`.
      const value = (result && typeof result === "object" && "value" in result ? result.value : result) as T;
      return { value, cachedAt: null };
    },
    close: () => {
      stopped = true;
    },
  };
}
