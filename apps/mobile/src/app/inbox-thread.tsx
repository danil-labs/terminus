import { RADIUS, TEXT } from "@terminus/design";
import { Redirect, router, usePathname } from "expo-router";
import { ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { contactDisplayName } from "../../../../packages/attention/src/inbox.ts";
import { ALPHA_DEMO } from "../lib/alpha-mode";
import { useCustomization } from "../lib/customization";
import { t, w } from "../lib/i18n";
import { useInbox } from "../lib/inbox";
import { Icon } from "../ui/Icon";
import { KeyboardScreen } from "../ui/KeyboardScreen";
import { NavBar, pageColor, RoundButton, Tap } from "../ui/list";
import { CHANNEL_COLORS } from "../ui/InboxParts";
import { useTheme } from "../ui/theme";

/**
 * La conversación del Inbox, como en Danil Agents: blanco el contacto y verde
 * WhatsApp lo que sale, marcado «Danil IA» o «Equipo». Asistencia IA se ve
 * pero no se cambia, y la caja de respuesta está deshabilitada y dice por
 * qué: el Inbox es de solo lectura en este alfa. Los datos del contacto se
 * abren desde la ficha de la cabecera.
 */
export default function InboxThread() {
  const pathname = usePathname();
  const customization = useCustomization();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const inbox = useInbox();
  if (!customization.ready) return null;
  if (!customization.enabled("inbox")) return pathname.endsWith("/inbox-thread") ? <Redirect href={ALPHA_DEMO ? "/?demo=1" : "/"} /> : null;
  const row = inbox.selected;
  const name = row ? contactDisplayName(row, t("customize.unknown")) : t("alpha.title");
  const outgoing = theme.dark ? "#1d3b2a" : "#d9fdd3";
  const outgoingBorder = theme.dark ? "#2d5a3f" : "#b7e4a0";

  return (
    <KeyboardScreen>
      <View style={{ flex: 1, backgroundColor: pageColor(theme) }}>
        <NavBar
          back={w("search.chip.inbox")}
          title={name}
          subtitle={row?.channel_name ? (
            <View style={styles.sub}>
              <View style={[styles.dot, { backgroundColor: CHANNEL_COLORS.whatsapp }]} />
              <Text numberOfLines={1} style={{ color: theme.textMuted, fontSize: TEXT.label }}>{row.channel_name}</Text>
            </View>
          ) : undefined}
          right={row ? <RoundButton testID="inbox-contact" icon="id-card" label={w("web.alpha.details")} onPress={() => router.push(ALPHA_DEMO ? "/inbox-detail?demo=1" : "/inbox-detail")} /> : null}
        />
        <View style={[styles.assist, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={{ color: theme.text, fontWeight: "700", fontSize: TEXT.body }}>{w("web.alpha.ai_assistance")}</Text>
          <Text numberOfLines={1} style={{ color: theme.textMuted, fontSize: TEXT.ui, flex: 1 }}>{w("web.alpha.ai_read_only")}</Text>
          <Switch disabled value={row?.ai_assistance ?? false} trackColor={{ true: `${theme.merged}88`, false: theme.border }} thumbColor="#ffffff"
                        {...({ activeThumbColor: "#ffffff" } as object)} accessibilityLabel={w("web.alpha.ai_assistance")} />
        </View>
        <ScrollView contentContainerStyle={styles.thread}>
          {inbox.busy ? <Text style={[styles.note, { color: theme.textMuted }]}>{t("alpha.loading")}</Text> : null}
          {inbox.error ? (
            <Tap accessibilityRole="button" onPress={() => row && void inbox.open(row)} style={styles.retry}>
              <Text accessibilityRole="alert" style={{ color: theme.text }}>{t(inbox.error === "HTTP 403" ? "alpha.forbidden" : "alpha.load_error")}</Text>
              <Text style={{ color: theme.merged }}>{t("customize.retry")}</Text>
            </Tap>
          ) : null}
          {!row ? <Text style={[styles.note, { color: theme.textMuted }]}>{t("alpha.empty")}</Text> : null}
          {inbox.older && row ? (
            <Tap accessibilityRole="button" onPress={() => void inbox.open(row, true)} style={styles.retry}>
              <Text style={{ color: theme.merged }}>{w("web.alpha.older")}</Text>
            </Tap>
          ) : null}
          {inbox.messages.map((message) => {
            const out = message.direction === "outbound";
            const who = message.sender_type === "ai-agent" ? w("web.alpha.sender_ai") : message.sender_type === "human-agent" ? w("web.alpha.sender_team") : null;
            return (
              <View key={message.id} style={[styles.bubble, out ? [styles.out, { backgroundColor: outgoing, borderColor: outgoingBorder }] : [styles.in, { backgroundColor: theme.surface, borderColor: theme.border }]]}>
                <Text selectable style={{ color: theme.text, fontSize: 16, lineHeight: 22, fontStyle: message.deleted_at ? "italic" : "normal" }}>
                  {message.deleted_at ? w("web.alpha.deleted") : message.content || t("alpha.no_text")}
                </Text>
                {out && who ? <Text style={[styles.who, { color: theme.text }]}>{who}</Text> : null}
              </View>
            );
          })}
        </ScrollView>
        <View style={[styles.footer, { paddingBottom: insets.bottom + 8 }]}>
          <Text style={[styles.unavailable, { color: theme.textMuted }]}>{w("web.alpha.send_unavailable")}</Text>
          <View style={styles.composer}>
            <View style={[styles.round, { backgroundColor: theme.border }]}><Icon name="paperclip" size={18} color={theme.textMuted} /></View>
            <TextInput editable={false} placeholder={w("web.alpha.reply_placeholder")} placeholderTextColor={theme.textMuted} accessibilityLabel={w("web.alpha.reply_placeholder")} style={[styles.input, { backgroundColor: theme.surface, borderColor: theme.border, color: theme.text }]} />
            <View style={[styles.round, { backgroundColor: theme.border }]}><Icon name="arrow-up" size={18} color={theme.textMuted} /></View>
          </View>
        </View>
      </View>
    </KeyboardScreen>
  );
}

const styles = StyleSheet.create({
  sub: { flexDirection: "row", alignItems: "center", gap: 4 },
  dot: { width: 8, height: 8, borderRadius: RADIUS.sm },
  assist: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, minHeight: 48, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  thread: { padding: 16, gap: 8 },
  note: { textAlign: "center", fontSize: TEXT.ui },
  retry: { alignItems: "center", gap: 4, padding: 8, borderRadius: RADIUS.lg },
  bubble: { maxWidth: "82%", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, gap: 4 },
  in: { alignSelf: "flex-start", borderTopLeftRadius: 6 },
  out: { alignSelf: "flex-end", borderTopRightRadius: 6 },
  who: { alignSelf: "flex-end", fontSize: 11.5, fontWeight: "700" },
  footer: { paddingHorizontal: 12, gap: 8 },
  unavailable: { textAlign: "center", fontSize: 12.5, lineHeight: 17, paddingHorizontal: 12 },
  composer: { flexDirection: "row", alignItems: "center", gap: 8 },
  round: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  input: { flex: 1, minHeight: 44, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, fontSize: 16, opacity: 0.7 },
});
