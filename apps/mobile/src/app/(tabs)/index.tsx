import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useConnection } from "../../lib/connection";
import { Notifications } from "../../lib/notifications";
import { t } from "../../lib/i18n";
import { spaceName, useTaskStates, useWorkspaces } from "../../lib/workspaces";
import { Avatar, Badge, Dot, Row, TaskItem } from "../../ui/components";
import { TaskMark, topState } from "../../ui/TaskStatus";
import { useTheme } from "../../ui/theme";

const NEEDS_YOU = new Set(["approving", "asked", "failed"]);

/**
 * The desktop sidebar on a phone: the workspace and its spaces on top (a filter,
 * like SpaceBar), then each folder of the space with its agents and its tasks.
 */
export default function Tasks() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { online, attention } = useConnection();
  const { list, current, snapshot, loading, reload, space, selectSpace } = useWorkspaces();
  const stateOf = useTaskStates(current?.id);
  const [askNotifications, setAskNotifications] = useState(false);

  useEffect(() => {
    void Notifications?.getPermissionsAsync().then((p) => setAskNotifications(p.canAskAgain && !p.granted));
  }, []);

  const otherPending = attention
    .filter((w) => w.workspace !== current?.id)
    .reduce((sum, w) => sum + w.tasks.filter((task) => NEEDS_YOU.has(task.state)).length, 0);
  const spaces = snapshot?.spaces ?? [];
  const tasks = (snapshot?.tasks ?? []).filter((task) => task.space === space?.id);
  const folders = (snapshot?.folders ?? []).filter((folder) => space?.folders.includes(folder.id));
  const agentColor = (status: string) => (status === "working" ? theme.success : status === "awake" ? theme.info : theme.border);

  return (
    <View style={[styles.page, { backgroundColor: theme.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 6, backgroundColor: theme.bg, borderColor: theme.border }]}>
        <Pressable testID="workspace-switcher" onPress={() => router.push("/workspaces")} style={styles.workspace} accessibilityLabel={t("home.switch")}>
          <Avatar name={current?.name ?? "T"} size={32} />
          <Text style={[styles.workspaceName, { color: theme.text }]} numberOfLines={1}>
            {current?.name ?? "Terminus"}
          </Text>
          <Text style={{ color: theme.textMuted, fontSize: 16 }}>⌄</Text>
          <Badge count={otherPending} />
        </Pressable>
        {spaces.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.spaces}>
            {spaces.map((s) => {
              const active = s.id === space?.id;
              const folded = active ? null : topState((snapshot?.tasks ?? []).filter((task) => task.space === s.id).map(stateOf));
              return (
                <Pressable
                  key={s.id}
                  testID={`space-${s.id}`}
                  onPress={() => selectSpace(s.id)}
                  style={[styles.pill, { borderColor: theme.border, backgroundColor: active ? theme.primary : theme.surface }]}
                >
                  <Text style={{ color: active ? theme.onPrimary : theme.text, fontWeight: active ? "700" : "500" }}>
                    {spaceName(s, t("space.general"))}
                  </Text>
                  {folded ? <TaskMark state={folded} size={13} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}
      </View>
      {!online ? <Text style={[styles.banner, { backgroundColor: theme.muted, color: theme.textMuted }]}>{t("home.offline")}</Text> : null}

      <ScrollView
        refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />}
        contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
        contentInsetAdjustmentBehavior="automatic"
      >
        {askNotifications ? (
          <View style={[styles.optIn, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={{ color: theme.text, flex: 1 }}>{t("notify.enable")}</Text>
            <Pressable
              testID="enable-notifications"
              style={[styles.optInButton, { backgroundColor: theme.primary }]}
              onPress={() => void Notifications?.requestPermissionsAsync().then(() => setAskNotifications(false))}
            >
              <Text style={{ color: theme.onPrimary, fontWeight: "600" }}>{t("notify.enable_button")}</Text>
            </Pressable>
          </View>
        ) : null}

        {folders.map((folder) => {
          const inFolder = tasks.filter((task) => task.folder === folder.id);
          const agents = (snapshot?.handlers ?? []).filter((h) => h.folders.includes(folder.id));
          const own = inFolder.filter((task) => !task.agent);
          return (
            <View key={folder.id} style={styles.folder}>
              <View style={styles.folderHead}>
                <Text style={[styles.folderName, { color: theme.textMuted }]} numberOfLines={1}>
                  {folder.name}
                </Text>
                <Pressable
                  testID={`new-in-${folder.id}`}
                  hitSlop={10}
                  accessibilityLabel={t("folder.new_task", { name: folder.name })}
                  onPress={() => router.push({ pathname: "/new", params: { folder: folder.id } })}
                >
                  <Text style={{ color: theme.textMuted, fontSize: 22, lineHeight: 22 }}>+</Text>
                </Pressable>
              </View>
              {agents.map((handler) => (
                <Row
                  key={handler.name}
                  testID={`agent-${handler.name}`}
                  left={
                    <View>
                      <Avatar name={handler.name} size={26} round />
                      <View style={[styles.presence, { borderColor: theme.bg }]}>
                        <Dot color={agentColor(handler.status)} />
                      </View>
                    </View>
                  }
                  title={handler.name}
                  subtitle={handler.live_tasks ? t("agent.live", { count: handler.live_tasks }) : (handler.description ?? undefined)}
                  right={<TaskMark state={topState(inFolder.filter((task) => task.agent === handler.name).map(stateOf))} />}
                  onPress={() => router.push({ pathname: "/agent/[workspace]/[name]", params: { workspace: current!.id, name: handler.name } })}
                />
              ))}
              {own.map((task) => (
                <TaskItem key={task.id} task={task} state={stateOf(task)} />
              ))}
              {!agents.length && !own.length ? (
                <Text style={[styles.empty, { color: theme.textMuted }]}>{t("folder.empty")}</Text>
              ) : null}
            </View>
          );
        })}
        {snapshot && !folders.length ? <Text style={[styles.empty, { color: theme.textMuted }]}>{t("space.no_folders")}</Text> : null}
        {list.length === 0 && !loading && online ? (
          <Text style={[styles.empty, { color: theme.textMuted }]}>{t("home.no_workspaces")}</Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 10, gap: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  workspace: { flexDirection: "row", alignItems: "center", gap: 10 },
  workspaceName: { fontSize: 20, fontWeight: "800", flexShrink: 1 },
  spaces: { gap: 8 },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  banner: { padding: 10, textAlign: "center", fontSize: 13 },
  optIn: { flexDirection: "row", alignItems: "center", gap: 10, margin: 12, padding: 12, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
  optInButton: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  folder: { paddingTop: 8 },
  folderHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4 },
  folderName: { fontSize: 13, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4, flexShrink: 1 },
  presence: { position: "absolute", right: -2, bottom: -2, borderWidth: 2, borderRadius: 6 },
  empty: { paddingHorizontal: 16, paddingVertical: 8, fontSize: 14 },
});
