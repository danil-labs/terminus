import { Pressable, Text, View } from 'react-native';
import { t } from '../lib/i18n';
import { useTheme } from './theme';

export type FeatureEntry = { id: string; title: string; description: string; available: boolean; selected: boolean };

export function FeatureCatalog(props: { entries: readonly FeatureEntry[]; onToggle(id: string): void }) {
  const theme = useTheme();
  return <View style={{ minWidth: 0, gap: 4 }}>
    <Text style={{ color: theme.textMuted, fontSize: 13, lineHeight: 20, marginBottom: 12 }}>{t('customize.description')}</Text>
    {props.entries.map(entry => <View key={entry.id} style={{ borderTopWidth: 1, borderColor: theme.border, paddingVertical: 12, gap: 8 }}>
      <Text style={{ color: theme.text, fontSize: 15, fontWeight: '600' }}>{entry.title}</Text>
      <Text style={{ color: theme.textMuted, fontSize: 13, lineHeight: 20 }}>{entry.description}</Text>
      {entry.available ? <Pressable accessibilityRole="button" accessibilityState={{ selected: entry.selected }} accessibilityLabel={`${t(entry.selected ? 'customize.remove' : 'customize.add')} ${entry.title}`} onPress={() => props.onToggle(entry.id)} style={({ pressed }) => ({ alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', borderRadius: 6, borderWidth: 1, borderColor: theme.border, backgroundColor: pressed ? theme.muted : theme.surface, paddingHorizontal: 14 })}><Text style={{ color: theme.text, fontWeight: '600', fontSize: 13 }}>{t(entry.selected ? 'customize.remove' : 'customize.add')}</Text></Pressable> : <Text style={{ color: theme.textMuted, fontSize: 12 }}>{t('customize.unavailable')}</Text>}
    </View>)}
  </View>;
}
