import { useEffect, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { accessRequested, sendAccessRequest, validPhone } from "../lib/access-request";
import { useAccount } from "../lib/account";
import { ALPHA_DEMO } from "../lib/alpha-mode";
import { lang, w } from "../lib/i18n";
import { useMachines } from "../lib/machines";
import { useTheme } from "./theme";

const POINTS = ["platform", "teams", "permissions"] as const;

/** La web de alfa, sin demostración ni bridge, con la lista leída y ningún workspace en ninguna parte. */
export function useNeedsAccess() {
  const { session } = useAccount();
  const { fleet, contextReady, hosts, registry, pairing } = useMachines();
  if (process.env.EXPO_PUBLIC_TERMINUS_ALPHA !== "1" || Platform.OS !== "web" || ALPHA_DEMO || !session || pairing) return false;
  if (!contextReady || (fleet !== "ok" && fleet !== "no_account")) return false;
  // `registry` en null: no se pudo leer; nadie que pertenece debe caer aquí.
  return registry !== null && registry.length === 0 && !hosts.some((host) => (host.linked?.size ?? 0) > 0);
}

/** Quien entra a alfa sin workspace: qué se puede hacer con Danil y su solicitud. Nada de conectar máquinas. */
export function AccessRequest() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { email, getToken, unauthorized, signOut } = useAccount();
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    // Si no se pudo leer, se ve el formulario: el BFF no duplica una solicitud ya enviada.
    void accessRequested({ getToken, unauthorized }).then(setSent, () => {});
  }, [getToken, unauthorized]);

  async function submit() {
    if (busy) return;
    if (!validPhone(phone)) return setError(w("web.access.phone_invalid"));
    setBusy(true);
    setError("");
    try {
      await sendAccessRequest({ getToken, unauthorized }, { phone, name, company, locale: lang });
      setSent(true);
    } catch {
      setError(w("web.access.failed"));
    } finally {
      setBusy(false);
    }
  }

  const field = [styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }];
  const label = [styles.label, { color: theme.textMuted }];
  return (
    <ScrollView
      style={[StyleSheet.absoluteFill, { backgroundColor: theme.bg }]}
      contentContainerStyle={[styles.page, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 32 }]}
      keyboardShouldPersistTaps="handled"
      testID="access-request"
    >
      <Text style={[styles.brand, { color: theme.text }]}>Danil</Text>
      <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>{w(sent ? "web.access.sent_title" : "web.access.title")}</Text>
      {sent ? null : <Text style={[styles.body, { color: theme.textMuted }]}>{w("web.access.intro")}</Text>}

      <Text accessibilityRole="header" style={[styles.heading, { color: theme.text }]}>{w("web.access.what")}</Text>
      <Text style={[styles.body, { color: theme.text }]}>{w("web.access.lead")}</Text>
      {POINTS.map((point) => (
        <View key={point} style={styles.point}>
          <Text style={[styles.pointTitle, { color: theme.text }]}>{w(`web.access.${point}_title`)}</Text>
          <Text style={[styles.body, { color: theme.textMuted }]}>{w(`web.access.${point}`)}</Text>
        </View>
      ))}

      {sent ? (
        <View style={[styles.sent, { borderColor: theme.border }]} accessibilityRole="alert" testID="access-sent">
          <Text style={[styles.body, { color: theme.text }]}>{w("web.access.sent")}</Text>
        </View>
      ) : (
        <View style={styles.form}>
          <Text accessibilityRole="header" style={[styles.heading, { color: theme.text }]}>{w("web.access.form_title")}</Text>
          <Text style={label}>{w("web.access.email")}</Text>
          <TextInput style={[field, { color: theme.textMuted }]} value={email ?? ""} editable={false} accessibilityLabel={w("web.access.email")} />
          <Text style={label}>{w("web.access.phone")}</Text>
          <TextInput style={field} value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" maxLength={40} accessibilityLabel={w("web.access.phone")} testID="access-phone" />
          <Text style={label}>{w("web.access.name")}</Text>
          <TextInput style={field} value={name} onChangeText={setName} autoComplete="name" maxLength={120} accessibilityLabel={w("web.access.name")} testID="access-name" />
          <Text style={label}>{w("web.access.company")}</Text>
          <TextInput style={field} value={company} onChangeText={setCompany} maxLength={160} accessibilityLabel={w("web.access.company")} testID="access-company" />
          {error ? <Text style={[styles.error, { color: theme.error }]} accessibilityRole="alert" testID="access-error">{error}</Text> : null}
          <Pressable style={[styles.submit, { backgroundColor: theme.primary, opacity: busy ? 0.6 : 1 }]} disabled={busy} onPress={() => void submit()} accessibilityRole="button" testID="access-submit">
            <Text style={[styles.submitText, { color: theme.onPrimary }]}>{w(busy ? "web.access.sending" : "web.access.submit")}</Text>
          </Pressable>
        </View>
      )}

      <Text style={[styles.account, { color: theme.textMuted }]}>{w("web.auth.active_account", { email: email ?? "" })}</Text>
      <Pressable style={styles.change} onPress={() => void signOut()} accessibilityRole="button" testID="access-change-account">
        <Text style={[styles.changeText, { color: theme.text }]}>{w("web.auth.change_account")}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 24, gap: 8, width: "100%", maxWidth: 480, alignSelf: "center" },
  brand: { fontSize: 28, fontWeight: "700", letterSpacing: -0.8, marginBottom: 12 },
  title: { fontSize: 20, fontWeight: "600" },
  heading: { fontSize: 16, fontWeight: "600", marginTop: 20 },
  body: { fontSize: 14, lineHeight: 20 },
  point: { marginTop: 8, gap: 2 },
  pointTitle: { fontSize: 14, fontWeight: "600" },
  form: { gap: 6 },
  label: { fontSize: 12, marginTop: 8 },
  input: { minHeight: 44, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, fontSize: 16 },
  error: { fontSize: 14, marginTop: 8 },
  submit: { minHeight: 44, borderRadius: 8, alignItems: "center", justifyContent: "center", marginTop: 12 },
  submitText: { fontSize: 14, fontWeight: "600" },
  sent: { borderWidth: 1, borderRadius: 8, padding: 16, gap: 4, marginTop: 20 },
  account: { fontSize: 14, marginTop: 28 },
  change: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
  changeText: { fontSize: 14, fontWeight: "500" },
});
