import { Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { BridgeError } from "../../../lib/bridge";
import { useConnection } from "../../../lib/connection";
import { t } from "../../../lib/i18n";
import { startTask } from "../../../lib/start";
import { lastAgent, useTaskStates, useWorkspaces } from "../../../lib/workspaces";
import { Avatar, Composer, TaskItem, openTask } from "../../../ui/components";
import { useTheme } from "../../../ui/theme";
import { KeyboardScreen } from "../../../ui/KeyboardScreen";

/** A handler reads like a direct message: its conversations, and a box to start a new one. */
export default function AgentScreen() {
  const theme = useTheme();
  const { workspace, name } = useLocalSearchParams<{ workspace: string; name: string }>();
  const { pairing } = useConnection();
  const { snapshot } = useWorkspaces();
  const handler = snapshot?.handlers.find((h) => h.name === name);
  const [note, setNote] = useState<string | null>(null);
  const tasks = (snapshot?.tasks ?? []).filter((task) => task.encargado === name);
  const stateOf = useTaskStates(workspace);
  const folder = handler?.folders[0] ?? null;
  const defaults = lastAgent(tasks) ?? lastAgent(snapshot?.tasks ?? []);
  const status = handler ? t(`agent.${handler.status === "working" ? "working" : handler.status === "awake" ? "awake" : "asleep"}` as const) : "";

  async function message(text: string) {
    if (!pairing || !folder || !defaults) return false;
    setNote(null);
    try {
      const task = await startTask(pairing, { workspace, folder }, { message: text, handler: name, ...defaults });
      openTask(workspace, folder, task);
      return true;
    } catch (error) {
      setNote(t("task.error", { detail: error instanceof BridgeError ? error.message : String(error) }));
      return false;
    }
  }

  return (
    <KeyboardScreen>
      <Stack.Screen options={{ title: name }} />
      <FlatList
        data={tasks}
        keyExtractor={(task) => task.id}
        ListHeaderComponent={
          <View style={[styles.profile, { borderColor: theme.border }]}>
            <Avatar name={name} size={56} round />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: theme.text, fontSize: 18, fontWeight: "700" }}>{name}</Text>
              <Text style={{ color: theme.textMuted }}>{status}</Text>
              {handler?.description ? <Text style={{ color: theme.text }}>{handler.description}</Text> : null}
            </View>
          </View>
        }
        renderItem={({ item }) => <TaskItem task={item} state={stateOf(item)} />}
        ListEmptyComponent={<Text style={[styles.empty, { color: theme.textMuted }]}>{t("agent.empty")}</Text>}
      />
      {note ? <Text style={[styles.note, { color: theme.textMuted }]}>{note}</Text> : null}
      <Composer testID="agent-composer" placeholder={t("agent.message", { name })} onSend={message} />
    </KeyboardScreen>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  profile: { flexDirection: "row", gap: 14, padding: 16, borderBottomWidth: StyleSheet.hairlineWidth, alignItems: "center" },
  empty: { padding: 24, textAlign: "center" },
  note: { paddingHorizontal: 16, paddingVertical: 6, fontSize: 13 },
});
