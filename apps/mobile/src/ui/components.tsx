import { router } from "expo-router";
import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { t } from "../lib/i18n";
import { useTheme } from "./theme";

/** A square with the first letter, like a workspace or a person in Slack. */
export function Avatar({ name, size = 32, round = false }: { name: string; size?: number; round?: boolean }) {
  const theme = useTheme();
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: round ? size / 2 : size / 4, backgroundColor: theme.primary }]}>
      <Text style={{ color: theme.onPrimary, fontWeight: "700", fontSize: size * 0.45 }}>{name.trim().charAt(0).toUpperCase() || "?"}</Text>
    </View>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <Text style={[styles.section, { color: theme.textMuted }]}>{children}</Text>;
}

export function Row({
  left,
  title,
  subtitle,
  right,
  bold,
  onPress,
  testID,
}: {
  left?: ReactNode;
  title: string;
  subtitle?: ReactNode;
  right?: ReactNode;
  bold?: boolean;
  onPress?: () => void;
  testID?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable testID={testID} onPress={onPress} style={({ pressed }) => [styles.row, { backgroundColor: pressed ? theme.muted : "transparent" }]}>
      {left}
      <View style={styles.rowBody}>
        <Text numberOfLines={1} style={[styles.rowTitle, { color: theme.text, fontWeight: bold ? "700" : "500" }]}>
          {title}
        </Text>
        {typeof subtitle === "string" ? (
          <Text numberOfLines={1} style={{ color: theme.textMuted, fontSize: 13 }}>
            {subtitle}
          </Text>
        ) : (
          subtitle
        )}
      </View>
      {right}
    </Pressable>
  );
}

export function Badge({ count, color }: { count: number; color?: string }) {
  const theme = useTheme();
  if (!count) return null;
  return (
    <View style={[styles.badge, { backgroundColor: color ?? theme.error }]}>
      <Text style={styles.badgeText}>{count > 99 ? "99+" : count}</Text>
    </View>
  );
}

export function Dot({ color }: { color: string }) {
  return <View style={[styles.dot, { backgroundColor: color }]} />;
}

/** Abre una tarea en la máquina que la corre. */
export function openTask(host: string, workspace: string, folder: string, id: string) {
  router.push({ pathname: "/task/[host]/[workspace]/[folder]/[id]", params: { host, workspace, folder: folder || "_", id } });
}

/** The box at the bottom of a channel or a conversation. */
export function Composer({ placeholder, onSend, testID }: { placeholder: string; onSend: (text: string) => Promise<boolean>; testID?: string }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  async function send() {
    const text = draft.trim();
    if (!text) return;
    setBusy(true);
    setDraft("");
    if (!(await onSend(text))) setDraft(text);
    setBusy(false);
  }
  return (
    <View style={[styles.composer, { borderColor: theme.border, backgroundColor: theme.surface, paddingBottom: 8 + insets.bottom }]}>
      <TextInput
        testID={testID}
        style={[styles.input, { color: theme.text, backgroundColor: theme.muted }]}
        value={draft}
        onChangeText={setDraft}
        placeholder={placeholder}
        placeholderTextColor={theme.textMuted}
        multiline
      />
      <Pressable
        style={[styles.send, { backgroundColor: theme.primary, opacity: draft.trim() && !busy ? 1 : 0.5 }]}
        disabled={!draft.trim() || busy}
        onPress={send}
      >
        <Text style={{ color: theme.onPrimary, fontWeight: "600" }}>{t("task.send")}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: { alignItems: "center", justifyContent: "center" },
  section: { paddingHorizontal: 16, paddingTop: 18, paddingBottom: 6, fontSize: 13, fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 9 },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 16 },
  badge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, alignItems: "center", justifyContent: "center" },
  badgeText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  dot: { width: 8, height: 8, borderRadius: 4 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8, padding: 8, borderTopWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 15, maxHeight: 140 },
  send: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
});
