import { Stack } from 'expo-router';
import { ScrollView, Text } from 'react-native';
import { ALPHA_DEMO } from '../lib/alpha-mode';
import { useInbox } from '../lib/inbox';
import { t } from '../lib/i18n';
import { SectionTitle } from '../ui/components';
import { useTheme } from '../ui/theme';
export default function InboxDetail(){const theme=useTheme();const {selected}=useInbox();return <><Stack.Screen options={{title:t('alpha.details')}}/><ScrollView contentContainerStyle={{padding:20,gap:16}}><Text style={{color:theme.textMuted}}>{t(ALPHA_DEMO?'alpha.demo_notice':'alpha.real_notice')}</Text><SectionTitle>{selected?.contact_name||t('alpha.empty')}</SectionTitle><Text style={{color:theme.text}}>{selected?.channel_name}</Text><Text style={{color:theme.textMuted}}>{t('alpha.unavailable')}</Text><Text style={{color:theme.textMuted}}>{t('alpha.crm')}</Text></ScrollView></>;}
