import { StyleSheet, Text, View } from "react-native";
import { type Conversation, type ConversationLabel, contactDisplayName, normalizeProvider } from "../../../../packages/attention/src/inbox.ts";
import { w } from "../lib/i18n";
import { type Theme, useTheme } from "./theme";

/** El color de cada canal en el punto del avatar. */
export const CHANNEL_COLORS: Record<string, string> = { whatsapp: "#22c55e", instagram: "#ec4899", messenger: "#3b82f6", web: "#64748b" };

export function LabelTag({ label, theme }: { label: ConversationLabel; theme: Theme }) {
  const tone = label === "human_required" ? theme.approving : label === "ai_paused_loop" ? theme.info : theme.textMuted;
  const text = label === "human_required" ? w("web.alpha.filter_assistance") : label === "ai_paused_loop" ? w("web.alpha.label_ai_paused_loop") : w("web.alpha.ai_off");
  return (
    <View style={[styles.tag, { backgroundColor: `${tone}26` }]}>
      <Text style={{ color: label === "human_required" && !theme.dark ? "#92400e" : tone, fontSize: 11, fontWeight: "700", letterSpacing: 0.4 }}>{text.toLocaleUpperCase()}</Text>
    </View>
  );
}

/** El avatar de un contacto: sus iniciales y el punto de su canal. */
export function ContactAvatar({ row, size = 40 }: { row: Conversation; size?: number }) {
  const theme = useTheme();
  const name = contactDisplayName(row, "?");
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
  const channel = CHANNEL_COLORS[normalizeProvider(row.active_provider)];
  return (
    <View style={{ width: size, height: size }}>
      <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: theme.muted }]}>
        <Text style={{ color: theme.text, fontWeight: "700", fontSize: size * 0.34 }}>{initials || "?"}</Text>
      </View>
      {channel ? <View style={[styles.channelDot, { backgroundColor: channel, borderColor: theme.surface }]} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: { alignItems: "center", justifyContent: "center" },
  channelDot: { position: "absolute", right: -1, bottom: -1, width: 13, height: 13, borderRadius: 7, borderWidth: 2 },
  tag: { borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
});
