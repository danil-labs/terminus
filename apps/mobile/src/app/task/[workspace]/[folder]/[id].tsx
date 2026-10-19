import { Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  BridgeError,
  type ChatEvent,
  type Permission,
  type Question,
  type QuestionSet,
  type Receipt,
  type TaskRecord,
  type TaskShow,
  call,
  readAll,
} from "../../../../lib/bridge";
import { useConnection } from "../../../../lib/connection";
import { t } from "../../../../lib/i18n";
import { type Theme, useTheme } from "../../../../ui/theme";
import { KeyboardScreen } from "../../../../ui/KeyboardScreen";

/** Kinds that change what `task show` reports: pending requests or whether it runs. */
const REFRESH_SHOW = new Set(["permission", "started", "done", "presence"]);

export default function TaskScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { workspace, folder, id } = useLocalSearchParams<{ workspace: string; folder: string; id: string }>();
  const { pairing, subscribe, setOpenTask } = useConnection();
  const scope = { workspace, folder };
  const [records, setRecords] = useState<TaskRecord[]>([]);
  const [streaming, setStreaming] = useState("");
  const [show, setShow] = useState<TaskShow | null>(null);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const cursor = useRef(0);
  const list = useRef<FlatList<TaskRecord>>(null);

  const fail = (error: unknown) => setNote(t("task.error", { detail: error instanceof BridgeError ? error.message : String(error) }));

  const refreshShow = useCallback(async () => {
    if (!pairing) return;
    setShow(await call<TaskShow>(pairing, "task show", { task: id }, { workspace, folder }));
  }, [pairing, id, workspace, folder]);

  const readMore = useCallback(async () => {
    if (!pairing) return;
    const page = await readAll(pairing, { workspace, folder }, id, cursor.current);
    cursor.current = page.cursor;
    if (page.records.length) setRecords((old) => [...old, ...page.records]);
  }, [pairing, id, workspace, folder]);

  const markSeen = useCallback(() => {
    if (pairing) void call(pairing, "mark_task_seen", { workspace, session: id }, { workspace }).catch(() => {});
  }, [pairing, workspace, id]);

  useEffect(() => {
    setOpenTask(id);
    cursor.current = 0;
    setRecords([]);
    void Promise.all([readMore(), refreshShow()]).then(markSeen).catch(fail);
    return () => setOpenTask(null);
  }, [id, setOpenTask, readMore, refreshShow, markSeen]);

  useEffect(
    () =>
      subscribe((event) => {
        if (event.name === "resync") {
          void readMore().then(refreshShow).catch(fail);
          return;
        }
        if (event.name !== "chat" && event.name !== "question") return;
        const chat = event.payload as ChatEvent;
        if (chat.session !== id) return;
        if (event.name === "question") return void refreshShow().catch(fail);
        if (chat.kind === "delta") setStreaming((text) => text + chat.text);
        if (REFRESH_SHOW.has(chat.kind)) void refreshShow().catch(fail);
        if (chat.kind === "done") {
          void readMore()
            .then(() => setStreaming(""))
            .then(markSeen)
            .catch(fail);
        }
      }),
    [subscribe, id, readMore, refreshShow, markSeen],
  );

  async function send() {
    if (!pairing || !draft.trim()) return;
    const message = draft.trim();
    const model = [...records].reverse().find((r) => r.model)?.model ?? undefined;
    setDraft("");
    setNote(null);
    try {
      const receipt = await call<Receipt>(pairing, "task send", { task: id, message, model }, scope);
      if (receipt.error) throw new BridgeError(receipt.error.code, receipt.error.detail);
      if (receipt.result?.queued) setNote(t("task.queued", { ahead: receipt.result.ahead ?? 0 }));
      await readMore();
    } catch (error) {
      setDraft(message);
      fail(error);
    }
  }

  async function decide(permission: Permission, allow: boolean) {
    if (!pairing) return;
    try {
      await call(pairing, "respond_permission", { session: id, requestId: permission.request_id, allow }, { workspace });
      await refreshShow();
    } catch (error) {
      fail(error);
    }
  }

  async function answer(set: QuestionSet, chosen: Record<string, string[]>, free: Record<string, string>) {
    if (!pairing || !set.request_id) return;
    const turn = set.turno ?? set.turn ?? "";
    const respuestas = questionsOf(set).map((q) => ({
      turn,
      question: q.id,
      chosen: chosen[q.id] ?? [],
      free_text: free[q.id]?.trim() || null,
    }));
    try {
      await call(pairing, "answer_question", { session: id, requestId: set.request_id, respuestas }, { workspace });
      await refreshShow();
    } catch (error) {
      fail(error);
    }
  }

  async function stop() {
    if (!pairing) return;
    await call(pairing, "task stop", { task: id }, scope).catch(fail);
  }

  const running = show?.running ?? false;
  const permissions = show?.requests.permissions ?? [];
  const questions = show?.requests.questions ?? [];

  return (
    <KeyboardScreen>
      <Stack.Screen options={{ title: show?.task.title ?? "" }} />
      <FlatList
        ref={list}
        data={records}
        keyExtractor={(r) => r.id}
        contentContainerStyle={styles.list}
        onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}
        renderItem={({ item }) => <Bubble record={item} theme={theme} />}
        ListFooterComponent={
          <View style={styles.footer}>
            {streaming ? <Bubble record={{ id: "live", role: "agent", text: streaming, at: 0, meta: null }} theme={theme} /> : null}
            {running && !streaming ? <Text style={{ color: theme.textMuted }}>{t("state.working")}…</Text> : null}
            {note ? <Text style={{ color: theme.textMuted }}>{note}</Text> : null}
          </View>
        }
      />
      {permissions.length || questions.length ? (
        <ScrollView style={styles.pending} contentContainerStyle={styles.footer}>
          {permissions.map((p) => (
            <PermissionCard key={p.request_id} permission={p} theme={theme} onDecide={(allow) => void decide(p, allow)} />
          ))}
          {questions.map((q, i) => (
            <QuestionCard key={q.request_id ?? i} set={q} theme={theme} onAnswer={(c, f) => void answer(q, c, f)} />
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
          multiline
          testID="composer"
        />
        {running ? (
          <Pressable style={[styles.send, { backgroundColor: theme.muted }]} onPress={stop} testID="stop">
            <Text style={{ color: theme.text, fontWeight: "600" }}>{t("task.stop")}</Text>
          </Pressable>
        ) : null}
        <Pressable
          style={[styles.send, { backgroundColor: theme.primary, opacity: draft.trim() ? 1 : 0.5 }]}
          disabled={!draft.trim()}
          onPress={send}
          testID="send"
        >
          <Text style={{ color: theme.onPrimary, fontWeight: "600" }}>{t("task.send")}</Text>
        </Pressable>
      </View>
    </KeyboardScreen>
  );
}

function questionsOf(set: QuestionSet): Question[] {
  return set.preguntas ?? set.questions ?? [];
}

function Bubble({ record, theme }: { record: TaskRecord; theme: Theme }) {
  const mine = record.role === "user";
  const system = record.role === "system";
  const steps = record.tools?.length ?? 0;
  if (!record.text && !steps) return null;
  return (
    <View
      style={[
        styles.bubble,
        mine ? { alignSelf: "flex-end", backgroundColor: theme.userBubble } : { alignSelf: "stretch", backgroundColor: theme.surface },
        system ? { backgroundColor: theme.muted } : null,
        { borderColor: theme.border },
      ]}
    >
      {record.text ? (
        <Text selectable style={{ color: system ? theme.textMuted : theme.text, fontSize: 15, lineHeight: 21 }}>
          {record.text}
        </Text>
      ) : null}
      {steps ? <Text style={{ color: theme.textMuted, fontSize: 12, marginTop: 4 }}>{t("task.tools", { count: steps })}</Text> : null}
    </View>
  );
}

function PermissionCard({ permission, theme, onDecide }: { permission: Permission; theme: Theme; onDecide: (allow: boolean) => void }) {
  return (
    <View style={[styles.card, { borderColor: theme.approving, backgroundColor: theme.surface }]} testID="permission">
      <Text style={{ color: theme.text, fontWeight: "600" }}>{t("task.permission", { tool: permission.tool })}</Text>
      {permission.target ? (
        <Text selectable style={[styles.code, { color: theme.text, backgroundColor: theme.muted }]}>
          {permission.target}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Pressable style={[styles.action, { backgroundColor: theme.muted }]} onPress={() => onDecide(false)} testID="deny">
          <Text style={{ color: theme.text }}>{t("task.deny")}</Text>
        </Pressable>
        <Pressable style={[styles.action, { backgroundColor: theme.primary }]} onPress={() => onDecide(true)} testID="allow">
          <Text style={{ color: theme.onPrimary, fontWeight: "600" }}>{t("task.allow")}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function QuestionCard({
  set,
  theme,
  onAnswer,
}: {
  set: QuestionSet;
  theme: Theme;
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
      {questionsOf(set).map((q) => (
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
      <Pressable style={[styles.action, { backgroundColor: theme.primary, alignSelf: "flex-end" }]} onPress={() => onAnswer(chosen, free)}>
        <Text style={{ color: theme.onPrimary, fontWeight: "600" }}>{t("task.answer")}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
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
