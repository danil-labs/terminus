import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BridgeError } from "../../lib/bridge";
import { useConnection } from "../../lib/connection";
import { t } from "../../lib/i18n";
import { startTask } from "../../lib/start";
import { lastAgent, spaceName, useWorkspaces } from "../../lib/workspaces";
import { openTask } from "../../ui/components";
import { useTheme } from "../../ui/theme";
import { KeyboardScreen } from "../../ui/KeyboardScreen";

/** "Nueva" of the tab bar, and the "+" of a folder: where, with whom, and what. */
export default function NewTask() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ folder?: string; handler?: string }>();
  const { pairing } = useConnection();
  const { current, snapshot, space } = useWorkspaces();
  const folders = (snapshot?.folders ?? []).filter((f) => space?.folders.includes(f.id));
  const [folder, setFolder] = useState<string | null>(null);
  const [handler, setHandler] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (params.folder) setFolder(params.folder);
    setHandler(params.handler ?? null);
  }, [params.folder, params.handler]);

  const target = folders.some((f) => f.id === folder) ? folder : (folders[0]?.id ?? null);
  const agents = (snapshot?.handlers ?? []).filter((h) => target && h.folders.includes(target));
  const tasks = snapshot?.tasks ?? [];
  const defaults = lastAgent(handler ? tasks.filter((task) => task.encargado === handler) : []) ?? lastAgent(tasks);
  const ready = Boolean(pairing && current && target && defaults && message.trim()) && !busy;

  async function start() {
    if (!pairing || !current || !target || !defaults) return;
    setBusy(true);
    setNote(null);
    try {
      const task = await startTask(
        pairing,
        { workspace: current.id, folder: target },
        { message: message.trim(), space: space?.id, ...(handler ? { handler } : {}), ...defaults },
      );
      setMessage("");
      openTask(current.id, target, task);
    } catch (error) {
      setNote(t("task.error", { detail: error instanceof BridgeError ? error.message : String(error) }));
    } finally {
      setBusy(false);
    }
  }

  const chip = (active: boolean) => [styles.chip, { borderColor: theme.border, backgroundColor: active ? theme.primary : theme.surface }];
  const chipText = (active: boolean) => ({ color: active ? theme.onPrimary : theme.text, fontWeight: active ? ("700" as const) : ("500" as const) });

  return (
    <KeyboardScreen style={{ backgroundColor: theme.bg }}>
      <ScrollView contentContainerStyle={[styles.body, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 96 }]} keyboardShouldPersistTaps="handled">
        <Text style={[styles.title, { color: theme.text }]}>{t("new.title")}</Text>
        <Text style={{ color: theme.textMuted }}>
          {current?.name}
          {space ? ` · ${spaceName(space, t("space.general"))}` : ""}
        </Text>

        <Text style={[styles.label, { color: theme.textMuted }]}>{t("new.folder")}</Text>
        <View style={styles.chips}>
          {folders.map((f) => (
            <Pressable key={f.id} testID={`folder-${f.id}`} style={chip(f.id === target)} onPress={() => setFolder(f.id)}>
              <Text style={chipText(f.id === target)}>{f.name}</Text>
            </Pressable>
          ))}
        </View>

        {agents.length ? (
          <>
            <Text style={[styles.label, { color: theme.textMuted }]}>{t("new.agent")}</Text>
            <View style={styles.chips}>
              <Pressable style={chip(!handler)} onPress={() => setHandler(null)}>
                <Text style={chipText(!handler)}>{t("new.no_agent")}</Text>
              </Pressable>
              {agents.map((h) => (
                <Pressable key={h.name} testID={`handler-${h.name}`} style={chip(handler === h.name)} onPress={() => setHandler(h.name)}>
                  <Text style={chipText(handler === h.name)}>{h.name}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        <TextInput
          testID="new-message"
          style={[styles.input, { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border }]}
          value={message}
          onChangeText={setMessage}
          placeholder={t("new.placeholder")}
          placeholderTextColor={theme.textMuted}
          multiline
        />
        {!defaults ? <Text style={{ color: theme.textMuted }}>{t("space.no_agent")}</Text> : null}
        {note ? <Text style={{ color: theme.textMuted }}>{note}</Text> : null}
        <Pressable testID="new-start" disabled={!ready} onPress={start} style={[styles.start, { backgroundColor: theme.primary, opacity: ready ? 1 : 0.5 }]}>
          <Text style={{ color: theme.onPrimary, fontWeight: "700", fontSize: 16 }}>{t("new.start")}</Text>
        </Pressable>
      </ScrollView>
    </KeyboardScreen>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  body: { paddingHorizontal: 16, gap: 8 },
  title: { fontSize: 28, fontWeight: "800" },
  label: { fontSize: 13, fontWeight: "700", textTransform: "uppercase", marginTop: 14 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7 },
  input: { marginTop: 16, minHeight: 140, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12, fontSize: 16, textAlignVertical: "top" },
  start: { marginTop: 8, borderRadius: 12, paddingVertical: 13, alignItems: "center" },
});
