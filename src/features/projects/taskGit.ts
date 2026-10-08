import { Channel } from "@tauri-apps/api/core";
import { invoke } from "../../lib/invoke.ts";
import { type Accessor, createSignal } from "solid-js";

export type CheckState = "unknown" | "none" | "pending" | "success" | "failure";
export type ReviewState = "unknown" | "unreviewed" | "approved" | "changes_requested";
export type KnState = "clean" | "draft" | "saved";

export type GitStatus = {
  kind: "none" | "unknown" | "branch" | "detached" | "kn";
  kn: KnState | null;
  branch: string | null;
  alias: string | null;
  head: string | null;
  repository: string;
  shared_with: string | null;
  pull: { number: number; state: "open" | "draft" | "merged" | "closed"; head_sha: string; checks?: CheckState; review?: ReviewState } | null;
  pull_known: boolean;
  checked_at: number | null;
  stale: boolean;
  has_remote: boolean;
  merged_locally: boolean;
};

export const UNKNOWN_GIT: GitStatus = {
  kind: "unknown", kn: null, branch: null, alias: null, head: null, repository: "", shared_with: null, pull: null,
  pull_known: false, checked_at: null, stale: false, has_remote: false, merged_locally: false,
};

export function retainGitObservation(previous: Record<string, GitStatus>, incoming: Record<string, GitStatus>) {
  return Object.fromEntries(Object.entries(incoming).map(([id, row]) => {
    const next = row.kind === "unknown" && previous[id] ? { ...previous[id], stale: true }
      : (previous[id]?.checked_at ?? 0) > (row.checked_at ?? 0) ? mergeRemoteGit({ [id]: row }, previous)[id] : row;
    // Lo que no cambió conserva su objeto: cada barrido trae filas nuevas iguales
    // a las de antes, y un objeto nuevo repinta la fila aunque diga lo mismo.
    return [id, previous[id] && mismoGit(previous[id], next) ? previous[id] : next];
  }));
}

function mismoGit(a: GitStatus, b: GitStatus) {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/** El registro nuevo, o el mismo si ninguna fila cambió: así no avisa a nadie. */
function conservarFilas(previous: Record<string, GitStatus>, next: Record<string, GitStatus>) {
  const ids = Object.keys(next);
  return ids.length === Object.keys(previous).length && ids.every(id => previous[id] === next[id]) ? previous : next;
}

export function mergeRemoteGit(previous: Record<string, GitStatus>, incoming: Record<string, GitStatus>) {
  return Object.fromEntries(Object.entries(previous).map(([id, row]) => {
    const remote = incoming[id];
    if (!remote || remote.repository !== row.repository || remote.kind !== row.kind || remote.branch !== row.branch || remote.head !== row.head
      || (remote.checked_at ?? 0) < (row.checked_at ?? 0)) return [id, row];
    return [id, { ...row, pull: remote.pull, pull_known: remote.pull_known, checked_at: remote.checked_at, stale: remote.stale }];
  }));
}

function staleGit(rows: Record<string, GitStatus>) {
  return Object.fromEntries(Object.entries(rows).map(([id, row]) => [id, { ...row, stale: true }]));
}

type Entry = {
  rows: Accessor<Record<string, GitStatus>>;
  refresh: () => void;
  dispose: () => void;
  interests: Map<symbol, string[]>;
};
const projects = new Map<string, Entry>();
const remoteQueue = new Map<symbol, { rank: () => number; run: () => Promise<void> }>();
let remoteRunning = 0;
function drainRemote() {
  while (remoteRunning < 2 && remoteQueue.size) {
    const next = [...remoteQueue].sort((a, b) => b[1].rank() - a[1].rank())[0];
    remoteQueue.delete(next[0]);
    remoteRunning++;
    void next[1].run().finally(() => { remoteRunning--; drainRemote(); });
  }
}

export function watchSessionGit(project: string) {
  let entry = projects.get(project);
  if (!entry) {
    const [rows, setRows] = createSignal<Record<string, GitStatus>>({});
    const interests = new Map<symbol, string[]>();
    let disposed = false;
    let generation = 0;
    let localBusy = false;
    let localSequence = 0;
    let scheduled = false;
    let remoteBusy = false;
    let pending = false;
    let localReady = false;
    let localFailed = false;
    let lastLocal = 0;
    let lastRemote = 0;
    const queueKey = Symbol();
    const priority = () => [...new Set([...interests.values()].flat())];
    const current = (started: number) => !disposed && started === generation;
    const remote = () => {
      if (disposed || remoteBusy || !localReady || document.hidden || Date.now() - lastRemote < 3_000) return;
      remoteBusy = true;
      lastRemote = Date.now();
      const started = generation;
      remoteQueue.set(queueKey, {
        rank: () => priority().some(id => rows()[id]) ? 1 : 0,
        run: async () => {
          try {
            if (!current(started) || document.hidden) return;
            const result = await invoke<Record<string, GitStatus>>("list_session_git", { project, remote: true, priority: priority(), progress: new Channel<Record<string, GitStatus>>() });
            if (current(started)) setRows(previous => {
              const merged = mergeRemoteGit(previous, result);
              const next = localFailed || Date.now() - lastLocal >= 30_000 ? staleGit(merged) : merged;
              // El remoto pregunta cada 3 s y casi siempre trae lo mismo.
              return conservarFilas(previous, Object.fromEntries(Object.entries(next).map(([id, row]) =>
                [id, previous[id] && mismoGit(previous[id], row) ? previous[id] : row])));
            });
          } catch {
            if (current(started)) setRows(staleGit);
          } finally {
            if (current(started)) remoteBusy = false;
          }
        },
      });
      queueMicrotask(drainRemote);
    };
    const refresh = async () => {
      if (scheduled) return;
      scheduled = true;
      await Promise.resolve();
      scheduled = false;
      if (disposed || document.hidden) return;
      if (localBusy) { pending = true; return; }
      localBusy = true;
      const sequence = ++localSequence;
      const started = generation;
      try {
        const progress = new Channel<Record<string, GitStatus>>(partial => {
          if (!current(started) || !localBusy || sequence !== localSequence) return;
          setRows(previous => conservarFilas(previous, { ...previous, ...retainGitObservation(previous, partial) }));
        });
        const local = await invoke<Record<string, GitStatus>>("list_session_git", { project, remote: false, priority: priority(), progress });
        if (!current(started)) return;
        lastLocal = Date.now();
        localFailed = false;
        setRows(previous => conservarFilas(previous, retainGitObservation(previous, local)));
        localReady = true;
        void remote();
      } catch {
        if (current(started)) { localFailed = true; setRows(staleGit); }
      } finally {
        if (current(started)) {
          localBusy = false;
          if (pending) { pending = false; void refresh(); }
        }
      }
    };
    const timer = setInterval(() => {
      if (lastLocal && Date.now() - lastLocal >= 30_000) setRows(staleGit);
      void refresh();
    }, 15_000);
    const remoteTimer = setInterval(() => void remote(), 3_000);
    const focus = () => { lastRemote = 0; void refresh(); };
    const workspace = () => {
      generation++;
      remoteQueue.delete(queueKey);
      localBusy = false;
      remoteBusy = false;
      localReady = false;
      localFailed = false;
      lastLocal = 0;
      pending = false;
      lastRemote = 0;
      setRows({});
      void refresh();
    };
    const visible = () => { if (!document.hidden) focus(); };
    window.addEventListener("harness:workspace", workspace);
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", visible);
    entry = { rows, refresh: () => void refresh(), interests, dispose: () => {
      disposed = true;
      remoteQueue.delete(queueKey);
      clearInterval(timer);
      clearInterval(remoteTimer);
      window.removeEventListener("focus", focus);
      window.removeEventListener("harness:workspace", workspace);
      document.removeEventListener("visibilitychange", visible);
    } };
    projects.set(project, entry);
    entry.refresh();
  }
  const token = Symbol();
  const current = entry;
  current.interests.set(token, []);
  return { rows: current.rows, refresh: current.refresh,
    prioritize: (ids: string[]) => {
      if (JSON.stringify(current.interests.get(token)) === JSON.stringify(ids)) return;
      current.interests.set(token, ids);
      current.refresh();
    },
    release: () => {
      current.interests.delete(token);
      if (current.interests.size === 0) { current.dispose(); projects.delete(project); }
    },
  };
}

export function compactGitKind(status?: GitStatus) {
  if (status?.kind === "kn") return "kn";
  if (!status || (status.kind !== "branch" && status.kind !== "detached")) return null;
  return status.pull && status.pull_known ? "pull" : "branch";
}

export function gitReviewSignals(status?: GitStatus) {
  const pull = status?.pull;
  if (!pull || !status.pull_known || !status.head || status.head !== pull.head_sha
    || (pull.state !== "open" && pull.state !== "draft")) return null;
  return { checks: pull.checks ?? "unknown", review: pull.review ?? "unknown" };
}

export function canFinishTask(
  session: { archived?: boolean | null; subagent?: string | null },
  status: GitStatus,
  busy: boolean,
) {
  if (session.archived || busy || status.stale) return false;
  if (status.kind === "kn") return status.kn === "saved";
  if (status.kind !== "branch" || !status.head) return false;
  // La misma regla que `ready_to_finish` en Rust: si hay PR manda el PR; si
  // no lo hay, o no hay remoto que lo tenga, la integración en la base local.
  if (status.pull) return status.pull_known && status.pull.state === "merged" && status.pull.head_sha === status.head;
  return status.merged_locally && (status.pull_known || !status.has_remote);
}

type TaskGitSession = { id: string; parent?: string | null; subagent?: string | null };

function resolveTaskGit(
  session: TaskGitSession,
  rows: Record<string, GitStatus>,
  sessions: TaskGitSession[],
): { status: GitStatus; owner: string | null } {
  const origin = rows[session.id] ?? UNKNOWN_GIT;
  const withOrigin = (status: GitStatus) =>
    origin.shared_with && status.shared_with !== origin.shared_with
      ? { ...status, shared_with: origin.shared_with }
      : status;
  const visited = new Set<string>();
  let current = session;
  while (!visited.has(current.id)) {
    visited.add(current.id);
    const status = rows[current.id] ?? UNKNOWN_GIT;
    const shared = status.shared_with ?? (current.subagent ? current.parent : null);
    const own = { status: withOrigin(status), owner: current.id };
    // Guardado propio gana. Un borrador en una hija no tapa al padre ya
    // integrado: finalizarla debe seguir disponible.
    if (status.kind === "kn" && status.kn === "saved") return own;
    if (status.kind === "kn" && status.kn === "draft" && !shared) return own;
    if (!shared) return own;
    const parent = sessions.find(row => row.id === shared);
    // Sin la dueña en la lista nadie más enseña esta rama: la fila se queda con ella.
    if (!parent) return own;
    current = parent;
  }
  return { status: UNKNOWN_GIT, owner: null };
}

export function effectiveTaskGit(
  session: TaskGitSession,
  rows: Record<string, GitStatus>,
  sessions: TaskGitSession[],
): GitStatus {
  return resolveTaskGit(session, rows, sessions).status;
}

export function sharesTaskGit(
  session: TaskGitSession,
  rows: Record<string, GitStatus>,
  sessions: TaskGitSession[],
): boolean {
  return resolveTaskGit(session, rows, sessions).owner !== session.id;
}
