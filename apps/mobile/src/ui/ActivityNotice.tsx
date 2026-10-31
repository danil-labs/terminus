import { TEXT } from "@terminus/design";
import type { ActivityEvent } from "@terminus/protocol";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMachines } from "../lib/machines";
import { useWorkspaces } from "../lib/workspaces";
import { t } from "../lib/i18n";
import { useTheme } from "./theme";

export function ActivityNotice() {
  const { subscribe, hostOf } = useMachines();
  const { current } = useWorkspaces();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [notice, setNotice] = useState<(ActivityEvent & { machine: string }) | null>(null);
  useEffect(() => { setNotice(null); return subscribe((machine, events) => {
    for (const event of events) {
      if (event.name !== "activity") continue;
      const row = event.payload as ActivityEvent | undefined;
      if (row && row.workspace === current?.members.get(machine) && typeof row.id === "string" && typeof row.title === "string" && ["running", "success", "failure", "interrupted"].includes(row.state)) setNotice({ ...row, machine });
    }
  }); }, [subscribe, current?.id]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 8_000);
    return () => clearTimeout(timer);
  }, [notice]);
  if (!notice) return null;
  return <View accessibilityLiveRegion="polite" style={{ position: "absolute", top: insets.top + 56, left: 16, right: 16, backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1, borderRadius: 10, padding: 14, gap: 8 }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}><Text style={{ flex: 1, color: theme.text, fontWeight: "600" }}>{notice.title}</Text><Pressable accessibilityRole="button" accessibilityLabel={t("activity.dismiss")} onPress={() => setNotice(null)} hitSlop={10}><Text style={{ color: theme.textMuted, fontSize: 20 }}>×</Text></Pressable></View>
    <Text style={{ color: theme.textMuted, fontSize: TEXT.label }}>{t(`activity.state.${notice.state}`)} · {hostOf(notice.machine)?.label ?? notice.machine}</Text>
    <Pressable accessibilityRole="button" onPress={() => { router.push({ pathname: "/activity", params: { machine: notice.machine } }); setNotice(null); }} style={{ paddingVertical: 8 }}><Text style={{ color: theme.primary, fontWeight: "600" }}>{t("activity.view")}</Text></Pressable>
  </View>;
}
