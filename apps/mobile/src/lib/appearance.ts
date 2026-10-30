import { useSyncExternalStore } from "react";
import { store } from "./store";

/** El tema que eligió la persona en su perfil: Claro, Oscuro o el del sistema. */
export type ThemeChoice = "light" | "dark" | "system";

const KEY = "terminus.theme";
let choice: ThemeChoice = "system";
const listeners = new Set<() => void>();
const publish = (next: ThemeChoice) => {
  choice = next;
  for (const listener of listeners) listener();
};

void store.get(KEY).then((saved) => {
  if (saved === "light" || saved === "dark") publish(saved);
}).catch(() => {});

export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, () => choice, () => choice);
}

export function setThemeChoice(next: ThemeChoice) {
  publish(next);
  void (next === "system" ? store.remove(KEY) : store.set(KEY, next)).catch(() => {});
}
