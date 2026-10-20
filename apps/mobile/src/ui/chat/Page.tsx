import { Platform } from "react-native";
import { WebView } from "react-native-webview";

/** iOS dibuja un PDF dentro de su WebView; Android no. */
export const PDF_INLINE = Platform.OS === "ios";

/** Una página HTML de la máquina a pantalla completa, con el mismo aislamiento que las visualizaciones. */
export function SandboxedPage({ html }: { html: string }) {
  return (
    <WebView
      source={{ html }}
      originWhitelist={["about:*"]}
      onShouldStartLoadWithRequest={(request) => request.url.startsWith("about:")}
      javaScriptCanOpenWindowsAutomatically={false}
      setSupportMultipleWindows={false}
      allowFileAccess={false}
      style={{ flex: 1, backgroundColor: "transparent" }}
    />
  );
}

export function PdfPage({ base64 }: { base64: string }) {
  return <WebView source={{ uri: `data:application/pdf;base64,${base64}` }} originWhitelist={["data:*"]} style={{ flex: 1 }} />;
}
