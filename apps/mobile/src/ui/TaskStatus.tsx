import { type IconShape, LUCIDE, STATUS_ICONS, STATUS_LABELS, type StatusLabel, type TaskState, taskPriority, topState } from "@terminus/design";
import { View } from "react-native";
import Svg, { Circle, Line, Path } from "react-native-svg";
import type { AttentionState, TaskRow } from "../lib/bridge";
import { lang } from "../lib/i18n";
import { type Theme, useTheme } from "./theme";

export { type TaskState, topState };

/** The sidebar's state of a task, from what the bridge reports: attention and the running turns. */
export function taskState(task: Pick<TaskRow, "id" | "outcome">, attention: AttentionState | undefined, live: Set<string>): TaskState | null {
  return taskPriority({
    aprobando: attention === "approving",
    esperando: attention === "asked",
    viva: live.has(task.id),
    outcome: task.outcome === "failed" || attention === "failed" ? "failed" : null,
    sinVer: attention === "unseen",
  });
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

export function stateText(state: StatusLabel) {
  return STATUS_LABELS[lang][state];
}

function Shape({ shape, color }: { shape: IconShape; color: string }) {
  const stroke = { stroke: color, strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };
  if (shape.kind === "circle") return <Circle cx={shape.cx} cy={shape.cy} r={shape.r} {...stroke} />;
  if (shape.kind === "line") return <Line x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2} {...stroke} />;
  return <Path d={shape.d} {...stroke} />;
}

function Icon({ state, color, size }: { state: Exclude<StatusLabel, "working">; color: string; size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {LUCIDE[STATUS_ICONS[state]].map((shape, i) => (
        <Shape key={i} shape={shape as IconShape} color={color} />
      ))}
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
