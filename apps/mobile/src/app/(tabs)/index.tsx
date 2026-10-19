import { applySidebarView, folderCounts, groupLabel, nonDefaultCount, scopeLabel, type SidebarView } from "@terminus/tasks";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { cardOf, cardTask, marksOf } from "../../lib/cards";
import { taskKey } from "../../lib/engine";
import { lang, t, w } from "../../lib/i18n";
import { useMachines } from "../../lib/machines";
import { Notifications } from "../../lib/notifications";
import { spaceName, useWorkspaces } from "../../lib/workspaces";
import { AgentDock } from "../../ui/AgentDock";
import { Avatar, Badge, openTask } from "../../ui/components";
import { MachineNote } from "../../ui/MachineNote";
import { TaskCard } from "../../ui/TaskCard";
import { TaskMark, topState } from "../../ui/TaskStatus";
import { useTheme } from "../../ui/theme";

const NEEDS_YOU = new Set(["approving", "asked", "failed"]);

/**
 * Tareas: el sidebar del escritorio (#151) en el teléfono. Arriba el workspace y
 * sus spaces; debajo, qué se enseña y el único filtro; el dock de agentes; y la
 * lista plana de todas las carpetas (y todas las máquinas), en tarjetas de dos
 * líneas, repartida en «Te necesitan» y «Tareas» o en los grupos del filtro.
 */
export default function Tasks() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { attention, hosts, fleet } = useMachines();
  const { list, current, snapshot, loading, reload, space, selectSpace, view, setView } = useWorkspaces();
  const [askNotifications, setAskNotifications] = useState(false);

  useEffect(() => {
    void Notifications?.getPermissionsAsync().then((p) => setAskNotifications(p.canAskAgain && !p.granted));
  }, []);

  const marks = useMemo(() => marksOf(attention, current?.id, snapshot?.live ?? new Set()), [attention, current?.id, snapshot?.live]);
  const otherPending = Object.values(attention)
    .flat()
    .filter((w) => w.workspace !== current?.id)
    .reduce((sum, w) => sum + w.tasks.filter((task) => NEEDS_YOU.has(task.state)).length, 0);

  const spaces = snapshot?.spaces ?? [];
  const inSpace = (folder: string) => !space || folder === "" || space.folders.includes(folder);
  const tasks = (snapshot?.tasks ?? []).filter((task) => inSpace(task.folder) && (!task.space || !space || task.space === space.id));
  const folderName = (id: string) => snapshot?.folders.find((f) => f.id === id)?.name;
  const counts = folderCounts(tasks.map((task) => ({ project: task.folder, row: task })));
  // Como el escritorio: de las carpetas elegidas, las que siguen teniendo tareas.
  const kept = view.folders.filter((f) => (counts.get(f) ?? 0) > 0);
  const effective: SidebarView = kept.length === view.folders.length ? view : { ...view, folders: kept };
  const groups = applySidebarView(tasks.map((task) => ({ ...cardTask(task, marks), task })), effective, {
    live: marks.live,
    approving: [...marks.attention].filter(([, s]) => s === "approving").map(([k]) => k),
    folderOf: (row) => row.task.folder,
  });
  const visibleGroups = groups.filter((g) => g.kind !== "section" || g.tasks.length || g.key === "active");
  const agents = (snapshot?.agents ?? []).filter((a) => a.places.some((p) => inSpace(p.folder)));
  const changed = nonDefaultCount(view);

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
              const folded = active ? null : topState((snapshot?.tasks ?? []).filter((task) => s.folders.includes(task.folder)).map((task) => cardOf(task, marks).state));
              return (
                <Pressable
                  key={s.id}
                  testID={`space-${s.id}`}
                  onPress={() => selectSpace(s.id)}
                  style={[styles.pill, { borderColor: theme.border, backgroundColor: active ? theme.primary : theme.surface }]}
                >
                  <Text style={{ color: active ? theme.onPrimary : theme.text, fontWeight: active ? "700" : "500" }}>{spaceName(s, t("space.general"))}</Text>
                  {folded ? <TaskMark state={folded} size={13} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}
        <View style={styles.scope}>
          <Text numberOfLines={1} style={[styles.scopeText, { color: theme.textMuted }]}>
            {scopeLabel(lang, effective, (id) => folderName(id) ?? id)}
          </Text>
          <Pressable
            testID="filter"
            hitSlop={10}
            onPress={() => router.push("/filter")}
            accessibilityLabel={changed ? w("shell.sidebar.view.trigger_count", { count: changed }) : w("shell.sidebar.view.trigger")}
            style={styles.filter}
          >
            <SymbolView name="slider.horizontal.3" size={18} tintColor={theme.textMuted} fallback={<Text style={{ color: theme.textMuted }}>☰</Text>} />
            {changed ? (
              <View style={[styles.filterBadge, { backgroundColor: theme.text }]}>
                <Text style={{ color: theme.bg, fontSize: 10, fontWeight: "700" }}>{changed}</Text>
              </View>
            ) : null}
          </Pressable>
        </View>
      </View>

      <ScrollView
        refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />}
        contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
        contentInsetAdjustmentBehavior="automatic"
      >
        <MachineNote hosts={hosts} fleet={fleet} cachedAt={snapshot?.cachedAt ?? null} />
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

        <AgentDock
          agents={agents}
          selected={view.agent}
          onTalk={(name) => current && router.push({ pathname: "/agent/[workspace]/[name]", params: { workspace: current.id, name } })}
          onShowTasks={(name) => setView({ ...view, agent: view.agent === name ? null : name })}
          onSeeAll={() => router.push("/agents")}
        />

        {visibleGroups.map((group) => (
          <View key={`${group.kind}-${group.key}`} style={styles.group}>
            <Text style={[styles.groupTitle, { color: theme.textMuted }]}>{groupLabel(lang, group, (id) => folderName(id) ?? id)}</Text>
            {group.tasks.map(({ task }) => (
              <TaskCard
                key={taskKey(task)}
                task={task}
                card={cardOf(task, marks, effective.group === "folder")}
                folderName={folderName}
                density={effective.density}
                onPress={() => openTask(task.host, task.workspace, task.folder, task.id)}
              />
            ))}
            {!group.tasks.length ? <Text style={[styles.empty, { color: theme.textMuted }]}>{t("folder.empty")}</Text> : null}
          </View>
        ))}
        {list.length === 0 && !loading && fleet === "ok" ? <Text style={[styles.empty, { color: theme.textMuted }]}>{t("home.no_workspaces")}</Text> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 8, gap: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  workspace: { flexDirection: "row", alignItems: "center", gap: 10 },
  workspaceName: { fontSize: 20, fontWeight: "800", flexShrink: 1 },
  spaces: { gap: 8 },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  scope: { flexDirection: "row", alignItems: "center", gap: 8 },
  scopeText: { flex: 1, fontSize: 13 },
  filter: { padding: 2 },
  filterBadge: { position: "absolute", top: -6, right: -8, minWidth: 15, borderRadius: 8, paddingHorizontal: 3, alignItems: "center" },
  optIn: { flexDirection: "row", alignItems: "center", gap: 10, margin: 12, padding: 12, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
  optInButton: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  group: { paddingTop: 8 },
  groupTitle: { fontSize: 13, fontWeight: "700", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  empty: { paddingHorizontal: 16, paddingVertical: 8, fontSize: 14 },
});
