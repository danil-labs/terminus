import { type InboxSession } from '../../../../../packages/attention/src/inbox.ts';
import { For, lazy, Suspense } from 'solid-js';
import { t } from '../../lib/i18n';
import { SettingsRow, SettingsSection } from '../../features/settings/layout';
import { Button } from '../../ui/Button';
import { Attention } from './Attention';
import { createCustomization } from '../../lib/customization';
import { featureEntries } from '../../lib/attention-labels';
import { AttentionMenu, PersonalizeMenu } from './SidebarEntries';
import { loadedConversations, requestConversation } from './loaded';

const CustomizationSection = lazy(() => import('./CustomizationSection').then(module => ({default:module.CustomizationSection})));
const Channels = lazy(() => import('./Channels').then(module => ({default:module.Channels})));
const Broadcasts = lazy(() => import('./Broadcasts').then(module => ({default:module.Broadcasts})));

export function attentionCapability(demo: boolean, initial: boolean, session?: InboxSession & { subscribe?: (clear: () => void) => () => void; userId?: string | null }) {
  return {
    customization: createCustomization, entries: featureEntries,
    demo, userId: demo ? 'demo' : session?.userId, subscribe: session?.subscribe,
    sidebarMenu: AttentionMenu, personalizeMenu: PersonalizeMenu,
    catalog: (props: import("./CustomizationSection").CustomizationSectionProps) => <Suspense fallback={null}><CustomizationSection {...props}/></Suspense>,
    broadcasts: () => <Suspense fallback={null}><Broadcasts demo={demo} session={session}/></Suspense>,
    initial,
    render: () => <Attention demo={demo} session={session}/>,
    agentSettings: (name: string) => <SettingsSection title={`${t("web.alpha.service_agent")} · ${name}`} description={t("web.alpha.configuration_unavailable")}><For each={['scope','knowledge','tools','schedule','host']}>{field=><SettingsRow label={t(`web.alpha.${field}`)} description={t(`web.alpha.${field}_hint`)}><input class="w-48 max-w-full rounded-md border border-border bg-surface p-2 text-sm" disabled={!demo} aria-label={t(`web.alpha.${field}`)}/></SettingsRow>}</For><Button class="mt-3 justify-self-start" disabled>{t("web.alpha.publish")}</Button></SettingsSection>,
    integrations: () => <Suspense fallback={null}><Channels demo={demo} session={session}/></Suspense>,
    search: { conversations: loadedConversations, open: requestConversation },
  };
}
