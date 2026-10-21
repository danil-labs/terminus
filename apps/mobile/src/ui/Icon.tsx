import Svg, { Circle, Ellipse, Line, Path, Polygon, Polyline, Rect } from "react-native-svg";
import { ICONS, type IconName, type LucideShape } from "./lucide";

export type { IconName };

/** Un ícono de Lucide, el mismo que usa el escritorio, igual en iOS y Android. */
export function Icon({ name, size = 16, color, strokeWidth = 2, fill = "none" }: { name: IconName; size?: number; color: string; strokeWidth?: number; fill?: string }) {
  const stroke = { stroke: color, strokeWidth, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {(ICONS[name] as readonly LucideShape[]).map((shape, i) => {
        switch (shape.kind) {
          case "path": return <Path key={i} d={shape.d} {...stroke} />;
          case "circle": return <Circle key={i} cx={shape.cx} cy={shape.cy} r={shape.r} {...stroke} fill={shape.fill === "currentColor" ? color : stroke.fill} />;
          case "line": return <Line key={i} x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2} {...stroke} />;
          case "rect": return <Rect key={i} x={shape.x} y={shape.y} width={shape.width} height={shape.height} rx={shape.rx} ry={shape.ry} {...stroke} />;
          case "polyline": return <Polyline key={i} points={shape.points} {...stroke} />;
          case "polygon": return <Polygon key={i} points={shape.points} {...stroke} />;
          default: return <Ellipse key={i} cx={shape.cx} cy={shape.cy} rx={shape.rx} ry={shape.ry} {...stroke} />;
        }
      })}
    </Svg>
  );
}
