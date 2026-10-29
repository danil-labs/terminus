import { invoke } from "@tauri-apps/api/core";
import { createSignal } from "solid-js";
import { invoke as routedInvoke } from "../../lib/invoke.ts";
import { t } from "../../lib/i18n";

export type LiveTurn = {
  session: string;
  workspace: string;
  project: string;
  started_at: number;
  shell?: { id: string; command: string };
};
type Pending = { questions: unknown[]; permissions: unknown[] };
/** `named` es falso cuando el título es el genérico «Tarea sin título». */
export type ShownTurn = LiveTurn & { title: string; named: boolean; waiting: boolean };
type Call = (cmd: string, args?: Record<string, unknown>, options?: { headers: Record<string, string> }) => Promise<unknown>;

/** Los turnos viven en el workspace que los lanzó, no en el que mira la ventana. */
export const scope = (workspace: string) => ({ headers: { "x-terminus-workspace": workspace } });

export async function stopTurns(turns: LiveTurn[], call: Call = routedInvoke) {
  return await Promise.allSettled(
    turns.map((turn) =>
      turn.shell
        ? call("stop_shell_command", { session: turn.session }, scope(turn.workspace))
        : call("stop_turn", { project: turn.project, session: turn.session }, scope(turn.workspace)),
    ),
  );
}

/** El título de una tarea sale de las filas del sidebar; `CloseGuard` lo conecta al montarse. */
let titleOf: (session: string) => string | undefined = () => undefined;
export function setTurnTitles(resolve: (session: string) => string | undefined) {
  titleOf = resolve;
}

export async function titled(turns: LiveTurn[], call: Call = invoke): Promise<ShownTurn[]> {
  return Promise.all(turns.map(async (turn) => {
    const pending = (await call("pending_requests", { session: turn.session }, scope(turn.workspace)).catch(() => null)) as Pending | null;
    const title = titleOf(turn.session) ?? turn.shell?.command;
    return {
      ...turn,
      title: title ?? t("shell.close.untitled"),
      named: !!title,
      waiting: !!pending && pending.questions.length + pending.permissions.length > 0,
    };
  }));
}

/** «A, B, C y 2 más»; la que espera una respuesta lo dice, porque no termina sola. */
export function namesOf(rows: ShownTurn[], max = 3): string {
  const names = rows.map((row) => (row.waiting ? `${row.title} (${t("shell.close.waiting")})` : row.title));
  const shown = names.slice(0, max).join(", ");
  return names.length > max ? t("shell.wait.more", { list: shown, count: names.length - max }) : shown;
}

export type AfterWait = "restart" | "quit";

const [waitingThen, setWaitingThen] = createSignal<AfterWait | null>(null);
const [waitRows, setWaitRows] = createSignal<ShownTurn[]>([]);
export { waitingThen, waitRows };

/** Mientras se espera, mirar los turnos es local y barato. */
export const WAIT_POLL = 2000;
let poll: ReturnType<typeof setInterval> | undefined;
let checking = false;

async function check() {
  if (checking || !waitingThen()) return;
  checking = true;
  try {
    const turns = await invoke<LiveTurn[]>("list_live_turns");
    const then = waitingThen();
    if (!then) return;
    if (turns.length === 0) {
      cancelWait();
      if (then === "restart") await invoke("restart_app");
      else await invoke("quit_completely");
      return;
    }
    setWaitRows(await titled(turns));
  } catch {
    // Sin respuesta del motor no se sabe si terminaron: se sigue esperando.
  } finally {
    checking = false;
  }
}

/** Reinicia o sale cuando ya no quede ningún turno vivo; la última elección manda. */
export function waitThen(then: AfterWait, rows: ShownTurn[] = []) {
  if (rows.length) setWaitRows(rows);
  setWaitingThen(then);
  if (poll === undefined) poll = setInterval(() => void check(), WAIT_POLL);
  void check();
}

export function cancelWait() {
  if (poll !== undefined) clearInterval(poll);
  poll = undefined;
  setWaitingThen(null);
  setWaitRows([]);
}
