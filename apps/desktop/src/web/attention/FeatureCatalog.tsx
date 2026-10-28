import { For, Show } from 'solid-js';
import { t } from '../../lib/i18n';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';

export type FeatureEntry = { id: string; title: string; description: string; available: boolean; selected: boolean };

export function FeatureCatalog(props: { entries: readonly FeatureEntry[]; onToggle(id: string): void }) {
  return <section class="min-w-0" aria-label={t('customize.title')}>
    <p class="mb-4 text-sm leading-relaxed text-neutral-500">{t('customize.description')}</p>
    <ul class="m-0 list-none p-0"><For each={props.entries}>{entry =>
      <li class="flex min-w-0 items-start gap-3 border-t border-border py-3">
        <div class="min-w-0 flex-1"><h3 class="m-0 text-sm font-semibold">{entry.title}</h3><p class="mb-0 mt-1 text-xs leading-relaxed text-neutral-500">{entry.description}</p></div>
        <Show when={entry.available} fallback={<Badge class="mt-1 shrink-0" forma="dato">{t('customize.unavailable')}</Badge>}>
          <Button size="sm" variant="secondary" aria-label={`${t(entry.selected ? 'customize.remove' : 'customize.add')} ${entry.title}`} aria-pressed={entry.selected} onClick={() => props.onToggle(entry.id)}>{t(entry.selected ? 'customize.remove' : 'customize.add')}</Button>
        </Show>
      </li>
    }</For></ul>
  </section>;
}
