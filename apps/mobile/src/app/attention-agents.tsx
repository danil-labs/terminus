import { Redirect, Stack, usePathname } from 'expo-router';
import { ScrollView, Text } from 'react-native';
import { ALPHA_DEMO } from '../lib/alpha-mode';
import { useCustomization } from '../lib/customization';
import { t } from '../lib/i18n';
import { useTheme } from '../ui/theme';

export default function AttentionAgents(){
 const model=useCustomization();const pathname=usePathname();const theme=useTheme();
 if(!model.ready)return null;
 if(!model.enabled('agents'))return pathname.endsWith('/attention-agents')?<Redirect href={ALPHA_DEMO?'/?demo=1':'/'}/>:null;
 return <><Stack.Screen options={{title:t('attention.agents')}}/><ScrollView contentContainerStyle={{padding:16,gap:16}}>{ALPHA_DEMO&&<Text style={{color:theme.textMuted}}>{t('alpha.demo_notice')}</Text>}<Text style={{color:theme.text}}>{t('attention.agents_unavailable')}</Text></ScrollView></>;
}
