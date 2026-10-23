import { For, Show } from "solid-js";
import { df } from "../../lib/format";
import { t } from "../../lib/i18n";
import { capabilities } from "../../lib/platform";
import { machineName } from "./store";

type SliceState = ReturnType<NonNullable<ReturnType<typeof capabilities>["machineSlices"]>>[string];

/**
 * Las otras máquinas cuya rebanada no es de ahora: guardada con su hora, sin
 * respuesta, apagada sin copia o con otro contrato. La de licencia tiene su
 * propio aviso. Sin ninguna así, no se pinta nada.
 */
export function MachineSlices() {
  const rows = () =>
    Object.entries(capabilities().machineSlices?.() ?? {}).filter(([, s]) => s.status !== "ok" && s.status !== "license_required");
  const label = (id: string, s: SliceState) => {
    const name = machineName(id, false);
    if (s.status === "cached" && s.at) return t("shell.machines.slice.cached", { name, time: df({ timeStyle: "short" }).format(s.at) });
    if (s.status === "outdated") return t("shell.machines.slice.outdated", { name });
    if (s.status === "no_answer") return t("shell.machines.slice.no_answer", { name });
    return t("shell.machines.slice.off", { name });
  };
  return (
    <Show when={rows().length}>
      <ul class="m-0 flex list-none flex-col gap-0.5 px-2 text-[0.6875rem] leading-tight text-neutral-500" data-machine-slices="">
        <For each={rows()}>
          {([id, s]) => (
            <li class="truncate" data-machine-slice={id} data-slice-status={s.status} title={label(id, s)}>
              {label(id, s)}
            </li>
          )}
        </For>
      </ul>
    </Show>
  );
}
