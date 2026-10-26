import { isPinned } from "@terminus/tasks";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { archiveTask, deleteTask, setPinned, type Task } from "../lib/engine";
import type { Host } from "../lib/hosts";
import { t } from "../lib/i18n";
import { SheetOption } from "./Sheet";
import { useTheme } from "./theme";

/** Las mismas acciones desde la conversación y la pulsación larga de la lista. */
export function TaskActions({ host, task, running, onRemoved, onChanged, onBusy }: {
  host: Host;
  task: Task;
  running: boolean;
  onRemoved: () => void;
  onChanged: () => void;
  onBusy?: (busy: boolean) => void;
}) {
  const theme = useTheme();
  const [confirm, setConfirm] = useState<"archive" | "delete" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const available = host.canAct() === "now" || host.canAct() === "wakes";
  const pinned = isPinned(task);
  const act = async (action: "pin" | "archive" | "delete") => {
    if (submitting.current || !available || (action !== "pin" && running) || (action === "delete" && host.power() !== "on")) return;
    submitting.current = true;
    setBusy(true);
    onBusy?.(true);
    setError(null);
    try {
      if (action === "pin") {
        await setPinned(host, task.workspace, task.folder, task.id, !pinned);
        if (live.current) onChanged();
      } else {
        if (action === "archive") {
          const result = await archiveTask(host, task.workspace, task.folder, task.id);
          if ("blocked" in result) { if (live.current) setError(t("task.actions.blocked")); return; }
        } else await deleteTask(host, task.workspace, task.folder, task.id);
        if (live.current) onRemoved();
      }
    } catch (failure) {
      if (live.current) setError(t("task.error", { detail: failure instanceof Error ? failure.message : String(failure) }));
    } finally {
      submitting.current = false;
      if (live.current) { setBusy(false); onBusy?.(false); }
    }
  };
  return <View style={{ gap: 8 }}>
    {confirm ? <>
      <Text style={{ color: theme.text, fontSize: 17, fontWeight: "600" }}>{t(`task.actions.${confirm}`)}</Text>
      <Text style={{ color: theme.textMuted, fontSize: 14, lineHeight: 21 }}>{t(`task.actions.${confirm}_confirm`, { name: host.label })}</Text>
      <Pressable accessibilityRole="button" testID={`task-${confirm}-confirm`} disabled={busy || running || !available || (confirm === "delete" && host.power() !== "on")} onPress={() => void act(confirm)} style={{ minHeight: 48, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: confirm === "delete" ? theme.failedMark : theme.primary, opacity: busy ? 0.5 : 1 }}>
        <Text style={{ color: theme.onPrimary, fontWeight: "600" }}>{t(busy ? "task.actions.working" : `task.actions.${confirm}`)}</Text>
      </Pressable>
      <SheetOption label={t("task.actions.cancel")} disabled={busy} onPress={() => { setConfirm(null); setError(null); }} />
    </> : <>
      <SheetOption icon={pinned ? "pin-off" : "pin"} label={t(pinned ? "task.actions.unpin" : "task.actions.pin")} disabled={busy || !available} onPress={() => void act("pin")} />
      {!task.archived ? <SheetOption testID="task-archive" icon="archive" label={t("task.actions.archive")} detail={t("task.actions.archive_hint")} disabled={busy || running || !available} onPress={() => { setConfirm("archive"); setError(null); }} /> : null}
      <View style={{ borderTopWidth: 1, borderTopColor: theme.border, marginTop: 4 }}>
        <SheetOption testID="task-delete" icon="trash-2" destructive label={t("task.actions.delete")} detail={t("task.actions.delete_hint")} disabled={busy || running || host.power() !== "on" || !available} onPress={() => { setConfirm("delete"); setError(null); }} />
      </View>
      {running ? <Text style={{ color: theme.textMuted }}>{t("task.actions.busy")}</Text> : host.power() !== "on" ? <Text style={{ color: theme.textMuted }}>{t("task.actions.online")}</Text> : null}
    </>}
    {error ? <Text accessibilityRole="alert" style={{ color: theme.failedMark }}>{error}</Text> : null}
  </View>;
}
