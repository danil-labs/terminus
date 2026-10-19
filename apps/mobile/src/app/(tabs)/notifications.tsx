import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { type TaskShow, call } from "../../lib/bridge";
import { useConnection } from "../../lib/connection";
import { t } from "../../lib/i18n";
import { useWorkspaces } from "../../lib/workspaces";
import { Avatar, Row, SectionTitle, openTask } from "../../ui/components";
import { TaskMark, type TaskState, stateText } from "../../ui/TaskStatus";
import { useTheme } from "../../ui/theme";

const ORDER: TaskState[] = ["approving", "asked", "failed", "unseen"];

type Entry = { workspace: string; session: string; folder: string | null; state: TaskState; at?: number };

/**
 * Every workspace in one list, with the sidebar's marks. "Ahora" is what the
 * engine still reports in `attention` (it survives a restart); "Antes" is what
 * arrived while the app was open and no longer waits.
 */
export default function Notifications() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { pairing, attention, activity, titleOf } = useConnection();
  const { list } = useWorkspaces();
  const [titles, setTitles] = useState<Record<string, string>>({});
  const nameOf = (id: string) => list.find((w) => w.id === id)?.name ?? id;

  const now: Entry[] = attention
    .flatMap((w) => w.tasks.map((task) => ({ workspace: w.workspace, session: task.session, folder: task.project, state: task.state as TaskState })))
    .filter((entry) => ORDER.includes(entry.state))
    .sort((a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state));
  const waiting = new Set(now.map((entry) => entry.session));
  const earlier: Entry[] = activity
    .filter(({ notice }) => !waiting.has(notice.session))
    .map(({ notice, at }) => ({
      workspace: notice.workspace,
      session: notice.session,
      folder: notice.project,
      state: notice.state === "finished" ? "unseen" : (notice.state as TaskState),
      at,
    }));

  // Titles of tasks in other workspaces: the home list only knows the current one.
  useEffect(() => {
    if (!pairing) return;
    for (const entry of [...now, ...earlier]) {
      if (titleOf(entry.session) || titles[entry.session] || !entry.folder) continue;
      void call<TaskShow>(pairing, "task show", { task: entry.session }, { workspace: entry.workspace, folder: entry.folder })
        .then((show) => setTitles((old) => ({ ...old, [entry.session]: show.task.title })))
        .catch(() => {});
    }
  });

  const row = (entry: Entry, key: string) => {
    const time = entry.at ? new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;
    return (
      <Row
        key={key}
        testID={`notification-${entry.session}`}
        left={
          <View>
            <Avatar name={nameOf(entry.workspace)} size={36} />
            <View style={[styles.mark, { backgroundColor: theme.bg }]}>
              <TaskMark state={entry.state} size={16} />
            </View>
          </View>
        }
        title={titleOf(entry.session) ?? titles[entry.session] ?? t("notify.untitled")}
        bold={entry.state !== "unseen"}
        subtitle={`${stateText(entry.state)} · ${nameOf(entry.workspace)}${time ? ` · ${time}` : ""}`}
        onPress={entry.folder ? () => openTask(entry.workspace, entry.folder!, entry.session) : undefined}
      />
    );
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.bg }} contentContainerStyle={{ paddingTop: insets.top + 6, paddingBottom: insets.bottom + 96 }}>
      <Text style={[styles.title, { color: theme.text }]}>{t("tabs.notifications")}</Text>
      {now.length ? <SectionTitle>{t("notifications.now")}</SectionTitle> : null}
      {now.map((entry) => row(entry, `n-${entry.workspace}-${entry.session}`))}
      {earlier.length ? <SectionTitle>{t("notifications.earlier")}</SectionTitle> : null}
      {earlier.map((entry) => row(entry, `e-${entry.at}-${entry.session}`))}
      {!now.length && !earlier.length ? (
        <Text style={[styles.empty, { color: theme.textMuted }]}>{t("notifications.empty")}</Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  mark: { position: "absolute", right: -6, bottom: -6, borderRadius: 10, padding: 2 },
  empty: { padding: 32, textAlign: "center" },
  title: { fontSize: 28, fontWeight: "800", paddingHorizontal: 16, paddingBottom: 4 },
});
