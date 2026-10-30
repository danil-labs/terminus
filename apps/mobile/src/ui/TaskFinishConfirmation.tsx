import { TEXT } from "@terminus/design";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { finishTask } from "../lib/engine";
import { HostError, type Host } from "../lib/hosts";
import { t } from "../lib/i18n";
import { useTheme } from "./theme";

/** La confirmación es la misma desde la cabecera y desde la lista. */
export function TaskFinishConfirmation(props: {
  host: Host;
  workspace: string;
  folder: string;
  id: string;
  shared: boolean;
  ready: boolean;
  onBusy: (busy: boolean) => void;
  onBlocked: () => void;
  onFinished: () => void;
}) {
  const theme = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(true);
  const submitting = useRef(false);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const finish = async () => {
    if (!props.ready || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    props.onBusy(true);
    setError(null);
    try {
      const result = await finishTask(props.host, props.workspace, props.folder, props.id);
      if (!live.current) return;
      if ("blocked" in result) { setError(t("task.header.blocked")); props.onBlocked(); }
      else props.onFinished();
    } catch (failure) {
      if (live.current) setError(failure instanceof HostError && failure.code === "task_status_unavailable" ? t("task.header.status_unavailable") : t("task.error", { detail: failure instanceof Error ? failure.message : String(failure) }));
    } finally {
      submitting.current = false;
      if (live.current) { setBusy(false); props.onBusy(false); }
    }
  };
  return <View style={{ gap: 12 }}>
    <Text style={{ color: theme.textMuted, fontSize: TEXT.body, lineHeight: 21 }}>{t(props.shared ? "task.header.finish_shared" : "task.header.finish_description")}</Text>
    {!props.ready && !busy ? <Text style={{ color: theme.textMuted }}>{t("task.header.finish_unavailable")}</Text> : null}
    {error ? <Text accessibilityRole="alert" style={{ color: theme.failedMark }}>{error}</Text> : null}
    <Pressable testID="task-finish-confirm" accessibilityRole="button" disabled={!props.ready || busy} onPress={() => void finish()} style={{ minHeight: 48, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: theme.primary, opacity: props.ready || busy ? 1 : 0.4 }}>
      <Text style={{ color: theme.onPrimary, fontWeight: "600" }}>{t(busy ? "task.header.finishing" : "task.header.finish")}</Text>
    </Pressable>
  </View>;
}
