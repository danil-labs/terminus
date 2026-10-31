import { Index, Show } from 'solid-js';
import { t } from '../../lib/i18n';
import { Badge } from '../../ui/Badge';
import { Toggle } from '../../ui/Toggle';

export type FeatureEntry = { id: string; title: string; description: string; available: boolean; selected: boolean };

export function FeatureCatalog(props: { entries: readonly FeatureEntry[]; onToggle(id: string): void }) {
  return <section class="min-w-0" aria-label={t("shell.customize.in_sidebar")}>
    <ul class="m-0 list-none p-0"><Index each={props.entries}>{entry =>
      <li class="flex min-w-0 items-center gap-3 py-1.5" title={entry().description}>
        <span class={`min-w-0 flex-1 truncate text-ui ${entry().available ? 'text-neutral-950' : 'text-neutral-500'}`}>{entry().title}</span>
        <Show when={entry().available} fallback={<Badge class="shrink-0" forma="dato">{t("customize.unavailable")}</Badge>}>
          <Toggle checked={entry().selected} label={entry().title} onChange={() => props.onToggle(entry().id)}/>
        </Show>
      </li>
    }</Index></ul>
  </section>;
}
