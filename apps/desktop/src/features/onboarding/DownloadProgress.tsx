import { Show } from "solid-js";
import { mb } from "../../lib/format";
import { t } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { CancelButton } from "../../ui/IconAction";

/**
 * Lo que baja, igual en proveedores de IA, herramientas y plugins: cuánto lleva de cuánto,
 * una barra que se llena y la × para cortarlo. Sin tamaño conocido la barra barre.
 */
export function AvanceDeDescarga(props: {
  hecho: number;
  total: number | null;
  cancelar: string;
  onCancelar?: () => void;
  barra?: string;
}) {
  const conTotal = () => (props.total ?? 0) > 0;
  const lleva = () => (conTotal() ? Math.min(100, (props.hecho / props.total!) * 100) : 0);
  return (
    <>
      <span class="text-[11px] whitespace-nowrap text-neutral-500 tabular-nums">
        {conTotal()
          ? t("onboarding.tools.plugin_progress", { done: Math.round(props.hecho / 1_048_576), total: mb(props.total!) })
          : t("onboarding.ai.downloading")}
      </span>
      <span class={cn("h-[5px] shrink-0 overflow-hidden rounded-full bg-surface-muted", props.barra ?? "w-[56px]")} aria-hidden="true">
        <Show when={conTotal()} fallback={<span class="block h-full w-1/3 animate-barrido bg-primary" />}>
          <span class="block h-full bg-primary transition-[width] duration-150" style={{ width: `${lleva()}%` }} />
        </Show>
      </span>
      <Show when={props.onCancelar}>
        {(f) => <CancelButton label={props.cancelar} onClick={() => f()()} />}
      </Show>
    </>
  );
}
