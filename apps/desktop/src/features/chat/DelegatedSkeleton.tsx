import { For } from "solid-js";
import { t } from "../../lib/i18n";
import { Spinner } from "../../ui/Spinner";

/**
 * Las delegadas que todavía no llegaron, con la forma de la tarjeta del riel.
 *
 * **Sustituye al «Leyendo tareas…».** Tres tarjetas de su misma medida (52px,
 * esquinas de 10px) con dos barras donde irán el título y la línea de abajo, y
 * el giro lento en la ranura del estado. Con `prefers-reduced-motion` se quedan
 * quietas: las barras siguen diciendo que viene algo.
 */
export function DelegatedSkeleton(props: { rows?: number }) {
  const rows = () => Array.from({ length: props.rows ?? 3 }, (_, i) => i);
  return (
    <div data-delegated-loading role="status" aria-busy="true" class="flex flex-col gap-0.5">
      <span class="sr-only">{t("chat.delegation.loading")}</span>
      <For each={rows()}>
        {() => (
          <div aria-hidden="true" class="flex h-[52px] flex-col justify-center gap-[5px] rounded-[10px] border border-transparent py-[7px] pr-2 pl-2.5">
            <div class="flex h-[18px] min-w-0 items-center gap-1.5">
              <Bar class="h-[9px] w-[150px]" />
              <span class="flex-1" />
              <span class="flex h-5 min-w-[22px] shrink-0 items-center justify-end">
                <Spinner size={14} class="text-primary motion-safe:animate-[spin_2.4s_steps(48)_infinite] motion-reduce:animate-none" />
              </span>
            </div>
            <div class="flex h-4 min-w-0 items-center">
              <Bar class="h-2 w-[90px]" />
            </div>
          </div>
        )}
      </For>
    </div>
  );
}

/** Una barra tenue con un brillo que la cruza; quieta si se pide menos movimiento. */
function Bar(props: { class: string }) {
  return (
    <div class={`relative shrink-0 overflow-hidden rounded-[4px] bg-neutral-950/7 ${props.class}`}>
      <div class="absolute inset-y-0 left-0 w-1/3 bg-linear-to-r from-transparent via-neutral-950/8 to-transparent motion-safe:animate-barrido motion-reduce:hidden" />
    </div>
  );
}
