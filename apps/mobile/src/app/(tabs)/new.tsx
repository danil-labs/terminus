import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { createTask, defaultsFor } from "../../lib/engine";
import { HostError } from "../../lib/hosts";
import { t, w } from "../../lib/i18n";
import { useMachines } from "../../lib/machines";
import { spaceName, useWorkspaces } from "../../lib/workspaces";
import { openTask } from "../../ui/components";
import { FolderSquare } from "../../ui/TaskCard";
import { useTheme } from "../../ui/theme";
import { KeyboardScreen } from "../../ui/KeyboardScreen";

/**
 * «Nueva» de la barra: en qué máquina, en qué carpeta, con quién y qué. La
 * máquina por omisión es la última usada o la VM de Danil; una VM apagada se
 * enciende al empezar, una máquina propia apagada no.
 */
export default function NewTask() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ folder?: string; agent?: string; host?: string }>();
  const { preferred, rememberMachine, tick } = useMachines();
  const { current, snapshot, space, hostsOfCurrent } = useWorkspaces();
  const [hostId, setHostId] = useState<string | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const [agent, setAgent] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (params.folder) setFolder(params.folder);
    if (params.host) setHostId(params.host);
    setAgent(params.agent ?? null);
  }, [params.folder, params.agent, params.host]);

  const host = hostsOfCurrent.find((h) => h.id === hostId) ?? preferred(hostsOfCurrent);
  const folders = (snapshot?.folders ?? []).filter((f) => (!space || space.folders.includes(f.id)) && host && f.hosts.includes(host.id));
  const target = folders.some((f) => f.id === folder) ? folder : (folders[0]?.id ?? null);
  const agents = (snapshot?.agents ?? []).filter((a) => a.places.some((p) => p.host === host?.id && p.folder === target));
  const chosenAgent = agents.some((a) => a.name === agent) ? agent : null;
  const act = host?.canAct();
  const ready = Boolean(host && current && target && message.trim()) && act !== "asleep" && !busy;
  void tick;

  async function start() {
    if (!host || !current || !target) return;
    setBusy(true);
    setNote(act === "wakes" ? w("shell.machines.waking", { name: host.label }) : null);
    try {
      const defaults = await defaultsFor(host, current.id, snapshot?.tasks ?? [], chosenAgent);
      const id = await createTask(host, current.id, {
        folder: target,
        prompt: message.trim(),
        provider: defaults.provider,
        model: defaults.model,
        agent: chosenAgent,
        space: space?.id ?? null,
      });
      rememberMachine(host.id);
      setMessage("");
      setNote(null);
      openTask(host.id, current.id, target, id);
    } catch (error) {
      if (error instanceof HostError && error.code === "no_provider") setNote(t("new.no_provider"));
      else if (error instanceof HostError && error.code === "machine_asleep") setNote(t("machines.asleep", { name: host.label }));
      else if (error instanceof HostError && (error.code === "start_failed" || error.code === "start_timeout")) setNote(t("machines.start_failed", { name: host.label }));
      else setNote(t("task.error", { detail: error instanceof Error ? error.message : String(error) }));
    } finally {
      setBusy(false);
    }
  }

  const chip = (active: boolean) => [styles.chip, { borderColor: theme.border, backgroundColor: active ? theme.primary : theme.surface }];
  const chipText = (active: boolean) => ({ color: active ? theme.onPrimary : theme.text, fontWeight: active ? ("700" as const) : ("500" as const) });
  const power = (h: typeof host) =>
    !h ? "" : h.power() === "on" ? w("web.computers.state.online") : h.power() === "starting" ? w("web.computers.state.starting") : w("web.computers.state.offline");

  return (
    <KeyboardScreen style={{ backgroundColor: theme.bg }}>
      <ScrollView contentContainerStyle={[styles.body, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 96 }]} keyboardShouldPersistTaps="handled">
        <Text style={[styles.title, { color: theme.text }]}>{t("new.title")}</Text>
        <Text style={{ color: theme.textMuted }}>
          {current?.name}
          {space ? ` · ${spaceName(space, t("space.general"))}` : ""}
        </Text>

        {hostsOfCurrent.length > 1 ? (
          <>
            <Text style={[styles.label, { color: theme.textMuted }]}>{w("shell.machines.label")}</Text>
            <View style={styles.chips}>
              {hostsOfCurrent.map((h) => (
                <Pressable key={h.id} testID={`machine-${h.id}`} style={chip(h.id === host?.id)} onPress={() => setHostId(h.id)}>
                  <Text style={chipText(h.id === host?.id)}>{h.label}</Text>
                  <Text style={[chipText(h.id === host?.id), { fontSize: 11, fontWeight: "400" }]}>{power(h)}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}
        {!host && current ? <Text style={{ color: theme.textMuted }}>{t("new.no_workspace")}</Text> : null}

        <Text style={[styles.label, { color: theme.textMuted }]}>{t("new.folder")}</Text>
        <View style={styles.chips}>
          {folders.map((f) => (
            <Pressable key={f.id} testID={`folder-${f.id}`} style={[chip(f.id === target), styles.folderChip]} onPress={() => setFolder(f.id)}>
              <FolderSquare id={f.id} />
              <Text style={chipText(f.id === target)}>{f.name}</Text>
            </Pressable>
          ))}
        </View>

        {agents.length ? (
          <>
            <Text style={[styles.label, { color: theme.textMuted }]}>{t("new.agent")}</Text>
            <View style={styles.chips}>
              <Pressable style={chip(!chosenAgent)} onPress={() => setAgent(null)}>
                <Text style={chipText(!chosenAgent)}>{t("new.no_agent")}</Text>
              </Pressable>
              {agents.map((a) => (
                <Pressable key={a.name} testID={`agent-${a.name}`} style={chip(chosenAgent === a.name)} onPress={() => setAgent(a.name)}>
                  <Text style={chipText(chosenAgent === a.name)}>{a.name}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        <TextInput
          testID="new-message"
          style={[styles.input, { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border }]}
          value={message}
          onChangeText={setMessage}
          placeholder={t("new.placeholder")}
          placeholderTextColor={theme.textMuted}
          multiline
        />
        {host && act === "asleep" ? <Text style={{ color: theme.textMuted }}>{t("machines.asleep", { name: host.label })}</Text> : null}
        {host && act === "wakes" && host.power() === "off" && !busy ? (
          <Text style={{ color: theme.textMuted }}>{w("shell.machines.asleep_notice", { name: host.label })}</Text>
        ) : null}
        {note ? <Text style={{ color: theme.textMuted }}>{note}</Text> : null}
        <Pressable testID="new-start" disabled={!ready} onPress={start} style={[styles.start, { backgroundColor: theme.primary, opacity: ready ? 1 : 0.5 }]}>
          <Text style={{ color: theme.onPrimary, fontWeight: "700", fontSize: 16 }}>{t("new.start")}</Text>
        </Pressable>
      </ScrollView>
    </KeyboardScreen>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, gap: 8 },
  title: { fontSize: 28, fontWeight: "800" },
  label: { fontSize: 13, fontWeight: "700", textTransform: "uppercase", marginTop: 14 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7 },
  folderChip: { flexDirection: "row", alignItems: "center", gap: 6 },
  input: { marginTop: 16, minHeight: 140, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12, fontSize: 16, textAlignVertical: "top" },
  start: { marginTop: 8, borderRadius: 12, paddingVertical: 13, alignItems: "center" },
});
