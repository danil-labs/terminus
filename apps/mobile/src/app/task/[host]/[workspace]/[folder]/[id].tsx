import { Stack, router, useLocalSearchParams } from "expo-router";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Image, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { type ChatEvent, type Question, type Turn, DEFAULT_CHAT_VEIL } from "@terminus/protocol";
import {
  type ChatBackdropView,
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
import { type Line, type LivePiece, type StepRow, applyLive, bareCommand, fileName, linesOfLive, linesOfTurn } from "../../../../../lib/steps";
import { t, w } from "../../../../../lib/i18n";
import { type Follow, OPENED, jumped, scrolled, shouldStick, showJump, unseen } from "../../../../../lib/follow";
import { useAccount } from "../../../../../lib/account";
import { useMachines } from "../../../../../lib/machines";
import { COMPUTERS } from "../../../../../lib/supabase";
import { useWorkspaces } from "../../../../../lib/workspaces";
import { Attachments, MessageBody, toolImages } from "../../../../../ui/chat/Message";
import { ChatScopeContext } from "../../../../../ui/chat/scope";
import { Composer, type Submission } from "../../../../../ui/Composer";
import { type Theme, useTheme } from "../../../../../ui/theme";
import { Icon, type IconName } from "../../../../../ui/Icon";
import { KeyboardScreen } from "../../../../../ui/KeyboardScreen";

/** Kinds that change what the task reports: pending requests or whether it runs. */
const REFRESH = new Set(["permission", "started", "done", "presence"]);

const sameLine = (a: Line, b: Line) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Las líneas de la conversación: por turno, sus avances, sus pasos y su
 * respuesta (`linesOfTurn`). Cada lectura trae turnos nuevos aunque no
 * cambien: una línea igual a la anterior se reutiliza, con sus mismos arreglos
 * de imágenes, para que `MessageBody` (memo) no vuelva a pintarse.
 */
function linesOf(turns: Turn[], previous: ReadonlyMap<string, Line>): Line[] {
  return turns.flatMap((turn, i) =>
    linesOfTurn(turn, turn.id ?? String(i), toolImages(turn.tools)).map((line) => {
      const old = previous.get(line.key);
      return old && sameLine(old, line) ? old : line;
    }),
  );
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
  const { hostOf, subscribe, setOpenTask, tick, titleOf, registry } = useMachines();
  const { getToken } = useAccount();
  const accountBackground = registry?.find((w) => w.id === workspace)?.background_url ?? null;
  const host = hostOf(params.host);
  const { snapshot, list: workspaces } = useWorkspaces();
  const [view, setView] = useState<TaskView | null>(null);
  const [live, setLive] = useState<readonly LivePiece[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [waking, setWaking] = useState(false);
  const [background, setBackground] = useState<Backdrop | null>(null);
  const list = useRef<FlatList<Line>>(null);
  const key = `${params.host}/${id}`;
  // Si el chat sigue el final, como el hilo del escritorio (ver `lib/follow.ts`). Ref y no estado:
  // cambia con cada evento de scroll; solo el botón, que se ve, va en estado.
  const follow = useRef<Follow>(OPENED);
  const [jump, setJump] = useState<{ shown: boolean; unseen: number }>({ shown: false, unseen: 0 });
  // Al final de verdad: el `scrollToEnd` de la `FlatList` calcula el fondo con el alto estimado de sus filas y sin el
  // pie (lo que llega en vivo), y con eso se queda corto o sube. El de su `ScrollView` usa el alto medido.
  const toBottom = (animated: boolean) => list.current?.getNativeScrollRef()?.scrollToEnd({ animated });

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

  // La tarea abierta ahora: una lectura de la anterior que llega tarde no la pisa.
  const keyNow = useRef(key);
  keyNow.current = key;
  const refresh = useCallback(async () => {
    if (!host) return;
    const asked = `${host.id}/${id}`;
    const next = await loadTask(host, workspace, folder, id);
    if (keyNow.current !== asked) return;
    setView(next);
    setLive([]);
  }, [host, workspace, folder, id]);

  // Otra tarea empieza de cero. Solo al cambiar de tarea: que la máquina cambie de objeto (la lista de
  // computadoras se releyó) no vacía la conversación, solo la relee.
  useEffect(() => {
    setOpenTask(key);
    setView(null);
    follow.current = OPENED;
    setJump({ shown: false, unseen: 0 });
    return () => setOpenTask(null);
  }, [key, setOpenTask]);

  useEffect(() => {
    void refresh()
      .then(() => host && markSeen(host, workspace, id))
      .catch(fail);
  }, [refresh, fail, host, workspace, id]);

  // El fondo del workspace en la máquina de la tarea o en la cuenta; leerlo nunca la enciende.
  useEffect(() => {
    setBackground(null);
    if (!host) return;
    let current = true;
    void chatBackgroundOf(host, workspace, accountBackground, COMPUTERS).then(async (next) => {
      const token = next.remote ? await getToken().catch(() => null) : null;
      if (current) setBackground({ ...next, token });
    });
    return () => {
      current = false;
    };
  }, [host, workspace, accountBackground, getToken]);

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
          if (chat.kind === "delta" || chat.kind === "tool" || chat.kind === "tool_done") setLive((now) => applyLive(now, chat));
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

  /** Baja animado al final y vuelve a seguirlo: el botón y mandar un mensaje. */
  const toEnd = () => {
    follow.current = jumped(follow.current);
    setJump({ shown: false, unseen: 0 });
    toBottom(true);
  };

  /** Enviar desde el cuadro: un mensaje abre otro turno; `!` corre el comando en la carpeta. */
  const submit = (s: Submission) => {
    // Mandar es volver al final: lo que se acaba de escribir va abajo, como en el escritorio.
    toEnd();
    return act(() =>
      s.shell
        ? runShell(host!, workspace, { folder, session: id, command: s.command, provider: s.provider, model: s.model, effort: s.effort, permissionMode: s.permissionMode })
        : sendToTask(host!, workspace, folder, id, s),
    );
  };
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
  const lastAgent = [...lines].reverse().find((line) => line.kind === "message" && line.role !== "user" && line.role !== "system" && line.role !== "shell")?.key;
  const liveLines = useMemo(() => linesOfLive(live), [live]);
  // Las respuestas del agente, para contar en el botón las que entraron desde que se subió.
  const replies = useRef(0);
  replies.current = lines.filter((line) => line.kind === "message" && line.role !== "user" && line.role !== "system" && line.role !== "shell").length;
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const next = scrolled(follow.current, { offset: contentOffset.y, content: contentSize.height, viewport: layoutMeasurement.height }, replies.current);
    follow.current = next;
    const shown = showJump(next);
    setJump((now) => (now.shown === shown ? now : { shown, unseen: unseen(next, replies.current) }));
  }, []);
  // Siguiendo, todo lo que cambia de alto —el texto que llega, los pasos, una imagen, el teclado— baja de un corte.
  // Suelto, no se mueve: crecer por abajo no toca el scroll.
  const stick = useCallback(() => {
    if (shouldStick(follow.current)) toBottom(false);
  }, []);
  const onLayout = useCallback((_: LayoutChangeEvent) => stick(), [stick]);
  const newReplies = jump.shown ? unseen(follow.current, replies.current) : 0;
  const streaming = liveLines.some((line) => line.key === "live");
  const scope = useMemo(() => (host ? { host, hostId: params.host, workspace, folder, session: id } : null), [host, params.host, workspace, folder, id]);
  // Una respuesta rápida se manda como un mensaje, con el proveedor y el modelo con que sigue la tarea.
  // Estable entre lecturas (lee la vista y `submit` del último render), para que el memo de `MessageBody` se sostenga.
  // El modo con que sigue la tarea. Con `null` el motor correría el suyo por omisión, no el que guardó la tarea.
  const savedMode = view?.session.permission_mode ?? null;
  const workspaceMode = workspaces.find((w) => w.id === workspace)?.defaultPermissionMode ?? null;
  const latest = useRef({ view, submit });
  latest.current = { view, submit };
  const quickReply = useCallback((prompt: string) => {
    const { view: now, submit: send } = latest.current;
    return now ? send({ shell: false, prompt, ...taskDefaults(now), effort: null, permissionMode: now.session.permission_mode ?? null, attachments: [] }) : Promise.resolve(false);
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
      <View style={styles.thread}>
      <FlatList
        ref={list}
        data={lines}
        keyExtractor={(line) => line.key}
        contentContainerStyle={styles.list}
        onContentSizeChange={stick}
        onLayout={onLayout}
        onScroll={onScroll}
        scrollEventThrottle={16}
        // Lo que cambia de alto por encima de lo que se lee (una imagen que carga, pasos que se abren) no lo mueve.
        maintainVisibleContentPosition={Platform.OS === "web" ? undefined : { minIndexForVisible: 0 }}
        renderItem={({ item }) => <Row line={item} theme={theme} onQuickReply={item.key === lastAgent && !running && !asleep ? quickReply : undefined} />}
        ListHeaderComponent={cachedNote ? <Text style={[styles.banner, { color: theme.textMuted, backgroundColor: theme.muted }]}>{cachedNote}</Text> : undefined}
        ListFooterComponent={
          <View style={styles.footer}>
            {liveLines.map((line) => (
              <Row key={line.key} line={line} theme={theme} streaming={line.key === "live"} />
            ))}
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
      {jump.shown ? (
        <Pressable
          onPress={toEnd}
          accessibilityRole="button"
          testID="to-bottom"
          style={[styles.toBottom, { backgroundColor: theme.surface, borderColor: theme.border }]}
        >
          <Text style={{ color: theme.text, fontSize: 13, fontWeight: "500" }}>
            {newReplies > 0 ? w("chat.thread.new_messages", { count: newReplies }) : w("chat.thread.to_bottom")}
          </Text>
          <Icon name="arrow-down" size={14} color={theme.text} />
        </Pressable>
      ) : null}
      </View>
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
        permissionMode={workspaceMode}
        savedPermissionMode={savedMode}
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

type Backdrop = ChatBackdropView & { token: string | null };

/** La imagen del workspace con su velo; un patrón del escritorio queda en el fondo liso del tema. */
function ChatBackdrop({ background, theme }: { background: Backdrop | null; theme: Theme }) {
  const source =
    background?.remote && background.token
      ? { uri: background.remote, headers: { Authorization: `Bearer ${background.token}` } }
      : background?.image
        ? { uri: background.image }
        : null;
  if (!background || !source) return null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Image source={source} style={StyleSheet.absoluteFill} resizeMode="cover" />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.surface, opacity: background.veil.chat ?? DEFAULT_CHAT_VEIL }]} />
    </View>
  );
}

const MONO = Platform.select({ ios: "Menlo", default: "monospace" });

/** Una línea solo se repinta si cambia: `linesOf` le deja el mismo objeto a la que no cambió. */
const Row = memo(function Row({ line, theme, streaming, onQuickReply }: { line: Line; theme: Theme; streaming?: boolean; onQuickReply?: (prompt: string) => Promise<boolean> }) {
  if (line.kind === "steps") return <Steps rows={line.rows} theme={theme} />;
  if (line.kind === "progress")
    return (
      <View style={styles.progress}>
        <Text selectable style={{ color: theme.textMuted, fontSize: 14, lineHeight: 20 }}>
          {line.text}
        </Text>
      </View>
    );
  if (line.kind === "shell") return <ShellRun command={line.command} output={line.output} exitCode={line.exitCode} theme={theme} />;
  return <Bubble line={line} theme={theme} streaming={streaming} onQuickReply={onQuickReply} />;
});

function Bubble({ line, theme, streaming, onQuickReply }: { line: Extract<Line, { kind: "message" }>; theme: Theme; streaming?: boolean; onQuickReply?: (prompt: string) => Promise<boolean> }) {
  const mine = line.role === "user";
  const system = line.role === "system";
  const shell = line.role === "shell";
  if (!line.text && !line.images.length && !line.attachments.length) return null;
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
        <Text selectable style={{ color: system ? theme.textMuted : theme.text, fontSize: shell ? 13 : 15, lineHeight: 21, fontFamily: shell ? MONO : undefined }}>
          {line.text}
        </Text>
      ) : line.text || line.images.length ? (
        <MessageBody text={line.text} streaming={streaming} images={line.images} onQuickReply={onQuickReply} />
      ) : null}
    </View>
  );
}

const STEP_ICON: Record<StepRow["kind"], IconName> = { read: "file", search: "sparkles", edit: "square-pen", run: "terminal", web: "external-link", plan: "list-checks", other: "sparkles" };
/** Las filas que se ven de entrada; las de antes se abren con un toque. */
const SHOWN_ROWS = 4;

/** La cabecera de una fila, como `resumen` del escritorio: el verbo se lee, el sujeto va en mono. */
function rowLabel(row: StepRow): { verb: string; subject: string | null } {
  const n = row.steps.length;
  const target = row.steps[0].target;
  switch (row.kind) {
    case "read":
      return n === 1 ? { verb: w("common.steps.read.one"), subject: target && fileName(target) } : { verb: w("common.steps.read.many", { count: n }), subject: null };
    case "search":
      return n === 1 ? { verb: w("common.steps.search.one"), subject: target } : { verb: w("common.steps.search.many", { count: n }), subject: null };
    case "edit": {
      const files = new Set(row.steps.map((s, i) => s.target ?? `#${i}`)).size;
      return n === 1 ? { verb: w("common.steps.edit.one"), subject: target && fileName(target) } : { verb: w("common.steps.edit.many", { count: files }), subject: null };
    }
    case "run":
      return { verb: w("common.steps.run"), subject: target && bareCommand(target).split("\n")[0] };
    case "web":
      return n === 1 ? { verb: w("common.steps.web.one"), subject: target } : { verb: w("common.steps.web.many", { count: n }), subject: null };
    case "plan":
      return { verb: n === 1 ? w("common.steps.plan.one") : w("common.steps.plan.many", { count: n }), subject: null };
    default:
      return n === 1 ? { verb: w("common.steps.other.one", { tool: row.steps[0].name }), subject: target } : { verb: w("common.steps.other.many", { count: n }), subject: null };
  }
}

/** Lo que el agente hizo: una fila por acto, con qué y sobre qué; las más viejas, plegadas. */
function Steps({ rows, theme }: { rows: StepRow[]; theme: Theme }) {
  const [open, setOpen] = useState(false);
  const hidden = open ? 0 : Math.max(0, rows.length - SHOWN_ROWS);
  return (
    <View style={styles.steps}>
      {hidden ? (
        <Pressable onPress={() => setOpen(true)} hitSlop={6} style={styles.stepRow}>
          <Icon name="chevron-right" size={14} color={theme.textMuted} />
          <Text style={{ color: theme.textMuted, fontSize: 13 }}>{t("task.more_steps", { count: hidden })}</Text>
        </Pressable>
      ) : null}
      {rows.slice(hidden).map((row, i) => {
        const { verb, subject } = rowLabel(row);
        const failed = row.steps.some((s) => s.ok === false);
        const running = row.steps.some((s) => s.running);
        const color = failed ? theme.error : theme.textMuted;
        return (
          <View key={i} style={styles.stepRow}>
            <Icon name={STEP_ICON[row.kind]} size={14} color={color} />
            <Text numberOfLines={1} style={{ flexShrink: 1, color, fontSize: 13 }}>
              {verb}
              {subject ? <Text style={{ fontFamily: MONO, fontSize: 12 }}>{` ${subject}`}</Text> : null}
              {running ? "…" : ""}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/** Un `!` de la persona: el comando y lo que imprimió, como en la ventana. */
function ShellRun({ command, output, exitCode, theme }: { command: string; output: string; exitCode: number | null; theme: Theme }) {
  const failed = exitCode !== null && exitCode !== 0;
  return (
    <View style={[styles.bubble, { alignSelf: "stretch", backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Text selectable style={{ color: theme.text, fontFamily: MONO, fontSize: 13 }}>
        {`$ ${command}`}
      </Text>
      {output ? (
        <ScrollView horizontal style={{ marginTop: 6 }}>
          <Text selectable style={{ color: failed ? theme.error : theme.textMuted, fontFamily: MONO, fontSize: 12, lineHeight: 17 }}>
            {output.trimEnd()}
          </Text>
        </ScrollView>
      ) : null}
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
  thread: { flex: 1 },
  list: { padding: 12, gap: 8 },
  // Como el del escritorio: una píldora centrada por encima del borde de abajo del hilo.
  toBottom: {
    position: "absolute",
    bottom: 12,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingLeft: 12,
    paddingRight: 10,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  footer: { gap: 8 },
  pending: { flexGrow: 0, maxHeight: "55%", paddingHorizontal: 12, paddingBottom: 8 },
  bubble: { maxWidth: "92%", borderRadius: 14, padding: 10, borderWidth: StyleSheet.hairlineWidth },
  reply: { alignSelf: "stretch", paddingHorizontal: 4, paddingVertical: 2 },
  progress: { alignSelf: "stretch", paddingHorizontal: 4 },
  steps: { alignSelf: "stretch", gap: 4, paddingHorizontal: 4, paddingVertical: 2 },
  stepRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  card: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 10 },
  code: { fontFamily: MONO, fontSize: 13, padding: 8, borderRadius: 8 },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  action: { borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  option: { borderWidth: 1, borderRadius: 10, padding: 10 },
  input: { flex: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 15, maxHeight: 140 },
});
