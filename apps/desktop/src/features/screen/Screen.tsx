import { SCREEN_CONTROL_DESKTOP } from "@terminus/computers";
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { t } from "../../lib/i18n";
import { Button } from "../../ui/Button";
import { screenConnection, type Phase } from "./connection";
import { screenInput } from "./input";

type InputViewer = { viewOnly: boolean };

const MESSAGE: Record<Exclude<Phase, "connecting" | "live">, () => string> = {
  offline: () => t("screen.offline"),
  unavailable: () => t("screen.unavailable"),
  busy: () => t("screen.busy"),
  ended: () => t("screen.ended"),
  failed: () => t("screen.failed"),
};

/** VNC sobre el WebSocket autenticado que abre `open`. */
export default function Screen(props: { open: () => Promise<WebSocket> }) {
  const [phase, setPhase] = createSignal<Phase>("connecting");
  const [controllable, setControllable] = createSignal(false);
  const [controlling, setControlling] = createSignal(false);
  let target!: HTMLDivElement;
  let rfb: InputViewer | undefined;
  let input: ReturnType<typeof screenInput> | undefined;
  let connection: ReturnType<typeof screenConnection> | undefined;
  onMount(() => {
    connection = screenConnection({
      target, open: () => props.open(), load: () => import("@novnc/novnc"), phase: setPhase,
      configure(view) {
        rfb = view;
        const controls = screenInput(target);
        input = controls;
        const named = (event: Event) => {
          // Los motores anteriores mantienen su visor de solo lectura.
          const supported = (event as CustomEvent<{ name: string }>).detail.name === SCREEN_CONTROL_DESKTOP;
          controls.release();
          view.viewOnly = !supported;
          setControllable(supported);
          setControlling(supported);
        };
        view.addEventListener("desktopname", named);
        return () => {
          view.removeEventListener("desktopname", named);
          controls.dispose();
          rfb = undefined;
          input = undefined;
          setControllable(false);
          setControlling(false);
        };
      },
    });
    void connection.connect();
  });
  onCleanup(() => connection?.disconnect());

  const toggleControl = () => {
    if (!rfb || !controllable() || phase() !== "live") return;
    input?.release();
    const next = !controlling();
    rfb.viewOnly = !next;
    setControlling(next);
  };

  const ended = () => {
    const p = phase();
    return p === "connecting" || p === "live" ? null : MESSAGE[p];
  };

  return (
    <main data-screen="" data-screen-phase={phase()} class="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-surface">
      <Show when={phase() === "live"}>
        <div class="flex shrink-0 items-center justify-between gap-3 border-b border-border px-3 py-1.5">
          <div class="min-w-0">
            <span role="status" class="block text-xs text-neutral-500">
              {controlling() ? t("screen.control_active") : t("screen.view_only")}
            </span>
            {/* La pantalla virtual no tiene escritorio: vacía se ve negra y parece rota. */}
            <span class="block truncate text-xs text-neutral-500">{t("screen.empty_hint")}</span>
          </div>
          <Show when={controllable()} fallback={<span class="text-xs text-neutral-500">{t("screen.control_unavailable")}</span>}>
            <Button size="compact" variant="outline" onClick={toggleControl}>
              {controlling() ? t("screen.stop_control") : t("screen.start_control")}
            </Button>
          </Show>
        </div>
      </Show>
      <div ref={target} class="min-h-0 flex-1" classList={{ invisible: phase() !== "live" }} />
      <Show when={phase() !== "live"}>
        <div class="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center">
          <Show when={ended()} fallback={<p role="status" class="text-sm text-neutral-500">{t("screen.connecting")}</p>}>
            {(key) => (
              <>
                <p role="alert" class="max-w-sm text-sm text-neutral-700">{key()()}</p>
                <Button size="sm" variant="outline" onClick={() => void connection?.connect()}>{t("screen.retry")}</Button>
              </>
            )}
          </Show>
        </div>
      </Show>
    </main>
  );
}
