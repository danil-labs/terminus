import { Redirect, Stack, usePathname } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { createChannels, type Channel } from '../../../../packages/attention/src/channels.ts';
import { useAccount } from '../lib/account';
import { ALPHA_API, ALPHA_DEMO } from '../lib/alpha-mode';
import { useCustomization } from '../lib/customization';
import { t } from '../lib/i18n';
import { Row } from '../ui/components';
import { useTheme } from '../ui/theme';

const PROVIDERS: Record<string, string> = { whatsapp: 'WhatsApp', whatsapp_cloud: 'WhatsApp', instagram: 'Instagram', messenger: 'Messenger', web: 'Web', simla: 'Simla' };

export default function Channels(){
  const model=useCustomization();const pathname=usePathname();const theme=useTheme();const session=useAccount();
  const enabled=model.ready&&model.enabled('channels');
  const api=useMemo(()=>ALPHA_DEMO||!enabled||!session.session?null:createChannels(session,fetch,ALPHA_API),[session.getToken,session.unauthorized,session.session?.user.id,enabled]);
  const [rows,setRows]=useState<Channel[]>([]);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const generation=useRef(0);
  async function load(){
    if(!api)return;const request=++generation.current;setBusy(true);setError('');
    try{const value=await api.list();if(request===generation.current)setRows(value);}
    catch(cause){if(request===generation.current){setRows([]);setError(cause instanceof Error?cause.message:'');}}
    finally{if(request===generation.current)setBusy(false);}
  }
  useEffect(()=>{generation.current++;setRows([]);setError('');setBusy(false);void load();return()=>{generation.current++;};},[api,model.scope]);
  if(!model.ready)return null;
  if(!model.enabled('channels'))return pathname.endsWith('/channels')?<Redirect href={ALPHA_DEMO?'/?demo=1':'/'}/>:null;
  const text={color:theme.text,fontSize:14,lineHeight:21};
  return <><Stack.Screen options={{title:t('attention.channels')}}/><ScrollView contentContainerStyle={{padding:16,gap:16}}>
    {ALPHA_DEMO?<><Text style={{color:theme.textMuted}}>{t('alpha.demo_notice')}</Text><Text style={text}>{t('attention.desktop_channels')}</Text><Text style={{color:theme.textMuted}}>{t('attention.channels_unavailable')}</Text></>:<>
      <Text style={{color:theme.textMuted}}>{t('attention.channels_live')}</Text>
      <Pressable accessibilityRole="button" disabled={busy} onPress={()=>void load()} style={{padding:14,borderWidth:1,borderColor:theme.border,borderRadius:8}}><Text style={{color:theme.primary}}>{t('alpha.refresh')}</Text></Pressable>
      {busy&&<Text accessibilityLiveRegion="polite" style={text}>{t('alpha.loading')}</Text>}
      {!!error&&<Text accessibilityRole="alert" style={text}>{t(error==='HTTP 403'?'attention.channels_denied':'attention.channels_error')}</Text>}
      {!busy&&!error&&!!api&&rows.length===0&&<Text style={text}>{t('attention.channels_empty')}</Text>}
      <View>{rows.map(row=><Row key={row.id} title={row.name||PROVIDERS[row.provider]||row.provider} subtitle={[PROVIDERS[row.provider]??row.provider,row.identity,t(row.active?'attention.channel_ai_on':'attention.channel_ai_off'),t(`attention.conn_${row.connection}`)].filter(Boolean).join(' · ')}/>)}</View>
    </>}
  </ScrollView></>;
}
