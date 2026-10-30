import { RADIUS, TEXT } from "@terminus/design";
import { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { Permission } from "../lib/engine";
import { t, w } from "../lib/i18n";
import { useTheme } from "./theme";

const MONO = Platform.select({ ios: "Menlo", default: "monospace" });
/** Arriba de esto el comando se corta: los botones siguen a la vista y nadie aprueba sin poder leerlo. */
const SHOWN_LINES = 6;
const isLong = (text: string) => text.split("\n").length > SHOWN_LINES || text.length > 260;

/** Aprobar o rechazar, en el chat y en la hoja. `busy`: la decisión ya salió y no se manda dos veces. */
export function PermissionCard({ permission, position, disabled, busy, onDecide }: { permission: Permission; position?: { current: number; total: number } | null; disabled: boolean; busy: boolean; onDecide: (allow: boolean) => void }) {
  const theme = useTheme();
  const [full, setFull] = useState(false);
  const off = disabled || busy;
  const target = permission.target;
  return (
    <View style={[styles.card, { borderColor: theme.approving, backgroundColor: theme.surface }]} testID="permission">
      <View style={styles.head}>
        <Text style={{ flex: 1, color: theme.text, fontWeight: "600" }}>{t("task.permission", { tool: permission.tool })}</Text>
        {position ? <Text style={{ color: theme.textMuted, fontSize: TEXT.ui }}>{t("task.permission.position", position)}</Text> : null}
      </View>
      {target ? (
        <Text selectable numberOfLines={isLong(target) && !full ? SHOWN_LINES : undefined} style={[styles.code, { color: theme.text, backgroundColor: theme.muted }]}>
          {target}
        </Text>
      ) : null}
      {target && isLong(target) ? (
        <Pressable onPress={() => setFull((now) => !now)} hitSlop={8} style={styles.more}>
          <Text style={{ color: theme.text, fontSize: TEXT.ui, textDecorationLine: "underline" }}>{w(full ? "chat.timeline.command.show_less" : "chat.timeline.command.show_all")}</Text>
        </Pressable>
      ) : null}
      <View style={styles.actions}>
        <Pressable disabled={off} style={[styles.action, { backgroundColor: theme.muted, opacity: off ? 0.5 : 1 }]} onPress={() => onDecide(false)} testID="deny">
          <Text style={{ color: theme.text }}>{t("task.deny")}</Text>
        </Pressable>
        <Pressable disabled={off} style={[styles.action, { backgroundColor: theme.primary, opacity: off ? 0.5 : 1 }]} onPress={() => onDecide(true)} testID="allow">
          <Text style={{ color: theme.onPrimary, fontWeight: "600" }}>{t("task.allow")}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 10 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  code: { fontFamily: MONO, fontSize: TEXT.ui, padding: 8, borderRadius: RADIUS.lg },
  more: { alignSelf: "flex-start", paddingVertical: 4 },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  action: { borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
});
