import { ASTRO_SHAPES, astroBody, astroColors, type AstroNode } from "@terminus/design";
import { Image, View, useColorScheme } from "react-native";
import Svg, { Circle, Ellipse, G, Path } from "react-native-svg";
import { useState } from "react";
import { useWorkspaces } from "../lib/workspaces";

const SHAPES = { g: G, circle: Circle, ellipse: Ellipse, path: Path };

function Shape({ node, colors }: { node: AstroNode; colors: readonly [string, string] }) {
  const Component = SHAPES[node.tag];
  const props = Object.fromEntries(Object.entries(node.attrs).filter(([key]) => key !== "class" && key !== "style").map(([key, value]) => [
    key.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase()),
    typeof value === "string" ? value.replace("var(--astro-1)", colors[0]).replace("var(--astro-2)", colors[1]).replace("var(--astro-ojo)", "#0b1026") : value,
  ]));
  return <Component {...props}>{node.children?.map((child, index) => <Shape key={index} node={child} colors={colors} />)}</Component>;
}

/** La misma identidad del escritorio; las imágenes viajan por preview_file, nunca por file://. */
export function AgentAvatar({ name, size = 32, host, folder }: { name: string; size?: number; host?: string; folder?: string }) {
  const { snapshot } = useWorkspaces();
  const agent = snapshot?.agents.find((a) => a.name === name && (!host || a.places.some((p) => p.host === host && (folder === undefined || p.folder === folder))));
  const appearance = host ? agent?.places.find((p) => p.host === host && (folder === undefined || p.folder === folder)) : agent;
  const body = astroBody(name, appearance?.body);
  const dark = useColorScheme() === "dark";
  const colors = astroColors(body, dark);
  const [failed, setFailed] = useState<string | null>(null);
  const image = appearance?.avatar;
  const asleep = agent?.status === "asleep";
  return <View style={{ width: size, height: size, opacity: asleep ? 0.62 : 1 }}>
    {image && failed !== image ? <Image source={{ uri: image }} style={{ width: size, height: size, borderRadius: size / 2 }} resizeMode="contain" onError={() => setFailed(image)} /> : (
      <Svg width={size} height={size} viewBox="0 0 64 64">
        <Shape node={ASTRO_SHAPES[body]} colors={colors} />
        {asleep ? <G fill="none" stroke={body === "hole" ? "#eef1fa" : "#0b1026"} strokeWidth={2.7} strokeLinecap="round"><Path d="M21.5 34q4.5 4 9 0M33.5 34q4.5 4 9 0" /></G> : <G fill={body === "hole" ? "#eef1fa" : "#0b1026"}><Ellipse cx={26} cy={34} rx={2.7} ry={3.5} /><Ellipse cx={38} cy={34} rx={2.7} ry={3.5} /></G>}
      </Svg>
    )}
  </View>;
}
