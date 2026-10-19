import { type JSX, Match, onCleanup, onMount, Switch, createSignal } from "solid-js";
import { t } from "../lib/i18n";
import { invoke } from "../lib/invoke.ts";

/**
 * The preparation of a managed computer, which the installer already ran on
 * it: no installer screen, only its state. It mounts the app once the engine
 * says nothing is pending and stops with a support note if an essential stage failed.
 */

type Stage = { name: string; essential: boolean; state: "waiting" | "running" | "succeeded" | "failed"; failure?: string };
type Run = { stages?: Stage[]; running?: boolean } | null;
type Phase = { t: "connecting" } | { t: "preparing"; percent: number | null } | { t: "failed"; detail: string } | { t: "ready" };

const AGAIN = 3000;

export default function ManagedSetup(props: { children: JSX.Element }) {
  const [phase, setPhase] = createSignal<Phase>({ t: "connecting" });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let started = false;
  let disposed = false;
  const later = () => {
    if (!disposed) timer = setTimeout(() => void check(), AGAIN);
  };

  async function check() {
    let required: boolean;
    try {
      required = await invoke<boolean>("setup_required");
    } catch {
      return later();
    }
    if (!required) return setPhase({ t: "ready" });
    let run: Run;
    try {
      // The first call joins the run in progress or starts the pending one; later ones only read it.
      run = await invoke<Run>("prepare_runtime", { joinOnly: started });
      started = true;
    } catch {
      return later();
    }
    const stages = run?.stages ?? [];
    const failed = stages.filter((s) => s.essential && s.state === "failed");
    if (failed.length) return setPhase({ t: "failed", detail: failed.map((s) => `${s.name}: ${s.failure ?? ""}`).join("\n") });
    if (run?.running !== true && stages.length > 0) return setPhase({ t: "ready" });
    const done = stages.filter((s) => s.state === "succeeded" || s.state === "failed").length;
    setPhase({ t: "preparing", percent: stages.length ? Math.round((done / stages.length) * 100) : null });
    later();
  }

  onMount(() => void check());
  onCleanup(() => {
    disposed = true;
    clearTimeout(timer);
  });

  const percent = () => {
    const p = phase();
    return p.t === "preparing" ? p.percent : null;
  };
  const detail = () => {
    const p = phase();
    return p.t === "failed" ? p.detail : "";
  };

  return (
    <Switch>
      <Match when={phase().t === "ready"}>{props.children}</Match>
      <Match when={phase().t === "failed"}>
        <main class="flex h-full flex-col bg-bg px-10 py-10" data-managed-setup="failed">
          <p class="m-0 max-w-[60ch] text-sm text-neutral-950">{t("web.setup.failed")}</p>
          <details class="mt-4 max-w-[60ch]">
            <summary class="cursor-pointer text-xs text-neutral-500">{t("web.setup.detail")}</summary>
            <pre class="m-0 mt-2 text-xs break-all whitespace-pre-wrap text-neutral-500 select-text">{detail()}</pre>
          </details>
        </main>
      </Match>
      <Match when={true}>
        <main class="flex h-full items-center justify-center bg-bg" data-managed-setup={phase().t}>
          <p role="status" class="m-0 text-sm text-neutral-500">
            {phase().t === "connecting"
              ? t("web.setup.connecting")
              : percent() === null
                ? t("web.setup.preparing")
                : t("web.setup.preparing_percent", { percent: percent() ?? 0 })}
          </p>
        </main>
      </Match>
    </Switch>
  );
}
