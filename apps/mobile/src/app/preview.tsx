import { folderColor } from "@terminus/design";
import { canFinishTask, previewLabel, taskPreview, type PreviewAction } from "@terminus/tasks";
import { router, useLocalSearchParams } from "expo-router";
import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { cardTask, marksOf } from "../lib/cards";
import { archiveTask, finishTask, setPinned, taskKey } from "../lib/engine";
import { HostError } from "../lib/hosts";
import { lang, t, w } from "../lib/i18n";
import { useMachines } from "../lib/machines";
import { useWorkspaces } from "../lib/workspaces";
import { useTaskGit } from "../lib/useTaskGit";
import { BrandMark } from "../ui/BrandMark";
import { Avatar, openTask } from "../ui/components";
import { Icon } from "../ui/Icon";
import { useTheme } from "../ui/theme";

/**
 * La vista previa de una tarea al mantener pulsada su tarjeta: la tarjeta
 * flotante del sidebar del escritorio (`TaskHoverCard`) como hoja del sistema.
 * Título, carpeta, agente, proveedor y modelo, la
 * máquina si hay más de una; y Abrir, Fijar y Archivar con los mismos comandos
 * que la ventana (`set_session_pinned`, `task_blockers` y `set_task_archived`).
 * Finalizar usa el estado Git compartido y el cierre validado por el motor.
 * Abrirla no enciende nada; fijar o archivar encienden la VM si está apagada.
 */
export default function Preview() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { host: hostId, id } = useLocalSearchParams<{ host: string; id: string }>();
  const { hostOf, attention, hosts } = useMachines();
  const { snapshot, current, reload } = useWorkspaces();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const task = snapshot?.tasks.find((x) => x.host === hostId && x.id === id);
  const host = hostOf(hostId);
  const git = useTaskGit(hostOf, task ? [task] : []);
  if (!task || !host) return <View style={{ height: 120 }} />;

  const marks = marksOf(attention, current?.members, snapshot?.live ?? new Set());
  const row = cardTask(task, marks);
  const approving = [...marks.attention].filter(([, s]) => s === "approving").map(([k]) => k);
  const preview = taskPreview(lang, row, { live: marks.live, approving });
  const folderName = snapshot?.folders.find((f) => f.key === task.folderKey)?.name;
  const provider = snapshot?.providers[task.host]?.find((p) => p.id === task.provider);
  const several = hosts.length > 1;
  const finish = !preview.pinned && canFinishTask(task, git[taskKey(task)], marks.live.has(taskKey(task)) || marks.attention.get(taskKey(task)) === "approving");
  const actions: (PreviewAction | "finish")[] = [...preview.actions, ...(finish ? ["finish" as const] : [])];

  async function run(what: "pin" | "unpin" | "archive" | "finish") {
    if (!host || !task) return;
    setBusy(what);
    setNote(host.power() !== "on" && host.canAct() === "wakes" ? w("shell.machines.waking", { name: host.label }) : null);
    try {
      if (what === "finish") {
        const result = await finishTask(host, task.workspace, task.folder, task.id);
        if ("blocked" in result) {
          setNote(result.blocked.not_finished ? w("projects.sessions.blockers_not_finished") : t("preview.blocked", { count: result.blocked.unsaved.reduce((n, b) => n + b.files.length, 0) }));
          return;
        }
      } else if (what === "archive") {
        const result = await archiveTask(host, task.workspace, task.folder, task.id);
        if ("blocked" in result) {
          setNote(t("preview.blocked", { count: result.blocked.reduce((n, b) => n + b.files.length, 0) }));
          return;
        }
      } else await setPinned(host, task.workspace, task.folder, task.id, what === "pin");
      void reload();
      router.back();
    } catch (error) {
      const name = host.label;
      if (error instanceof HostError && error.code === "machine_asleep") setNote(w("web.machines.off_action", { name }));
      else if (error instanceof HostError && error.code === "machine_outdated") setNote(w("web.machines.outdated_action", { name }));
      else if (error instanceof HostError && (error.code === "start_failed" || error.code === "start_timeout")) setNote(t("machines.start_failed", { name }));
      else setNote(t("task.error", { detail: error instanceof Error ? error.message : String(error) }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={[styles.sheet, { backgroundColor: theme.surface, paddingBottom: insets.bottom + 16 }]} testID="task-preview">
      <View style={styles.head}>
        <Text style={[styles.title, { color: theme.text }]}>{preview.title}</Text>
      </View>
      <View style={styles.rows}>
        {preview.folder ? (
          <Field label={previewLabel(lang, "folder")}>
            <View style={[styles.square, { backgroundColor: folderColor(preview.folder) }]} />
            <Text numberOfLines={1} style={[styles.value, { color: theme.text }]}>{folderName ?? task.folder}</Text>
          </Field>
        ) : null}
        {preview.agent ? (
          <Field label={previewLabel(lang, "agent")}>
            <Avatar name={preview.agent} size={16} round />
            <Text numberOfLines={1} style={[styles.value, { color: theme.text }]}>{preview.agent}</Text>
          </Field>
        ) : null}
        <Field label={previewLabel(lang, "provider")}>
          <BrandMark id={task.provider} size={14} color={theme.text} />
          <Text numberOfLines={1} style={[styles.value, { color: theme.text }]}>
            {preview.model ?? previewLabel(lang, "default_model")}
          </Text>
          <Text numberOfLines={1} style={[styles.value, { color: theme.textMuted, flex: 0 }]}>{provider?.label ?? task.provider}</Text>
        </Field>
        {several ? (
          <Field label={t("preview.machine")}>
            <Icon name="server" size={13} color={theme.textMuted} />
            <Text numberOfLines={1} style={[styles.value, { color: theme.text }]}>{host.label}</Text>
            <Text style={[styles.value, { color: theme.textMuted, flex: 0 }]}>
              {host.power() === "on"
                ? w("web.computers.state.online")
                : host.power() === "starting"
                  ? w("web.computers.state.starting")
                  : host.power() === "outdated"
                    ? w("web.computers.state.outdated")
                    : w("web.computers.state.offline")}
            </Text>
          </Field>
        ) : null}
      </View>
      <View style={styles.actions}>
        {actions.map((action) => (
          <Pressable
            key={action}
            testID={`preview-${action}`}
            accessibilityHint={action === "finish" ? w("projects.sessions.finish_description") : undefined}
            disabled={busy !== null}
            onPress={() => {
              if (action === "open") {
                router.back();
                openTask(task.host, task.workspace, task.folder, task.id);
              } else void run(action);
            }}
            style={({ pressed }) => [
              styles.button,
              finish ? { flexBasis: "40%" } : null,
              { borderColor: theme.border, backgroundColor: pressed ? theme.muted : "transparent", opacity: busy && busy !== action ? 0.5 : 1 },
              action === "open" ? { backgroundColor: theme.primary, borderColor: theme.primary } : null,
            ]}
          >
            {action === "pin" || action === "unpin" ? <Icon name={action === "pin" ? "pin" : "pin-off"} size={14} color={theme.text} /> : null}
            {action === "archive" ? <Icon name="archive" size={14} color={theme.text} /> : null}
            <Text style={{ color: action === "open" ? theme.onPrimary : theme.text, fontWeight: "600" }}>{busy === action ? "…" : action === "finish" ? w("projects.sessions.finish") : previewLabel(lang, action)}</Text>
          </Pressable>
        ))}
      </View>
      {note ? <Text style={[styles.note, { color: theme.textMuted }]}>{note}</Text> : null}
    </View>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: theme.textMuted }]}>{label}</Text>
      <View style={styles.fieldValue}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { paddingHorizontal: 20, paddingTop: 22, gap: 12 },
  head: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  title: { flex: 1, fontSize: 17, fontWeight: "600", lineHeight: 22 },
  rows: { gap: 8 },
  field: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 22 },
  label: { width: 84, fontSize: 13 },
  fieldValue: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6 },
  square: { width: 9, height: 9, borderRadius: 2 },
  value: { flex: 1, fontSize: 14 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  button: { flex: 1, minHeight: 44, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", borderWidth: 1, borderRadius: 10, paddingVertical: 11 },
  note: { fontSize: 13 },
});
