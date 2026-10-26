import { folderColor } from "@terminus/design";
import { previewLabel, taskPreview } from "@terminus/tasks";
import { router, useLocalSearchParams } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { cardTask, marksOf } from "../lib/cards";
import { TaskActions } from "../ui/TaskActions";
import { lang, t, w } from "../lib/i18n";
import { useMachines } from "../lib/machines";
import { useWorkspaces } from "../lib/workspaces";
import { BrandMark } from "../ui/BrandMark";
import { Avatar, openTask } from "../ui/components";
import { Icon } from "../ui/Icon";
import { useTheme } from "../ui/theme";

/**
 * La vista previa de una tarea al mantener pulsada su tarjeta: la tarjeta
 * flotante del sidebar del escritorio (`TaskHoverCard`) como hoja del sistema.
 * Título, lo último que se dijo, carpeta, agente, proveedor y modelo, la
 * máquina si hay más de una; y Abrir, Fijar y Archivar con los mismos comandos
 * que la ventana (`set_session_pinned`, `task_blockers` y `set_task_archived`).
 * Abrirla no enciende nada; fijar o archivar encienden la VM si está apagada.
 */
export default function Preview() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { host: hostId, id } = useLocalSearchParams<{ host: string; id: string }>();
  const { hostOf, attention, hosts } = useMachines();
  const { snapshot, current, reload } = useWorkspaces();

  const task = snapshot?.tasks.find((x) => x.host === hostId && x.id === id);
  const host = hostOf(hostId);
  if (!task || !host) return <View style={{ height: 120 }} />;

  const marks = marksOf(attention, current?.members, snapshot?.live ?? new Set());
  const row = cardTask(task, marks);
  const approving = [...marks.attention].filter(([, s]) => s === "approving").map(([k]) => k);
  const preview = taskPreview(lang, row, { live: marks.live, approving });
  const folderName = snapshot?.folders.find((f) => f.key === task.folderKey)?.name;
  const provider = snapshot?.providers[task.host]?.find((p) => p.id === task.provider);
  const several = hosts.length > 1;

  return (
    <View style={[styles.sheet, { backgroundColor: theme.surface, paddingBottom: insets.bottom + 16 }]} testID="task-preview">
      <View style={styles.head}>
        <Text style={[styles.title, { color: theme.text }]}>{preview.title}</Text>
      </View>
      {preview.excerpt ? (
        <Text numberOfLines={4} style={[styles.excerpt, { color: theme.textMuted, borderColor: theme.border }]}>
          {preview.excerpt}
        </Text>
      ) : null}
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
      <Pressable accessibilityRole="button" onPress={() => { router.back(); openTask(task.host, task.workspace, task.folder, task.id); }} style={[styles.button, { backgroundColor: theme.primary, borderColor: theme.primary }]}>
        <Text style={{ color: theme.onPrimary, fontWeight: "600" }}>{previewLabel(lang, "open")}</Text>
      </Pressable>
      <TaskActions host={host} task={task} running={marks.live.has(`${task.host}/${task.id}`)} onChanged={() => { void reload(); }} onRemoved={() => { void reload(); router.back(); }} />
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
  excerpt: { borderLeftWidth: 2, paddingLeft: 10, fontSize: 14, lineHeight: 20 },
  rows: { gap: 8 },
  field: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 22 },
  label: { width: 84, fontSize: 13 },
  fieldValue: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6 },
  square: { width: 9, height: 9, borderRadius: 2 },
  value: { flex: 1, fontSize: 14 },
  button: { minHeight: 48, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", borderWidth: 1, borderRadius: 10, paddingVertical: 11 },
});
