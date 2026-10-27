import { Stack, router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SendButton } from "../../../../../ui/SendButton";
import { type ChatBackgroundView, type ChatEvent, type Question, type Turn, DEFAULT_CHAT_VEIL } from "@terminus/protocol";
import {
  type PendingQuestion,
  type Permission,
  type TaskView,
  answerQuestion,
  chatBackgroundOf,
  injectIntoTask,
  loadTask,
  markSeen,
  respondPermission,
  runShell,
  sendToTask,
  stopShell,
  stopTask,
  taskDefaults,
} from "../../../../../lib/engine";
import { HostError } from "../../../../../lib/hosts";
import { t, w } from "../../../../../lib/i18n";
import { useMachines } from "../../../../../lib/machines";
import { useWorkspaces } from "../../../../../lib/workspaces";
import { Attachments, MessageBody, toolImages } from "../../../../../ui/chat/Message";
import { ChatScopeContext } from "../../../../../ui/chat/scope";
import { Composer, type Submission } from "../../../../../ui/Composer";
import { type Theme, useTheme } from "../../../../../ui/theme";
import { Icon } from "../../../../../ui/Icon";
import { KeyboardScreen } from "../../../../../ui/KeyboardScreen";

/** Kinds that change what the task reports: pending requests or whether it runs. */
const REFRESH = new Set(["permission", "started", "done", "presence"]);

type Line = { key: string; role: string; text: string; tools: number; images: string[]; attachments: string[] };

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const sameLine = (a: Line, b: Line) =>
  a.key === b.key && a.role === b.role && a.text === b.text && a.tools === b.tools && sameList(a.images, b.images) && sameList(a.attachments, b.attachments);

/**
 * Las líneas de la conversación. Cada lectura trae turnos nuevos aunque no
 * cambien: una línea igual a la anterior se reutiliza, con sus mismos arreglos
 * de imágenes, para que `MessageBody` (memo) no vuelva a pintarse.
 */
function linesOf(turns: Turn[], previous: ReadonlyMap<string, Line>): Line[] {
  return turns.map((turn, i) => {
    const line: Line = {
      key: turn.id ?? String(i),
      role: turn.role,
      text: turn.text ?? "",
      tools: turn.tools?.length ?? 0,
      images: toolImages(turn.tools),
      attachments: turn.attachments ?? [],
    };
    const old = previous.get(line.key);
    return old && sameLine(old, line) ? old : line;
  });
}

/**
 * Una tarea en vivo, en la máquina que la corre: conversación, aprobaciones,
 * preguntas, escribir y detener. Con la VM apagada se ve la copia del relay y
 * escribir la enciende; una máquina propia apagada lo dice y no se intenta.
 */
export default function TaskScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ host: string; workspace: string; folder: string; id: string }>();
  const { workspace, id } = params;
  const folder = params.folder === "_" ? "" : params.folder;
  const { hostOf, subscribe, setOpenTask, tick, titleOf } = useMachines();
  const host = hostOf(params.host);
  const { snapshot } = useWorkspaces();
  const [view, setView] = useState<TaskView | null>(null);
  const [streaming, setStreaming] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [waking, setWaking] = useState(false);
  const [background, setBackground] = useState<ChatBackgroundView | null>(null);
  const list = useRef<FlatList<Line>>(null);
  const key = `${params.host}/${id}`;

  const fail = useCallback(
    (error: unknown) => {
      const name = host?.label ?? "";
      if (error instanceof HostError && error.code === "machine_asleep") return setNote(w("web.machines.off_action", { name }));
      if (error instanceof HostError && error.code === "machine_outdated") return setNote(w("web.machines.outdated_action", { name }));
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

  // El fondo del workspace en la máquina de la tarea; leerlo nunca la enciende.
  useEffect(() => {
    setBackground(null);
    if (!host) return;
    let current = true;
    void chatBackgroundOf(host, workspace).then((next) => current && setBackground(next));
    return () => {
      current = false;
    };
  }, [host, workspace]);

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

  /** Enviar desde el cuadro: un mensaje abre otro turno; `!` corre el comando en la carpeta. */
  const submit = (s: Submission) =>
    act(() =>
      s.shell
        ? runShell(host!, workspace, { folder, session: id, command: s.command, provider: s.provider, model: s.model, effort: s.effort, permissionMode: s.permissionMode })
        : sendToTask(host!, workspace, folder, id, s),
    );
  const inject = (text: string, attachments: string[]) => act(() => injectIntoTask(host!, workspace, folder, id, text, attachments));

  const decide = (permission: Permission, allow: boolean) => host && void act(() => respondPermission(host, workspace, id, permission.request_id, allow));
  const answer = (pending: PendingQuestion, chosen: Record<string, string[]>, free: Record<string, string>) =>
    host && void act(() => answerQuestion(host, workspace, id, pending, chosen, free));
  // Un `!` en marcha se detiene con su comando; si no había, se detiene el turno.
  const stop = () =>
    host &&
    void stopShell(host, workspace, id)
      .then((r) => (r.value === true ? undefined : stopTask(host, workspace, folder, id)))
      .catch(() => stopTask(host, workspace, folder, id))
      .catch(fail);

  const running = view?.running ?? false;
  const permissions = view?.permissions ?? [];
  const questions = view?.questions ?? [];
  const asleep = host?.canAct() === "asleep" || host?.canAct() === "outdated";
  const turns = view?.session.turns;
  const shown = useRef<ReadonlyMap<string, Line>>(new Map());
  const lines = useMemo(() => {
    const next = linesOf(turns ?? [], shown.current);
    shown.current = new Map(next.map((line) => [line.key, line]));
    return next;
  }, [turns]);
  const cachedNote =
    view?.cachedAt && host ? t("machines.cached", { name: host.label, time: new Date(view.cachedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }) : null;
  const title = (view?.session.turns.find((turn) => turn.role === "user")?.text ?? "").split("\n")[0];
  const lastAgent = [...lines].reverse().find((line) => line.role !== "user" && line.role !== "system" && line.role !== "shell")?.key;
  const scope = useMemo(() => (host ? { host, hostId: params.host, workspace, folder, session: id } : null), [host, params.host, workspace, folder, id]);
  // Una respuesta rápida se manda como un mensaje, con el proveedor y el modelo con que sigue la tarea.
  // Estable entre lecturas (lee la vista y `submit` del último render), para que el memo de `MessageBody` se sostenga.
  const latest = useRef({ view, submit });
  latest.current = { view, submit };
  const quickReply = useCallback((prompt: string) => {
    const { view: now, submit: send } = latest.current;
    return now ? send({ shell: false, prompt, ...taskDefaults(now), effort: null, permissionMode: null, attachments: [] }) : Promise.resolve(false);
  }, []);

  return (
    <KeyboardScreen>
      <ChatScopeContext.Provider value={scope}>
      <Stack.Screen
        options={{
          title: titleOf(key) ?? title,
          // Abierta desde un enlace (en el navegador o un aviso) no hay a dónde volver: la flecha lleva a Tareas.
          headerLeft: router.canGoBack()
            ? undefined
            : () => (
                <Pressable hitSlop={10} onPress={() => router.replace("/")} accessibilityLabel={t("task.back")} style={{ paddingRight: 12 }}>
                  <Icon name="arrow-left" size={22} color={theme.text} />
                </Pressable>
              ),
        }}
      />
      <ChatBackdrop background={background} theme={theme} />
      <FlatList
        ref={list}
        data={lines}
        keyExtractor={(line) => line.key}
        contentContainerStyle={styles.list}
        onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}
        renderItem={({ item }) => <Bubble line={item} theme={theme} onQuickReply={item.key === lastAgent && !running && !asleep ? quickReply : undefined} />}
        ListHeaderComponent={cachedNote ? <Text style={[styles.banner, { color: theme.textMuted, backgroundColor: theme.muted }]}>{cachedNote}</Text> : undefined}
        ListFooterComponent={
          <View style={styles.footer}>
            {streaming ? <Bubble line={{ key: "live", role: "agent", text: streaming, tools: 0, images: [], attachments: [] }} theme={theme} streaming /> : null}
            {running && !streaming ? <Text style={{ color: theme.textMuted }}>{t("state.working")}…</Text> : null}
            {waking && host ? <Text style={{ color: theme.textMuted }}>{w("shell.machines.waking", { name: host.label })}</Text> : null}
            {asleep && host ? (
              <Text style={{ color: theme.textMuted }}>
                {host.canAct() === "outdated" ? w("web.machines.outdated_action", { name: host.label }) : w("web.machines.off_action", { name: host.label })}
              </Text>
            ) : null}
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
      <Composer
        host={host}
        workspace={workspace}
        folder={folder}
        session={id}
        providers={snapshot?.providers[params.host] ?? []}
        provider={view?.session.provider ?? null}
        model={view ? taskDefaults(view).model : null}
        providerLocked={Boolean(view?.session.turns.length)}
        running={running}
        disabled={asleep || waking || !view}
        placeholder={w("chat.composer.placeholder.next")}
        onSubmit={submit}
        onInject={inject}
        onStop={stop}
      />
      </ChatScopeContext.Provider>
    </KeyboardScreen>
  );
}

/** La imagen del workspace con su velo; un patrón del escritorio queda en el fondo liso del tema. */
function ChatBackdrop({ background, theme }: { background: ChatBackgroundView | null; theme: Theme }) {
  if (!background?.image) return null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Image source={{ uri: background.image }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.surface, opacity: background.veil.chat ?? DEFAULT_CHAT_VEIL }]} />
    </View>
  );
}

function Bubble({ line, theme, streaming, onQuickReply }: { line: Line; theme: Theme; streaming?: boolean; onQuickReply?: (prompt: string) => Promise<boolean> }) {
  const mine = line.role === "user";
  const system = line.role === "system";
  const shell = line.role === "shell";
  const steps = line.tools;
  if (!line.text && !steps && !line.images.length && !line.attachments.length) return null;
  // Como en la ventana: lo de la persona va en globo; la respuesta del agente, sin globo y a todo el ancho.
  const agent = !mine && !system && !shell;
  return (
    <View
      style={
        agent
          ? styles.reply
          : [
              styles.bubble,
              mine ? { alignSelf: "flex-end", backgroundColor: theme.userBubble } : { alignSelf: "stretch", backgroundColor: theme.surface },
              system ? { backgroundColor: theme.muted } : null,
              { borderColor: theme.border },
            ]
      }
    >
      {line.attachments.length ? <Attachments paths={line.attachments} /> : null}
      {/* Lo que escribe la persona y la salida de un `!` van tal cual; lo del agente, con su markdown. */}
      {line.text && (mine || system || shell) ? (
        <Text
          selectable
          style={{ color: system ? theme.textMuted : theme.text, fontSize: shell ? 13 : 15, lineHeight: 21, fontFamily: shell ? Platform.select({ ios: "Menlo", default: "monospace" }) : undefined }}
        >
          {line.text}
        </Text>
      ) : line.text || line.images.length ? (
        <MessageBody text={line.text} streaming={streaming} images={line.images} onQuickReply={onQuickReply} />
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
      <View style={{ alignSelf: "flex-end" }}>
        <SendButton testID="answer-question" disabled={disabled} label={t("task.answer")} onPress={() => onAnswer(chosen, free)} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { padding: 8, borderRadius: 8, fontSize: 13 },
  list: { padding: 12, gap: 8 },
  footer: { gap: 8 },
  pending: { flexGrow: 0, maxHeight: "55%", paddingHorizontal: 12, paddingBottom: 8 },
  bubble: { maxWidth: "92%", borderRadius: 14, padding: 10, borderWidth: StyleSheet.hairlineWidth },
  reply: { alignSelf: "stretch", paddingHorizontal: 4, paddingVertical: 2 },
  card: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 10 },
  code: { fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }), fontSize: 13, padding: 8, borderRadius: 8 },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  action: { borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  option: { borderWidth: 1, borderRadius: 10, padding: 10 },
  input: { flex: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 15, maxHeight: 140 },
});
