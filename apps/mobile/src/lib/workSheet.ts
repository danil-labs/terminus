import { useSyncExternalStore } from "react";
import type { Permission } from "./engine";
import type { WorkRun } from "./steps";

/**
 * Lo que la hoja de una ejecución lee de su tarea. `TaskScreen` y `task-work` son rutas
 * hermanas: un contexto no cruza la pila. La pantalla sigue montada bajo la hoja y publica
 * aquí, en un efecto. Sin React Native: se prueba en Node.
 */
export type WorkSheetState = {
  runs: readonly WorkRun[];
  /** Desde cuándo corre el turno; `null`: no se muestra tiempo. */
  since: number | null;
  permissions: readonly Permission[];
  deciding: ReadonlySet<string>;
  /** Los avisos de la máquina y del último fallo, ya escritos: debajo de la hoja nadie los ve. */
  asleep: string | null;
  waking: string | null;
  note: string | null;
  questions: number;
  decide: (permission: Permission, allow: boolean) => void;
};

type Entry = { owner: object; state: WorkSheetState };

/** Por tarea: la misma puede estar dos veces en la pila, y manda la última que publicó. */
const entries = new Map<string, Entry[]>();
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};

export function publishWork(key: string, owner: object, state: WorkSheetState) {
  const rest = (entries.get(key) ?? []).filter((entry) => entry.owner !== owner);
  entries.set(key, [...rest, { owner, state }]);
  notify();
}

export function releaseWork(key: string, owner: object) {
  const rest = (entries.get(key) ?? []).filter((entry) => entry.owner !== owner);
  if (rest.length) entries.set(key, rest);
  else entries.delete(key);
  notify();
}

/**
 * Lo que enseña la hoja. Lo vivo sin guardar se cuelga de la última ejecución: un mensaje que entra a media
 * ejecución se lo lleva hasta que el motor guarda el tramo, y esta ejecución no debe quedarse sin sus pasos.
 */
export function shownRun(known: WorkRun | null, found: WorkRun | undefined): WorkRun | null {
  if (!found) return known;
  if (!known || found.steps.length >= known.steps.length) return found;
  return { ...known, live: found.live, durationMs: found.durationMs };
}

export const workState = (key: string): WorkSheetState | null => entries.get(key)?.at(-1)?.state ?? null;

export function useWorkState(key: string): WorkSheetState | null {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, () => workState(key), () => workState(key));
}
