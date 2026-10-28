import { t } from '../../lib/i18n';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '../../ui/Table';

export function Broadcasts() {
  return <section class="flex h-full min-h-0 min-w-0 flex-col overflow-y-auto" aria-label={t('customize.broadcasts')}>
    <header class="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3"><h2 class="m-0 flex-1 text-sm font-semibold">{t('customize.broadcasts')}</h2><Badge forma="dato">{t('customize.prototype')}</Badge><Button size="sm" variant="secondary" disabled>{t('customize.new_unavailable')}</Button></header>
    <p role="note" class="m-0 border-b border-border bg-surface-muted px-4 py-3 text-xs leading-relaxed text-neutral-500">{t('customize.broadcast_notice')}</p>
    <div class="p-4"><Table><caption class="pb-3 text-left text-xs text-neutral-500">{t('customize.synthetic_campaigns')}</caption><TableHead><TableRow><TableHeaderCell>{t('customize.name')}</TableHeaderCell><TableHeaderCell>{t('customize.channel')}</TableHeaderCell><TableHeaderCell>{t('customize.state')}</TableHeaderCell></TableRow></TableHead><TableBody><TableRow><TableCell>{t('customize.sample_campaign')}</TableCell><TableCell>WhatsApp</TableCell><TableCell><Badge forma="dato">{t('customize.draft')}</Badge></TableCell></TableRow></TableBody></Table></div>
  </section>;
}
