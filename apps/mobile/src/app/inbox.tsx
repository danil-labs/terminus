import { Stack } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, Switch, View } from "react-native";
import { t } from "../lib/i18n";
import { useAccount } from "../lib/account";
import { AlphaInboxLive } from "../ui/AlphaInboxLive";
import { Avatar, Row, SectionTitle } from "../ui/components";
import { useTheme } from "../ui/theme";

type Page = "list" | "conversation" | "details" | "agent" | "spaces";

/** Alfa explícita: la demo no importa transportes ni conserva datos fuera de esta pantalla. */
export default function AlphaInbox() {
  const theme = useTheme();
  const accountSession = useAccount();
  const [live, setLive] = useState(false);
  const [demo, setDemo] = useState(false);
  const [page, setPage] = useState<Page>("list");
  const [knowledge, setKnowledge] = useState(t("alpha.knowledge_value"));
  const [tool, setTool] = useState(true);
  const [view, setView] = useState(true);
  const [plugin, setPlugin] = useState(false);
  const [draft, setDraft] = useState("");
  const enabled = process.env.EXPO_PUBLIC_TERMINUS_ALPHA === "1";
  const text = { color: theme.text, fontSize: 16, lineHeight: 24 };
  const action = (label: string, onPress: () => void) => (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.action, { borderColor: theme.border }]}>
      <Text style={{ color: theme.primary, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
  const section = (title: string, body: string) => <View style={styles.section}><SectionTitle>{title}</SectionTitle><Text style={text}>{body}</Text></View>;
  return <>
    <Stack.Screen options={{ title: t("alpha.title") }} />
    <ScrollView style={{ backgroundColor: theme.bg }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {!enabled ? <Text style={text}>{t("alpha.unavailable")}</Text> : live ? <AlphaInboxLive key={accountSession.session?.user.id ?? "signed-out"} exit={() => setLive(false)} /> : !demo ? <>
        <Text style={[text, styles.heading]}>{t("alpha.title")}</Text>
        <Text style={text}>{t("alpha.intro")}</Text>
        <Text style={{ color: theme.textMuted }}>{t("alpha.unavailable")}</Text>
        {action(t("alpha.real"), () => setLive(true))}
        {action(t("alpha.demo"), () => setDemo(true))}
      </> : <>
        <View style={[styles.notice, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={{ color: theme.textMuted, lineHeight: 20 }}>{t("alpha.demo_notice")}</Text>
        </View>
        {page !== "list" && action(t("alpha.back"), () => setPage(page === "conversation" || page === "spaces" ? "list" : "conversation"))}
        {page === "list" && <>
          <SectionTitle>{t("alpha.list")}</SectionTitle>
          <Row left={<Avatar name={t("alpha.customer")} />} title={t("alpha.customer")} subtitle={t("alpha.preview")} onPress={() => setPage("conversation")} />
          <Row left={<Avatar name={t("alpha.agent")} />} title={t("alpha.agent")} subtitle={t("alpha.configuration")} onPress={() => setPage("agent")} />
          {action(t("alpha.spaces"), () => setPage("spaces"))}
        </>}
        {page === "conversation" && <>
          <Text style={[text, styles.heading]}>{t("alpha.customer")}</Text>
          <Text style={{ color: theme.textMuted }}>{t("alpha.channel")} · {t("alpha.status")}</Text>
          <View style={[styles.bubble, { backgroundColor: theme.surface }]}><Text style={text}>{t("alpha.message")}</Text></View>
          <View style={[styles.bubble, { backgroundColor: theme.muted }]}><Text style={{ color: theme.primary, fontWeight: "600" }}>{t("alpha.agent")}</Text><Text style={text}>{t("alpha.reply")}</Text></View>
          {action(t("alpha.details"), () => setPage("details"))}
          <SectionTitle>{t("alpha.draft")}</SectionTitle>
          <TextInput multiline accessibilityLabel={t("alpha.draft")} placeholder={t("alpha.placeholder")} placeholderTextColor={theme.textMuted} value={draft} onChangeText={setDraft} style={[styles.input, text, { borderColor: theme.border, backgroundColor: theme.surface }]} />
        </>}
        {page === "details" && <>
          {section(t("alpha.details"), t("alpha.channel"))}
          <Row title={t("alpha.agent")} subtitle={t("alpha.configuration")} onPress={() => setPage("agent")} />
          {section(t("alpha.crm"), t("alpha.reports"))}
        </>}
        {page === "agent" && <>
          <Text style={[text, styles.heading]}>{t("alpha.agent")}</Text>
          <Text style={{ color: theme.textMuted }}>{t("alpha.local_changes")}</Text>
          <SectionTitle>{t("alpha.knowledge")}</SectionTitle>
          <TextInput multiline accessibilityLabel={t("alpha.knowledge")} value={knowledge} onChangeText={setKnowledge} style={[styles.input, text, { borderColor: theme.border, backgroundColor: theme.surface }]} />
          <Row title={t("alpha.catalog_tool")} right={<Switch accessibilityLabel={t("alpha.catalog_tool")} value={tool} onValueChange={setTool} trackColor={{ true: theme.primary, false: theme.border }} />} />
          {section(t("alpha.tools"), t("alpha.tools_value"))}
          {section(t("alpha.integrations"), t("alpha.integrations_value"))}
        </>}
        {page === "spaces" && <>
          {section(t("alpha.spaces"), t("alpha.spaces_value"))}
          <Row title={t("alpha.inbox_view")} right={<Switch accessibilityLabel={t("alpha.inbox_view")} value={view} onValueChange={setView} trackColor={{ true: theme.primary, false: theme.border }} />} />
          <Row title={t("alpha.crm_plugin")} right={<Switch accessibilityLabel={t("alpha.crm_plugin")} value={plugin} onValueChange={setPlugin} trackColor={{ true: theme.primary, false: theme.border }} />} />
          <Text style={{ color: theme.textMuted }}>{t("alpha.local_changes")}</Text>
        </>}
        {action(t("alpha.exit"), () => { setDemo(false); setPage("list"); setDraft(""); setKnowledge(t("alpha.knowledge_value")); setTool(true); setView(true); setPlugin(false); })}
      </>}
    </ScrollView>
  </>;
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 18, paddingBottom: 48 },
  heading: { fontSize: 24, lineHeight: 30, fontWeight: "700" },
  action: { padding: 14, minHeight: 46, borderWidth: 1, borderRadius: 12, alignSelf: "flex-start" },
  notice: { padding: 14, borderWidth: 1, borderRadius: 12 },
  bubble: { padding: 16, borderRadius: 14, gap: 8 },
  section: { gap: 8 },
  input: { minHeight: 110, borderWidth: 1, borderRadius: 12, padding: 14, textAlignVertical: "top" },
});
