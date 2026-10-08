import { For, Show } from "solid-js";
import Check from "lucide-solid/icons/check";
import { t } from "../../lib/i18n";
import { cn } from "../../lib/utils";

/** Las tres fases del alta: la preparación pinta la primera y el alta las otras dos. */
export function Fases(props: { actual: number }) {
  const fases = () => [
    t("onboarding.phases.prepare"),
    t("onboarding.phases.install"),
    t("onboarding.phases.space"),
  ];
  return (
    <nav class="flex gap-5" aria-label={t("onboarding.phases.label")}>
      <For each={fases()}>
        {(fase, i) => (
          <span
            class={cn(
              "flex items-center gap-1",
              i() === props.actual ? "font-semibold text-primary" : "text-neutral-500",
            )}
            aria-current={i() === props.actual ? "step" : undefined}
          >
            <Show when={i() < props.actual} fallback={i() + 1}>
              <Check size={12} aria-hidden="true" />
            </Show>{" "}
            {fase}
          </span>
        )}
      </For>
    </nav>
  );
}
