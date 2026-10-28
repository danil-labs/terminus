import { usePathname, Redirect, Stack } from 'expo-router';
import { ScrollView } from 'react-native';
import { ALPHA_DEMO } from '../lib/alpha-mode';
import { useCustomization } from '../lib/customization';
import { t } from '../lib/i18n';
import { Broadcasts } from '../ui/Broadcasts';
export default function BroadcastScreen(){
  const pathname=usePathname();const model=useCustomization();
  if(!model.ready)return null;
 if(!model.enabled('broadcasts'))return pathname.endsWith('/broadcasts')?<Redirect href={ALPHA_DEMO?'/?demo=1':'/'}/>:null;
  return <><Stack.Screen options={{title:t('attention.broadcasts')}}/><ScrollView><Broadcasts/></ScrollView></>;
}
