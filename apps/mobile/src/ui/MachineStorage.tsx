import type { MachineResources, WorkspaceStorage } from "@terminus/protocol";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { Host } from "../lib/hosts";
import { lang, t } from "../lib/i18n";
import { diskUsage, storageDetail, storageSummary } from "../lib/storage";
import { Icon } from "./Icon";
import type { Theme } from "./theme";

const size = (bytes: number) => {
  const unit = bytes >= 1e9 ? 1e9 : bytes >= 1e6 ? 1e6 : bytes >= 1e3 ? 1e3 : 1;
  return `${new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(bytes / unit)} ${unit === 1e9 ? "GB" : unit === 1e6 ? "MB" : unit === 1e3 ? "KB" : "B"}`;
};
const date = (at: number) => new Date(at).toLocaleString(lang);

export function MachineStorage({ hosts, workspace, theme }: { hosts: Host[]; workspace: string | null; theme: Theme }) {
  return <View style={{ gap: 12 }}>
    {!hosts.length ? <Text style={{ color: theme.textMuted }}>{t("storage.empty")}</Text> : null}
    {hosts.map((host) => <MachineDisk key={host.id} host={host} workspace={workspace} theme={theme} />)}
  </View>;
}

function MachineDisk({ host, workspace, theme }: { host: Host; workspace: string | null; theme: Theme }) {
  const [resources, setResources] = useState<MachineResources>();
  const [workspaceName, setWorkspaceName] = useState<string>();
  const [detail, setDetail] = useState<WorkspaceStorage>();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [measuring, setMeasuring] = useState(false);
  const [error, setError] = useState(false);
  const [detailError, setDetailError] = useState(false);
  const [stale, setStale] = useState(false);
  const [, render] = useState(0);
  const request = useRef(0);
  const scan = useRef(0);
  const reading = useRef(false);
  const scanning = useRef(false);
  const online = host.power() === "on";

  async function summary() {
    if (reading.current || host.power() !== "on") return;
    const id = ++request.current;
    reading.current = true;
    setBusy(true);
    setError(false);
    try {
      const result = await storageSummary(host);
      if (id !== request.current) return;
      setResources(result.resources);
      setWorkspaceName(result.workspaces.find((w) => w.id === workspace)?.name);
      setStale(result.stale);
      setError(result.stale);
    } catch {
      if (id === request.current) { setError(true); setStale(true); }
    } finally {
      if (id === request.current) { reading.current = false; setBusy(false); }
    }
  }

  async function measure() {
    if (!workspace || scanning.current || host.power() !== "on" || (host.linked !== null && !host.linked.has(workspace))) return;
    const id = ++scan.current;
    scanning.current = true;
    setMeasuring(true);
    setDetailError(false);
    try {
      const result = await storageDetail(host, workspace);
      if (id === scan.current) {
        setDetail(result.value);
        if (result.cachedAt !== null) { setStale(true); setDetailError(true); }
      }
    } catch { if (id === scan.current) setDetailError(true); }
    finally { if (id === scan.current) { scanning.current = false; setMeasuring(false); } }
  }

  useEffect(() => {
    setResources(undefined); setDetail(undefined); setWorkspaceName(undefined);
    setOpen(false); setStale(false); setError(false); setDetailError(false);
    void summary();
    const unsubscribe = host.onChange(() => {
      render((value) => value + 1);
      if (host.power() !== "on") {
        request.current++; scan.current++;
        reading.current = false; scanning.current = false;
        setBusy(false); setMeasuring(false); setStale(true);
      }
    });
    return () => { request.current++; scan.current++; reading.current = false; scanning.current = false; unsubscribe(); };
  }, [host, workspace]);

  const text = { color: theme.textMuted, fontSize: 13 };
  return <View testID={`storage-${host.id}`} style={{ padding: 14, gap: 8, borderWidth: 1, borderColor: theme.border, borderRadius: 12, backgroundColor: theme.surface }}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => {
      setOpen(!open);
      if (!open && !detail) void measure();
    }} style={{ minHeight: 44, justifyContent: "center", gap: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}><Text style={{ color: theme.text, fontWeight: "600", fontSize: 16, flex: 1 }}>{host.label}</Text><Icon name={open ? "chevron-down" : "chevron-right"} size={18} color={theme.textMuted} /></View>
      <Text style={text}>{!online ? t("storage.offline") : busy ? t("storage.loading") : error ? t("storage.error") : t("storage.online")}</Text>
    </Pressable>
    {resources?.storage.map((disk) => {
      const usage = diskUsage(disk);
      return usage ? <View key={disk.id} style={{ gap: 6 }}>
        <Text style={text}>{t("storage.volume")}</Text>
        <View accessible accessibilityLabel={t("storage.disk", { used: size(usage.used), free: size(disk.free_bytes), total: size(disk.total_bytes) })} style={{ height: 8, borderRadius: 4, overflow: "hidden", backgroundColor: theme.muted }}>
          <View style={{ height: 8, width: `${usage.percent}%`, backgroundColor: usage.percent >= 90 ? theme.approving : theme.primary }} />
        </View>
        <Text style={text}>{t("storage.disk", { used: size(usage.used), free: size(disk.free_bytes), total: size(disk.total_bytes) })}</Text>
        {open ? <Text style={text}>{t("storage.available", { size: size(disk.available_bytes) })}</Text> : null}
      </View> : <Text key={disk.id} style={text}>{t("storage.unavailable")}</Text>;
    })}
    {!busy && (!resources || !resources.storage.length) ? <Text style={text}>{resources?.error === "measurement_failed" ? t("storage.error") : t("storage.unavailable")}</Text> : null}
    {resources ? <Text style={text}>{t("storage.measured", { when: date(resources.measured_at) })}</Text> : null}
    {(stale || !online || (resources && Date.now() - resources.measured_at > 300_000)) && resources ? <Text style={text}>{t("storage.stale")}</Text> : null}
    <Pressable accessibilityRole="button" disabled={!online || busy} onPress={() => void summary()} style={{ minHeight: 44, justifyContent: "center", opacity: !online || busy ? 0.5 : 1 }}>
      <Text style={{ color: theme.primary }}>{t("storage.refresh")}</Text>
    </Pressable>
    {open ? <View style={{ gap: 8, borderTopWidth: 1, borderColor: theme.border, paddingTop: 12 }}>
      <Text style={text}>{t("storage.unknown")}</Text>
      <Text style={{ color: theme.text, fontWeight: "600" }}>{t("storage.workspace", { name: workspaceName ?? workspace ?? t("storage.none") })}</Text>
      {workspace && host.linked !== null && !host.linked.has(workspace) ? <Text style={text}>{t("storage.missing")}</Text> : null}
      {detail ? <>
        <Text style={{ color: theme.text }}>{t("storage.logical", { size: size(detail.bytes) })}</Text>
        <Text style={text}>{t("storage.recoverable", { size: size(detail.recuperable) })}</Text>
        <Text style={text}>{t("storage.measured", { when: date(detail.medido_en) })}</Text>
        {!online || stale || detailError || Date.now() - detail.medido_en > 300_000 ? <Text style={text}>{t("storage.stale")}</Text> : null}
        {detail.aviso ? <Text style={text}>{t("storage.incomplete")}</Text> : null}
        <Text style={text}>{t("storage.shared", { size: size(detail.compartido.reduce((sum, row) => sum + row.bytes, 0)) })}</Text>
        <Text style={text}>{t("storage.other", { size: size(detail.sueltos.reduce((sum, row) => sum + row.bytes, 0)) })}</Text>
        {detail.tareas.slice(0, 20).map((task) => <View key={`${task.project}:${task.session}`} style={{ gap: 2 }}>
          <Text style={{ color: theme.text }}>{task.tarea}</Text>
          <Text style={text}>{task.proyecto ? `${task.proyecto} · ` : ""}{size(task.bytes)}</Text>
        </View>)}
        {detail.tareas.length > 20 ? <Text style={text}>{t("storage.tasks_shown", { count: detail.tareas.length })}</Text> : null}
      </> : null}
      {detailError ? <Text accessibilityRole="alert" style={{ color: theme.error }}>{t("storage.error")}</Text> : null}
      <Pressable accessibilityRole="button" disabled={!online || measuring || !workspace || (host.linked !== null && !host.linked.has(workspace))} onPress={() => void measure()} style={{ minHeight: 44, justifyContent: "center" }}>
        <Text style={{ color: online ? theme.primary : theme.textMuted }}>{measuring ? t("storage.measuring") : t("storage.measure")}</Text>
      </Pressable>
    </View> : null}
  </View>;
}
