import { agentFolder, dockStatusText } from "@terminus/tasks";
import { Stack, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { cardOf, marksOf } from "../../../lib/cards";
import { createTask, defaultsFor, taskKey } from "../../../lib/engine";
import { HostError } from "../../../lib/hosts";
import { lang, t } from "../../../lib/i18n";
import { useMachines } from "../../../lib/machines";
import { useWorkspaces } from "../../../lib/workspaces";
import { Avatar, Composer, openTask } from "../../../ui/components";
import { TaskCard } from "../../../ui/TaskCard";
import { useTheme } from "../../../ui/theme";
import { KeyboardScreen } from "../../../ui/KeyboardScreen";

/** Un agente se lee como un mensaje directo: sus conversaciones y un cuadro para empezar otra. */
export default function AgentScreen() {
  const theme = useTheme();
  const { workspace, name } = useLocalSearchParams<{ workspace: string; name: string }>();
  const { attention, preferred, rememberMachine } = useMachines();
  const { snapshot, hostsOfCurrent, view } = useWorkspaces();
  const agent = snapshot?.agents.find((a) => a.name === name);
  const [note, setNote] = useState<string | null>(null);
  const marks = useMemo(() => marksOf(attention, workspace, snapshot?.live ?? new Set()), [attention, workspace, snapshot?.live]);
  const tasks = (snapshot?.tasks ?? []).filter((task) => task.agent === name);
  const folderName = (id: string) => snapshot?.folders.find((f) => f.id === id)?.name;
  // En qué máquina se habla con él: la preferida entre las que lo tienen.
  const host = preferred(hostsOfCurrent.filter((h) => agent?.places.some((p) => p.host === h.id)));
  const places = agent?.places.filter((p) => p.host === host?.id).map((p) => p.folder) ?? [];
  const folder = agentFolder(places, null) ?? places[0] ?? null;

  async function message(text: string) {
    if (!host || folder === null) return false;
    setNote(null);
    try {
      const defaults = await defaultsFor(host, workspace, snapshot?.tasks ?? [], name);
      const id = await createTask(host, workspace, { folder, prompt: text, provider: defaults.provider, model: defaults.model, agent: name, space: null });
      rememberMachine(host.id);
      openTask(host.id, workspace, folder, id);
      return true;
    } catch (error) {
      if (error instanceof HostError && error.code === "machine_asleep") setNote(t("machines.asleep", { name: host.label }));
      else setNote(t("task.error", { detail: error instanceof Error ? error.message : String(error) }));
      return false;
    }
  }

  return (
    <KeyboardScreen>
      <Stack.Screen options={{ title: name }} />
      <FlatList
        data={tasks}
        keyExtractor={taskKey}
        ListHeaderComponent={
          <View style={[styles.profile, { borderColor: theme.border }]}>
            <Avatar name={name} size={56} round />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: theme.text, fontSize: 18, fontWeight: "700" }}>{name}</Text>
              {agent ? <Text style={{ color: theme.textMuted }}>{dockStatusText(lang, agent)}</Text> : null}
              {agent?.description ? <Text style={{ color: theme.text }}>{agent.description}</Text> : null}
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <TaskCard
            task={item}
            card={cardOf(item, marks)}
            folderName={folderName}
            density={view.density}
            onPress={() => openTask(item.host, item.workspace, item.folder, item.id)}
          />
        )}
        ListEmptyComponent={<Text style={[styles.empty, { color: theme.textMuted }]}>{t("agent.empty")}</Text>}
      />
      {note ? <Text style={[styles.note, { color: theme.textMuted }]}>{note}</Text> : null}
      <Composer testID="agent-composer" placeholder={t("agent.message", { name })} onSend={message} />
    </KeyboardScreen>
  );
}

const styles = StyleSheet.create({
  profile: { flexDirection: "row", gap: 14, alignItems: "center", padding: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  empty: { padding: 24, textAlign: "center" },
  note: { paddingHorizontal: 16, paddingBottom: 6 },
});
