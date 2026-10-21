/**
 * Las sesiones de Danil de esta computadora como estado de Solid: las lee, sigue
 * `danil-sessions` y, con `workspace`, la cuenta de ese workspace. La comparten
 * Configuración, la sección del workspace y el pie de la barra lateral.
 * `sessions()` es `undefined` mientras lee y `null` con un motor anterior.
 */
import { createEffect, createSignal, on, onCleanup, onMount } from "solid-js";
import { invoke } from "../../lib/invoke";
import { listen } from "../../lib/serviceEvents";
import { failureCode } from "./danil-account";
import {
  addAccount,
  connectedSessions,
  type DanilSessionInfo,
  pendingSession,
  readSessions,
  readWorkspaceAccount,
  setDefaultAccount,
  signOutAccount,
  type WorkspaceAccount,
} from "./danil-sessions";

/**
 * `workspace`: de cuál leer la cuenta. `"active"` es el abierto, y se relee al
 * cambiar de workspace; sin la opción no se lee ninguna.
 */
export function createDanilAccounts(options: { workspace?: (() => string | null | undefined) | "active" } = {}) {
  const [sessions, setSessions] = createSignal<DanilSessionInfo[] | null | undefined>(undefined);
  const [of, setOf] = createSignal<WorkspaceAccount | null>(null);
  const [busy, setBusy] = createSignal(false);
  /** El código del último fallo; quien pinta lo traduce. */
  const [problem, setProblem] = createSignal<string | null>(null);
  const reading = options.workspace;
  let turn = 0;

  async function readOf() {
    if (!reading || sessions() === null) return;
    const mine = ++turn;
    const workspace = reading === "active" ? undefined : reading();
    if (reading !== "active" && !workspace) return setOf(null);
    const next = await readWorkspaceAccount(workspace);
    if (mine === turn) setOf(next);
  }

  async function reload() {
    setSessions(await readSessions());
    await readOf();
  }

  onMount(() => {
    void reload();
    const changes = listen<DanilSessionInfo[]>("danil-sessions", (e) => {
      if (Array.isArray(e.payload)) setSessions(e.payload);
      void readOf();
    });
    // El primer inicio de sesión llega también por aquí; un motor anterior solo manda este.
    const connect = listen("danil-connect", () => void reload());
    const moved = () => void readOf();
    if (reading === "active") window.addEventListener("harness:workspace", moved);
    onCleanup(() => {
      void changes.then((off) => off());
      void connect.then((off) => off());
      window.removeEventListener("harness:workspace", moved);
    });
  });

  if (reading && reading !== "active") createEffect(on(reading, () => void readOf(), { defer: true }));

  async function run<T>(action: () => Promise<T>, after?: (value: T) => void) {
    setBusy(true);
    setProblem(null);
    try {
      const value = await action();
      after?.(value);
      return value;
    } catch (e) {
      setProblem(failureCode(e) ?? "failed");
      return null;
    } finally {
      setBusy(false);
    }
  }

  return {
    sessions,
    connected: () => connectedSessions(sessions()),
    pending: () => pendingSession(sessions()),
    of,
    setOf,
    busy,
    problem,
    setProblem,
    reload,
    add: () => run(() => addAccount(), () => void reload()),
    makeDefault: (account: string) => run(() => setDefaultAccount(account), (list) => Array.isArray(list) && setSessions(list)),
    signOut: (account: string) => run(() => signOutAccount(account), () => void reload()),
    reopen: () => {
      const url = pendingSession(sessions())?.verification_uri_complete;
      if (url) void invoke("open_external", { target: url }).catch(() => {});
    },
  };
}

export type DanilAccounts = ReturnType<typeof createDanilAccounts>;
