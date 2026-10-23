import type { ProviderInfo, Workspace } from "@terminus/protocol";
import { DEFAULT_SIDEBAR_VIEW, type SidebarView, sanitizeSidebarView } from "@terminus/tasks";
import { store } from "./store";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { type Agent, type Folder, type HostSnapshot, type MergedSpace, type Task, type WorkspaceEntry, mergeSnapshots, snapshotOf, taskKey, withAccountFolders, workspaceEntries, workspacesOf } from "./engine";
import type { Host } from "./hosts";
import { useMachines } from "./machines";
import { keepSame } from "./reconcile";

export type { MergedSpace, WorkspaceEntry };

/** Lo que el teléfono enseña de un workspace, juntando todas sus máquinas. */
export type Snapshot = {
  /** Carpetas de cada máquina; `key` es `host/id`. */
  folders: Folder[];
  spaces: MergedSpace[];
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
  space: MergedSpace | null;
  selectSpace: (id: string) => void;
  /** El filtro de la lista (`@terminus/tasks`), por workspace y space como en el escritorio. */
  view: SidebarView;
  setView: (view: SidebarView) => void;
  /** Las máquinas que tienen el workspace actual. */
  hostsOfCurrent: Host[];
  /** Relee el workspace; con el gesto de la lista enseña que carga. */
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
  const { hosts, registry, subscribe, rememberTitles, tick } = useMachines();
  const [perHost, setPerHost] = useState<Record<string, Workspace[] | null>>({});
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const asked = useRef(0);
  // La recarga en vuelo lee lo último, no lo de su render: el workspace abierto, lo que listó cada máquina y qué recarga pintó.
  const currentNow = useRef(currentId);
  currentNow.current = currentId;
  const perHostNow = useRef(perHost);
  const shown = useRef(0);
  // Lo último que contestó cada máquina del workspace abierto: hasta que vuelva a contestar, su parte se queda.
  const parts = useRef<{ entry: string | null; byHost: Map<string, HostSnapshot> }>({ entry: null, byHost: new Map() });
  const hasSnapshot = useRef(false);
  hasSnapshot.current = snapshot !== null;

  useEffect(() => {
    void store.get(KEY).then((saved) => {
      if (!saved || currentNow.current !== null) return;
      currentNow.current = saved;
      setCurrentId(saved);
    });
  }, []);

  const list = useMemo<WorkspaceEntry[]>(() => workspaceEntries(hosts, perHost, registry), [hosts, perHost, registry]);

  const machineCount = hosts.length;
  // `quiet`: la recarga que dispara un evento o un cambio de máquina no enseña que carga si ya hay lista.
  const load = useCallback(async (quiet: boolean) => {
    const mine = ++asked.current;
    if (!quiet || !hasSnapshot.current) setLoading(true);
    // La máquina de cada tarea solo se dice con más de una máquina.
    const tag = (hostId: string) => {
      if (machineCount < 2) return null;
      const host = hosts.find((h) => h.id === hostId);
      return host ? { machine: host.label, on: host.power() === "on" } : null;
    };
    // Cada máquina se pinta al contestar: una lenta o sin conexión no detiene la lista. Una recarga más nueva que ya pintó manda.
    // Mientras tanto, y si no contesta, vale lo último que dijo: sus tareas no se van de la lista para volver un momento después.
    const loadEntry = async (entry: WorkspaceEntry) => {
      const having = hosts.filter((h) => entry.members.has(h.id));
      const before = parts.current.entry === entry.id ? parts.current.byHost : new Map<string, HostSnapshot>();
      const answered = having.map((h) => before.get(h.id) ?? null);
      const show = () => {
        if (mine < shown.current || (currentNow.current !== null && currentNow.current !== entry.id)) return;
        shown.current = mine;
        parts.current = { entry: entry.id, byHost: new Map(answered.flatMap((p, i) => (p ? [[having[i].id, p] as const] : []))) };
        // Lo que ninguna máquina contestó lo pone el registro de la cuenta: un workspace dormido abre con sus carpetas.
        const merged = withAccountFolders(mergeSnapshots(answered.filter((p) => p !== null), tag), registry, entry.id, having.map((h) => h.id));
        rememberTitles(merged.tasks.map((task) => [taskKey(task), task.title]));
        // Solo cambia lo que cambió: las filas iguales conservan su objeto y sus tarjetas no se repintan.
        setSnapshot((old) => (old ? keepSame<Snapshot>(old, merged) : merged));
      };
      await Promise.all(
        having.map(async (host, i) => {
          const part = await snapshotOf(host, entry.members.get(host.id) as string).catch(() => null);
          if (part) answered[i] = part;
          show();
        }),
      );
      if (!having.length) show();
    };
    const pick = (groups: WorkspaceEntry[]) => groups.find((g) => g.id === currentNow.current) ?? groups[0] ?? null;
    const sameEntry = (a: WorkspaceEntry | null, b: WorkspaceEntry | null) => a?.id === b?.id && [...(a?.members ?? [])].join() === [...(b?.members ?? [])].join();
    try {
      // Con lo que ya se sabe del workspace, sus tareas se piden a la vez que la lista de workspaces.
      const early = pick(workspaceEntries(hosts, perHostNow.current, registry));
      const first = early ? loadEntry(early) : null;
      const answers = await Promise.all(hosts.map(async (host) => [host.id, (await workspacesOf(host).catch(() => ({ list: null }))).list] as const));
      if (mine !== asked.current) return void (await first);
      const byHost = Object.fromEntries(answers);
      perHostNow.current = byHost;
      setPerHost(byHost);
      const entry = pick(workspaceEntries(hosts, byHost, registry));
      if ((entry?.id ?? null) !== currentNow.current) {
        currentNow.current = entry?.id ?? null;
        setCurrentId(currentNow.current);
      }
      if (!entry) {
        shown.current = mine;
        return setSnapshot(null);
      }
      await (sameEntry(early, entry) && first ? first : loadEntry(entry));
    } finally {
      if (mine === asked.current) setLoading(false);
    }
  }, [hosts, registry, rememberTitles, machineCount]);
  const reload = useCallback(() => load(false), [load]);
  const refresh = useCallback(() => load(true), [load]);

  // Al cambiar las máquinas, su estado o el workspace.
  useEffect(() => {
    void refresh();
  }, [refresh, tick]);

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
        pending.current = setTimeout(() => void refresh(), 600);
      }),
    [subscribe, refresh, currentId, list],
  );

  const select = useCallback((id: string) => {
    setSnapshot(null);
    currentNow.current = id;
    setCurrentId(id);
    void store.set(KEY, id);
    void reload();
  }, [reload]);

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
  const chosen = currentId ? spaceIds[currentId] : undefined;
  const space = spaces.find((s) => chosen !== undefined && Object.values(s.on).includes(chosen)) ?? spaces[0] ?? null;

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
export function spaceName(space: { name: string | null } | undefined | null, fallback: string) {
  return space?.name?.trim() || fallback;
}

