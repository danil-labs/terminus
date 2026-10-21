import { groupWorkspaces } from "@terminus/computers";
import type { ProviderInfo, Space, Workspace } from "@terminus/protocol";
import { DEFAULT_SIDEBAR_VIEW, type SidebarView, sanitizeSidebarView } from "@terminus/tasks";
import { store } from "./store";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { type Agent, type Folder, type Task, mergeSnapshots, snapshotOf, taskKey, workspacesOf } from "./engine";
import type { Host } from "./hosts";
import { useMachines } from "./machines";

/**
 * Un workspace, quizá abierto en varias máquinas: el mismo si su id es igual
 * (`groupWorkspaces`, la regla de la web). `id` es ese id; `members`, el id en
 * cada máquina, que es el mismo.
 */
export type WorkspaceEntry = { id: string; name: string; members: Map<string, string>; hosts: string[] };

/** Lo que el teléfono enseña de un workspace, juntando todas sus máquinas. */
export type Snapshot = {
  /** Carpetas de cada máquina; `key` es `host/id`. */
  folders: Folder[];
  spaces: Space[];
  tasks: Task[];
  agents: Agent[];
  /** `host/id` de las tareas con un turno en marcha. */
  live: Set<string>;
  /** Los proveedores (Codex, Claude…) de cada máquina, por su id. */
  providers: Record<string, ProviderInfo[]>;
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
    void store.get(KEY).then((saved) => saved && setCurrentId((id) => id ?? saved));
  }, []);

  const list = useMemo<WorkspaceEntry[]>(() => grouped(hosts, perHost), [hosts, perHost]);

  const machineCount = hosts.length;
  const reload = useCallback(async () => {
    const mine = ++asked.current;
    setLoading(true);
    try {
      const answers = await Promise.all(hosts.map(async (host) => [host.id, (await workspacesOf(host).catch(() => ({ list: [] }))).list] as const));
      if (mine !== asked.current) return;
      const byHost = Object.fromEntries(answers);
      setPerHost(byHost);
      const groups = grouped(hosts, byHost);
      const entry = groups.find((g) => g.id === currentId) ?? groups[0] ?? null;
      if ((entry?.id ?? null) !== currentId) setCurrentId(entry?.id ?? null);
      if (!entry) return setSnapshot(null);
      // En el orden de las máquinas: la primera pone los spaces.
      const having = hosts.filter((h) => entry.members.has(h.id));
      const parts = await Promise.all(having.map((host) => snapshotOf(host, entry.members.get(host.id) as string).catch(() => null)));
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
            const local = list.find((g) => g.id === currentId)?.members.get(_host);
            return !payload?.workspace || payload.workspace === local;
          });
        if (!relevant) return;
        if (pending.current) clearTimeout(pending.current);
        pending.current = setTimeout(() => void reload(), 600);
      }),
    [subscribe, reload, currentId, list],
  );

  const select = useCallback((id: string) => {
    setSnapshot(null);
    setCurrentId(id);
    void store.set(KEY, id);
  }, []);

  const [spaceIds, setSpaceIds] = useState<Record<string, string>>({});
  useEffect(() => {
    void store.get(SPACES_KEY).then((saved) => saved && setSpaceIds(JSON.parse(saved)));
  }, []);
  const selectSpace = useCallback(
    (id: string) => {
      if (!currentId) return;
      setSpaceIds((old) => {
        const next = { ...old, [currentId]: id };
        void store.set(SPACES_KEY, JSON.stringify(next));
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
    void store.get(currentViewKey).then((saved) => saved && setViewState(sanitizeSidebarView(JSON.parse(saved))));
  }, [currentViewKey]);
  const setView = useCallback(
    (next: SidebarView) => {
      const clean = sanitizeSidebarView(next);
      setViewState(clean);
      if (currentViewKey) void store.set(currentViewKey, JSON.stringify(clean));
    },
    [currentViewKey],
  );

  const current = list.find((w) => w.id === currentId) ?? null;
  const hostsOfCurrent = useMemo(() => hosts.filter((h) => current?.members.has(h.id)), [hosts, current]);

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

function grouped(hosts: { id: string }[], perHost: Record<string, Workspace[]>): WorkspaceEntry[] {
  return groupWorkspaces(hosts.map((h) => ({ machine: h.id, rows: perHost[h.id] ?? [] }))).map((g) => ({
    id: g.key,
    name: g.row.name ?? g.key,
    members: g.members,
    hosts: [...g.members.keys()],
  }));
}
