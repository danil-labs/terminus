import type { SessionRow } from "../features/projects/Sessions";
import type { Project } from "./model";
import type { Space } from "./spaces";

/**
 * Lo que pinta el sidebar, por workspace, para enseñarlo antes del primer IPC.
 * Es una foto de la ventana anterior: hasta que el motor contesta, la fila no
 * sirve para actuar. Se guarda con espera y acotada; una foto que no cabe se
 * recorta por carpeta y, si aun así no cabe, no se guarda.
 */
/** El estado de la rebanada de otra máquina de la cuenta; sus filas vuelven como copia (`cached`) con su hora. */
export type SliceState = { status: NonNullable<SessionRow["machine_status"]>; at: number | null };
export type ShellSnapshot = {
  workspace: string;
  projects: Project[];
  sessions: Record<string, SessionRow[]>;
  spaces: Space[];
  desk: string | null;
  slices?: Record<string, SliceState>;
};

// La versión 2 trae filas con `provider` y `agent`; una foto de la 1 se descarta.
type Stored = { version: 2; last: string; workspaces: Record<string, { saved: number; snapshot: string }> };

const KEY = "harness:shell-cache";
const WORKSPACES = 4;
const ROWS = [80, 30, 10];
const BYTES = 400_000;
export const SAVE_DELAY = 500;

function stored(): Stored | null {
  try {
    const raw = localStorage.getItem(KEY);
    const value = raw === null ? null : (JSON.parse(raw) as Stored);
    return value?.version === 2 && typeof value.last === "string" ? value : null;
  } catch {
    return null;
  }
}

export function readShellCache(): ShellSnapshot | null {
  const value = stored();
  const entry = value?.workspaces[value.last];
  if (!entry) return null;
  try {
    const snapshot = JSON.parse(entry.snapshot) as ShellSnapshot;
    if (snapshot.workspace !== value.last || !Array.isArray(snapshot.projects)) return null;
    // Una foto no es una respuesta: lo que otra máquina dijo vuelve como copia de esa hora.
    const copy = (row: SessionRow): SessionRow => (row.machine && row.machine_status === "ok" ? { ...row, machine_status: "cached" } : row);
    const sessions = Object.fromEntries(Object.entries(snapshot.sessions).map(([folder, rows]) => [folder, rows.map(copy)]));
    const slices = snapshot.slices && Object.fromEntries(Object.entries(snapshot.slices).map(([m, s]) => [m, s.status === "ok" ? { ...s, status: "cached" as const } : s]));
    return { ...snapshot, sessions, ...(slices ? { slices } : {}) };
  } catch {
    return null;
  }
}

export function hasShellCache(): boolean {
  return readShellCache() !== null;
}

// Una fila que no cambió conserva su objeto (`conservar`): se codifica una vez.
const encoded = new WeakMap<object, string>();
const encode = (value: object) => {
  let text = encoded.get(value);
  if (text === undefined) {
    text = JSON.stringify(value);
    encoded.set(value, text);
  }
  return text;
};
const list = (values: object[]) => `[${values.map(encode).join(",")}]`;

export function encodeSnapshot(snapshot: ShellSnapshot, rows: number): string {
  const sessions = Object.entries(snapshot.sessions)
    .map(([folder, values]) => `${JSON.stringify(folder)}:${list(values.slice(0, rows))}`)
    .join(",");
  const slices = snapshot.slices && Object.keys(snapshot.slices).length ? `,"slices":${JSON.stringify(snapshot.slices)}` : "";
  return `{"workspace":${JSON.stringify(snapshot.workspace)},"projects":${list(snapshot.projects)},"sessions":{${sessions}},"spaces":${list(snapshot.spaces)},"desk":${JSON.stringify(snapshot.desk)}${slices}}`;
}

export function writeShellCache(snapshot: ShellSnapshot, now = Date.now()) {
  const text = ROWS.map((rows) => encodeSnapshot(snapshot, rows)).find((t) => t.length <= BYTES);
  const value = stored() ?? { version: 2 as const, last: snapshot.workspace, workspaces: {} };
  // La misma foto ya guardada no se reescribe: cada escritura rehace todo el valor.
  if (value.last === snapshot.workspace && value.workspaces[snapshot.workspace]?.snapshot === text) return;
  if (text === undefined) {
    delete value.workspaces[snapshot.workspace];
  } else {
    value.workspaces[snapshot.workspace] = { saved: now, snapshot: text };
  }
  value.last = snapshot.workspace;
  const kept = Object.entries(value.workspaces)
    .sort(([, a], [, b]) => b.saved - a.saved)
    .slice(0, WORKSPACES);
  value.workspaces = Object.fromEntries(kept);
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // Sin espacio se pierde la foto, no el trabajo: el siguiente arranque espera al motor.
    try {
      localStorage.removeItem(KEY);
    } catch {
      // Sin almacenamiento no hay nada que borrar.
    }
  }
}

/** Guarda la última foto pedida tras `SAVE_DELAY` sin pedidos nuevos; `flush` la escribe ya y `cancel` la descarta. */
export function shellCacheWriter(
  write: (snapshot: ShellSnapshot) => void = writeShellCache,
  schedule: (run: () => void, ms: number) => unknown = (run, ms) => setTimeout(run, ms),
  cancel: (handle: unknown) => void = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
) {
  let pending: ShellSnapshot | null = null;
  let handle: unknown;
  const flush = () => {
    if (handle !== undefined) cancel(handle);
    handle = undefined;
    const snapshot = pending;
    pending = null;
    if (snapshot) write(snapshot);
  };
  return {
    save(snapshot: ShellSnapshot) {
      pending = snapshot;
      if (handle !== undefined) cancel(handle);
      handle = schedule(flush, SAVE_DELAY);
    },
    flush,
    cancel() {
      if (handle !== undefined) cancel(handle);
      handle = undefined;
      pending = null;
    },
  };
}
