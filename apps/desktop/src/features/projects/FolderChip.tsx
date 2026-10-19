import { Show } from "solid-js";
import { folderColor } from "../../lib/folderColor";
import { cn } from "../../lib/utils";

/** El cuadrado de color de una carpeta, que la identifica en una lista plana. */
export function FolderSquare(props: { id: string; size?: number; class?: string }) {
  const lado = () => props.size ?? 8;
  return (
    <span
      aria-hidden="true"
      data-folder-square={props.id}
      class={cn("inline-block shrink-0 rounded-[2.5px]", props.class)}
      style={{ width: `${lado()}px`, height: `${lado()}px`, background: folderColor(props.id) }}
    />
  );
}

/**
 * Cuadrado y nombre de la carpeta; sin nombre, el cuadrado lleva el nombre en el `title`.
 * `untitled`: la fila ya saca su tarjeta flotante, y un `title` nativo saldría encima de ella.
 */
export default function FolderChip(props: { id: string; name: string; bare?: boolean; untitled?: boolean; class?: string }) {
  return (
    <span
      data-folder-chip={props.id}
      class={cn("inline-flex min-w-0 items-center gap-1 text-[0.6875rem] text-neutral-700", props.class)}
      title={props.untitled ? undefined : props.name}
    >
      <FolderSquare id={props.id} />
      <Show when={!props.bare}>
        <span class="min-w-0 truncate">{props.name}</span>
      </Show>
    </span>
  );
}
