import { useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../theme";
import { WebFrame } from "./WebFrame";

/**
 * Mermaid fijado a una versión exacta y con SRI: el WebView solo ejecuta ese
 * archivo de jsDelivr (el mismo que `mermaid@12.2.0` de npm, que usa la web).
 * Al cambiar la versión, el hash se vuelve a calcular:
 * `curl -fsSL <url> | openssl dgst -sha384 -binary | openssl base64 -A`.
 */
const MERMAID_URL = "https://cdn.jsdelivr.net/npm/mermaid@12.2.0/dist/mermaid.min.js";
const MERMAID_SRI = "sha384-8xUhuLNMjW/cI2Dacg3DR4WliYznvIg0LVG1stctThKD/YVrJFI9TNCFxft5NYgp";
/** Sin red salvo ese script; sin imágenes de afuera; los estilos en línea son los del SVG. */
const CSP = "default-src 'none'; script-src 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'unsafe-inline'; img-src data:; connect-src 'none'";

/**
 * Un texto como literal de JavaScript dentro de `<script>`: `JSON.stringify` y
 * además `<` (un `</script>` del agente cerraría el bloque) y U+2028/U+2029
 * (fin de línea en JavaScript antiguo).
 */
export function scriptLiteral(text: string): string {
  return JSON.stringify(text).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

/** Un bloque ```mermaid: el diagrama con mermaid, en su propia página, del color del tema. */
export function MermaidDiagram({ definition }: { definition: string }) {
  const theme = useTheme();
  const dark = useTheme().dark;
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<style>html,body{margin:0;background:transparent;color:${theme.text}}#d{padding:8px;overflow-x:auto}#d svg{max-width:100%;height:auto}</style></head>
<body><div id="d"></div><script src="${MERMAID_URL}" integrity="${MERMAID_SRI}" crossorigin="anonymous" onerror="parent.postMessage({type:'terminus:visual-error'},'*')"></script><script>
function size(){parent.postMessage({type:"terminus:visual-height",height:Math.ceil(document.body.scrollHeight)},"*")}
try{mermaid.initialize({startOnLoad:false,securityLevel:"strict",theme:${JSON.stringify(dark ? "dark" : "default")}});
mermaid.render("m",${scriptLiteral(definition)}).then(function(r){document.getElementById("d").innerHTML=r.svg;size()}).catch(function(){parent.postMessage({type:"terminus:visual-error"},"*")});}
catch(e){parent.postMessage({type:"terminus:visual-error"},"*")}
</script></body></html>`;
  const [failed, setFailed] = useState(false);
  if (failed) return <CodeFallback text={definition} />;
  return (
    <View style={styles.block}>
      <WebFrame html={html} minHeight={80} onError={() => setFailed(true)} />
    </View>
  );
}

export function CodeFallback({ text }: { text: string }) {
  const theme = useTheme();
  return (
    <Text selectable style={[styles.mono, { color: theme.text, backgroundColor: theme.muted }]}>
      {text}
    </Text>
  );
}

const styles = StyleSheet.create({
  block: { alignSelf: "stretch", marginVertical: 4 },
  mono: { fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }), fontSize: 12.5, lineHeight: 18, padding: 10, borderRadius: 8 },
});
