import { Redirect, Stack, usePathname } from 'expo-router';
import { ScrollView, Text } from 'react-native';
import { ALPHA_DEMO } from '../lib/alpha-mode';
import { useCustomization } from '../lib/customization';
import { t } from '../lib/i18n';
import { useTheme } from '../ui/theme';
export default function Channels(){
  const model=useCustomization();const pathname=usePathname();const theme=useTheme();
  if(!model.ready)return null;
  if(!model.enabled('channels'))return pathname.endsWith('/channels')?<Redirect href={ALPHA_DEMO?'/?demo=1':'/'}/>:null;
  return <><Stack.Screen options={{title:t('attention.channels')}}/><ScrollView contentContainerStyle={{padding:16,gap:16}}><Text style={{color:theme.text}}>{t('attention.desktop_channels')}</Text><Text style={{color:theme.textMuted}}>{t('attention.channels_unavailable')}</Text></ScrollView></>;
}
