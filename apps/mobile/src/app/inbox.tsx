import { Stack, router } from 'expo-router';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { ALPHA_DEMO } from '../lib/alpha-mode';
import { useInbox } from '../lib/inbox';
import { t } from '../lib/i18n';
import { Avatar, Row } from '../ui/components';
import { useTheme } from '../ui/theme';

export default function Inbox(){
 const theme=useTheme();const inbox=useInbox();const text={color:theme.text,fontSize:14,lineHeight:21};
 const button=(label:string,press:()=>void)=><Pressable accessibilityRole="button" onPress={press} style={{padding:14,borderWidth:1,borderColor:theme.border,borderRadius:8}}><Text style={{color:theme.primary}}>{label}</Text></Pressable>;
 return <><Stack.Screen options={{title:t('alpha.title')}}/><ScrollView contentContainerStyle={{padding:16,gap:16,paddingBottom:40}}>
  <Text style={{color:theme.textMuted}}>{t(ALPHA_DEMO?'alpha.demo_notice':'alpha.real_notice')}</Text>
  {!ALPHA_DEMO&&!inbox.consent&&<><Text style={text}>{t('alpha.intro')}</Text>{button(t('alpha.real'),()=>void inbox.connect())}{button(t('alpha.demo'),()=>void Linking.openURL(`${process.env.EXPO_PUBLIC_TERMINUS_WEB_BASE||'/terminus/'}m/?demo=1`))}{button(t('alpha.signin'),()=>void Linking.openURL(`${process.env.EXPO_PUBLIC_TERMINUS_WEB_BASE||'/terminus/'}sign-in?next=%2Fterminus%2Fm%2Finbox`))}</>}
  {!ALPHA_DEMO&&inbox.consent&&<View style={{gap:8}}>{button(t('alpha.refresh'),()=>void inbox.connect())}{inbox.accounts.map(row=><Row key={row.id} title={row.name} subtitle={t('alpha.select_account')} onPress={()=>void inbox.selectAccount(row)}/>)}</View>}
  {inbox.busy&&<Text accessibilityLiveRegion="polite" style={text}>{t('alpha.loading')}</Text>}
  {!!inbox.error&&<Text accessibilityRole="alert" style={text}>{t(inbox.error==='HTTP 403'?'alpha.forbidden':'alpha.load_error')}</Text>}
  {inbox.rows.map(row=><Row key={row.id} left={<Avatar name={row.contact_name}/>} title={row.contact_name} subtitle={row.last_message} onPress={()=>{void inbox.open(row);router.push(ALPHA_DEMO?'/inbox-thread?demo=1':'/inbox-thread');}}/>)}
  {inbox.more&&inbox.account&&button(t('alpha.more'),()=>void inbox.selectAccount(inbox.account!,true))}
  {button(t('alpha.home'),()=>router.replace(ALPHA_DEMO?'/?demo=1':'/'))}
 </ScrollView></>;
}
