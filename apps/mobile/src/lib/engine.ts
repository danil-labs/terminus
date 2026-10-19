/**
 * Lo que el teléfono hace con el motor de una máquina, en comandos de
 * `APP_COMMANDS`. Las mismas llamadas que la ventana (`apps/desktop/src`),
 * por el relay o por el bridge. Sin React Native: se prueba en Node.
 */
import type {
  AccountLimits,
  AccountList,
  AgentList,
  AgentStatusRow,
  Answer,
  AttentionState,
  BaseBranches,
  ChatEvent,
  EngineEvent,
  MentionList,
  OpenedSession,
  PendingRequests,
  PermissionModeOption,
  Project,
  ProviderInfo,
  ProviderModels,
  Question,
  SessionRow,
  ShellRun,
  SlashMenu,
  Space,
  TaskBlockers,
  Startup,
  Turn,
  Workspace,
  WorkspaceAttention,
} from "@terminus/protocol";
import { type FlatRow, flattenTasks } from "@terminus/tasks";
import { type Host, HostError } from "./hosts.ts";

/** Una tarea de la lista, con la máquina y la carpeta de donde viene. */
export type Task = SessionRow & {
  /** `computer_id` o `bridge`. */
  host: string;
  workspace: string;
  /** Id de la carpeta en su máquina; `""` es sin carpeta. */
  folder: string;
  /** `host/folder`: cada motor tiene sus ids, así que entre máquinas la carpeta se nombra con la suya. */
  folderKey: string;
  /** La máquina, solo cuando la persona tiene más de una (para la tarjeta). */
  machine?: string | null;
  machine_on?: boolean;
};

/** Un agente con nombre, juntando sus carpetas y máquinas. */
export type Agent = {
  name: string;
  description: string | null;
  status: "working" | "awake" | "asleep";
  liveTasks: number;
  minutesSinceLastTurn: number | null;
  /** `host/folder` donde está. */
  places: { host: string; folder: string }[];
};

/** Lo que una máquina sabe de un workspace. */
export type Folder = Project & { key: string; host: string };

export type HostSnapshot = {
  host: string;
  folders: Folder[];
  spaces: Space[];
  tasks: Task[];
  agents: Agent[];
  /** Tareas con un turno en marcha. */
  live: string[];
  /** Codex, Claude…: para nombrar el proveedor de una tarea y elegir con cuál empieza otra. */
  providers: ProviderInfo[];
  /** Si salió de la copia del relay (máquina apagada): cuándo. */
  cachedAt: number | null;
};

const off = (error: unknown) => error instanceof HostError && (error.code === "machine_off" || error.code === "machine_asleep");

/** Una lectura que con la máquina apagada y sin copia es `fallback`, no un error. */
async function read<T>(host: Host, command: Parameters<Host["call"]>[0], workspace: string | null, args: object, fallback: T, at: { cachedAt: number | null }): Promise<T> {
  try {
    const answer = await host.call<T>(command, workspace, args);
    if (answer.cachedAt !== null) at.cachedAt = Math.max(at.cachedAt ?? 0, answer.cachedAt);
    return answer.value ?? fallback;
  } catch (error) {
    if (off(error)) return fallback;
    throw error;
  }
}

/** Los workspaces de una máquina; apagada y sin copia, ninguno. */
export async function workspacesOf(host: Host): Promise<{ list: Workspace[]; cachedAt: number | null }> {
  const at = { cachedAt: null as number | null };
  const startup = await read<Startup | null>(host, "list_workspaces", null, {}, null, at);
  return { list: startup?.workspaces ?? [], cachedAt: at.cachedAt };
}

/**
 * Carpetas, spaces, tareas abiertas y agentes de un workspace en una máquina.
 * `list_live_sessions` con `project: ""` solo trae las tareas sin carpeta: se
 * pide una vez por carpeta y otra para `""`, como la ventana.
 */
export async function snapshotOf(host: Host, workspace: string): Promise<HostSnapshot> {
  const at = { cachedAt: null as number | null };
  const [folders, spaces, live, providers] = await Promise.all([
    read<Project[]>(host, "list_projects", workspace, {}, [], at),
    read<Space[]>(host, "list_spaces", workspace, {}, [], at).catch(() => []),
    read<string[]>(host, "list_active_turns", workspace, { workspace }, [], at).catch(() => []),
    read<ProviderInfo[]>(host, "list_providers", workspace, {}, [], at).catch(() => []),
  ]);
  const projects = ["", ...folders.map((f) => f.id)];
  const perFolder = await Promise.all(
    projects.map(async (project) => {
      const [rows, agents, status] = await Promise.all([
        read<SessionRow[]>(host, "list_live_sessions", workspace, { project, open: [] }, [], at),
        project ? read<AgentList>(host, "list_agents", workspace, { project }, { agents: [] }, at).catch(() => ({ agents: [] })) : { agents: [] },
        project ? read<AgentStatusRow[]>(host, "list_agent_status", workspace, { project }, [], at).catch(() => []) : [],
      ]);
      return { project, rows, agents: agents.agents ?? [], status };
    }),
  );
  const byProject: Record<string, (SessionRow & FlatRow)[]> = {};
  for (const { project, rows } of perFolder) byProject[project] = rows;
  const tasks: Task[] = flattenTasks(byProject).map(({ project, row }) => ({ ...row, host: host.id, workspace, folder: project, folderKey: `${host.id}/${project}` }));

  const agents = new Map<string, Agent>();
  for (const { project, agents: list, status } of perFolder) {
    for (const a of list) {
      const s = status.find((x) => x.name === a.name);
      const known = agents.get(a.name);
      if (known) {
        known.places.push({ host: host.id, folder: project });
        known.liveTasks += s?.live_tasks ?? 0;
        if (s && rank(s.status) < rank(known.status)) known.status = s.status;
      } else {
        agents.set(a.name, {
          name: a.name,
          description: a.description ?? null,
          status: s?.status ?? "asleep",
          liveTasks: s?.live_tasks ?? 0,
          minutesSinceLastTurn: s?.minutes_since_last_turn ?? null,
          places: [{ host: host.id, folder: project }],
        });
      }
    }
  }
  return {
    host: host.id,
    folders: folders.map((f) => ({ ...f, key: `${host.id}/${f.id}`, host: host.id })),
    spaces,
    tasks,
    agents: [...agents.values()],
    live,
    providers: Array.isArray(providers) ? providers : [],
    cachedAt: at.cachedAt,
  };
}

const rank = (s: Agent["status"]) => (s === "working" ? 0 : s === "awake" ? 1 : 2);

/**
 * Junta lo que cada máquina sabe de un mismo workspace, como el panel de la
 * web: las carpetas y tareas de cada una, marcadas con su máquina (sus ids no
 * se parecen entre motores). Los spaces son los de la primera máquina; las
 * carpetas de las demás se ven en todos.
 */
export function mergeSnapshots(parts: HostSnapshot[], tagMachines: (host: string) => { machine: string; on: boolean } | null) {
  const lead = parts[0];
  const others = parts.slice(1).flatMap((p) => p.folders.map((f) => f.key));
  const spaces: Space[] = (lead?.spaces ?? []).map((s) => ({ ...s, folders: [...s.folders.map((f) => `${lead.host}/${f}`), ...others] }));
  const agents = new Map<string, Agent>();
  const tasks: Task[] = [];
  const live = new Set<string>();
  let cached: number | null = null;
  for (const part of parts) {
    for (const a of part.agents) {
      const known = agents.get(a.name);
      if (known) {
        known.places.push(...a.places);
        known.liveTasks += a.liveTasks;
        if (rank(a.status) < rank(known.status)) known.status = a.status;
      } else agents.set(a.name, { ...a, places: [...a.places] });
    }
    const tag = tagMachines(part.host);
    for (const task of part.tasks) tasks.push(tag ? { ...task, machine: tag.machine, machine_on: tag.on } : task);
    for (const id of part.live) live.add(`${part.host}/${id}`);
    if (part.cachedAt !== null) cached = Math.max(cached ?? 0, part.cachedAt);
  }
  tasks.sort((a, b) => b.created_at - a.created_at);
  const providers = Object.fromEntries(parts.map((p) => [p.host, p.providers]));
  return { folders: parts.flatMap((p) => p.folders), spaces, agents: [...agents.values()], tasks, live, providers, cachedAt: cached };
}

/** La clave de una tarea entre máquinas: el mismo id puede repetirse en dos. */
export const taskKey = (task: { host: string; id: string }) => `${task.host}/${task.id}`;

// --- Una tarea ---------------------------------------------------------------

export type Permission = { request_id: string; tool: string; target: string | null };
export type PendingQuestion = { request_id: string; turn: string; questions: Question[] };

export type TaskView = {
  session: OpenedSession;
  permissions: Permission[];
  questions: PendingQuestion[];
  running: boolean;
  cachedAt: number | null;
};

export async function loadTask(host: Host, workspace: string, folder: string, id: string): Promise<TaskView> {
  const at = { cachedAt: null as number | null };
  const [session, pending, live] = await Promise.all([
    read<OpenedSession | null>(host, "load_session", workspace, { project: folder, id }, null, at),
    read<PendingRequests | null>(host, "pending_requests", workspace, { session: id }, null, at).catch((): PendingRequests | null => null),
    read<string[]>(host, "list_active_turns", workspace, { workspace }, [], at).catch((): string[] => []),
  ]);
  if (!session) throw new HostError("machine_off", host.label);
  const turns = session.turns ?? [];
  // `pending_requests` solo da el turno de la pregunta; el contenido está en ese turno.
  const questions = (pending?.questions ?? []).map((q) => ({
    ...q,
    questions: [...turns].reverse().find((t: Turn) => t.id === q.turn && t.questions?.length)?.questions ?? [],
  }));
  return { session, permissions: pending?.permissions ?? [], questions, running: live.includes(id), cachedAt: at.cachedAt };
}

/** Lo que el cuadro de escribir elige para un mensaje, como la ventana. */
export type Draft = {
  prompt: string;
  provider: string;
  model: string | null;
  /** `null` deja decidir al agente («Auto»). */
  effort: string | null;
  permissionMode: string | null;
  /** Rutas en la máquina que devolvió `prepare_attachments`. */
  attachments: string[];
};

/** El proveedor y el modelo con que sigue una tarea: los de su último turno. */
export function taskDefaults(view: TaskView): { provider: string; model: string | null } {
  const model = [...view.session.turns].reverse().find((t) => t.model)?.model ?? view.session.model ?? null;
  return { provider: view.session.provider, model };
}

/** Un mensaje a una tarea parada: abre otro turno con lo que eligió el cuadro. */
export async function sendToTask(host: Host, workspace: string, folder: string, session: string, draft: Draft) {
  const { value } = await host.call<string>("send_message", workspace, {
    ...MESSAGE_DEFAULTS,
    provider: draft.provider,
    project: folder,
    session,
    prompt: draft.prompt,
    model: draft.model,
    effort: draft.effort,
    permissionMode: draft.permissionMode,
    attachments: draft.attachments,
  });
  return value;
}

/** «Mandar ahora»: el mensaje entra en el turno que corre, sin esperar a que termine. */
export async function injectIntoTask(host: Host, workspace: string, folder: string, session: string, prompt: string, attachments: string[] = []) {
  await host.call("inject_message", workspace, { project: folder, session, prompt, queueId: null, attachments, taskMentions: [], recipients: [] });
}

const MESSAGE_DEFAULTS = {
  taskMentions: [],
  recipients: [],
  effort: null,
  permissionMode: null,
  attachments: [],
  sources: [],
  excludedSources: [],
  respuestas: null,
  baseRef: null,
  agent: null,
  taskFromAgent: false,
  fromAgent: null,
  fromChannel: null,
  replyTo: null,
  hops: null,
  fromTask: null,
  space: null,
};

/** El proveedor y el modelo de una tarea nueva: los de la más reciente, o el primer proveedor disponible. */
export async function defaultsFor(host: Host, workspace: string, tasks: Task[], agent: string | null) {
  const mine = tasks.filter((t) => t.host === host.id && t.workspace === workspace && t.provider);
  const newest = (agent ? mine.find((t) => t.agent === agent) : undefined) ?? mine[0];
  if (newest) return { provider: newest.provider, model: newest.model };
  const at = { cachedAt: null as number | null };
  const providers = await read<ProviderInfo[]>(host, "list_providers", workspace, {}, [], at);
  const first = providers.find((p) => p.available && p.driver);
  if (!first) throw new HostError("no_provider");
  return { provider: first.id, model: null };
}

/** Lo que el cuadro propone sin preguntar a la máquina: el proveedor y el modelo de su tarea más reciente (o del agente). */
export function suggestedDefaults(tasks: Task[], host: string, workspace: string, agent: string | null): { provider: string | null; model: string | null } {
  const mine = tasks.filter((t) => t.host === host && t.workspace === workspace && t.provider);
  const newest = (agent ? mine.find((t) => t.agent === agent) : undefined) ?? mine[0];
  return { provider: newest?.provider ?? null, model: newest?.model ?? null };
}

/** Una tarea nueva en una carpeta: `send_message` sin sesión. El motor devuelve su id. */
export async function createTask(
  host: Host,
  workspace: string,
  args: { folder: string; prompt: string; provider: string; model: string | null; agent: string | null; space: string | null } & Partial<Pick<Draft, "effort" | "permissionMode" | "attachments">> & { baseRef?: string | null },
) {
  const { value } = await host.call<string>("send_message", workspace, {
    ...MESSAGE_DEFAULTS,
    provider: args.provider,
    project: args.folder,
    session: null,
    prompt: args.prompt,
    model: args.model,
    effort: args.effort ?? null,
    permissionMode: args.permissionMode ?? null,
    attachments: args.attachments ?? [],
    baseRef: args.baseRef ?? null,
    agent: args.agent,
    taskFromAgent: Boolean(args.agent),
    space: args.space,
  });
  if (typeof value !== "string" || !value) throw new HostError("operation_failed");
  return value;
}

export function stopTask(host: Host, workspace: string, folder: string, id: string) {
  return host.call("stop_turn", workspace, { project: folder, session: id });
}

export function respondPermission(host: Host, workspace: string, id: string, requestId: string, allow: boolean) {
  return host.call("respond_permission", workspace, { session: id, requestId, allow });
}

export function answerQuestion(host: Host, workspace: string, id: string, pending: PendingQuestion, chosen: Record<string, string[]>, free: Record<string, string>) {
  const respuestas: Answer[] = pending.questions.map((q) => ({
    turn: pending.turn,
    question: q.id,
    chosen: chosen[q.id] ?? [],
    free_text: free[q.id]?.trim() || null,
  }));
  return host.call("answer_question", workspace, { session: id, requestId: pending.request_id, respuestas });
}

export function markSeen(host: Host, workspace: string, id: string) {
  // Marcar vista no es una intención: con la máquina apagada se pierde, y no pasa nada.
  return host.call("mark_task_seen", workspace, { workspace, session: id }).catch(() => {});
}

export async function attentionOf(host: Host): Promise<WorkspaceAttention[]> {
  const at = { cachedAt: null as number | null };
  return read<WorkspaceAttention[]>(host, "list_workspace_attention", null, {}, [], at).catch(() => []);
}

// --- Fijar y archivar (la vista previa) -----------------------------------------

/** Fijar o desfijar, como la ventana (`set_session_pinned`). Enciende la VM si está apagada. */
export async function setPinned(host: Host, workspace: string, folder: string, id: string, pinned: boolean) {
  await host.call("set_session_pinned", workspace, { project: folder, id, pinned });
}

/**
 * Archivar, como «Archivar» de la tarjeta del escritorio: primero pregunta qué
 * lo impide (`task_blockers`); con cambios sin guardar no archiva y lo dice,
 * para decidir desde la ventana. Enciende la VM si está apagada.
 */
export async function archiveTask(host: Host, workspace: string, folder: string, id: string): Promise<{ archived: true } | { blocked: TaskBlockers["unsaved"] }> {
  await host.wake();
  const { value } = await host.call<TaskBlockers | null>("task_blockers", workspace, { project: folder, id, finish: false });
  const unsaved = value?.unsaved ?? [];
  if (unsaved.length) return { blocked: unsaved };
  await host.call("set_task_archived", workspace, { project: folder, id, archived: true, space: null });
  return { archived: true };
}

// --- El cuadro de escribir -----------------------------------------------------

/** Los proveedores con los que se puede empezar algo en esa máquina. */
export const usableProviders = (providers: ProviderInfo[]) => providers.filter((p) => p.available && p.driver);

/** Los modelos de un proveedor y sus niveles de razonamiento; apagada y sin copia, ninguno. */
export async function modelsOf(host: Host, workspace: string, provider: string): Promise<ProviderModels> {
  const at = { cachedAt: null as number | null };
  const value = await read<ProviderModels | null>(host, "list_models", workspace, { provider }, null, at).catch(() => null);
  return value && Array.isArray(value.models) ? value : { provider, models: [] };
}

export async function permissionModesOf(host: Host, workspace: string, provider: string): Promise<PermissionModeOption[]> {
  const at = { cachedAt: null as number | null };
  const value = await read<PermissionModeOption[]>(host, "list_permission_modes", workspace, { provider }, [], at).catch(() => []);
  return Array.isArray(value) ? value : [];
}

/** La barra de `/`: los comandos del CLI y las skills. */
export async function slashMenuOf(host: Host, workspace: string, provider: string): Promise<SlashMenu> {
  const at = { cachedAt: null as number | null };
  const value = await read<SlashMenu | null>(host, "list_slash_menu", workspace, { provider }, null, at).catch(() => null);
  return { commands: value?.commands ?? [], skills: value?.skills ?? [], side_question: value?.side_question ?? null };
}

/** Lo que se puede nombrar con `@` en una carpeta: archivos y carpetas. */
export async function mentionsOf(host: Host, workspace: string, folder: string, session: string | null): Promise<MentionList> {
  const at = { cachedAt: null as number | null };
  const value = await read<MentionList | null>(host, "list_mentions", workspace, { project: folder, sources: null, excludedSources: null, session }, null, at).catch(() => null);
  return { fuentes: value?.fuentes ?? [], truncado: value?.truncado ?? false };
}

/** Las ramas desde las que puede empezar una tarea nueva en una carpeta con git. */
export async function baseBranchesOf(host: Host, workspace: string, folder: string): Promise<BaseBranches> {
  const at = { cachedAt: null as number | null };
  const value = await read<BaseBranches | null>(host, "project_base_branches", workspace, { project: folder, refresh: false, details: false }, null, at).catch(() => null);
  return { branches: value?.branches ?? [], selected: value?.selected ?? null, fetched_at: value?.fetched_at ?? null };
}

/**
 * `!` en el cuadro: un comando de terminal en la carpeta. Sin sesión crea la
 * tarea, con lo que eligió el cuadro, como la ventana.
 */
export async function runShell(
  host: Host,
  workspace: string,
  args: { folder: string; session: string | null; command: string; provider?: string | null; model?: string | null; effort?: string | null; permissionMode?: string | null; space?: string | null; agent?: string | null; baseRef?: string | null },
): Promise<ShellRun> {
  const { value } = await host.call<ShellRun | null>("run_shell_command", workspace, {
    project: args.folder,
    session: args.session,
    command: args.command,
    queueId: null,
    provider: args.provider ?? null,
    model: args.model ?? null,
    effort: args.effort ?? null,
    permissionMode: args.permissionMode ?? null,
    space: args.space ?? null,
    agent: args.agent ?? null,
    baseRef: args.baseRef ?? null,
    runId: null,
  });
  if (!value?.session) throw new HostError("operation_failed");
  return value;
}

export function stopShell(host: Host, workspace: string, session: string) {
  return host.call("stop_shell_command", workspace, { session });
}

/**
 * Una imagen del teléfono a la máquina, por el camino de pegar una imagen en
 * la ventana: viaja en base64 (`guardar_imagen_pegada`) y queda como adjunto
 * del workspace (`prepare_attachments`). Devuelve la ruta para `attachments`.
 * El motor solo guarda así PNG, JPEG, WebP y GIF de hasta 25 MiB, y el socket
 * corta en 16 MiB por mensaje: el teléfono no sube otros archivos ni imágenes
 * de más de `MAX_ATTACHMENT_BYTES`.
 */
export const ATTACHMENT_MIMES: ReadonlySet<string> = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
/** 16 MiB de mensaje en base64 son unos 12 MB de imagen. */
export const MAX_ATTACHMENT_BYTES = 11 * 1024 * 1024;

export async function uploadAttachment(host: Host, workspace: string, folder: string, file: { mime: string; base64: string }): Promise<string> {
  const saved = await host.call<string>("guardar_imagen_pegada", workspace, { mime: file.mime, datos: file.base64 });
  if (typeof saved.value !== "string" || !saved.value) throw new HostError("operation_failed");
  const prepared = await host.call<string[]>("prepare_attachments", workspace, { project: folder, paths: [saved.value] });
  const path = Array.isArray(prepared.value) ? prepared.value[0] : null;
  if (!path) throw new HostError("operation_failed");
  return path;
}

// --- Cuentas de IA ---------------------------------------------------------------

export async function accountsOf(host: Host, provider: string): Promise<AccountList | null> {
  const at = { cachedAt: null as number | null };
  return read<AccountList | null>(host, "list_accounts", null, { provider }, null, at);
}

export async function limitsOf(host: Host, provider: string, id: string): Promise<AccountLimits | null> {
  const at = { cachedAt: null as number | null };
  return read<AccountLimits | null>(host, "account_limits", null, { provider, id, force: false }, null, at).catch(() => null);
}

/** Cerrar la sesión de una cuenta en una máquina (`remove_account`), como la ✕ de la chapa en la web. */
export async function signOutAccount(host: Host, provider: string, id: string) {
  await host.call("remove_account", null, { provider, id });
}

/**
 * Iniciar sesión en una máquina sin pantalla, en dos pasos para conocer el id
 * antes de que lleguen sus eventos: la cuenta nace vacía (`add_account`) y el
 * CLI arranca por tubería (`login_account`, modo `tuberia`). Lo que sigue
 * llega en eventos `account` de esa máquina: el enlace (`url`), el código a
 * comparar (`confirm`) o a pegar (`code`) y el final (`done`, con texto si falló).
 */
export async function addAccount(host: Host, provider: string): Promise<string> {
  const { value } = await host.call<{ id: string } | null>("add_account", null, { provider, label: "" });
  if (!value?.id) throw new HostError("operation_failed");
  return value.id;
}

export async function beginLogin(host: Host, provider: string, id: string) {
  await host.call("login_account", null, { provider, id, mode: "tuberia" });
}

export async function submitLoginCode(host: Host, id: string, code: string) {
  await host.call("submit_login_code", null, { id, code });
}

/** Cancelar un inicio de sesión a medias y no dejar la cuenta vacía. */
export async function cancelLogin(host: Host, provider: string, id: string) {
  await host.call("cancel_login", null, { id }).catch(() => {});
  await host.call("discard_account", null, { provider, id }).catch(() => {});
}

// --- Avisos ------------------------------------------------------------------

export type Notice = { host: string; workspace: string; session: string; folder: string | null; state: AttentionState | "finished" };

const NEEDS_YOU = new Set<AttentionState>(["approving", "asked", "failed"]);

/**
 * Convierte los eventos de una máquina en avisos: una tarea que entra en
 * `approving`, `asked` o `failed` (de `attention`), o un turno que termina
 * bien (`chat` con `done`). El motor marca `unseen` en cuanto arranca el turno,
 * así que «terminó» sale de `done` y no de `attention`.
 */
export function noticer(host: string, initial: WorkspaceAttention[] = []) {
  let known = new Map<string, AttentionState>();
  const folders = new Map<string, string>();
  const index = (list: WorkspaceAttention[]) => {
    const next = new Map<string, AttentionState>();
    for (const w of list) for (const task of w.tasks) {
      next.set(`${w.workspace}/${task.session}`, task.state);
      folders.set(task.session, task.project);
    }
    return next;
  };
  known = index(initial);
  return {
    reset(list: WorkspaceAttention[]) {
      known = index(list);
    },
    take(event: EngineEvent): Notice[] {
      if (event.name === "attention" && Array.isArray(event.payload)) {
        const list = event.payload as WorkspaceAttention[];
        const next = index(list);
        const notices: Notice[] = [];
        for (const w of list) for (const task of w.tasks) {
          const key = `${w.workspace}/${task.session}`;
          if (NEEDS_YOU.has(task.state) && known.get(key) !== task.state) {
            notices.push({ host, workspace: w.workspace, session: task.session, folder: task.project, state: task.state });
          }
        }
        known = next;
        return notices;
      }
      const payload = event.payload as { session?: string; project?: string; workspace?: string } | null;
      if (event.name === "session" && payload?.session && payload.project !== undefined) folders.set(payload.session, payload.project);
      if (event.name === "chat") {
        const chat = event.payload as ChatEvent;
        if (chat.kind === "done" && chat.ok === true && chat.workspace) {
          return [{ host, workspace: chat.workspace, session: chat.session, folder: folders.get(chat.session) ?? null, state: "finished" }];
        }
      }
      return [];
    },
  };
}
