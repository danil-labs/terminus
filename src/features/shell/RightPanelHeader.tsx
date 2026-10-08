import PanelRightClose from "lucide-solid/icons/panel-right-close";
import type { JSX } from "solid-js";
import { cn } from "../../lib/utils";
import { HEADER_HEIGHT, toggleMaximizeFromHeader } from "../../lib/window";
import { BotonConAtajo } from "../../ui/Shortcut";

export default function RightPanelHeader(props: {
  title: string;
  actions?: JSX.Element;
  closeLabel: string;
  closeTooltip: string;
  onClose: () => void;
}) {
  return <div
    class={cn("flex min-h-0 shrink-0 items-center justify-between gap-3 px-4 text-sm font-semibold", HEADER_HEIGHT)}
    data-tauri-drag-region=""
    onDblClick={toggleMaximizeFromHeader}
  >
    <span class="min-w-0 truncate text-xs font-semibold text-neutral-950">{props.title}</span>
    <div class="flex shrink-0 items-center gap-1">{props.actions}</div>
    <div class="ml-auto flex items-center gap-3">
      <BotonConAtajo variant="ghost" size="icon" class="size-7 shrink-0 text-neutral-500"
        onClick={props.onClose} aria-pressed={true} aria-label={props.closeLabel}
        accion="workTree" etiqueta={props.closeTooltip}
      ><PanelRightClose size={16} /></BotonConAtajo>
    </div>
  </div>;
}
