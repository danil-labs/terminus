import { type InboxSession } from '../../../../../packages/attention/src/inbox.ts';
import { For } from 'solid-js';
import { t } from '../../lib/i18n';
import { SettingsRow, SettingsSection } from '../../features/settings/layout';
import { Button } from '../../ui/Button';
import { Attention } from './Attention';

export function attentionCapability(demo: boolean, initial: boolean, session?: InboxSession & { subscribe?: (clear: () => void) => () => void }) {
  return {
    initial,
    render: () => <Attention demo={demo} session={session}/>,
    agentSettings: (name: string) => <SettingsSection title={`${t('web.alpha.service_agent')} · ${name}`} description={t('web.alpha.configuration_unavailable')}><For each={['scope','knowledge','tools','schedule','host']}>{field=><SettingsRow label={t(`web.alpha.${field}`)} description={t(`web.alpha.${field}_hint`)}><input class="w-48 max-w-full rounded-md border border-border bg-surface p-2 text-sm" disabled={!demo} aria-label={t(`web.alpha.${field}`)}/></SettingsRow>}</For><Button class="mt-3 justify-self-start" disabled>{t('web.alpha.publish')}</Button></SettingsSection>,
    integrations: () => <SettingsSection title={t('web.alpha.channel')} description={t('web.alpha.channels_description')}><For each={['WhatsApp','Web','Instagram']}>{channel=><SettingsRow label={channel} description={t('web.alpha.not_connected')}><Button size="sm" disabled>{t('web.alpha.not_connected')}</Button></SettingsRow>}</For></SettingsSection>,
  };
}
