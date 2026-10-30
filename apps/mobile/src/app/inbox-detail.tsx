import { usePathname, Redirect, Stack } from 'expo-router';
import { ScrollView, Text } from 'react-native';
import { ALPHA_DEMO } from '../lib/alpha-mode';
import { useCustomization } from '../lib/customization';
import { useInbox } from '../lib/inbox';
import { t } from '../lib/i18n';
import { SectionTitle } from '../ui/components';
import { useTheme } from '../ui/theme';
export default function InboxDetail(){const pathname=usePathname();const customization=useCustomization();const theme=useTheme();const {selected}=useInbox();if(!customization.ready)return null;
 if(!customization.enabled('inbox'))return pathname.endsWith('/inbox-detail')?<Redirect href={ALPHA_DEMO?'/?demo=1':'/'}/>:null;return <><Stack.Screen options={{title:t('alpha.details')}}/><ScrollView contentContainerStyle={{padding:20,gap:16}}><Text style={{color:theme.textMuted}}>{t(ALPHA_DEMO?'alpha.demo_notice':'alpha.real_notice')}</Text><SectionTitle>{selected?.contact_name||t('alpha.empty')}</SectionTitle><Text style={{color:theme.text}}>{selected?.channel_name}</Text><Text style={{color:theme.textMuted}}>{t('alpha.unavailable')}</Text><Text style={{color:theme.textMuted}}>{t('alpha.crm')}</Text></ScrollView></>;}
