import { useLocalSearchParams } from "expo-router";
import type { Activity, ActivityLog, ActivityRow } from "@terminus/protocol";
import { useEffect, useRef, useState } from "react";
import { AppState, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { failureText } from "../lib/engine";
import { t } from "../lib/i18n";
import { useMachines } from "../lib/machines";
import { useWorkspaces } from "../lib/workspaces";
import { useTheme } from "../ui/theme";

export default function ActivityLogs() {
  const theme = useTheme();
  const { hostsOfCurrent, current } = useWorkspaces();
  const { subscribe } = useMachines();
  const params = useLocalSearchParams<{ machine?: string }>();
  const [machine, setMachine] = useState(params.machine ?? "");
  useEffect(() => { if (params.machine) setMachine(params.machine); }, [params.machine]);
  const host = hostsOfCurrent.find(h => h.id === machine) ?? hostsOfCurrent[0];
  const workspace = host && current?.members.get(host.id);
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [detail, setDetail] = useState<Activity | null>(null);
  const [step, setStep] = useState("");
  const [log, setLog] = useState<ActivityLog | null>(null);
  const [offsets, setOffsets] = useState([0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const reading = useRef(false);
  const logRequest = useRef(0);
  const selectedStep = useRef(step); selectedStep.current = step;
  const online = host?.power() === "on";
  const date = (at: number) => new Date(at).toLocaleString();
  const color = (state: string) => state === "failure" ? theme.failedMark : state === "success" ? theme.success : theme.textMuted;
  const load = async (id?: string) => {
    if (!host || !workspace || !online || reading.current) return;
    reading.current = true;
    const key = generation.current;
    setBusy(true); setError("");
    try {
      const answer = await host.call<ActivityRow[]>("list_activity", workspace, { project: null });
      const record = id ? await host.call<Activity>("read_activity", workspace, { id }) : null;
      if (key !== generation.current) return;
      setRows(answer.value); setDetail(record?.value ?? null);
      if (!record?.value.steps.some(s => s.id === selectedStep.current)) { setStep(""); setLog(null); setOffsets([0]); }
    } catch (e) { if (key === generation.current) setError(`${t("activity.unavailable")} ${failureText(e)}`); }
    finally { if (key === generation.current) { reading.current = false; setBusy(false); } }
  };
  const read = async (id: string, part: string, history: number[]) => {
    if (!host || !workspace || !online) return;
    const key = generation.current;
    const request = ++logRequest.current;
    if (step !== part || offsets.at(-1) !== history.at(-1)) setLog(null);
    setStep(part); setOffsets(history); setError("");
    try {
      const page = await host.call<ActivityLog>("read_activity_log", workspace, { id, step: part, offset: history.at(-1) ?? 0 });
      if (key === generation.current && request === logRequest.current) setLog(page.value);
    } catch { if (key === generation.current && request === logRequest.current) setError(t("activity.unavailable")); }
  };
  const refresh = () => {
    void load(detail?.id);
    if (detail && step) void read(detail.id, step, offsets);
  };
  const latest = useRef({ refresh }); latest.current = { refresh };
  useEffect(() => {
    generation.current++; reading.current = false; logRequest.current++;
    setRows([]); setDetail(null); setStep(""); setLog(null); setError("");
    void load();
    return () => { generation.current++; logRequest.current++; };
  }, [host?.id, workspace]);
  useEffect(() => {
    const timer = setInterval(() => { if (AppState.currentState === "active") latest.current.refresh(); }, 5_000);
    const off = subscribe((id, events) => { if (id === host?.id && events.some(e => e.name === "activity" && (e.payload as { workspace?: string })?.workspace === workspace)) latest.current.refresh(); });
    return () => { clearInterval(timer); off(); };
  }, [host?.id, workspace, subscribe]);
  const action = { color: theme.primary, fontSize: 14, fontWeight: "600" as const };
  return <ScrollView contentInsetAdjustmentBehavior="automatic" refreshControl={<RefreshControl refreshing={busy} onRefresh={refresh} />} contentContainerStyle={{ padding: 16, gap: 16 }}>
    <Text style={{ color: theme.textMuted, fontSize: 14 }}>{t("activity.description")}</Text>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {hostsOfCurrent.map(h => <Pressable key={h.id} accessibilityRole="button" accessibilityState={{ selected: h.id === host?.id }} onPress={() => setMachine(h.id)} style={{ paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderRadius: 8, borderColor: h.id === host?.id ? theme.primary : theme.border }}><Text style={{ color: h.id === host?.id ? theme.primary : theme.text }}>{h.label}</Text></Pressable>)}
    </ScrollView>
    {!online ? <Text accessibilityRole="text" style={{ color: theme.textMuted }}>{t("activity.offline")}</Text> : null}
    {error ? <Text accessibilityRole="alert" style={{ color: theme.failedMark }}>{error}</Text> : null}
    {detail ? <>
      <Pressable accessibilityRole="button" onPress={() => { generation.current++; reading.current = false; setBusy(false); setDetail(null); setStep(""); setLog(null); logRequest.current++; }} style={{ paddingVertical: 8 }}><Text style={action}>{t("activity.back")}</Text></Pressable>
      <Text style={{ color: theme.text, fontWeight: "600", fontSize: 18 }}>{detail.title}</Text>
      <Text style={{ color: color(detail.state) }}>{t(`activity.state.${detail.state}`)} · {date(detail.updated_at)}</Text>
      <Text style={{ color: theme.textMuted, fontSize: 13 }}>{t("activity.technical")}</Text>
      {detail.steps.map(part => <View key={part.id} style={{ borderTopWidth: 1, borderColor: theme.border, paddingVertical: 8, gap: 10 }}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: step === part.id }} onPress={() => { if (step === part.id) { setStep(""); logRequest.current++; } else void read(detail.id, part.id, [0]); }} style={{ minHeight: 44, justifyContent: "center", gap: 4 }}>
          <Text style={{ color: theme.text, fontWeight: "600" }}>{date(part.started_at)}</Text><Text style={{ color: color(part.state), fontSize: 13 }}>{t(`activity.state.${part.state}`)}</Text>
        </Pressable>
        {step === part.id ? <>
          <Text selectable style={{ color: theme.text, backgroundColor: theme.muted, padding: 12, borderRadius: 6, fontFamily: "monospace", fontSize: 12 }}>{part.command}</Text>
          <Text selectable style={{ color: theme.textMuted, fontSize: 12 }}>{part.cwd}</Text>
          {part.exit_code !== null ? <Text style={{ color: theme.textMuted }}>{t("activity.exit", { code: part.exit_code })}</Text> : null}
          {part.error ? <Text selectable style={{ color: theme.failedMark }}>{part.error}</Text> : null}
          <Text selectable accessibilityLabel={t("activity.output")} style={{ color: theme.text, backgroundColor: theme.muted, padding: 12, borderRadius: 6, fontFamily: "monospace", fontSize: 12 }}>{log?.text || t(log ? "activity.no_output" : "activity.loading")}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
            <Pressable accessibilityRole="button" disabled={offsets.length < 2} onPress={() => void read(detail.id, part.id, offsets.slice(0,-1))} style={{ paddingVertical: 12, opacity: offsets.length < 2 ? 0.4 : 1 }}><Text style={action}>{t("activity.previous")}</Text></Pressable>
            <Pressable accessibilityRole="button" disabled={!log?.has_more} onPress={() => void read(detail.id, part.id, [...offsets, log!.next_offset])} style={{ paddingVertical: 12, opacity: log?.has_more ? 1 : 0.4 }}><Text style={action}>{t("activity.next")}</Text></Pressable>
            <Pressable accessibilityRole="button" disabled={!online} onPress={() => void read(detail.id, part.id, offsets)} style={{ paddingVertical: 12 }}><Text style={action}>{t("activity.refresh")}</Text></Pressable>
          </View>
        </> : null}
      </View>)}
    </> : <>
      {online && !rows.length && !error ? <Text style={{ color: theme.textMuted, paddingVertical: 16 }}>{t(busy ? "activity.loading" : "activity.empty")}</Text> : null}
      {rows.map(row => <Pressable key={row.id} accessibilityRole="button" disabled={!online || busy} onPress={() => void load(row.id)} style={{ borderBottomWidth: 1, borderColor: theme.border, paddingVertical: 14, gap: 6 }}>
        <Text style={{ color: theme.text, fontWeight: "600", fontSize: 15 }}>{row.title}</Text><Text style={{ color: color(row.state), fontSize: 13 }}>{t(`activity.state.${row.state}`)}</Text><Text style={{ color: theme.textMuted, fontSize: 12 }}>{date(row.updated_at)}</Text>
      </Pressable>)}
    </>}
  </ScrollView>;
}
