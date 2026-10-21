/**
 * El cliente del socket de sesión de Danil Computers (protocolo v1,
 * «Navegador/escritorio ↔ relay»): call/result, subscribe/events, state y
 * ping/pong sobre un WebSocket que se reconecta con un token fresco.
 *
 * Sin APIs del DOM: el WebSocket se inyecta (el global de React Native o del
 * navegador sirve tal cual). Portado de `apps/desktop/src/web/relay.ts`.
 */
import type { MachineState } from "./machine.ts";

export type RelayConfig = {
  /** Origen del relay: `relay.example`, `https://relay.example` o `wss://relay.example`. */
  endpoint: string;
  computerId: string;
  /** El token de la sesión de la persona; se pide en cada conexión. */
  getToken: () => string | Promise<string>;
  /** El relay revocó la sesión (4003): el cliente vuelve a iniciar sesión. */
  onUnauthorized?: () => void;
  /** Antes de cada reconexión: un upgrade fallido no trae cuerpo, así que el cliente pregunta a la API por qué. False para. */
  beforeReconnect?: () => Promise<boolean>;
};

export type RelayFailure = { code?: string; message_key?: string; detail?: unknown; what?: unknown };

/** Una lectura que el relay contestó desde su copia con la computadora apagada. */
export type Cached = { updated_at: string | number };
export type CallResult = { value: unknown; cached: Cached | null };

export type EventsPage = {
  cursor: number | null;
  gap?: boolean;
  replay?: boolean;
  runtime?: string;
  events?: { name: string; payload: unknown }[];
};

export type SocketLike = {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
};

export type SocketFactory = (url: string, protocols?: string[]) => SocketLike;

export const SUBPROTOCOL = "danil.computers.v1";
const OPEN = 1;
const BACKOFF = [500, 1000, 2000, 5000, 10000];
const PING_EVERY = 20_000;
const MISSED_PINGS = 3;
/** Una lectura o una acción con la máquina encendida. */
export const CALL_TIMEOUT = 180_000;
/** Una acción que enciende la VM: el relay espera el `hello` hasta 5 min (`start_timeout`). */
export const WAKE_TIMEOUT = 330_000;
const REPLACED = 4001;
const REVOKED = 4003;

export function sessionUrl(endpoint: string, computerId: string): string {
  const base = /^[a-z]+:\/\//i.test(endpoint) ? endpoint : `wss://${endpoint}`;
  const url = new URL(base.replace(/^http/i, "ws"));
  // `origin` de whatwg-url no da `ws:`/`wss:` en todos los entornos: se arma a mano.
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}/v1/computers/${encodeURIComponent(computerId)}/session`;
}

/** Un UUID v4 para el `id` de un `call`: reintentar con el mismo no repite la acción. */
export function requestId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string; getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  if (typeof c?.getRandomValues === "function") c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

type Pending = {
  message: string;
  resolve: (result: CallResult) => void;
  reject: (error: RelayFailure) => void;
  timer: ReturnType<typeof setTimeout>;
};

const defaultFactory: SocketFactory = (url, protocols) => {
  const Socket = (globalThis as unknown as { WebSocket?: new (url: string, protocols?: string[]) => SocketLike }).WebSocket;
  if (!Socket) throw new Error("WebSocket is not available: pass a SocketFactory");
  return new Socket(url, protocols);
};

export class RelaySession {
  private socket: SocketLike | null = null;
  private pending = new Map<string, Pending>();
  private subscribed = false;
  private after: number | null = null;
  private attempt = 0;
  private missed = 0;
  private pinger: ReturnType<typeof setInterval> | undefined;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  private machine: MachineState = "unknown";
  private stateListeners = new Set<(state: MachineState) => void>();
  private eventListeners = new Set<(page: EventsPage) => void>();
  private linkListeners = new Set<(open: boolean) => void>();

  private readonly config: RelayConfig;
  private readonly factory: SocketFactory;

  constructor(config: RelayConfig, factory: SocketFactory = defaultFactory) {
    this.config = config;
    this.factory = factory;
  }

  start() {
    void this.connect();
  }

  state(): MachineState {
    return this.machine;
  }

  connected(): boolean {
    return this.socket?.readyState === OPEN;
  }

  onState(listener: (state: MachineState) => void): () => void {
    this.stateListeners.add(listener);
    return () => void this.stateListeners.delete(listener);
  }

  onEvents(listener: (page: EventsPage) => void): () => void {
    this.eventListeners.add(listener);
    return () => void this.eventListeners.delete(listener);
  }

  onLink(listener: (open: boolean) => void): () => void {
    this.linkListeners.add(listener);
    return () => void this.linkListeners.delete(listener);
  }

  /**
   * Resuelve con `value` (y `cached` si el relay contestó desde su copia) o
   * rechaza con `error`. Se reenvía con el mismo id tras una reconexión.
   */
  call(id: string, command: string, workspace: string | null, folder: string | null, args: unknown, timeoutMs = CALL_TIMEOUT): Promise<CallResult> {
    const message = JSON.stringify({ type: "call", id, command, workspace, folder, args: args ?? {} });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject({ code: "io", detail: "timeout" });
      }, timeoutMs);
      this.pending.set(id, { message, resolve, reject, timer });
      if (this.connected()) this.socket?.send(message);
    });
  }

  subscribe(after: number | null) {
    this.subscribed = true;
    this.after = after;
    if (this.connected()) this.send({ type: "subscribe", after });
  }

  close() {
    this.closed = true;
    clearTimeout(this.retry);
    clearInterval(this.pinger);
    this.socket?.close(1000);
    for (const [id, call] of this.pending) {
      clearTimeout(call.timer);
      call.reject({ code: "app_unavailable" });
      this.pending.delete(id);
    }
  }

  private send(message: object) {
    this.socket?.send(JSON.stringify(message));
  }

  private async connect() {
    if (this.closed) return;
    if (this.attempt > 0 && this.config.beforeReconnect) {
      const go = await this.config.beforeReconnect().catch(() => true);
      if (!go) return this.close();
      if (this.closed) return;
    }
    let token: string;
    try {
      token = await this.config.getToken();
    } catch {
      return this.reconnectLater();
    }
    if (this.closed) return;
    // Un WebSocket de navegador no puede poner Authorization; el relay rechaza el token en la query.
    const protocols = [SUBPROTOCOL, `bearer.${token}`];
    let socket: SocketLike;
    try {
      socket = this.factory(sessionUrl(this.config.endpoint, this.config.computerId), protocols);
    } catch {
      return this.reconnectLater();
    }
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.attempt = 0;
      this.missed = 0;
      clearInterval(this.pinger);
      this.pinger = setInterval(() => this.ping(), PING_EVERY);
      if (this.subscribed) this.send({ type: "subscribe", after: this.after });
      for (const call of this.pending.values()) socket.send(call.message);
      for (const listener of this.linkListeners) listener(true);
    };
    socket.onmessage = (event) => {
      if (this.socket === socket) this.receive(event.data);
    };
    socket.onerror = () => {};
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      clearInterval(this.pinger);
      for (const listener of this.linkListeners) listener(false);
      if (event.code === REVOKED) this.config.onUnauthorized?.();
      // Otra sesión ocupó el lugar de esta computadora: reconectar la echaría a su vez.
      if (event.code === REPLACED) return this.close();
      this.reconnectLater();
    };
  }

  private reconnectLater() {
    if (this.closed) return;
    const wait = BACKOFF[Math.min(this.attempt, BACKOFF.length - 1)];
    this.attempt += 1;
    clearTimeout(this.retry);
    this.retry = setTimeout(() => void this.connect(), wait);
  }

  private ping() {
    if (this.missed >= MISSED_PINGS) {
      const socket = this.socket;
      this.socket = null;
      clearInterval(this.pinger);
      socket?.close(4000, "ping");
      for (const listener of this.linkListeners) listener(false);
      return this.reconnectLater();
    }
    this.missed += 1;
    this.send({ type: "ping", t: Date.now() });
  }

  private receive(data: unknown) {
    this.missed = 0;
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(String(data));
    } catch {
      return;
    }
    switch (message.type) {
      case "result": {
        const id = String(message.id);
        const call = this.pending.get(id);
        if (!call) return;
        this.pending.delete(id);
        clearTimeout(call.timer);
        if (message.error !== undefined && message.error !== null) call.reject(message.error as RelayFailure);
        else {
          const cached = message.cached as Cached | undefined;
          call.resolve({ value: message.value ?? null, cached: cached && typeof cached === "object" ? cached : null });
        }
        return;
      }
      case "events": {
        const page = message as unknown as EventsPage;
        if (typeof page.cursor === "number") this.after = page.cursor;
        for (const listener of this.eventListeners) listener(page);
        return;
      }
      case "state": {
        this.machine = String(message.state) as MachineState;
        for (const listener of this.stateListeners) listener(this.machine);
        return;
      }
      case "ping":
        this.send({ type: "pong", t: message.t });
        return;
    }
  }
}

/** `cached.updated_at` en ms de época, o null si no se entiende. */
export function cachedAt(cached: Cached | null): number | null {
  if (!cached) return null;
  const at = typeof cached.updated_at === "number" ? cached.updated_at : Date.parse(cached.updated_at);
  if (!Number.isFinite(at)) return null;
  return at < 1e12 ? at * 1000 : at;
}
