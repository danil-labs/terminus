import { usePathname, Redirect, Stack, router } from 'expo-router';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { ALPHA_DEMO } from '../lib/alpha-mode';
import { useCustomization } from '../lib/customization';
import { useInbox } from '../lib/inbox';
import { t } from '../lib/i18n';
import { Avatar, Row } from '../ui/components';
import { useTheme } from '../ui/theme';

export default function Inbox(){
 const pathname=usePathname();const customization=useCustomization();
 const theme=useTheme();const inbox=useInbox();const text={color:theme.text,fontSize:14,lineHeight:21};
 const button=(label:string,press:()=>void)=><Pressable accessibilityRole="button" onPress={press} style={{padding:14,borderWidth:1,borderColor:theme.border,borderRadius:8}}><Text style={{color:theme.primary}}>{label}</Text></Pressable>;
 if(!customization.ready)return null;
 if(!customization.enabled('inbox'))return pathname.endsWith('/inbox')?<Redirect href={ALPHA_DEMO?'/?demo=1':'/'}/>:null;
 return <><Stack.Screen options={{title:t('alpha.title')}}/><ScrollView contentContainerStyle={{padding:16,gap:16,paddingBottom:40}}>
  <Text style={{color:theme.textMuted}}>{t(ALPHA_DEMO?'alpha.demo_notice':'alpha.real_notice')}</Text>
  {!ALPHA_DEMO&&!inbox.consent&&<><Text style={text}>{t('alpha.intro')}</Text>{button(t('alpha.signin'),()=>void Linking.openURL(`${process.env.EXPO_PUBLIC_TERMINUS_WEB_BASE||'/terminus/'}sign-in?next=${encodeURIComponent(`${process.env.EXPO_PUBLIC_TERMINUS_WEB_BASE||'/terminus/'}m/inbox`)}`))}</>}
  {!ALPHA_DEMO&&inbox.consent&&<View style={{gap:8}}>{button(t('alpha.refresh'),()=>void inbox.connect())}{inbox.accounts.map(row=><Row key={row.id} title={row.name} subtitle={t('alpha.select_account')} onPress={()=>void inbox.selectAccount(row)}/>)}</View>}
  {inbox.busy&&<Text accessibilityLiveRegion="polite" style={text}>{t('alpha.loading')}</Text>}
  {!!inbox.error&&<Text accessibilityRole="alert" style={text}>{t(inbox.error==='HTTP 403'?'alpha.forbidden':'alpha.load_error')}</Text>}
  {!inbox.busy&&!inbox.error&&inbox.account&&inbox.rows.length===0&&<Text accessibilityRole="text" style={text}>{t('customize.page_empty')}</Text>}
  {!inbox.busy&&!inbox.error&&!ALPHA_DEMO&&inbox.consent&&inbox.accounts.length===0&&<Text style={text}>{t('customize.no_accounts')}</Text>}
  {inbox.rows.map(row=><Row key={row.id} left={<Avatar name={row.contact_name}/>} title={row.contact_name} subtitle={<View style={{gap:4}}><Text style={{color:theme.textMuted,fontSize:12}}>{row.channel_name||t('customize.unknown')} · {t(typeof row.ai_assistance==='boolean'?(row.ai_assistance?'customize.ai_enabled':'customize.ai_paused'):'customize.unknown')}{row.unread_count>0?` · ${t('customize.unread')}: ${row.unread_count}`:''}</Text><Text style={text}>{row.last_message}</Text></View>} onPress={()=>{void inbox.open(row);router.push(ALPHA_DEMO?'/inbox-thread?demo=1':'/inbox-thread');}}/>)}
  {inbox.more&&inbox.account&&button(t('alpha.more'),()=>void inbox.selectAccount(inbox.account!,true))}
  {button(t('alpha.home'),()=>router.replace(ALPHA_DEMO?'/?demo=1':'/'))}
 </ScrollView></>;
}
