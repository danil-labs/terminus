import { Redirect, Stack } from 'expo-router';
import { Linking, Pressable, ScrollView, Text } from 'react-native';
import { ALPHA_DEMO } from '../lib/alpha-mode';
import { useCustomization } from '../lib/customization';
import { t } from '../lib/i18n';
import { FeatureCatalog } from '../ui/FeatureCatalog';
import { SheetTitle } from '../ui/components';
import { useTheme } from '../ui/theme';

export default function Personalize(){
  const model=useCustomization();const theme=useTheme();
  if(process.env.EXPO_PUBLIC_TERMINUS_ALPHA!=='1')return <Redirect href="/"/>;
  if(!model.ready)return null;
  return <><Stack.Screen options={{title:t('attention.personalize')}}/><ScrollView contentContainerStyle={{padding:16,gap:12}}>
    <SheetTitle>{t('attention.personalize')}</SheetTitle>
    <Text style={{color:theme.textMuted}}>{t(model.temporary?'attention.memory':'attention.local')}</Text>
    {!model.selection.writable&&<Text accessibilityRole="alert" style={{color:theme.text}}>{t('attention.future')}</Text>}
    {ALPHA_DEMO&&<Pressable accessibilityRole="link" onPress={()=>void Linking.openURL(`${process.env.EXPO_PUBLIC_TERMINUS_WEB_BASE||'/terminus/'}m/`)} style={{minHeight:44,justifyContent:'center'}}><Text style={{color:theme.primary}}>{t('attention.leave_demo')}</Text></Pressable>}
    <FeatureCatalog entries={model.entries} onToggle={id=>void model.toggle(id)}/>
  </ScrollView></>;
}
