/**
 * The browser side of the Danil Computers session socket (protocol v1,
 * "Navegador/escritorio ↔ relay"): call/result, subscribe/events, state and
 * ping/pong over one WebSocket that reconnects with a fresh token.
 */

export type RelayConfig = {
  /** Relay origin: `relay.example`, `https://relay.example` or `wss://relay.example`. */
  endpoint: string;
  computerId: string;
  /** The person's session token; asked again on every connection. */
  getToken: () => string | Promise<string>;
  /** Called when the relay revokes the session (4003), so the host can sign in again. */
  onUnauthorized?: () => void;
  /** Before each reconnection: a failed upgrade has no body, so the host asks the API why. False stops. */
  beforeReconnect?: () => Promise<boolean>;
};

/** `version_mismatch`: the relay may say the engine's contract is not the web's. */
export type MachineState = "unknown" | "starting" | "online" | "offline" | "stopped" | "provisioning" | "version_mismatch" | "outdated";

export type RelayFailure = { code?: string; message_key?: string; detail?: unknown; what?: unknown };

/** A read the relay answered from its own copy while the computer is off. */
export type Cached = { updated_at: string | number };
export type CallResult = { value: unknown; cached: Cached | null };

export type EventsPage = {
  cursor: number | null;
  gap?: boolean;
  replay?: boolean;
  runtime?: string;
  events?: { name: string; payload: unknown }[];
};

type SocketLike = {
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
const CALL_TIMEOUT = 180_000;
const REPLACED = 4001;
const REVOKED = 4003;

export function sessionUrl(endpoint: string, computerId: string): string {
  const base = /^[a-z]+:\/\//i.test(endpoint) ? endpoint : `wss://${endpoint}`;
  const url = new URL(base.replace(/^http/i, "ws"));
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/v1/computers/${encodeURIComponent(computerId)}/session`;
  return url.toString();
}

type Pending = {
  message: string;
  resolve: (result: CallResult) => void;
  reject: (error: RelayFailure) => void;
  timer: ReturnType<typeof setTimeout>;
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

  constructor(
    private readonly config: RelayConfig,
    private readonly factory: SocketFactory = (url, protocols) => new WebSocket(url, protocols) as unknown as SocketLike,
  ) {}

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
    return () => this.stateListeners.delete(listener);
  }

  onEvents(listener: (page: EventsPage) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onLink(listener: (open: boolean) => void): () => void {
    this.linkListeners.add(listener);
    return () => this.linkListeners.delete(listener);
  }

  /** Resolves with `value` (and `cached` when the relay answered from its copy) or rejects with `error`. Resent with the same id after a reconnection. */
  call(id: string, command: string, workspace: string | null, folder: string | null, args: unknown): Promise<CallResult> {
    const message = JSON.stringify({ type: "call", id, command, workspace, folder, args: args ?? {} });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject({ code: "io", detail: "timeout" });
      }, CALL_TIMEOUT);
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
    // Browsers cannot set Authorization on a WebSocket; the relay rejects tokens in the query.
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
      // Another session took this computer's place: reconnecting would push it out in turn.
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
