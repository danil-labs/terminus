import { AGENT_MARKS, agentMarkId } from "@terminus/design";
import { useId } from "react";
import { useColorScheme } from "react-native";
import Svg, { Defs, FeGaussianBlur, Filter, G, Mask, Path } from "react-native-svg";

/**
 * La marca de un proveedor por su id, como `MarcaAgente` del escritorio: los
 * trazos, los colores y qué marca le toca a cada uno salen de `@terminus/design`
 * (`AGENT_MARKS`, `agentMarkId`). Un relleno sin color de marca lleva `color`
 * (el del texto). Un proveedor desconocido no pinta nada.
 */
export function BrandMark({ id, size = 14, color }: { id: string | null | undefined; size?: number; color: string }) {
  const dark = useColorScheme() === "dark";
  // Ids por instancia: la marca se pinta varias veces por pantalla, y dos ids iguales se pisan.
  const uid = useId().replace(/[^\w-]/g, "");
  const which = agentMarkId(id);
  if (!which) return null;
  const mark = AGENT_MARKS[which];
  if (mark.spots)
    return (
      <Svg width={size} height={size} viewBox={mark.viewBox}>
        <Defs>
          <Mask id={`${uid}-m`} maskUnits="userSpaceOnUse" x="0" y="0" width="65" height="65">
            <Path d={mark.paths[0].d} fill="#fff" />
          </Mask>
          {mark.spots.map(([, , blur], i) => (
            <Filter key={i} id={`${uid}-f${i}`} x="-50" y="-50" width="170" height="170" filterUnits="userSpaceOnUse">
              <FeGaussianBlur stdDeviation={blur} />
            </Filter>
          ))}
        </Defs>
        <G mask={`url(#${uid}-m)`}>
          {mark.spots.map(([d, fill], i) => (
            <Path key={i} d={d} fill={fill} filter={`url(#${uid}-f${i})`} />
          ))}
        </G>
      </Svg>
    );
  const paths = dark && mark.dark ? mark.dark : mark.paths;
  return (
    <Svg width={size} height={size} viewBox={mark.viewBox}>
      <G transform={mark.transform}>
        {paths.map((p, i) => (
          <Path key={i} d={p.d} fill={p.fill ?? color} />
        ))}
      </G>
    </Svg>
  );
}
