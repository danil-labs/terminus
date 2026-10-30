import { useTheme } from "../theme";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { CodeFallback } from "./Mermaid";

let seq = 0;

/**
 * En el navegador, mermaid corre en la página como en la ventana (`ui/Mermaid.tsx`),
 * cargado al primer diagrama: la política de la página no deja traerlo de afuera.
 */
export function MermaidDiagram({ definition }: { definition: string }) {
  const dark = useTheme().dark;
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    void import("mermaid")
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "default" });
        const { svg } = await mermaid.render(`terminus-mermaid-${++seq}`, definition);
        if (alive) setSvg(svg);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [definition, dark]);
  if (failed) return <CodeFallback text={definition} />;
  return (
    <View style={{ alignSelf: "stretch", marginVertical: 4 }}>
      {/* `securityLevel: "strict"` limpia el SVG; es el mismo que pinta la ventana. */}
      {svg ? <div style={{ overflowX: "auto", maxWidth: "100%" }} dangerouslySetInnerHTML={{ __html: svg }} /> : null}
    </View>
  );
}
