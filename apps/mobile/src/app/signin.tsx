import { TEXT } from "@terminus/design";
import { Redirect, router } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { type OAuthProvider, useAccount } from "../lib/account";
import { BRIDGE_ENABLED } from "../lib/bridge";
import { t } from "../lib/i18n";
import { useTheme } from "../ui/theme";

/**
 * Entrar con la cuenta de Danil, como en app.danil.ai: correo y contraseña, o
 * Google y Microsoft por el navegador del sistema (PKCE). El teléfono solo
 * guarda la sesión de Supabase, en el llavero.
 */
export default function SignIn() {
  const theme = useTheme();
  const { session, signInWithPassword, signInWithProvider } = useAccount();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (session) return <Redirect href="/" />;

  async function run(work: () => Promise<string | null>) {
    setBusy(true);
    setMessage(null);
    const failure = await work().catch((error: unknown) => (error instanceof Error ? error.message : String(error)));
    setBusy(false);
    if (failure) setMessage(t("signin.failed", { detail: failure }));
  }
  const provider = (p: OAuthProvider, label: string) => (
    <Pressable
      testID={`signin-${p}`}
      disabled={busy}
      onPress={() => void run(() => signInWithProvider(p))}
      style={[styles.button, styles.secondary, { borderColor: theme.border, backgroundColor: theme.surface, opacity: busy ? 0.5 : 1 }]}
    >
      <Text style={[styles.buttonText, { color: theme.text }]}>{label}</Text>
    </Pressable>
  );
  const input = [styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }];
  const ready = Boolean(email.trim() && password) && !busy;

  return (
    <ScrollView contentContainerStyle={[styles.page, { backgroundColor: theme.bg }]} keyboardShouldPersistTaps="handled">
      <Text style={[styles.title, { color: theme.text }]}>{t("signin.title")}</Text>
      <Text style={[styles.hint, { color: theme.textMuted }]}>{t("signin.hint")}</Text>
      {provider("google", t("signin.google"))}
      {provider("azure", t("signin.microsoft"))}
      <View style={[styles.rule, { backgroundColor: theme.border }]} />
      <TextInput
        testID="signin-email"
        style={input}
        value={email}
        onChangeText={setEmail}
        placeholder={t("signin.email")}
        placeholderTextColor={theme.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        keyboardType="email-address"
        textContentType="username"
      />
      <TextInput
        testID="signin-password"
        style={input}
        value={password}
        onChangeText={setPassword}
        placeholder={t("signin.password")}
        placeholderTextColor={theme.textMuted}
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
        onSubmitEditing={() => ready && void run(() => signInWithPassword(email, password))}
      />
      <Pressable
        testID="signin-submit"
        disabled={!ready}
        onPress={() => void run(() => signInWithPassword(email, password))}
        style={[styles.button, { backgroundColor: theme.primary, opacity: ready ? 1 : 0.5 }]}
      >
        <Text style={[styles.buttonText, { color: theme.onPrimary }]}>{t("signin.submit")}</Text>
      </Pressable>
      {message ? <Text style={[styles.hint, { color: theme.textMuted }]}>{message}</Text> : null}
      {BRIDGE_ENABLED ? (
        <Pressable testID="signin-bridge" onPress={() => router.push("/pair")} style={styles.dev}>
          <Text style={{ color: theme.textMuted, textDecorationLine: "underline" }}>{t("signin.dev_bridge")}</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flexGrow: 1, padding: 24, paddingTop: 96, gap: 10 },
  title: { fontSize: 28, fontWeight: "800" },
  hint: { fontSize: TEXT.lead, lineHeight: 21, marginBottom: 8 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, fontSize: 16 },
  button: { borderRadius: 12, paddingVertical: 13, alignItems: "center" },
  secondary: { borderWidth: 1 },
  buttonText: { fontSize: 16, fontWeight: "600" },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: 8 },
  dev: { marginTop: 24, alignItems: "center" },
});
