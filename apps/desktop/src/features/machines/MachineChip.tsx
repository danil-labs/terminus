import Server from "lucide-solid/icons/server";
import { t } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { machineName } from "./store";

/**
 * La máquina que corre una tarea que no es de la máquina de la ventana; atenuada si está apagada.
 * `untitled`: dentro de una fila con tarjeta flotante, que ya dice la máquina.
 */
export function MachineChip(props: { machine: string; on: boolean; untitled?: boolean; class?: string }) {
  const label = () =>
    props.on
      ? t("shell.machines.task_on", { name: machineName(props.machine) })
      : t("shell.machines.task_off", { name: machineName(props.machine) });
  return (
    <span
      data-machine={props.machine}
      data-machine-on={props.on ? "true" : "false"}
      class={cn("flex shrink-0 items-center gap-0.5", !props.on && "opacity-60", props.class)}
      title={props.untitled ? undefined : label()}
      aria-label={label()}
    >
      <Server size={11} aria-hidden="true" />
      <span class="truncate">{machineName(props.machine)}</span>
    </span>
  );
}
