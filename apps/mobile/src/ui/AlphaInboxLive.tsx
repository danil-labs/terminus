import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { createInbox, type Account, type Conversation, type Message } from "../../../../packages/attention/src/inbox.ts";
import { useAccount } from "../lib/account";
import { t } from "../lib/i18n";
import { Row, SectionTitle } from "./components";
import { useTheme } from "./theme";

/** Lectura explícita sin caché persistente; las respuestas viejas no cruzan cuenta o sesión. */
export function AlphaInboxLive({ exit }: { exit(): void }) {
  const session = useAccount();
  const theme = useTheme();
  const api = useMemo(() => createInbox(session), [session.getToken, session.unauthorized]);
  const generation = useRef(0);
  const [panel, setPanel] = useState<"inbox" | "agent" | "spaces">("inbox");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [account, setAccount] = useState<Account | null>(null);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  useEffect(() => {
    generation.current++;
    setAccounts([]); setAccount(null); setConversation(null); setConversations([]); setMessages([]); setMore(false); setError(false); setBusy(false);
    return () => { generation.current++; };
  }, [session.session?.user.id]);
  async function load(nextAccount: Account | null, nextConversation: Conversation | null, append = false) {
    const request = ++generation.current;
    setBusy(true); setError(false); setForbidden(false);
    if (!append) { setMessages([]); setMore(false); }
    setAccount(nextAccount); setConversation(nextConversation);
    try {
      if (!nextAccount) {
        const rows = await api.accounts();
        if (request === generation.current) setAccounts(rows);
      } else if (!nextConversation) {
        if (!append) setConversations([]);
        const page = await api.conversations(nextAccount.id, append ? conversations.length : 0);
        if (request === generation.current) { setConversations(previous => append ? [...previous, ...page.rows.filter(row => !previous.some(old => old.id === row.id))] : page.rows); setMore(page.hasMore); }
      } else {
        const before = append && messages.length ? Math.min(...messages.map(row => row.id)) : undefined;
        const page = await api.messages(nextAccount.id, nextConversation.id, before);
        if (request === generation.current) { setMessages(previous => append ? [...page.rows.filter(row => !previous.some(old => old.id === row.id)), ...previous] : page.rows); setMore(page.hasMore); }
      }
    } catch (cause) { if (request === generation.current) { setError(true); setForbidden(cause instanceof Error && cause.message === "HTTP 403"); } }
    finally { if (request === generation.current) setBusy(false); }
  }
  const button = (label: string, press: () => void) => <Pressable accessibilityRole="button" disabled={busy} onPress={press} style={{ padding: 14, borderRadius: 12, borderWidth: 1, borderColor: theme.border, opacity: busy ? 0.5 : 1 }}><Text style={{ color: theme.primary }}>{label}</Text></Pressable>;
  function signIn() {
    if (Platform.OS !== "web") return;
    const WEB_LOGIN = process.env.EXPO_PUBLIC_TERMINUS_WEB_LOGIN || "/";
    let login: URL;
    try { login = new URL(WEB_LOGIN, window.location.origin); } catch { setError(true); return; }
    if (login.origin !== window.location.origin || !["http:", "https:"].includes(login.protocol)) { setError(true); return; }
    login.searchParams.set("next", "/terminus/m/inbox");
    window.location.assign(login.toString());
  }
  if (panel !== "inbox") return <View style={{ gap: 18 }}><SectionTitle>{t(panel === "agent" ? "alpha.agent" : "alpha.spaces")}</SectionTitle><Text style={{ color: theme.text }}>{t("alpha.config_unavailable")}</Text>{button(t("alpha.back"), () => setPanel("inbox"))}</View>;
  if (Platform.OS !== "web" || !session.session) return <View style={{ gap: 14 }}><Text style={{ color: theme.text }}>{t("alpha.signin")}</Text>{Platform.OS === "web" && button(t("alpha.login"), signIn)}{error && <Text style={{ color: theme.text }}>{t("alpha.login_error")}</Text>}{button(t("alpha.back"), exit)}</View>;
  return <View style={{ gap: 18 }}>
    <Text style={{ color: theme.textMuted }}>{t("alpha.real_notice")}</Text>
    {button(t("alpha.agent"), () => setPanel("agent"))}
    {button(t("alpha.spaces"), () => setPanel("spaces"))}
    {account && <SectionTitle>{account.name}</SectionTitle>}
    {conversation && <SectionTitle>{conversation.contact_name}</SectionTitle>}
    {button(t("alpha.refresh"), () => void load(account, conversation))}
    {!account && accounts.map(row => <Row key={row.id} title={row.name} subtitle={t("alpha.select_account")} onPress={() => void load(row, null)} />)}
    {account && !conversation && conversations.map(row => <Row key={row.id} title={row.contact_name || t("alpha.customer")} subtitle={row.last_message} onPress={() => void load(account, row)} />)}
    {conversation && messages.filter(row => !row.deleted_at).map(row => <View key={row.id} style={{ padding: 14, borderRadius: 12, backgroundColor: row.direction === "inbound" ? theme.surface : theme.muted }}><Text style={{ color: theme.text }}>{row.content || t("alpha.no_text")}</Text></View>)}
    {busy && <Text accessibilityLiveRegion="polite" style={{ color: theme.textMuted }}>{t("alpha.loading")}</Text>}
    {error && <Text accessibilityRole="alert" style={{ color: theme.text }}>{t(forbidden ? "alpha.forbidden" : "alpha.load_error")}</Text>}
    {!busy && !error && (account ? conversation ? messages.length === 0 : conversations.length === 0 : accounts.length === 0) && <Text style={{ color: theme.textMuted }}>{t("alpha.empty")}</Text>}
    {more && button(t("alpha.more"), () => void load(account, conversation, true))}
    {account && button(t("alpha.back"), () => void load(conversation ? account : null, null))}
    {button(t("alpha.exit_real"), exit)}
  </View>;
}
