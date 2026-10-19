import { type Accessor, Show } from "solid-js";
import { df } from "../lib/format";
import { t } from "../lib/i18n";

/** With the computer off, how old the copies on screen are. */
export function SyncNote(props: { at: Accessor<number | null>; off: Accessor<boolean> }) {
  return (
    <Show when={props.off() && props.at()}>
      {(at) => (
        <p
          role="status"
          data-web-sync=""
          class="pointer-events-none fixed bottom-2 left-2 z-50 m-0 rounded-md border border-border bg-bg px-2 py-1 text-xs text-neutral-500"
        >
          {t("web.sync.last", { time: df({ dateStyle: "short", timeStyle: "short" }).format(at()) })}
        </p>
      )}
    </Show>
  );
}
