import { Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ChatEvent, Question, Turn } from "@terminus/protocol";
import {
  type PendingQuestion,
  type Permission,
  type TaskView,
  answerQuestion,
  loadTask,
  markSeen,
  respondPermission,
  sendToTask,
  stopTask,
} from "../../../../../lib/engine";
import { HostError } from "../../../../../lib/hosts";
import { t, w } from "../../../../../lib/i18n";
import { useMachines } from "../../../../../lib/machines";
import { type Theme, useTheme } from "../../../../../ui/theme";
import { KeyboardScreen } from "../../../../../ui/KeyboardScreen";

/** Kinds that change what the task reports: pending requests or whether it runs. */
const REFRESH = new Set(["permission", "started", "done", "presence"]);

type Line = { key: string; role: string; text: string; tools: number };

const linesOf = (turns: Turn[]): Line[] => turns.map((turn, i) => ({ key: turn.id ?? String(i), role: turn.role, text: turn.text ?? "", tools: turn.tools?.length ?? 0 }));

/**
 * Una tarea en vivo, en la máquina que la corre: conversación, aprobaciones,
 * preguntas, escribir y detener. Con la VM apagada se ve la copia del relay y
 * escribir la enciende; una máquina propia apagada lo dice y no se intenta.
 */
export default function TaskScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ host: string; workspace: string; folder: string; id: string }>();
  const { workspace, id } = params;
  const folder = params.folder === "_" ? "" : params.folder;
  const { hostOf, subscribe, setOpenTask, tick, titleOf } = useMachines();
  const host = hostOf(params.host);
  const [view, setView] = useState<TaskView | null>(null);
  const [streaming, setStreaming] = useState("");
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [waking, setWaking] = useState(false);
  const list = useRef<FlatList<Line>>(null);
  const key = `${params.host}/${id}`;

  const fail = useCallback(
    (error: unknown) => {
      const name = host?.label ?? "";
      if (error instanceof HostError && error.code === "machine_asleep") return setNote(t("machines.asleep", { name }));
      if (error instanceof HostError && error.code === "machine_off") return setNote(w("shell.machines.task_off", { name }));
      if (error instanceof HostError && (error.code === "start_failed" || error.code === "start_timeout")) return setNote(t("machines.start_failed", { name }));
      setNote(t("task.error", { detail: error instanceof Error ? error.message : String(error) }));
    },
    [host],
  );

  const refresh = useCallback(async () => {
    if (!host) return;
    const next = await loadTask(host, workspace, folder, id);
    setView(next);
    setStreaming("");
  }, [host, workspace, folder, id]);

  useEffect(() => {
    setOpenTask(key);
    setView(null);
    void refresh()
      .then(() => host && markSeen(host, workspace, id))
      .catch(fail);
    return () => setOpenTask(null);
  }, [key, refresh, setOpenTask, fail, host, workspace, id]);

  // La máquina se encendió (o volvió): la copia deja paso a lo vivo.
  useEffect(() => {
    if (host?.power() === "on" && view?.cachedAt) void refresh().catch(fail);
  }, [tick]);

  useEffect(
    () =>
      subscribe((from, events, gap) => {
        if (from !== params.host) return;
        if (gap) return void refresh().catch(fail);
        for (const event of events) {
          if (event.name !== "chat" && event.name !== "question" && event.name !== "session") continue;
          const chat = event.payload as ChatEvent;
          if (chat.session !== id) continue;
          if (event.name !== "chat") {
            void refresh().catch(fail);
            continue;
          }
          if (chat.kind === "delta") setStreaming((text) => (chat.starts_message ? chat.text : text + chat.text));
          if (chat.kind === "done") {
            void refresh()
              .then(() => host && markSeen(host, workspace, id))
              .catch(fail);
          } else if (REFRESH.has(chat.kind)) void refresh().catch(fail);
        }
      }),
    [subscribe, params.host, id, refresh, fail, host, workspace],
  );

  /** Una acción: si la VM está apagada, avisa que se enciende mientras espera. */
  async function act(work: () => Promise<unknown>) {
    if (!host) return false;
    setNote(null);
    const wakes = host.canAct() === "wakes" && host.power() !== "on";
    if (wakes) setWaking(true);
    try {
      await work();
      await refresh();
      return true;
    } catch (error) {
      fail(error);
      return false;
    } finally {
      setWaking(false);
    }
  }

  async function send() {
    if (!host || !view || !draft.trim()) return;
    const message = draft.trim();
    setDraft("");
    if (!(await act(() => sendToTask(host, workspace, folder, view, message)))) setDraft(message);
  }

  const decide = (permission: Permission, allow: boolean) => host && void act(() => respondPermission(host, workspace, id, permission.request_id, allow));
  const answer = (pending: PendingQuestion, chosen: Record<string, string[]>, free: Record<string, string>) =>
    host && void act(() => answerQuestion(host, workspace, id, pending, chosen, free));
  const stop = () => host && void stopTask(host, workspace, folder, id).catch(fail);

  const running = view?.running ?? false;
  const permissions = view?.permissions ?? [];
  const questions = view?.questions ?? [];
  const asleep = host?.canAct() === "asleep";
  const lines = linesOf(view?.session.turns ?? []);
  const cachedNote =
    view?.cachedAt && host ? t("machines.cached", { name: host.label, time: new Date(view.cachedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }) : null;
  const title = (view?.session.turns.find((turn) => turn.role === "user")?.text ?? "").split("\n")[0];

  return (
    <KeyboardScreen>
      <Stack.Screen options={{ title: titleOf(key) ?? title }} />
      <FlatList
        ref={list}
        data={lines}
        keyExtractor={(line) => line.key}
        contentContainerStyle={styles.list}
        onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}
        renderItem={({ item }) => <Bubble line={item} theme={theme} />}
        ListHeaderComponent={cachedNote ? <Text style={[styles.banner, { color: theme.textMuted, backgroundColor: theme.muted }]}>{cachedNote}</Text> : undefined}
        ListFooterComponent={
          <View style={styles.footer}>
            {streaming ? <Bubble line={{ key: "live", role: "agent", text: streaming, tools: 0 }} theme={theme} /> : null}
            {running && !streaming ? <Text style={{ color: theme.textMuted }}>{t("state.working")}…</Text> : null}
            {waking && host ? <Text style={{ color: theme.textMuted }}>{w("shell.machines.waking", { name: host.label })}</Text> : null}
            {asleep && host ? <Text style={{ color: theme.textMuted }}>{t("machines.asleep", { name: host.label })}</Text> : null}
            {note ? <Text style={{ color: theme.textMuted }}>{note}</Text> : null}
          </View>
        }
      />
      {permissions.length || questions.length ? (
        <ScrollView style={styles.pending} contentContainerStyle={styles.footer}>
          {permissions.map((p) => (
            <PermissionCard key={p.request_id} permission={p} theme={theme} disabled={asleep} onDecide={(allow) => decide(p, allow)} />
          ))}
          {questions.map((q) => (
            <QuestionCard key={q.request_id} pending={q} theme={theme} disabled={asleep} onAnswer={(c, f) => answer(q, c, f)} />
          ))}
        </ScrollView>
      ) : null}
      <View style={[styles.composer, { borderColor: theme.border, backgroundColor: theme.surface, paddingBottom: 8 + insets.bottom }]}>
        <TextInput
          style={[styles.input, { color: theme.text, backgroundColor: theme.muted }]}
          value={draft}
          onChangeText={setDraft}
          placeholder={t("task.composer")}
          placeholderTextColor={theme.textMuted}
          editable={!asleep}
          multiline
          testID="composer"
        />
        {running ? (
          <Pressable style={[styles.send, { backgroundColor: theme.muted }]} onPress={stop} testID="stop">
            <Text style={{ color: theme.text, fontWeight: "600" }}>{t("task.stop")}</Text>
          </Pressable>
        ) : null}
        <Pressable
          style={[styles.send, { backgroundColor: theme.primary, opacity: draft.trim() && !asleep && !waking ? 1 : 0.5 }]}
          disabled={!draft.trim() || asleep || waking}
          onPress={send}
          testID="send"
        >
          <Text style={{ color: theme.onPrimary, fontWeight: "600" }}>{t("task.send")}</Text>
        </Pressable>
      </View>
    </KeyboardScreen>
  );
}

function Bubble({ line, theme }: { line: Line; theme: Theme }) {
  const mine = line.role === "user";
  const system = line.role === "system";
  const steps = line.tools;
  if (!line.text && !steps) return null;
  return (
    <View
      style={[
        styles.bubble,
        mine ? { alignSelf: "flex-end", backgroundColor: theme.userBubble } : { alignSelf: "stretch", backgroundColor: theme.surface },
        system ? { backgroundColor: theme.muted } : null,
        { borderColor: theme.border },
      ]}
    >
      {line.text ? (
        <Text selectable style={{ color: system ? theme.textMuted : theme.text, fontSize: 15, lineHeight: 21 }}>
          {line.text}
        </Text>
      ) : null}
      {steps ? <Text style={{ color: theme.textMuted, fontSize: 12, marginTop: 4 }}>{t("task.tools", { count: steps })}</Text> : null}
    </View>
  );
}

function PermissionCard({ permission, theme, disabled, onDecide }: { permission: Permission; theme: Theme; disabled: boolean; onDecide: (allow: boolean) => void }) {
  return (
    <View style={[styles.card, { borderColor: theme.approving, backgroundColor: theme.surface }]} testID="permission">
      <Text style={{ color: theme.text, fontWeight: "600" }}>{t("task.permission", { tool: permission.tool })}</Text>
      {permission.target ? (
        <Text selectable style={[styles.code, { color: theme.text, backgroundColor: theme.muted }]}>
          {permission.target}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Pressable disabled={disabled} style={[styles.action, { backgroundColor: theme.muted, opacity: disabled ? 0.5 : 1 }]} onPress={() => onDecide(false)} testID="deny">
          <Text style={{ color: theme.text }}>{t("task.deny")}</Text>
        </Pressable>
        <Pressable disabled={disabled} style={[styles.action, { backgroundColor: theme.primary, opacity: disabled ? 0.5 : 1 }]} onPress={() => onDecide(true)} testID="allow">
          <Text style={{ color: theme.onPrimary, fontWeight: "600" }}>{t("task.allow")}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function QuestionCard({
  pending,
  theme,
  disabled,
  onAnswer,
}: {
  pending: PendingQuestion;
  theme: Theme;
  disabled: boolean;
  onAnswer: (chosen: Record<string, string[]>, free: Record<string, string>) => void;
}) {
  const [chosen, setChosen] = useState<Record<string, string[]>>({});
  const [free, setFree] = useState<Record<string, string>>({});
  const toggle = (q: Question, value: string) =>
    setChosen((old) => {
      const current = old[q.id] ?? [];
      const next = current.includes(value) ? current.filter((v) => v !== value) : q.multiple ? [...current, value] : [value];
      return { ...old, [q.id]: next };
    });
  return (
    <View style={[styles.card, { borderColor: theme.info, backgroundColor: theme.surface }]} testID="question">
      <Text style={{ color: theme.textMuted, fontSize: 12 }}>{t("task.question")}</Text>
      {pending.questions.map((q) => (
        <View key={q.id} style={{ gap: 6 }}>
          <Text style={{ color: theme.text, fontWeight: "600" }}>{q.question}</Text>
          {q.options.map((o) => {
            const on = chosen[q.id]?.includes(o.value);
            return (
              <Pressable
                key={o.value}
                onPress={() => toggle(q, o.value)}
                style={[styles.option, { borderColor: on ? theme.primary : theme.border, backgroundColor: on ? theme.userBubble : theme.surface }]}
              >
                <Text style={{ color: theme.text }}>{o.label}</Text>
                {o.detail ? <Text style={{ color: theme.textMuted, fontSize: 12 }}>{o.detail}</Text> : null}
              </Pressable>
            );
          })}
          {q.free_text ? (
            <TextInput
              style={[styles.input, { color: theme.text, backgroundColor: theme.muted }]}
              placeholder={t("task.free_text")}
              placeholderTextColor={theme.textMuted}
              value={free[q.id] ?? ""}
              onChangeText={(text) => setFree((old) => ({ ...old, [q.id]: text }))}
            />
          ) : null}
        </View>
      ))}
      <Pressable disabled={disabled} style={[styles.action, { backgroundColor: theme.primary, alignSelf: "flex-end", opacity: disabled ? 0.5 : 1 }]} onPress={() => onAnswer(chosen, free)}>
        <Text style={{ color: theme.onPrimary, fontWeight: "600" }}>{t("task.answer")}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { padding: 8, borderRadius: 8, fontSize: 13 },
  list: { padding: 12, gap: 8 },
  footer: { gap: 8 },
  pending: { flexGrow: 0, maxHeight: "55%", paddingHorizontal: 12, paddingBottom: 8 },
  bubble: { maxWidth: "92%", borderRadius: 14, padding: 10, borderWidth: StyleSheet.hairlineWidth },
  card: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 10 },
  code: { fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }), fontSize: 13, padding: 8, borderRadius: 8 },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  action: { borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  option: { borderWidth: 1, borderRadius: 10, padding: 10 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8, padding: 8, borderTopWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 15, maxHeight: 140 },
  send: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
});
