import { useState } from "react";
import { Platform, StyleSheet, Text, useColorScheme, View } from "react-native";
import { useTheme } from "../theme";
import { WebFrame } from "./WebFrame";

/** Un bloque ```mermaid: el diagrama con mermaid, en su propia página, del color del tema. */
export function MermaidDiagram({ definition }: { definition: string }) {
  const theme = useTheme();
  const dark = useColorScheme() === "dark";
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;background:transparent;color:${theme.text}}#d{padding:8px;overflow-x:auto}#d svg{max-width:100%;height:auto}</style></head>
<body><div id="d"></div><script src="https://cdn.jsdelivr.net/npm/mermaid@12/dist/mermaid.min.js"></script><script>
function size(){parent.postMessage({type:"terminus:visual-height",height:Math.ceil(document.body.scrollHeight)},"*")}
try{mermaid.initialize({startOnLoad:false,securityLevel:"strict",theme:${JSON.stringify(dark ? "dark" : "default")}});
mermaid.render("m",${JSON.stringify(definition)}).then(function(r){document.getElementById("d").innerHTML=r.svg;size()}).catch(function(){parent.postMessage({type:"terminus:visual-error"},"*")});}
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
