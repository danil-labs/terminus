import * as SecureStore from "expo-secure-store";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { type Folder, type Handler, type Space, type TaskRow, type Workspace, call } from "./bridge";
import { type TaskState, taskState } from "../ui/TaskStatus";
import { useConnection } from "./connection";

/** What the phone shows of one workspace: its channels (spaces), people (handlers) and tasks. */
export type Snapshot = {
  spaces: Space[];
  folders: Folder[];
  tasks: TaskRow[];
  handlers: Handler[];
  /** Tasks with a turn running now: the sidebar's "working" mark. */
  live: Set<string>;
};

type Workspaces = {
  list: Workspace[];
  current: Workspace | null;
  snapshot: Snapshot | null;
  loading: boolean;
  select: (id: string) => void;
  /** The active space, a filter like the desktop's SpaceBar; the oldest space when none was chosen. */
  space: Space | null;
  selectSpace: (id: string) => void;
  reload: () => Promise<void>;
};

const Context = createContext<Workspaces | null>(null);
const KEY = "terminus.workspace";
const SPACES_KEY = "terminus.spaces";
const REFRESH_ON = new Set(["cli-changed", "session", "resync", "providers"]);

export function useWorkspaces() {
  const value = useContext(Context);
  if (!value) throw new Error("useWorkspaces outside WorkspacesProvider");
  return value;
}

async function load(pairing: NonNullable<ReturnType<typeof useConnection>["pairing"]>, workspace: string): Promise<Snapshot> {
  const scope = { workspace };
  const [folders, spaces, live] = await Promise.all([
    call<Folder[]>(pairing, "folder list", {}, scope),
    call<{ spaces: Space[] }>(pairing, "space list", {}, scope),
    call<string[]>(pairing, "list_active_turns", { workspace }, scope).catch(() => []),
  ]);
  const perFolder = await Promise.all(
    folders.map(async (folder) => {
      const inFolder = { workspace, folder: folder.id };
      const [tasks, handlers] = await Promise.all([
        call<TaskRow[]>(pairing, "task list", {}, inFolder),
        call<{ handlers: Omit<Handler, "folders">[] }>(pairing, "handler list", {}, inFolder).catch(() => ({ handlers: [] })),
      ]);
      return { folder, tasks, handlers: handlers.handlers };
    }),
  );
  // A handler can serve several folders; the phone shows it once.
  const handlers = new Map<string, Handler>();
  for (const { folder, handlers: list } of perFolder) {
    for (const h of list) {
      const known = handlers.get(h.name);
      if (known) {
        known.folders.push(folder.id);
        known.live_tasks += h.live_tasks;
        if (h.status !== "asleep") known.status = h.status;
      } else handlers.set(h.name, { ...h, folders: [folder.id] });
    }
  }
  return {
    folders,
    spaces: spaces.spaces,
    tasks: perFolder.flatMap((f) => f.tasks).sort((a, b) => b.updated_at - a.updated_at),
    handlers: [...handlers.values()].sort((a, b) => a.name.localeCompare(b.name)),
    live: new Set(live),
  };
}

export function WorkspacesProvider({ children }: { children: ReactNode }) {
  const { pairing, online, subscribe, rememberTasks } = useConnection();
  const [list, setList] = useState<Workspace[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const asked = useRef(0);

  useEffect(() => {
    void SecureStore.getItemAsync(KEY).then((saved) => saved && setCurrentId((id) => id ?? saved));
  }, []);

  const reload = useCallback(async () => {
    if (!pairing) return;
    const mine = ++asked.current;
    setLoading(true);
    try {
      const workspaces = await call<Workspace[]>(pairing, "workspace list");
      if (mine !== asked.current) return;
      setList(workspaces);
      const id = workspaces.some((w) => w.id === currentId) ? currentId : (workspaces[0]?.id ?? null);
      if (id !== currentId) setCurrentId(id);
      if (!id) return setSnapshot(null);
      const next = await load(pairing, id);
      if (mine !== asked.current) return;
      rememberTasks(next.tasks);
      setSnapshot(next);
    } catch {
      // The connection banner already says it is offline.
    } finally {
      if (mine === asked.current) setLoading(false);
    }
  }, [pairing, currentId, rememberTasks]);

  useEffect(() => {
    if (online) void reload();
  }, [online, reload]);

  useEffect(
    () =>
      subscribe((event) => {
        const payload = event.payload as { workspace?: string | null; kind?: string } | null;
        const turn = event.name === "chat" && (payload?.kind === "started" || payload?.kind === "done");
        if (!REFRESH_ON.has(event.name) && !turn) return;
        const workspace = payload?.workspace;
        if (workspace && workspace !== currentId) return;
        if (pending.current) clearTimeout(pending.current);
        pending.current = setTimeout(() => void reload(), 600);
      }),
    [subscribe, reload, currentId],
  );

  const select = useCallback((id: string) => {
    setSnapshot(null);
    setCurrentId(id);
    void SecureStore.setItemAsync(KEY, id);
  }, []);

  const [spaceIds, setSpaceIds] = useState<Record<string, string>>({});
  useEffect(() => {
    void SecureStore.getItemAsync(SPACES_KEY).then((saved) => saved && setSpaceIds(JSON.parse(saved)));
  }, []);
  const selectSpace = useCallback(
    (id: string) => {
      if (!currentId) return;
      setSpaceIds((old) => {
        const next = { ...old, [currentId]: id };
        void SecureStore.setItemAsync(SPACES_KEY, JSON.stringify(next));
        return next;
      });
    },
    [currentId],
  );
  const spaces = snapshot?.spaces ?? [];
  const space = spaces.find((s) => s.id === (currentId ? spaceIds[currentId] : undefined)) ?? spaces[0] ?? null;

  const value = useMemo<Workspaces>(
    () => ({ list, current: list.find((w) => w.id === currentId) ?? null, snapshot, loading, select, space, selectSpace, reload }),
    [list, currentId, snapshot, loading, select, space, selectSpace, reload],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** The space's name, or the default space's label. */
export function spaceName(space: Space | undefined, fallback: string) {
  return space?.name?.trim() || fallback;
}

/** Agent and model of the newest task, the defaults for one started from the phone. */
export function lastAgent(tasks: TaskRow[]) {
  const newest = tasks.find((task) => task.provider);
  // `agent` is the `task create` CLI option, whose name does not change.
  return newest ? { agent: newest.provider, model: newest.model ?? undefined } : null;
}

/** The sidebar state of each task of a workspace, from attention and the running turns. */
export function useTaskStates(workspace: string | undefined) {
  const { attention } = useConnection();
  const { snapshot, current } = useWorkspaces();
  const marks = new Map(
    attention.filter((w) => w.workspace === workspace).flatMap((w) => w.tasks.map((task) => [task.session, task.state] as const)),
  );
  const live = workspace === current?.id ? (snapshot?.live ?? new Set<string>()) : new Set<string>();
  return (task: Pick<TaskRow, "id" | "outcome">): TaskState | null => taskState(task, marks.get(task.id), live);
}
