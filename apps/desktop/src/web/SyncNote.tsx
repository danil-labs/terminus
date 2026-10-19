import { type Accessor } from "solid-js";
import { df } from "../lib/format";
import { t } from "../lib/i18n";

const LABELS: Record<string, string> = {
  online: "web.computers.state.online",
  starting: "web.computers.state.starting",
  provisioning: "web.computers.state.provisioning",
};

/**
 * Whether the computer is on or off; neither is an error. With it off, the
 * age of the copies on screen goes in the tooltip.
 */
export function SyncNote(props: { name: string; at: Accessor<number | null>; state: Accessor<string> }) {
  const on = () => props.state() === "online";
  const tip = () => {
    const at = props.at();
    return !on() && at ? t("web.sync.last", { time: df({ dateStyle: "short", timeStyle: "short" }).format(at) }) : undefined;
  };
  return (
    <p
      role="status"
      data-web-sync=""
      data-state={props.state()}
      title={tip()}
      class="fixed bottom-2 left-2 z-50 m-0 flex items-center gap-1.5 rounded-md border border-border bg-bg px-2 py-1 text-xs text-neutral-500"
    >
      <span aria-hidden="true" class={`size-1.5 rounded-full ${on() ? "bg-success" : props.state() === "starting" ? "animate-danil-pulse bg-neutral-500" : "bg-neutral-500"}`} />
      <span>{props.name}</span>
      <span>· {t(LABELS[props.state()] ?? "web.computers.state.offline")}</span>
    </p>
  );
}
