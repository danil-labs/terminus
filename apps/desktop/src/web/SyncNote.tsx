import { type Accessor, For } from "solid-js";
import { df } from "../lib/format";
import { t } from "../lib/i18n";
import type { MachineStatus } from "./fleet";

export type MachineRow = { id: string; name: string; status: MachineStatus; at: number | null };

const LABELS: Record<MachineStatus, string> = {
  online: "web.computers.state.online",
  starting: "web.computers.state.starting",
  offline: "web.computers.state.offline",
  outdated: "web.computers.state.outdated",
};

/**
 * One row per computer: on, off, starting or needing an update; none of them is
 * an error. With one off, the age of its copies on screen goes in the tooltip.
 */
export function SyncNote(props: { machines: Accessor<MachineRow[]> }) {
  const tip = (m: MachineRow) =>
    m.status !== "online" && m.at ? t("web.sync.last", { time: df({ dateStyle: "short", timeStyle: "short" }).format(m.at) }) : undefined;
  return (
    <ul
      role="status"
      data-web-sync=""
      data-state={props.machines()[0]?.status}
      title={props.machines().length === 1 ? tip(props.machines()[0]) : undefined}
      class="fixed bottom-2 left-2 z-50 m-0 flex max-w-[280px] list-none flex-col gap-0.5 rounded-md border border-border bg-bg px-2 py-1 text-xs text-neutral-500"
    >
      <For each={props.machines()}>
        {(m) => (
          <li class="flex min-w-0 items-center gap-1.5" data-machine-row={m.id} data-state={m.status} title={tip(m)}>
            <span
              aria-hidden="true"
              class={`size-1.5 shrink-0 rounded-full ${m.status === "online" ? "bg-success" : m.status === "starting" ? "animate-danil-pulse bg-neutral-500" : "bg-neutral-500"}`}
            />
            <span class="truncate">{m.name}</span>
            <span class="shrink-0">· {t(LABELS[m.status])}</span>
          </li>
        )}
      </For>
    </ul>
  );
}
