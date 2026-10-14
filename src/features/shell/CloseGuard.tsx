import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "../../lib/invoke.ts";
import { escribirPref, leerPref } from "../../lib/prefs";
import { t } from "../../lib/i18n";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogTitle } from "../../ui/Dialog";

/** Qué hacer al cerrar la ventana con agentes trabajando. */
export type CloseChoice = "ask" | "background" | "stop";
export const CLOSE_PREF = "close.live_turns";

type LiveTurn = {
  session: string;
  workspace: string;
  project: string;
  started_at: number;
  shell?: { id: string; command: string };
};
type Pending = { questions: unknown[]; permissions: unknown[] };
type Shown = LiveTurn & { title: string; waiting: boolean };

/** Los turnos viven en el workspace que los lanzó, no en el que mira la ventana. */
const scope = (workspace: string) => ({ headers: { "x-terminus-workspace": workspace } });

export async function stopTurns(turns: LiveTurn[]) {
  await Promise.allSettled(
    turns.map((turn) =>
      turn.shell
        ? invoke("stop_shell_command", { session: turn.session }, scope(turn.workspace))
        : invoke("stop_turn", { project: turn.project, session: turn.session }, scope(turn.workspace)),
    ),
  );
}

/**
 * Rust detiene todo cierre de la ventana y emite `close-requested`. Sin agentes
 * trabajando se cierra en el acto; con ellos decide la preferencia o la persona.
 */
export default function CloseGuard(props: { title: (session: string) => string | undefined }) {
  const [shown, setShown] = createSignal<Shown[] | null>(null);
  const [remember, setRemember] = createSignal(false);
  const [stopping, setStopping] = createSignal(false);

  const close = () => void invoke("close_confirmed").catch(() => {});

  async function onCloseRequested() {
    const turns = await invoke<LiveTurn[]>("list_live_turns").catch(() => []);
    if (turns.length === 0) return close();
    const choice = leerPref<CloseChoice>(CLOSE_PREF, "ask");
    if (choice === "background") return close();
    if (choice === "stop") {
      await stopTurns(turns);
      return close();
    }
    const rows = await Promise.all(
      turns.map(async (turn) => {
        const pending = await invoke<Pending>(
          "pending_requests",
          { session: turn.session },
          scope(turn.workspace),
        ).catch(() => null);
        return {
          ...turn,
          title: props.title(turn.session) ?? turn.shell?.command ?? t("shell.close.untitled"),
          waiting: !!pending && pending.questions.length + pending.permissions.length > 0,
        };
      }),
    );
    setRemember(false);
    setStopping(false);
    setShown(rows);
  }

  async function decide(choice: Exclude<CloseChoice, "ask">) {
    const turns = shown() ?? [];
    if (remember()) escribirPref(CLOSE_PREF, choice);
    if (choice === "stop") {
      setStopping(true);
      await stopTurns(turns);
      setStopping(false);
    }
    setShown(null);
    close();
  }

  onMount(() => {
    const unlisten = listen("close-requested", () => void onCloseRequested());
    onCleanup(() => void unlisten.then((u) => u()));
  });

  return (
    <Show when={shown()}>
      {(rows) => (
        <Dialog open onOpenChange={(open) => { if (!open && !stopping()) setShown(null); }}>
          <DialogContent class="flex flex-col gap-3" data-close-guard>
            <DialogTitle class="text-sm font-semibold">
              {t("shell.close.title", { count: rows().length })}
            </DialogTitle>
            <p class="m-0 text-[13px] text-neutral-700">{t("shell.close.body")}</p>
            <ul class="m-0 grid list-none gap-0 rounded-md border border-neutral-200 p-0">
              <For each={rows()}>
                {(row) => (
                  <li class="flex items-center gap-2 border-b border-neutral-200 px-3 py-2 text-[13px] last:border-b-0">
                    <span class="min-w-0 flex-1 truncate">{row.title}</span>
                    <span class={row.waiting ? "shrink-0 font-semibold text-warning-strong" : "shrink-0 text-neutral-500"}>
                      {row.waiting ? t("shell.close.waiting") : t("shell.close.working")}
                    </span>
                  </li>
                )}
              </For>
            </ul>
            <label class="flex items-center gap-2 text-[13px] text-neutral-700">
              <input
                type="checkbox"
                checked={remember()}
                onChange={(e) => setRemember(e.currentTarget.checked)}
              />
              {t("shell.close.remember")}
            </label>
            {/* Cancelar primero: toma el foco y Enter no detiene a nadie. */}
            <div class="flex justify-end gap-2">
              <Button variant="outline" size="sm" disabled={stopping()} onClick={() => setShown(null)}>
                {t("shell.close.cancel")}
              </Button>
              <Button variant="secondary" size="sm" disabled={stopping()} onClick={() => void decide("stop")}>
                {stopping() ? t("shell.close.stopping") : t("shell.close.stop")}
              </Button>
              <Button size="sm" disabled={stopping()} onClick={() => void decide("background")}>
                {t("shell.close.background")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </Show>
  );
}
