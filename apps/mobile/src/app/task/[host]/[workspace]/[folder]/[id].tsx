import { AgentAvatar } from "../../../../../ui/AgentAvatar";
import { SendButton } from "../../../../../ui/SendButton";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, FlatList, Image, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { type ChatEvent, type Question, type Turn, DEFAULT_CHAT_VEIL } from "@terminus/protocol";
import { delegatedOf, taskTitle } from "@terminus/tasks";
import {
  type ChatBackdropView,
  type PendingQuestion,
  type Permission,
  type Task,
  type TaskView,
  answerQuestion,
  chatBackgroundOf,
  coalesced,
  injectIntoTask,
  loadTask,
  markSeen,
  respondPermission,
  runShell,
  sendToTask,
  switchLiveMode,
  stopShell,
  stopTask,
  taskDefaults,
} from "../../../../../lib/engine";
import { HostError } from "../../../../../lib/hosts";
import { type Line, type LivePiece, type StepRow, applyLive, bareCommand, fileName, linesOfLive, linesOfTurn, liveAfterRead } from "../../../../../lib/steps";
import { lang, t, w } from "../../../../../lib/i18n";
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
import { openTask } from "../../../../../ui/components";
import { KeyboardScreen } from "../../../../../ui/KeyboardScreen";
import { TaskHeader } from "../../../../../ui/TaskHeader";
import { BrandMark } from "../../../../../ui/BrandMark";
import { Avatar } from "../../../../../ui/components";

/** Kinds that change what the task reports: pending requests or whether it runs. */
const REFRESH = new Set(["permission", "permission_resolved", "started", "done", "presence", "segment_saved"]);
/** Tras estos, lo que llegó en vivo ya está guardado: la lectura lo reemplaza (`liveAfterRead`). */
const SAVED = new Set(["done", "segment_saved"]);

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
  const { hostOf, subscribe, setOpenTask, titleOf, registry } = useMachines();
  const { getToken } = useAccount();
  const accountBackground = registry?.find((w) => w.id === workspace)?.background_url ?? null;
  const host = hostOf(params.host);
  const { snapshot, list: workspaces, reload } = useWorkspaces();
  const [view, setView] = useState<TaskView | null>(null);
  const [live, setLive] = useState<readonly LivePiece[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [waking, setWaking] = useState(false);
  // Lo que se mandó mientras la VM enciende: sin él, el mensaje desaparece el minuto o dos que tarda.
  const [pending, setPending] = useState<string | null>(null);
  const [background, setBackground] = useState<Backdrop | null>(null);
  const list = useRef<FlatList<Line>>(null);
  const key = `${params.host}/${id}`;
  // Las que esta tarea lanzó: la lista las esconde bajo ella, como el riel del escritorio. Las hijas
  // remotas viven en otra máquina y nombran a esta por su `taskKey`.
  const delegated = useMemo(() => [
    ...delegatedOf((snapshot?.delegated ?? []).filter((task) => task.host === params.host && !task.remote_launcher), id),
    ...(snapshot?.delegated ?? []).filter((task) => !task.archived && task.remote_launcher === key),
  ].sort((a, b) => b.created_at - a.created_at), [snapshot, params.host, id, key]);
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
  // Lo vivo al momento, sin esperar al render: un evento y la lectura que provoca llegan en el mismo lote.
  const liveNow = useRef<readonly LivePiece[]>([]);
  const putLive = (next: readonly LivePiece[]) => {
    liveNow.current = next;
    setLive(next);
  };
  // `resync`: lo vivo que había al empezar ya está guardado (ver `liveAfterRead`). Leer nunca enciende la máquina.
  const load = async (resync: boolean) => {
    if (!host) return;
    const asked = `${host.id}/${id}`;
    const before = liveNow.current;
    const next = await loadTask(host, workspace, folder, id);
    if (keyNow.current !== asked) return;
    setView(next);
    putLive(liveAfterRead(liveNow.current, before, { running: next.running, resync }));
  };
  const loadNow = useRef(load);
  loadNow.current = load;
  // Una sola lectura a la vez: las que piden el foco, volver al frente, la máquina y los eventos se juntan.
  const reader = useRef(coalesced((resync: boolean) => loadNow.current(resync), (a, b) => a || b));
  const refresh = useCallback((resync = true) => reader.current(resync), [host, workspace, folder, id]);

  // Otra tarea empieza de cero. Solo al cambiar de tarea: que la máquina cambie de objeto (la lista de
  // computadoras se releyó) no vacía la conversación, solo la relee.
  useEffect(() => {
    setOpenTask(key);
    setView(null);
    putLive([]);
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

  // La máquina cambió: encendida, la copia deja paso a lo vivo; apagada, se ve lo último que guardó en el
  // relay (con su aviso). El enlace que se reabre también avisa aquí: se relee por si algo pasó sin verse.
  useEffect(() => {
    if (!host) return;
    let power = host.power();
    return host.onChange(() => {
      const changed = host.power() !== power;
      power = host.power();
      void refresh(changed).catch(fail);
    });
  }, [host, refresh, fail]);

  // Al volver a la app o a esta pantalla (desde otra de la pila) se relee: lo que terminó mientras no se veía.
  const reread = useRef((_resync: boolean) => {});
  reread.current = (resync) => void refresh(resync).catch(fail);
  const focused = useRef(false);
  useFocusEffect(
    useCallback(() => {
      // El primer foco es la apertura, que ya lee arriba.
      if (focused.current) reread.current(false);
      focused.current = true;
    }, []),
  );
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => state === "active" && reread.current(true));
    return () => sub.remove();
  }, []);

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
            void refresh(false).catch(fail);
            continue;
          }
          if (chat.kind === "delta" || chat.kind === "tool" || chat.kind === "tool_done") putLive(applyLive(liveNow.current, chat));
          if (chat.kind === "done") {
            void refresh()
              .then(() => host && markSeen(host, workspace, id))
              .catch(fail);
          } else if (REFRESH.has(chat.kind)) void refresh(SAVED.has(chat.kind)).catch(fail);
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
      setPending(null);
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
    if (!s.shell && host?.canAct() === "wakes" && host.power() !== "on") setPending(s.prompt);
    return act(() =>
      s.shell
        ? runShell(host!, workspace, { folder, session: id, command: s.command, provider: s.provider, model: s.model, effort: s.effort, permissionMode: s.permissionMode })
        : sendToTask(host!, workspace, folder, id, s),
    );
  };
  const inject = (text: string, attachments: string[]) => act(() => injectIntoTask(host!, workspace, folder, id, text, attachments));

  const decide = (permission: Permission, allow: boolean) => host && void act(() => respondPermission(host, workspace, id, permission.request_id, allow));
  const answer = (pending: PendingQuestion, chosen: Record<string, string[]>, free: Record<string, string>) =>
    host && void act(() => answerQuestion(host, workspace, folder, id, pending, chosen, free));
  // Un `!` en marcha se detiene con su comando; si no había, se detiene el turno.
  const stop = () =>
    host &&
    void stopShell(host, workspace, id)
      .then((r) => (r.value === true ? undefined : stopTask(host, workspace, folder, id)))
      .catch(() => stopTask(host, workspace, folder, id))
      .catch(fail);

  const running = host?.power() === "on" && (view?.running ?? false);
  const permissions = view?.permissions ?? [];

  /** Elegir modo con el turno en marcha: el motor lo aplica al turno vivo (`switchLiveMode`). */
  const chosenMode = useRef<string | null>(null);
  const changeMode = (mode: string) => {
    if (!host) return;
    chosenMode.current = mode;
    void switchLiveMode(host, workspace, folder, id, mode, () => chosenMode.current === mode)
      .then(() => refresh())
      .catch(fail);
  };
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
      <Stack.Screen options={{ title: titleOf(key) ?? title, headerShown: false }} />
      <ChatBackdrop background={background} theme={theme} />
      <TaskHeader
        key={`${params.host}/${workspace}/${id}`}
        title={titleOf(key) || title || id}
        hostId={params.host}
        host={host}
        hostOf={hostOf}
        workspace={workspace}
        folder={folder}
        id={id}
        task={[...(snapshot?.tasks ?? []), ...(snapshot?.delegated ?? [])].find((task) => task.host === params.host && task.workspace === workspace && task.id === id)}
        tasks={[...(snapshot?.tasks ?? []), ...(snapshot?.delegated ?? [])].filter((task) => task.host === params.host && task.workspace === workspace)}
        running={running || waking}
        onChanged={() => { void reload(); }}
        onFinished={() => { void reload(); router.replace("/"); }}
      />
      {delegated.length ? <Delegated tasks={delegated} theme={theme} /> : null}
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
            {pending && waking ? <Bubble line={{ key: "pending", kind: "message", role: "user", text: pending, images: [], attachments: [] }} theme={theme} /> : null}
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
            <QuestionCard key={q.turn} pending={q} theme={theme} disabled={asleep} onAnswer={(c, f) => answer(q, c, f)} />
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
        onModeChange={changeMode}
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
  const from = line.from ?? null;
  const mine = line.role === "user" && !from;
  const system = line.role === "system";
  const shell = line.role === "shell";
  if (!line.text && !line.images.length && !line.attachments.length) return null;
  // Como en la ventana: lo de la persona va en globo; la respuesta del agente, sin globo y a todo el ancho.
  const agent = line.role !== "user" && !system && !shell;
  const bubble = (
    <View
      style={
        agent
          ? styles.reply
          : [
              styles.bubble,
              from
                ? [styles.incoming, { backgroundColor: theme.incomingBubble }]
                : mine
                  ? { alignSelf: "flex-end", backgroundColor: theme.userBubble, borderColor: theme.border }
                  : { alignSelf: "stretch", backgroundColor: theme.surface, borderColor: theme.border },
              system ? { backgroundColor: theme.muted } : null,
            ]
      }
    >
      {line.attachments.length ? <Attachments paths={line.attachments} /> : null}
      {/* Lo que escribe la persona y la salida de un `!` van tal cual; lo del agente, con su markdown. */}
      {line.text && (line.role === "user" || system || shell) ? (
        <Text selectable style={{ color: system ? theme.textMuted : theme.text, fontSize: shell ? 13 : 15, lineHeight: 21, fontFamily: shell ? MONO : undefined }}>
          {line.text}
        </Text>
      ) : line.text || line.images.length ? (
        <MessageBody text={line.text} streaming={streaming} images={line.images} onQuickReply={onQuickReply} />
      ) : null}
    </View>
  );
  if (!from) return bubble;
  // El input de un encargado u otra tarea va a la izquierda, con su cara y su firma encima del globo.
  const signature = [from.agent, from.task].filter(Boolean).join(" · ");
  return (
    <View style={styles.incomingRow} testID="incoming-message">
      <View style={styles.incomingFace}>
        {from.agent ? (
          <AgentAvatar name={from.agent} size={28} />
        ) : (
          <View style={[styles.taskFace, { backgroundColor: theme.muted, borderColor: theme.border }]}>
            <BrandMark id={from.provider} size={16} color={theme.text} />
          </View>
        )}
      </View>
      <View style={styles.incomingColumn}>
        <Text numberOfLines={1} style={[styles.signature, { color: theme.textMuted }]}>
          {signature}
        </Text>
        {bubble}
      </View>
    </View>
  );
}

/** «N tareas delegadas», como el panel del lanzador en el escritorio: se abre con un toque y cada una lleva a su chat. */
function Delegated({ tasks, theme }: { tasks: Task[]; theme: Theme }) {
  const [open, setOpen] = useState(false);
  return (
    <View testID="delegated" style={[styles.delegated, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Pressable onPress={() => setOpen((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: open }} hitSlop={6} style={styles.delegatedRow}>
        <Icon name={open ? "chevron-down" : "chevron-right"} size={14} color={theme.textMuted} />
        <Text style={{ color: theme.text, fontSize: 13, fontWeight: "500" }}>
          {t(tasks.length === 1 ? "task.delegated.one" : "task.delegated.many", { count: tasks.length })}
        </Text>
      </Pressable>
      {open
        ? tasks.map((task) => (
            <Pressable key={task.id} onPress={() => openTask(task.host, task.workspace, task.folder, task.id)} accessibilityRole="link" style={styles.delegatedRow}>
              <Icon name="corner-down-right" size={14} color={theme.textMuted} />
              <Text numberOfLines={1} style={{ color: theme.text, fontSize: 14, flex: 1 }}>
                {taskTitle(lang, task)}
              </Text>
            </Pressable>
          ))
        : null}
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
      <View style={{ alignSelf: "flex-end" }}>
        <SendButton testID="answer-question" disabled={disabled} label={t("task.answer")} onPress={() => onAnswer(chosen, free)} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { padding: 8, borderRadius: 8, fontSize: 13 },
  thread: { flex: 1 },
  delegated: { marginHorizontal: 12, marginTop: 8, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth },
  delegatedRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6 },
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
  incoming: { alignSelf: "flex-start", maxWidth: "100%", borderColor: "transparent", shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  incomingRow: { flexDirection: "row", alignItems: "flex-end", gap: 8, maxWidth: "88%", alignSelf: "flex-start" },
  incomingFace: { paddingBottom: 2 },
  incomingColumn: { flexShrink: 1, gap: 3 },
  taskFace: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth },
  signature: { fontSize: 12, fontWeight: "600", paddingLeft: 2 },
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
