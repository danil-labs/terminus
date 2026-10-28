import { useCustomization } from "../../lib/customization";
import { ALPHA_DEMO, ALPHA_ORDINARY } from "../../lib/alpha-mode";
import { applySidebarView, folderCounts, groupKey, groupLabel, nonDefaultCount, scopeLabel, type SidebarView } from "@terminus/tasks";
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { cardOf, cardTask, marksOf } from "../../lib/cards";
import { taskInSpace, taskKey } from "../../lib/engine";
import { lang, t, w } from "../../lib/i18n";
import { useMachines } from "../../lib/machines";
import { Notifications } from "../../lib/notifications";
import { effectiveGit } from "../../lib/taskGit";
import { useTaskGit } from "../../lib/useTaskGit";
import { spaceName, useWorkspaces } from "../../lib/workspaces";
import { AgentDock } from "../../ui/AgentDock";
import { Avatar, Badge, openPreview, openTask } from "../../ui/components";
import { Icon } from "../../ui/Icon";
import { MachineNote } from "../../ui/MachineNote";
import { TaskCard } from "../../ui/TaskCard";
import { TaskMark, topState } from "../../ui/TaskStatus";
import { useTheme } from "../../ui/theme";

const NEEDS_YOU = new Set(["approving", "asked", "failed"]);

/**
 * Tareas: el sidebar del escritorio (#151) en el teléfono. Arriba el workspace y
 * sus spaces; debajo, qué se enseña y el único filtro; el dock de agentes; y la
 * lista plana de todas las carpetas (y todas las máquinas), en tarjetas de dos
 * líneas, en una sola lista «Tareas» o en los grupos del filtro.
 */
export default function Tasks() {
  const customization=useCustomization();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { attention, hosts, hostOf, fleet } = useMachines();
  const { list, current, snapshot, loading, reload, space, selectSpace, view, setView } = useWorkspaces();
  const [askNotifications, setAskNotifications] = useState(false);

  useEffect(() => {
    void Notifications?.getPermissionsAsync().then((p) => setAskNotifications(p.canAskAgain && !p.granted));
  }, []);

  const marks = useMemo(() => marksOf(attention, current?.members, snapshot?.live ?? new Set()), [attention, current?.members, snapshot?.live]);
  const otherPending = Object.values(attention)
    .flat()
    .filter((w) => !Object.values(Object.fromEntries(current?.members ?? [])).includes(w.workspace))
    .reduce((sum, w) => sum + w.tasks.filter((task) => NEEDS_YOU.has(task.state)).length, 0);
  const pending = Object.values(attention)
    .flat()
    .flatMap((w) => w.tasks)
    .filter((task) => NEEDS_YOU.has(task.state)).length;

  const spaces = snapshot?.spaces ?? [];
  // Las carpetas se nombran `host/id`; una tarea va en el space que dice su fila, como en el escritorio.
  const inSpace = (key: string) => !space || key.endsWith("/") || space.folders.includes(key);
  const tasks = (snapshot?.tasks ?? []).filter((task) => taskInSpace(task, space));
  const folderName = (key: string) => snapshot?.folders.find((f) => f.key === key)?.name;
  const counts = folderCounts(tasks.map((task) => ({ project: task.folderKey, row: task })));
  // Como el escritorio: de las carpetas elegidas, las que siguen teniendo tareas.
  const kept = view.folders.filter((f) => (counts.get(f) ?? 0) > 0);
  const effective: SidebarView = kept.length === view.folders.length ? view : { ...view, folders: kept };
  // Se agrupa por el id de la carpeta en la cuenta, el mismo en todas las máquinas: una carpeta con
  // tareas en dos máquinas sale en un grupo por máquina («Terminus · vm-principal»), y el filtro las junta.
  const folderIdOf = (key: string) => snapshot?.folders.find((f) => f.key === key)?.id ?? key.slice(key.indexOf("/") + 1);
  const groups = applySidebarView(tasks.map((task) => ({ ...cardTask(task, marks), task })), { ...effective, folders: effective.folders.map(folderIdOf) }, {
    live: marks.live,
    approving: [...marks.attention].filter(([, s]) => s === "approving").map(([k]) => k),
    folderOf: (row) => row.task.folder,
    machineOf: (row) => row.task.host,
  });
  // Git de las tarjetas en pantalla, también para las señales de la vista compacta.
  const git = useTaskGit(hostOf, groups.flatMap((group) => group.tasks.map(({ task }) => task)));
  const groupFolderName = (id: string) => snapshot?.folders.find((f) => f.id === id)?.name ?? id;
  const machineName = (id: string) => hosts.find((h) => h.id === id)?.label ?? id;
  const agents = (snapshot?.agents ?? []).filter((a) => a.places.some((p) => inSpace(`${p.host}/${p.folder}`)));
  const changed = nonDefaultCount(view);

  return (
    <View style={[styles.page, { backgroundColor: theme.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 6, backgroundColor: theme.bg, borderColor: theme.border }]}>
        <View style={styles.topRow}>
        <Pressable testID="workspace-switcher" onPress={() => router.push("/workspaces")} style={styles.workspace} accessibilityLabel={t("home.switch")}>
          <Avatar name={current?.name ?? "T"} size={32} />
          <Text style={[styles.workspaceName, { color: theme.text }]} numberOfLines={1}>
            {current?.name ?? "Terminus"}
          </Text>
          <Icon name="chevron-down" size={16} color={theme.textMuted} />
          <Badge count={otherPending} />
        </Pressable>
        <View style={styles.actions}>
          <Pressable testID="usage" hitSlop={8} onPress={() => router.push("/accounts")} accessibilityLabel={w("settings.nav.ai_providers")} style={styles.action}>
            <Icon name="gauge" size={22} color={theme.text} />
          </Pressable>
          <Pressable testID="new-task" hitSlop={8} onPress={() => router.push("/new")} accessibilityLabel={t("new.title")} style={styles.action}>
            <Icon name="square-pen" size={22} color={theme.text} />
          </Pressable>
          <Pressable testID="notifications" hitSlop={8} onPress={() => router.push("/notifications")} accessibilityLabel={t("tabs.notifications")} style={styles.action}>
            <Icon name="bell" size={22} color={theme.text} />
            {pending ? (
              <View style={styles.actionBadge}>
                <Badge count={pending} />
              </View>
            ) : null}
          </Pressable>
        </View>
        </View>
        {process.env.EXPO_PUBLIC_TERMINUS_ALPHA === "1" && !ALPHA_ORDINARY ? (
          <View style={{gap:8}}>
            <Pressable accessibilityRole="button" onPress={() => router.push("/personalize")} style={[styles.workspace,{minHeight:44}]}><Icon name="sliders-horizontal" size={16} color={theme.text}/><Text style={{color:theme.text,fontWeight:"600"}}>{t("attention.personalize")}</Text></Pressable>
            {customization.entries.filter(entry=>entry.selected).map(entry=><Pressable key={entry.id} accessibilityRole="link" accessibilityLabel={entry.title} style={[styles.workspace,{minHeight:44}]} onPress={()=>{
              if(entry.id==='inbox')router.push(ALPHA_DEMO?'/inbox?demo=1':'/inbox');
              else if(entry.id==='broadcasts')router.push(ALPHA_DEMO?'/broadcasts?demo=1':'/broadcasts');
              else if(entry.id==='agents')router.push('/attention-agents');
              else if(entry.id==='channels')router.push('/channels');
            }}><Text style={{color:theme.primary,fontWeight:"600"}}>{entry.title}</Text></Pressable>)}
          </View>
        ) : null}
        {spaces.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.spaces}>
            {spaces.map((s) => {
              const active = s.id === space?.id;
              const folded = active ? null : topState((snapshot?.tasks ?? []).filter((task) => task.space && taskInSpace(task, s)).map((task) => cardOf(task, marks).state));
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
            <Icon name="sliders-horizontal" size={18} color={theme.textMuted} />
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
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        contentInsetAdjustmentBehavior="automatic"
      >
        <MachineNote hosts={hosts} fleet={fleet} />
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

        {groups.map((group) => (
          <View key={groupKey(group)} style={styles.group}>
            <Text style={[styles.groupTitle, { color: theme.textMuted }]}>{groupLabel(lang, group, groupFolderName, machineName)}</Text>
            {group.tasks.map(({ task }) => (
              <TaskCard
                key={taskKey(task)}
                task={task}
                card={cardOf(task, marks, effective.group === "folder")}
                git={effectiveGit(git, task, snapshot?.tasks ?? [])}
                folderName={folderName}
                density={effective.density}
                onPress={() => openTask(task.host, task.workspace, task.folder, task.id)}
                onLongPress={() => openPreview(task.host, task.id)}
                onFinish={() => openPreview(task.host, task.id, "finish")}
                online={hostOf(task.host)?.power() === "on" && hostOf(task.host)?.canAct() === "now"}
              />
            ))}
            {!group.tasks.length ? <Text style={[styles.empty, { color: theme.textMuted }]}>{t("folder.empty")}</Text> : null}
          </View>
        ))}
        {list.length === 0 && !loading && fleet === "ok" ? (
          <Text style={[styles.empty, { color: theme.textMuted }]}>{t(hosts.some((h) => h.linked) ? "home.no_linked_workspaces" : "home.no_workspaces")}</Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 8, gap: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  topRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  workspace: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  actions: { flexDirection: "row", alignItems: "center", gap: 14 },
  action: { padding: 4 },
  actionBadge: { position: "absolute", top: -4, right: -8 },
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
