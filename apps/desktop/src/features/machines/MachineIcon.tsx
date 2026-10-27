import Laptop from "lucide-solid/icons/laptop";
import Server from "lucide-solid/icons/server";

/**
 * Una VM que Danil puede encender (`wakes`) frente a una máquina de la persona.
 * El sistema (macOS, Windows, Linux) no viene en la fila de la cuenta: el icono
 * no lo inventa.
 */
export function MachineIcon(props: { wakes?: boolean; size?: number; class?: string }) {
  const size = () => props.size ?? 12;
  return props.wakes ? (
    <Server size={size()} class={props.class} aria-hidden="true" data-machine-form="vm" />
  ) : (
    <Laptop size={size()} class={props.class} aria-hidden="true" data-machine-form="computer" />
  );
}
