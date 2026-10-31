import { agentMarkId, type IconShape, LUCIDE, STATUS_ICONS, STATUS_LABELS, type StatusLabel, type TaskState, topState } from "@terminus/design";
import { View } from "react-native";
import Svg, { Circle, Line, Path } from "react-native-svg";
import { AgentAvatar } from "./AgentAvatar";
import { BrandMark } from "./BrandMark";
import { Icon as GenericIcon } from "./Icon";
import { TaskOrbit } from "./TaskOrbit";
import { lang } from "../lib/i18n";
import { type Theme, useTheme } from "./theme";

export { type TaskState, topState };

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
    case "interrupted":
      return theme.textMuted;
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
export function TaskMark({ state, delivered = false, size = 16, identity }: { state: TaskState | null; delivered?: boolean; size?: number; identity?: { agent?: string | null; provider?: string | null; host?: string; folder?: string } }) {
  const theme = useTheme();
  const box = { width: size, height: size, alignItems: "center" as const, justifyContent: "center" as const };
  if (state === "working") {
    return (
      <View style={identity ? undefined : box} accessibilityLabel={[stateText("working"), identity?.agent ?? identity?.provider].filter(Boolean).join(" · ")}>
        {identity ? <TaskOrbit>
          {identity.agent ? <AgentAvatar name={identity.agent} host={identity.host} folder={identity.folder} size={16} working /> : agentMarkId(identity.provider) ? <BrandMark id={identity.provider} size={14} color={theme.text} /> : <GenericIcon name="user-round" size={14} color={theme.text} />}
        </TaskOrbit> : <View style={[box, { width: size * 0.4, height: size * 0.4, borderRadius: size, backgroundColor: theme.primary }]} />}
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
