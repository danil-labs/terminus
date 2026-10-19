import { useColorScheme } from "react-native";

// Same tokens as `src/styles/global.css` of the desktop window: its default light (violet) and dark (graphite).
const light = {
  bg: "#f9f9f9",
  surface: "#ffffff",
  muted: "#f3f4f8",
  border: "rgba(10,13,35,0.12)",
  text: "#0a0d23",
  textMuted: "#62647a",
  primary: "#6539f5",
  onPrimary: "#ffffff",
  userBubble: "#efeafe",
  success: "#15803d",
  error: "#dc2626",
  warning: "#b45309",
  info: "#2563eb",
  // The sidebar's task marks (`src/features/projects/TaskStatus.tsx`).
  approving: "#f59e0b",
  asked: "#f4eb7b",
  failedMark: "#dc2626",
  unseenMark: "#166534",
  delivered: "#62647a",
};
// Graphite, the desktop's default dark (`[data-dark-style="graphite"]`); navy is the alternative there.
const dark: typeof light = {
  bg: "#111113",
  surface: "#212124",
  muted: "#19191c",
  border: "rgba(255,255,255,0.08)",
  text: "#ececef",
  textMuted: "#9a9aa3",
  primary: "#ececef",
  onPrimary: "#111113",
  // `--color-chat-user`: brand yellow at 8% over `surface-raised`.
  userBubble: "#3c3b36",
  success: "#4ade80",
  error: "#f87171",
  warning: "#fbbf24",
  info: "#60a5fa",
  approving: "#f59e0b",
  asked: "#f4eb7b",
  failedMark: "#f87171",
  unseenMark: "#4ade80",
  delivered: "#9a9aa3",
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === "dark" ? dark : light;
}
