import { useState } from "react";
import { Linking, StyleSheet, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { destinoAbrible } from "@terminus/chat/links";
import { useTheme } from "../theme";

/**
 * El `iframe` de la ventana en el teléfono: HTML que no sale a la red (su CSP),
 * no navega y mide su alto. El runtime del escritorio avisa por
 * `parent.postMessage`; en un WebView `parent` es la propia página, así que
 * antes de cargar se le cambia por el puente de React Native.
 */
const BRIDGE = `(function () {
  var send = function (m) { window.ReactNativeWebView.postMessage(JSON.stringify(m)); };
  try { window.postMessage = function (m) { send(m); }; } catch (e) {}
  window.addEventListener("error", function () { send({ type: "terminus:visual-error" }); });
})(); true;`;

export function WebFrame({ html, minHeight = 48, maxHeight = 4096, onError }: { html: string; minHeight?: number; maxHeight?: number; onError?: () => void }) {
  const theme = useTheme();
  const [height, setHeight] = useState(minHeight);
  const onMessage = (event: WebViewMessageEvent) => {
    let message: { type?: string; height?: number } | null = null;
    try {
      message = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (message?.type === "terminus:visual-height" && typeof message.height === "number") setHeight(Math.max(minHeight, Math.min(maxHeight, message.height)));
    if (message?.type === "terminus:visual-error") onError?.();
  };
  return (
    <View style={[styles.frame, { height, borderColor: theme.border }]}>
      <WebView
        source={{ html }}
        originWhitelist={["about:*"]}
        injectedJavaScriptBeforeContentLoaded={BRIDGE}
        onMessage={onMessage}
        // No navega: un enlace del agente con http(s) se abre en el navegador del sistema, lo demás se ignora.
        onShouldStartLoadWithRequest={(request) => {
          if (request.url.startsWith("about:")) return true;
          const target = destinoAbrible(request.url);
          if (target && request.isTopFrame !== false) void Linking.openURL(target);
          return false;
        }}
        javaScriptCanOpenWindowsAutomatically={false}
        setSupportMultipleWindows={false}
        allowFileAccess={false}
        allowsInlineMediaPlayback
        scrollEnabled={false}
        nestedScrollEnabled
        style={{ backgroundColor: "transparent" }}
        containerStyle={{ backgroundColor: "transparent" }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { alignSelf: "stretch", borderRadius: 10, overflow: "hidden", borderWidth: StyleSheet.hairlineWidth },
});
