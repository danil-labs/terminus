import { Redirect, router, usePathname } from "expo-router";
import { useState } from "react";
import { Linking, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  contactDisplayName,
  contactSubIdentifier,
  conversationLabels,
  INBOX_FILTERS,
  type InboxFilter,
  matchesFilter,
} from "../../../../packages/attention/src/inbox.ts";
import { MOBILE_WEB_DIR, RADIUS, TEXT } from "@terminus/design";
import { ALPHA_DEMO, WEB_BASE } from "../lib/alpha-mode";
import { useCustomization } from "../lib/customization";
import { useHomeLabel } from "../lib/homeLabel";
import { lang, t, w } from "../lib/i18n";
import { useInbox } from "../lib/inbox";
import { shortWhen } from "../lib/when";
import { Icon } from "../ui/Icon";
import { Chip, Group, GroupFooter, LargeTitle, ListRow, NavBar, pageColor, Tap } from "../ui/list";
import { type MenuItem, Popover, useMenuAnchor } from "../ui/Popover";
import { CHANNEL_COLORS, ContactAvatar, LabelTag } from "../ui/InboxParts";
import { useTheme } from "../ui/theme";

const FILTER_WORDS: Record<Exclude<InboxFilter, "all">, Parameters<typeof w>[0]> = {
  assistance: "web.alpha.filter_assistance",
  ai_disabled: "web.alpha.filter_ai_disabled",
  ai_blocked: "web.alpha.filter_ai_blocked",
};

/**
 * Inbox (listas nativas v2): fiel al de Danil Agents. Se abre desde Inicio;
 * tarjetas de contacto con su canal, chips de filtro, etiquetas de estado y
 * búsqueda; el canal se filtra con el menú de la cabecera. Es de solo
 * lectura en este alfa.
 */
export default function Inbox() {
  const pathname = usePathname();
  const customization = useCustomization();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const back = useHomeLabel();
  const inbox = useInbox();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [channel, setChannel] = useState<string | null>(null);
  const menu = useMenuAnchor();
  if (!customization.ready) return null;
  if (!customization.enabled("inbox")) return pathname.endsWith("/inbox") ? <Redirect href={ALPHA_DEMO ? "/?demo=1" : "/"} /> : null;

  const q = query.trim().toLowerCase();
  const channels = [...new Set(inbox.rows.map((row) => row.channel_name).filter(Boolean))];
  const rows = inbox.rows.filter((row) =>
    matchesFilter(row, filter) &&
    (!channel || row.channel_name === channel) &&
    (!q || [row.contact_name, row.last_message, row.channel_name, contactSubIdentifier(row)].some((f) => f?.toLowerCase().includes(q))));
  const counts = Object.fromEntries(INBOX_FILTERS.map((f) => [f, inbox.rows.filter((row) => matchesFilter(row, f)).length]));
  const items: MenuItem[] = [
    { key: "all", label: w("web.alpha.all_channels"), checked: channel === null, onPress: () => setChannel(null) },
    ...channels.map((name) => ({ key: `c-${name}`, label: name, checked: channel === name, onPress: () => setChannel(name) })),
    ...(inbox.accounts.length > 1 ? inbox.accounts.map((account, i) => ({ key: `a-${account.id}`, label: account.name, icon: "user-round" as const, section: i === 0, checked: inbox.account?.id === account.id, onPress: () => void inbox.selectAccount(account) })) : []),
  ];

  return (
    <View style={{ flex: 1, backgroundColor: pageColor(theme) }}>
      <NavBar
        back={back}
        right={inbox.rows.length || inbox.accounts.length > 1 ? (
          <View ref={menu.ref} collapsable={false}>
            <Tap testID="inbox-channels" accessibilityRole="button" onPress={() => void menu.open()} style={[styles.channels, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <View style={[styles.dot, { backgroundColor: channel ? theme.merged : CHANNEL_COLORS.whatsapp }]} />
              <Text numberOfLines={1} style={{ color: theme.text, fontSize: TEXT.lead, fontWeight: "500", flexShrink: 1 }}>{channel ?? w("web.alpha.all_channels")}</Text>
              <Icon name="chevron-down" size={14} color={theme.textMuted} />
            </Tap>
          </View>
        ) : null}
      />
      <Popover testID="inbox-channel-menu" anchor={menu.rect} items={items} onClose={menu.close} align="end" />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
        <LargeTitle note={
          <View style={styles.note}>
            <Icon name="file-text" size={13} color={theme.textMuted} />
            <Text style={{ color: theme.textMuted, fontSize: TEXT.ui }}>{w("web.alpha.ai_read_only")}</Text>
          </View>
        }>{w("search.chip.inbox")}</LargeTitle>

        {!ALPHA_DEMO && !inbox.consent ? (
          <>
            <GroupFooter>{t("alpha.intro")}</GroupFooter>
            <View style={{ height: 12 }} />
            <Group>
              <ListRow testID="inbox-signin" title={t("alpha.signin")} chevron onPress={() => void Linking.openURL(`${WEB_BASE}sign-in?next=${encodeURIComponent(`${WEB_BASE}${MOBILE_WEB_DIR}/inbox`)}`)} />
            </Group>
          </>
        ) : (
          <>
            <View style={[styles.search, { backgroundColor: theme.dark ? theme.surface : theme.border }]}>
              <Icon name="search" size={16} color={theme.textMuted} />
              <TextInput testID="inbox-search" value={query} onChangeText={setQuery} placeholder={w("search.title")} placeholderTextColor={theme.textMuted} autoCorrect={false} autoCapitalize="none" style={[styles.searchInput, { color: theme.text }]} />
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {INBOX_FILTERS.map((f) => (
                <Chip key={f} testID={`inbox-filter-${f}`} label={f === "all" ? w("search.chip.all") : w(FILTER_WORDS[f])} count={f === "all" ? undefined : counts[f]} active={filter === f} onPress={() => setFilter(f)} />
              ))}
            </ScrollView>
            {!inbox.account && inbox.accounts.length > 1 ? (
              <Group>
                {inbox.accounts.map((account) => <ListRow key={account.id} title={account.name} subtitle={t("alpha.select_account")} chevron onPress={() => void inbox.selectAccount(account)} />)}
              </Group>
            ) : null}
            {inbox.busy ? <GroupFooter>{t("alpha.loading")}</GroupFooter> : null}
            {inbox.error ? <GroupFooter>{t(inbox.error === "HTTP 403" ? "alpha.forbidden" : "alpha.load_error")}</GroupFooter> : null}
            {!inbox.busy && !inbox.error && inbox.account && !rows.length ? <GroupFooter>{w("web.alpha.empty")}</GroupFooter> : null}
            {!inbox.busy && !inbox.error && !ALPHA_DEMO && inbox.consent && inbox.accounts.length === 0 ? <GroupFooter>{t("customize.no_accounts")}</GroupFooter> : null}
            <Group inset={68}>
              {rows.map((row) => (
                <ListRow
                  key={row.id}
                  testID={`inbox-row-${row.id}`}
                  left={<ContactAvatar row={row} />}
                  title={contactDisplayName(row, t("customize.unknown"))}
                  subtitle={
                    <View style={{ gap: 3 }}>
                      <View style={styles.line}>
                        {row.channel_name ? <Text style={[styles.channelTag, { color: theme.text, backgroundColor: theme.muted }]}>{row.channel_name}</Text> : null}
                        <Text numberOfLines={1} style={{ color: theme.textMuted, fontSize: TEXT.ui, flexShrink: 1 }}>{contactSubIdentifier(row) ?? ""}</Text>
                      </View>
                      <View style={styles.line}>
                        <Text numberOfLines={1} style={{ color: theme.textMuted, fontSize: TEXT.body, flex: 1 }}>{row.last_message || t("alpha.no_text")}</Text>
                        {row.unread_count > 0 ? <View style={[styles.unread, { backgroundColor: theme.merged }]}><Text style={styles.unreadText}>{row.unread_count}</Text></View> : null}
                      </View>
                      {conversationLabels(row).length ? <View style={styles.line}>{conversationLabels(row).map((label) => <LabelTag key={label} label={label} theme={theme} />)}</View> : null}
                    </View>
                  }
                  right={<Text style={[styles.when, { color: theme.textMuted }]}>{shortWhen(row.last_message_at, lang)}</Text>}
                  onPress={() => { void inbox.open(row); router.push(ALPHA_DEMO ? "/inbox-thread?demo=1" : "/inbox-thread"); }}
                />
              ))}
            </Group>
            {inbox.more && inbox.account ? (
              <>
                <View style={{ height: 16 }} />
                <Group><ListRow title={t("alpha.more")} onPress={() => void inbox.selectAccount(inbox.account!, true)} /></Group>
              </>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  channels: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 40, paddingHorizontal: 12, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, maxWidth: 220 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  note: { flexDirection: "row", alignItems: "center", gap: 6 },
  search: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16, height: 44, borderRadius: 12, paddingHorizontal: 12 },
  searchInput: { flex: 1, fontSize: 16, minWidth: 0, ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null) },
  chips: { gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  avatar: { alignItems: "center", justifyContent: "center" },
  channelDot: { position: "absolute", right: -1, bottom: -1, width: 13, height: 13, borderRadius: 7, borderWidth: 2 },
  line: { flexDirection: "row", alignItems: "center", gap: 6 },
  channelTag: { fontSize: 11.5, fontWeight: "600", paddingHorizontal: 5, paddingVertical: 1, borderRadius: RADIUS.sm, overflow: "hidden" },
  unread: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, alignItems: "center", justifyContent: "center" },
  unreadText: { color: "#ffffff", fontSize: TEXT.caption, fontWeight: "700" },
  tag: { borderRadius: RADIUS.sm, paddingHorizontal: 5, paddingVertical: 2 },
  when: { fontSize: 12.5, alignSelf: "flex-start", marginTop: 2 },
});
