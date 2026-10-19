import { Stack, router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { HostError, bridgeStatus } from "../lib/hosts";
import { useMachines } from "../lib/machines";
import { t } from "../lib/i18n";
import { useTheme } from "../ui/theme";

/**
 * El camino de desarrollo: un Terminus de la red local por el bridge. También
 * se abre con `terminus-mobile://pair?url=…&token=…`, el enlace que imprime el bridge.
 */
export default function Pair() {
  const theme = useTheme();
  const { pair } = useMachines();
  const params = useLocalSearchParams<{ url?: string; token?: string }>();
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function connect(pairing = { url: url.trim(), token: token.trim() }) {
    setBusy(true);
    setMessage(null);
    try {
      const answer = await bridgeStatus(pairing);
      await pair(pairing);
      setMessage(t("pair.connected", { version: answer.engine.version }));
      router.replace("/");
    } catch (error) {
      setMessage(t("pair.failed", { detail: error instanceof HostError ? error.message : String(error) }));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!params.url || !params.token) return;
    setUrl(params.url);
    setToken(params.token);
    void connect({ url: params.url, token: params.token });
  }, [params.url, params.token]);

  const input = [styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }];
  return (
    <View style={styles.page}>
      <Stack.Screen options={{ title: t("pair.title") }} />
      <Text style={[styles.hint, { color: theme.textMuted }]}>{t("pair.hint")}</Text>
      <Text style={[styles.label, { color: theme.text }]}>{t("pair.url")}</Text>
      <TextInput
        style={input}
        value={url}
        onChangeText={setUrl}
        placeholder="http://100.x.y.z:6780"
        placeholderTextColor={theme.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        testID="pair-url"
      />
      <Text style={[styles.label, { color: theme.text }]}>{t("pair.token")}</Text>
      <TextInput
        style={input}
        value={token}
        onChangeText={setToken}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        testID="pair-token"
      />
      <Pressable
        style={[styles.button, { backgroundColor: theme.primary, opacity: busy || !url || !token ? 0.5 : 1 }]}
        disabled={busy || !url || !token}
        onPress={() => void connect()}
        testID="pair-connect"
      >
        <Text style={[styles.buttonText, { color: theme.onPrimary }]}>{t("pair.connect")}</Text>
      </Pressable>
      {message ? <Text style={[styles.hint, { color: theme.textMuted }]}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 20, gap: 8 },
  hint: { fontSize: 14, lineHeight: 20, marginBottom: 8 },
  label: { fontSize: 13, fontWeight: "600", marginTop: 8 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  button: { marginTop: 16, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  buttonText: { fontSize: 16, fontWeight: "600" },
});
