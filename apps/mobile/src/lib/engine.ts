/**
 * Lo que el teléfono hace con el motor de una máquina, en comandos de
 * `APP_COMMANDS`. Las mismas llamadas que la ventana (`apps/desktop/src`),
 * por el relay o por el bridge. Sin React Native: se prueba en Node.
 */
import type {
  AgentList,
  AgentStatusRow,
  Answer,
  AttentionState,
  ChatEvent,
  EngineEvent,
  OpenedSession,
  PendingRequests,
  Project,
  ProviderInfo,
  Question,
  SessionRow,
  Space,
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
  const [folders, spaces, live] = await Promise.all([
    read<Project[]>(host, "list_projects", workspace, {}, [], at),
    read<Space[]>(host, "list_spaces", workspace, {}, [], at).catch(() => []),
    read<string[]>(host, "list_active_turns", workspace, { workspace }, [], at).catch(() => []),
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
  return { folders: parts.flatMap((p) => p.folders), spaces, agents: [...agents.values()], tasks, live, cachedAt: cached };
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

/** Escribir a una tarea: si su turno corre, el mensaje entra en él; si no, abre otro. */
export async function sendToTask(host: Host, workspace: string, folder: string, view: TaskView, prompt: string) {
  if (view.running) {
    await host.call("inject_message", workspace, { project: folder, session: view.session.id, prompt, queueId: null, attachments: [], taskMentions: [] });
    return view.session.id;
  }
  const model = [...view.session.turns].reverse().find((t) => t.model)?.model ?? view.session.model ?? null;
  const { value } = await host.call<string>("send_message", workspace, {
    ...MESSAGE_DEFAULTS,
    provider: view.session.provider,
    project: folder,
    session: view.session.id,
    prompt,
    model,
  });
  return value;
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

/** Una tarea nueva en una carpeta: `send_message` sin sesión. El motor devuelve su id. */
export async function createTask(
  host: Host,
  workspace: string,
  args: { folder: string; prompt: string; provider: string; model: string | null; agent: string | null; space: string | null },
) {
  const { value } = await host.call<string>("send_message", workspace, {
    ...MESSAGE_DEFAULTS,
    provider: args.provider,
    project: args.folder,
    session: null,
    prompt: args.prompt,
    model: args.model,
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
