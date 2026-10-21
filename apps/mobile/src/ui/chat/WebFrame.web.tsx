import { SANDBOX_ARTEFACTO } from "@terminus/chat/sandbox";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useTheme } from "../theme";

/**
 * En el navegador, la visualización va en el mismo `iframe` que en la ventana
 * (`ChatVisual.tsx`): `srcdoc`, `allow-scripts` sin `allow-same-origin`, y el
 * alto que el runtime manda con `terminus:visual-height` desde ese marco.
 */
export function WebFrame({ html, minHeight = 48, maxHeight = 4096, onError }: { html: string; minHeight?: number; maxHeight?: number; onError?: () => void }) {
  const theme = useTheme();
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(minHeight);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const message = event.data as { type?: string; height?: number } | null;
      if (message?.type === "terminus:visual-height" && typeof message.height === "number") setHeight(Math.max(minHeight, Math.min(maxHeight, message.height)));
      if (message?.type === "terminus:visual-error") onError?.();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [minHeight, maxHeight, onError]);
  return (
    <View style={[styles.frame, { height, borderColor: theme.border }]}>
      <iframe ref={frame} title="visual" srcDoc={html} sandbox={SANDBOX_ARTEFACTO} style={{ width: "100%", height: "100%", border: 0, background: "transparent" }} />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { alignSelf: "stretch", borderRadius: 10, overflow: "hidden", borderWidth: StyleSheet.hairlineWidth },
});
