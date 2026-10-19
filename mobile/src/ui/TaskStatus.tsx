import { View } from "react-native";
import Svg, { Circle, Line, Path } from "react-native-svg";
import type { AttentionState, TaskRow } from "../lib/bridge";
import { t } from "../lib/i18n";
import { type Theme, useTheme } from "./theme";

/**
 * Mirror of `src/features/projects/TaskStatus.tsx` and `taskActivity.ts` of the
 * desktop: same priority, colors, icons and words, so a task reads the same on
 * the phone and in the sidebar.
 */
export type TaskState = "approving" | "asked" | "working" | "failed" | "unseen";
const ORDER: TaskState[] = ["approving", "asked", "working", "failed", "unseen"];

export function taskState(task: Pick<TaskRow, "id" | "outcome">, attention: AttentionState | undefined, live: Set<string>): TaskState | null {
  if (attention === "approving") return "approving";
  if (attention === "asked") return "asked";
  if (live.has(task.id)) return "working";
  if (task.outcome === "failed" || attention === "failed") return "failed";
  if (attention === "unseen") return "unseen";
  return null;
}

/** The most urgent state of a group, like a folded row of the sidebar. */
export function topState(states: (TaskState | null)[]): TaskState | null {
  return ORDER.find((state) => states.includes(state)) ?? null;
}

export function stateColor(state: TaskState, theme: Theme) {
  switch (state) {
    case "failed":
      return theme.failedMark;
    case "approving":
      return theme.approving;
    case "working":
      return theme.primary;
    case "unseen":
      return theme.unseenMark;
    default:
      return theme.asked;
  }
}

export function stateText(state: TaskState | "delivered") {
  return t(`status.${state}` as const);
}

// Icon paths from Lucide (ISC License, Copyright (c) Lucide Icons and Contributors).
function Icon({ state, color, size }: { state: TaskState | "delivered"; color: string; size: number }) {
  const stroke = { stroke: color, strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {state === "unseen" || state === "delivered" ? <Path d="M20 6 9 17l-5-5" {...stroke} /> : null}
      {state === "failed" ? (
        <>
          <Circle cx="12" cy="12" r="10" {...stroke} />
          <Line x1="12" x2="12" y1="8" y2="12" {...stroke} />
          <Line x1="12" x2="12.01" y1="16" y2="16" {...stroke} />
        </>
      ) : null}
      {state === "approving" ? (
        <>
          <Path
            d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"
            {...stroke}
          />
          <Path d="M9.1 9a3 3 0 0 1 5.82 1c0 2-3 3-3 3" {...stroke} />
          <Path d="M12 17h.01" {...stroke} />
        </>
      ) : null}
      {state === "asked" ? (
        <>
          <Circle cx="12" cy="12" r="10" {...stroke} />
          <Path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" {...stroke} />
          <Path d="M12 17h.01" {...stroke} />
        </>
      ) : null}
    </Svg>
  );
}

/** The mark of one task, or of a folded group; nothing when there is nothing to say. */
export function TaskMark({ state, delivered = false, size = 16 }: { state: TaskState | null; delivered?: boolean; size?: number }) {
  const theme = useTheme();
  const box = { width: size, height: size, alignItems: "center" as const, justifyContent: "center" as const };
  if (state === "working") {
    return (
      <View style={box} accessibilityLabel={stateText("working")}>
        <View style={{ width: size * 0.4, height: size * 0.4, borderRadius: size, backgroundColor: theme.primary }} />
      </View>
    );
  }
  if (state) {
    return (
      <View style={box} accessibilityLabel={stateText(state)}>
        <Icon state={state} color={stateColor(state, theme)} size={size} />
      </View>
    );
  }
  if (delivered) {
    return (
      <View style={box} accessibilityLabel={stateText("delivered")}>
        <Icon state="delivered" color={theme.delivered} size={size} />
      </View>
    );
  }
  return <View style={box} />;
}
