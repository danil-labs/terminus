import { screenEnd, type ScreenEnd } from "@terminus/computers";
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { t } from "../../lib/i18n";
import { Button } from "../../ui/Button";

type Phase = "connecting" | "live" | ScreenEnd | "failed";

const MESSAGE: Record<Exclude<Phase, "connecting" | "live">, () => string> = {
  offline: () => t("screen.offline"),
  unavailable: () => t("screen.unavailable"),
  busy: () => t("screen.busy"),
  ended: () => t("screen.ended"),
  failed: () => t("screen.failed"),
};

/** La pantalla de una VM administrada, de solo ver: VNC sobre el WebSocket que abre `open`. */
export default function Screen(props: { open: () => Promise<WebSocket> }) {
  const [phase, setPhase] = createSignal<Phase>("connecting");
  let target!: HTMLDivElement;
  let rfb: { disconnect(): void } | null = null;
  let attempt = 0;

  const stop = () => {
    const current = rfb;
    rfb = null;
    current?.disconnect();
    target?.replaceChildren();
  };

  const connect = async () => {
    const mine = ++attempt;
    stop();
    setPhase("connecting");
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
      view.addEventListener("connect", () => {
        live = true;
        if (mine === attempt) setPhase("live");
      });
      view.addEventListener("disconnect", () => {
        if (mine !== attempt) return;
        rfb = null;
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

  const ended = () => {
    const p = phase();
    return p === "connecting" || p === "live" ? null : MESSAGE[p];
  };

  return (
    <main data-screen="" data-screen-phase={phase()} class="relative h-full min-h-0 w-full overflow-hidden bg-surface">
      <div ref={target} class="absolute inset-0" classList={{ invisible: phase() !== "live" }} />
      <Show when={phase() === "live"}>
        <span class="pointer-events-none absolute top-2 right-2 rounded-sm bg-neutral-900/70 px-1.5 py-0.5 text-[0.6875rem] font-medium text-white">
          {t("screen.view_only")}
        </span>
      </Show>
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
