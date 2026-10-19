import type { Project, Space, Workspace } from "@terminus/protocol";
import { DEFAULT_SIDEBAR_VIEW, type SidebarView, sanitizeSidebarView } from "@terminus/tasks";
import * as SecureStore from "expo-secure-store";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { type Agent, type Task, mergeSnapshots, snapshotOf, taskKey, workspacesOf } from "./engine";
import type { Host } from "./hosts";
import { useMachines } from "./machines";

/** Un workspace, quizá abierto en varias máquinas. */
export type WorkspaceEntry = Workspace & { hosts: string[] };

/** Lo que el teléfono enseña de un workspace, juntando todas sus máquinas. */
export type Snapshot = {
  folders: (Project & { hosts: string[] })[];
  spaces: Space[];
  tasks: Task[];
  agents: Agent[];
  /** `host/id` de las tareas con un turno en marcha. */
  live: Set<string>;
  /** La copia más nueva del relay que se usó, si alguna máquina estaba apagada. */
  cachedAt: number | null;
};

type Workspaces = {
  list: WorkspaceEntry[];
  current: WorkspaceEntry | null;
  snapshot: Snapshot | null;
  loading: boolean;
  select: (id: string) => void;
  /** El space activo, como la SpaceBar del escritorio; el primero si no se eligió ninguno. */
  space: Space | null;
  selectSpace: (id: string) => void;
  /** El filtro de la lista (`@terminus/tasks`), por workspace y space como en el escritorio. */
  view: SidebarView;
  setView: (view: SidebarView) => void;
  /** Las máquinas que tienen el workspace actual. */
  hostsOfCurrent: Host[];
  reload: () => Promise<void>;
};

const Context = createContext<Workspaces | null>(null);
const KEY = "terminus.workspace";
const SPACES_KEY = "terminus.spaces";
const REFRESH_ON = new Set(["cli-changed", "session", "providers"]);

export function useWorkspaces() {
  const value = useContext(Context);
  if (!value) throw new Error("useWorkspaces outside WorkspacesProvider");
  return value;
}

/** Misma clave que `sidebarViewKey` del escritorio, con caracteres que acepta el llavero. */
const viewKey = (workspace: string, space: string | null) => `terminus.view.${workspace}${space ? `.${space}` : ""}`.replace(/[^\w.-]/g, "_");

export function WorkspacesProvider({ children }: { children: ReactNode }) {
  const { hosts, subscribe, rememberTitles, tick } = useMachines();
  const [perHost, setPerHost] = useState<Record<string, Workspace[]>>({});
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const asked = useRef(0);

  useEffect(() => {
    void SecureStore.getItemAsync(KEY).then((saved) => saved && setCurrentId((id) => id ?? saved));
  }, []);

  const list = useMemo<WorkspaceEntry[]>(() => {
    const merged = new Map<string, WorkspaceEntry>();
    for (const host of hosts) {
      for (const w of perHost[host.id] ?? []) {
        const known = merged.get(w.id);
        if (known) known.hosts.push(host.id);
        else merged.set(w.id, { ...w, hosts: [host.id] });
      }
    }
    return [...merged.values()];
  }, [hosts, perHost]);

  const machineCount = hosts.length;
  const reload = useCallback(async () => {
    const mine = ++asked.current;
    setLoading(true);
    try {
      const answers = await Promise.all(hosts.map(async (host) => [host.id, (await workspacesOf(host).catch(() => ({ list: [] }))).list] as const));
      if (mine !== asked.current) return;
      const byHost = Object.fromEntries(answers);
      setPerHost(byHost);
      const all = answers.flatMap(([, ws]) => ws);
      const id = all.some((w) => w.id === currentId) ? currentId : (all[0]?.id ?? null);
      if (id !== currentId) setCurrentId(id);
      if (!id) return setSnapshot(null);
      const having = hosts.filter((h) => byHost[h.id]?.some((w: Workspace) => w.id === id));
      const parts = await Promise.all(having.map((host) => snapshotOf(host, id).catch(() => null)));
      if (mine !== asked.current) return;
      // La máquina de cada tarea solo se dice con más de una máquina.
      const tag = (hostId: string) => {
        if (machineCount < 2) return null;
        const host = hosts.find((h) => h.id === hostId);
        return host ? { machine: host.label, on: host.power() === "on" } : null;
      };
      const merged = mergeSnapshots(parts.filter((p) => p !== null), tag);
      rememberTitles(merged.tasks.map((task) => [taskKey(task), task.title]));
      setSnapshot(merged);
    } finally {
      if (mine === asked.current) setLoading(false);
    }
  }, [hosts, currentId, rememberTitles, machineCount]);

  // Al cambiar las máquinas, su estado o el workspace.
  useEffect(() => {
    void reload();
  }, [reload, tick]);

  useEffect(
    () =>
      subscribe((_host, events, gap) => {
        const relevant =
          gap ||
          events.some((event) => {
            const payload = event.payload as { workspace?: string | null; kind?: string } | null;
            const turn = event.name === "chat" && (payload?.kind === "started" || payload?.kind === "done");
            if (!REFRESH_ON.has(event.name) && !turn) return false;
            return !payload?.workspace || payload.workspace === currentId;
          });
        if (!relevant) return;
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

  const [view, setViewState] = useState<SidebarView>(DEFAULT_SIDEBAR_VIEW);
  const currentViewKey = currentId ? viewKey(currentId, space?.id ?? null) : null;
  useEffect(() => {
    setViewState(DEFAULT_SIDEBAR_VIEW);
    if (!currentViewKey) return;
    void SecureStore.getItemAsync(currentViewKey).then((saved) => saved && setViewState(sanitizeSidebarView(JSON.parse(saved))));
  }, [currentViewKey]);
  const setView = useCallback(
    (next: SidebarView) => {
      const clean = sanitizeSidebarView(next);
      setViewState(clean);
      if (currentViewKey) void SecureStore.setItemAsync(currentViewKey, JSON.stringify(clean));
    },
    [currentViewKey],
  );

  const current = list.find((w) => w.id === currentId) ?? null;
  const hostsOfCurrent = useMemo(() => hosts.filter((h) => current?.hosts.includes(h.id)), [hosts, current]);

  const value = useMemo<Workspaces>(
    () => ({ list, current, snapshot, loading, select, space, selectSpace, view, setView, hostsOfCurrent, reload }),
    [list, current, snapshot, loading, select, space, selectSpace, view, setView, hostsOfCurrent, reload],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** El nombre del space, o el del space por defecto. */
export function spaceName(space: Space | undefined | null, fallback: string) {
  return space?.name?.trim() || fallback;
}
