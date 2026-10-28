import { usePathname, Redirect, Stack, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ALPHA_DEMO } from '../lib/alpha-mode';
import { useAccount } from '../lib/account';
import { useCustomization } from '../lib/customization';
import { useInbox } from '../lib/inbox';
import { t } from '../lib/i18n';
import { useTheme } from '../ui/theme';
import { KeyboardScreen } from '../ui/KeyboardScreen';

export default function InboxThread(){
 const pathname=usePathname();const customization=useCustomization();
 const theme=useTheme();const inbox=useInbox();const [draft,setDraft]=useState('');const session=useAccount();
 useEffect(()=>setDraft(''),[inbox.account?.id,inbox.selected?.id,session.session?.user.id]);
 if(!customization.ready)return null;
 if(!customization.enabled('inbox'))return pathname.endsWith('/inbox-thread')?<Redirect href={ALPHA_DEMO?'/?demo=1':'/'}/>:null;
 return <KeyboardScreen><Stack.Screen options={{title:inbox.selected?.contact_name||t('alpha.title')}}/>
 <ScrollView contentContainerStyle={{padding:16,gap:16}}>
  <Text style={{color:theme.textMuted}}>{t(ALPHA_DEMO?'alpha.demo_notice':'alpha.real_notice')}</Text>
  {inbox.busy&&<Text accessibilityLiveRegion="polite" style={{color:theme.textMuted}}>{t('alpha.loading')}</Text>}
  {!!inbox.error&&<Text accessibilityRole="alert" style={{color:theme.text}}>{t(inbox.error==='HTTP 403'?'alpha.forbidden':'alpha.load_error')}</Text>}
  {!inbox.selected&&<Text style={{color:theme.text}}>{t('alpha.empty')}</Text>}
  {inbox.older&&inbox.selected&&<Pressable accessibilityRole="button" onPress={()=>void inbox.open(inbox.selected!,true)} style={{padding:14}}><Text style={{color:theme.primary}}>{t('alpha.more')}</Text></Pressable>}
  {inbox.messages.map(message=><View key={message.id} style={{padding:14,borderRadius:12,backgroundColor:message.direction==='inbound'?theme.surface:theme.muted}}><Text style={{color:theme.textMuted,fontSize:12}}>{message.direction==='inbound'?inbox.selected?.contact_name:t('alpha.agent')}</Text><Text style={{color:theme.text,fontSize:16,lineHeight:24}}>{message.deleted_at?t('alpha.no_text'):message.content||t('alpha.no_text')}</Text></View>)}
  {inbox.selected&&<Pressable accessibilityRole="button" onPress={()=>router.push(ALPHA_DEMO?'/inbox-detail?demo=1':'/inbox-detail')} style={{padding:14}}><Text style={{color:theme.primary}}>{t('alpha.details')}</Text></Pressable>}
 </ScrollView><View style={{padding:16,gap:8,borderTopWidth:1,borderColor:theme.border}}><Text style={{color:theme.textMuted}}>{t('alpha.unavailable')}</Text>{ALPHA_DEMO&&<TextInput multiline accessibilityLabel={t('alpha.draft')} placeholder={t('alpha.placeholder')} placeholderTextColor={theme.textMuted} value={draft} onChangeText={setDraft} style={{minHeight:72,padding:12,color:theme.text,borderWidth:1,borderRadius:8,borderColor:theme.border}}/>}</View></KeyboardScreen>;
}
