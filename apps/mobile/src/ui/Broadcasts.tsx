import { RADIUS, TEXT } from "@terminus/design";
import { Text, View } from 'react-native';
import { t } from '../lib/i18n';
import { useTheme } from './theme';

export function Broadcasts() {
  const theme = useTheme();
  return <View style={{ minWidth: 0, gap: 16, padding: 16 }}>
    <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 18, fontWeight: '600' }}>{t('customize.broadcasts')}</Text>
    <Text style={{ color: theme.textMuted, fontSize: TEXT.label }}>{t('customize.prototype')}</Text>
    <View style={{ borderWidth: 1, borderColor: theme.border, borderRadius: RADIUS.lg, backgroundColor: theme.muted, padding: 12 }}><Text style={{ color: theme.textMuted, fontSize: TEXT.ui, lineHeight: 20 }}>{t('customize.broadcast_notice')}</Text></View>
    <Text style={{ color: theme.textMuted, fontSize: TEXT.label }}>{t('customize.synthetic_campaigns')}</Text>
    <View style={{ borderTopWidth: 1, borderBottomWidth: 1, borderColor: theme.border, paddingVertical: 14, gap: 8 }}>
      <Text style={{ color: theme.text, fontSize: TEXT.lead, fontWeight: '600' }}>{t('customize.sample_campaign')}</Text>
      <Text style={{ color: theme.textMuted, fontSize: TEXT.ui }}>{t('customize.channel')}: WhatsApp</Text>
      <Text style={{ color: theme.textMuted, fontSize: TEXT.ui }}>{t('customize.state')}: {t('customize.draft')}</Text>
    </View>
    <Text style={{ color: theme.textMuted, fontSize: TEXT.ui }}>{t('customize.new_unavailable')}</Text>
  </View>;
}
