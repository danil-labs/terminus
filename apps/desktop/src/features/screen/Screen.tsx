import { SCREEN_CONTROL_DESKTOP, screenEnd, type ScreenEnd } from "@terminus/computers";
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { t } from "../../lib/i18n";
import { Button } from "../../ui/Button";
import { screenInput } from "./input";

type Phase = "connecting" | "live" | ScreenEnd | "failed";

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
  let input: ReturnType<typeof screenInput> | null = null;
  let rfb: { viewOnly: boolean; disconnect(): void } | null = null;
  let attempt = 0;

  const stop = () => {
    input?.dispose();
    input = null;
    const current = rfb;
    rfb = null;
    current?.disconnect();
    target?.replaceChildren();
  };

  const connect = async () => {
    const mine = ++attempt;
    stop();
    setPhase("connecting");
    setControllable(false);
    setControlling(false);
    try {
      const [{ default: RFB }, socket] = await Promise.all([import("@novnc/novnc"), props.open()]);
      if (mine !== attempt) return socket.close();
      let live = false;
      let code = 1000;
      socket.addEventListener("close", (e) => {
        code = e.code;
      });
      const view = new RFB(target, socket, { shared: true });
      view.viewOnly = true;
      view.scaleViewport = true;
      view.background = "transparent";
      input = screenInput(target);
      view.addEventListener("desktopname", (event) => {
        if (mine !== attempt) return;
        // Los motores anteriores mantienen su visor de solo lectura.
        const supported = (event as CustomEvent<{ name: string }>).detail.name === SCREEN_CONTROL_DESKTOP;
        input?.release();
        view.viewOnly = !supported;
        setControllable(supported);
        setControlling(supported);
      });
      view.addEventListener("connect", () => {
        live = true;
        if (mine === attempt) setPhase("live");
      });
      view.addEventListener("disconnect", () => {
        if (mine !== attempt) return;
        input?.dispose();
        input = null;
        rfb = null;
        setControlling(false);
        setPhase(live ? "ended" : screenEnd(code));
      });
      rfb = view;
    } catch {
      if (mine === attempt) setPhase("failed");
    }
  };

  onMount(() => void connect());
  onCleanup(() => {
    attempt++;
    stop();
  });

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
          <span role="status" class="text-xs text-neutral-500">
            {controlling() ? t("screen.control_active") : t("screen.view_only")}
          </span>
          <Show when={controllable()} fallback={<span class="text-xs text-neutral-500">{t("screen.control_unavailable")}</span>}>
            <Button size="compact" variant="outline" aria-pressed={controlling()} onClick={toggleControl}>
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
                <Button size="sm" variant="outline" onClick={() => void connect()}>{t("screen.retry")}</Button>
              </>
            )}
          </Show>
        </div>
      </Show>
    </main>
  );
}
