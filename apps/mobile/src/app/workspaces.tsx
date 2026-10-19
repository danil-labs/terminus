import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { status } from "../lib/bridge";
import type { AttentionState } from "../lib/bridge";
import { useConnection } from "../lib/connection";
import { useWorkspaces } from "../lib/workspaces";
import { t } from "../lib/i18n";
import { Avatar, Badge, Row, SectionTitle } from "../ui/components";
import { TaskMark, type TaskState, topState } from "../ui/TaskStatus";
import { useTheme } from "../ui/theme";

const NEEDS_YOU = new Set<AttentionState>(["approving", "asked", "failed"]);

/** The desktop's workspace column, as a sheet: every workspace with what waits in it, and the connection. */
export default function WorkspaceSwitcher() {
  const theme = useTheme();
  const { attention, pairing, online, pair } = useConnection();
  const { list, current, select } = useWorkspaces();
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    if (pairing && online) void status(pairing).then((s) => setVersion(s.engine.version)).catch(() => {});
  }, [pairing, online]);
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingVertical: 8 }}>
      {list.map((workspace) => {
        const tasks = attention.find((w) => w.workspace === workspace.id)?.tasks ?? [];
        const pending = tasks.filter((task) => NEEDS_YOU.has(task.state)).length;
        const folded = topState(tasks.map((task) => task.state as TaskState));
        return (
          <Row
            key={workspace.id}
            testID={`workspace-${workspace.id}`}
            left={<Avatar name={workspace.name} size={40} />}
            title={workspace.name}
            bold={workspace.id === current?.id}
            right={pending ? <Badge count={pending} /> : <TaskMark state={folded} />}
            subtitle={workspace.id === current?.id ? <Text style={{ color: theme.primary, fontSize: 13 }}>●</Text> : undefined}
            onPress={() => {
              select(workspace.id);
              router.back();
            }}
          />
        );
      })}
      <SectionTitle>{t("you.connection")}</SectionTitle>
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Text style={{ color: theme.text, fontWeight: "600" }}>{pairing?.url}</Text>
        <Text style={{ color: theme.textMuted }}>{online ? t("you.engine", { version: version ?? "…" }) : t("home.offline")}</Text>
      </View>
      <Pressable
        testID="disconnect"
        style={[styles.button, { borderColor: theme.failedMark }]}
        onPress={() => {
          router.back();
          void pair(null);
        }}
      >
        <Text style={{ color: theme.failedMark, fontWeight: "600" }}>{t("home.disconnect")}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 12, padding: 14, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, gap: 4 },
  button: { margin: 12, padding: 12, borderRadius: 10, borderWidth: 1, alignItems: "center" },
});
