import { envolver } from "@terminus/chat/sandbox";
import type { FilePreview } from "@terminus/protocol";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, useColorScheme, View } from "react-native";
import { previewFile, readVisual } from "../../lib/engine";
import { t } from "../../lib/i18n";
import { Icon } from "../Icon";
import { useTheme } from "../theme";
import { useChatScope } from "./scope";
import { PDF_INLINE, PdfPage, SandboxedPage } from "./Page";
import { visualThemeOf } from "./visualTheme";
import { WebFrame } from "./WebFrame";

/** Lo que se lee de la máquina una vez por mensaje montado; `null` mientras llega. */
function useLoad<T>(key: string | null, load: () => Promise<T>): { value: T | null; failed: boolean } {
  const [state, setState] = useState<{ key: string | null; value: T | null; failed: boolean }>({ key: null, value: null, failed: false });
  useEffect(() => {
    if (!key) return;
    let alive = true;
    load().then(
      (value) => alive && setState({ key, value, failed: false }),
      () => alive && setState({ key, value: null, failed: true }),
    );
    return () => {
      alive = false;
    };
  }, [key]);
  return state.key === key ? state : { value: null, failed: false };
}

function Muted({ children }: { children: string }) {
  const theme = useTheme();
  return <Text style={{ color: theme.textMuted, fontSize: 13 }}>{children}</Text>;
}

/**
 * `::terminus-visual{…}`: el HTML del agente, aislado y a su alto, con el tema
 * del teléfono. Mientras carga es una tarjeta (título y loader) que no se mueve
 * hasta que el marco, pintado detrás, ya midió su alto; entonces aparece con
 * sus botones. Cerrarlo vuelve a la tarjeta, y tocarla lo carga otra vez.
 */
export function ChatVisual({ file, title }: { file: string; title: string }) {
  const scope = useChatScope();
  const theme = useTheme();
  const dark = useColorScheme() === "dark";
  const [opened, setOpened] = useState(true);
  const [painted, setPainted] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const key = scope && opened ? `${scope.hostId}/${scope.session}/${file}` : null;
  const { value, failed } = useLoad(key, () => readVisual(scope!.host, scope!.workspace, scope!.folder, scope!.session, file));
  const html = useMemo(() => (value ? envolver(value, { inline: { font: "", theme: visualThemeOf(theme, dark) } }) : null), [value, theme, dark]);
  const name = title || t("chat.visual.title");
  const close = () => {
    setExpanded(false);
    setPainted(false);
    setOpened(false);
  };
  if (failed) {
    return (
      <View style={styles.block}>
        <Text style={[styles.caption, { color: theme.textMuted }]}>{name}</Text>
        <Muted>{t("chat.visual.failed")}</Muted>
      </View>
    );
  }
  const card = !opened || !painted;
  return (
    <View style={styles.block}>
      {card ? (
        <Pressable
          onPress={() => setOpened(true)}
          disabled={opened}
          accessibilityRole="button"
          accessibilityState={{ busy: opened }}
          accessibilityLabel={opened ? t("chat.visual.loading") : t("chat.visual.load")}
          style={[styles.card, { borderColor: theme.border, backgroundColor: theme.surface }]}
        >
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ color: theme.text, fontWeight: "600" }}>
              {name}
            </Text>
            {opened ? null : <Text style={{ color: theme.textMuted, fontSize: 12 }}>{t("chat.visual.load")}</Text>}
          </View>
          {opened ? <ActivityIndicator size="small" color={theme.textMuted} /> : <Icon name="maximize-2" size={16} color={theme.textMuted} />}
        </Pressable>
      ) : (
        <View style={styles.visualTop}>
          <Text numberOfLines={1} style={[styles.caption, { color: theme.textMuted, flex: 1 }]}>
            {name}
          </Text>
          <Pressable hitSlop={8} onPress={() => setExpanded(true)} accessibilityRole="button" accessibilityLabel={t("chat.visual.expand")} style={styles.tool}>
            <Icon name="maximize-2" size={16} color={theme.textMuted} />
          </Pressable>
          <Pressable hitSlop={8} onPress={close} accessibilityRole="button" accessibilityLabel={t("chat.visual.unload")} style={styles.tool}>
            <Icon name="x" size={16} color={theme.textMuted} />
          </Pressable>
        </View>
      )}
      {opened && html ? (
        // Se pinta detrás de la tarjeta y se destapa ya a su alto.
        <View style={painted ? null : styles.hidden} pointerEvents={painted ? "auto" : "none"}>
          <WebFrame html={html} minHeight={120} inset={8} onReady={() => setPainted(true)} />
        </View>
      ) : null}
      <Modal visible={expanded && !!html} animationType="fade" presentationStyle="fullScreen" onRequestClose={() => setExpanded(false)}>
        <View style={[styles.sheet, { backgroundColor: theme.bg }]}>
          <View style={styles.sheetTop}>
            <Text numberOfLines={1} style={{ color: theme.text, fontWeight: "700", flex: 1 }}>
              {name}
            </Text>
            <Pressable hitSlop={10} onPress={() => setExpanded(false)} accessibilityRole="button" accessibilityLabel={t("chat.visual.collapse")}>
              <Icon name="minimize-2" size={20} color={theme.text} />
            </Pressable>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }}>
            {html ? <WebFrame html={html} minHeight={120} inset={8} /> : null}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

/** Una imagen que ya viene en el mensaje (`data:image/…`) o que se leyó de la máquina; tocarla la agranda. */
export function ChatImage({ uri, alt }: { uri: string; alt?: string }) {
  const [ratio, setRatio] = useState(4 / 3);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    Image.getSize(uri, (w, h) => h && setRatio(w / h), () => undefined);
  }, [uri]);
  return (
    <>
      <Pressable onPress={() => setOpen(true)} accessibilityLabel={alt} style={styles.block}>
        <Image source={{ uri }} style={[styles.image, { aspectRatio: ratio }]} resizeMode="contain" />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.viewer} onPress={() => setOpen(false)}>
          <Image source={{ uri }} style={styles.full} resizeMode="contain" />
        </Pressable>
      </Modal>
    </>
  );
}

// Las que `Image` dibuja; un SVG va como archivo.
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|avif|heic)$/i;

/**
 * `![x](/ruta/en/la/máquina)`: una imagen se pinta; un PDF, HTML u otro archivo
 * es una tarjeta que se abre en un visor (el PDF solo en iOS, que lo dibuja).
 */
export function LocalFile({ path, alt }: { path: string; alt?: string }) {
  const scope = useChatScope();
  const theme = useTheme();
  const isImage = IMAGE_EXT.test(path);
  const [open, setOpen] = useState(false);
  const want = isImage || open;
  const key = scope && want ? `${scope.hostId}/${path}` : null;
  const { value, failed } = useLoad<FilePreview>(key, () => previewFile(scope!.host, scope!.workspace, path, scope!));
  if (isImage) {
    if (value?.data_url) return <ChatImage uri={value.data_url} alt={alt} />;
    if (failed || !scope) return <Muted>{alt || path}</Muted>;
    return <ActivityIndicator style={styles.loading} />;
  }
  const name = path.split("/").pop() ?? path;
  return (
    <>
      <Pressable onPress={() => setOpen(true)} style={[styles.card, { borderColor: theme.border, backgroundColor: theme.surface }]} accessibilityRole="button">
        <Icon name="file" size={18} color={theme.textMuted} />
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ color: theme.text, fontWeight: "600" }}>
            {alt && alt !== name ? alt : name}
          </Text>
          <Text numberOfLines={1} style={{ color: theme.textMuted, fontSize: 12 }}>
            {path}
          </Text>
        </View>
        <Icon name="chevron-right" size={16} color={theme.textMuted} />
      </Pressable>
      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
        <View style={[styles.sheet, { backgroundColor: theme.bg }]}>
          <View style={styles.sheetTop}>
            <Text numberOfLines={1} style={{ color: theme.text, fontWeight: "700", flex: 1 }}>
              {name}
            </Text>
            <Pressable hitSlop={10} onPress={() => setOpen(false)} accessibilityLabel={t("chat.close")}>
              <Icon name="x" size={20} color={theme.text} />
            </Pressable>
          </View>
          <FileBody preview={value} failed={failed || !scope} />
        </View>
      </Modal>
    </>
  );
}

function FileBody({ preview, failed }: { preview: FilePreview | null; failed: boolean }) {
  const theme = useTheme();
  if (failed) return <Muted>{t("chat.file.failed")}</Muted>;
  if (!preview) return <ActivityIndicator style={styles.loading} />;
  if (preview.kind === "image" && preview.data_url) return <Image source={{ uri: preview.data_url }} style={{ flex: 1 }} resizeMode="contain" />;
  if (preview.kind === "html" && preview.text) return <SandboxedPage html={envolver(preview.text)} />;
  if (preview.kind === "pdf" && preview.pdf && PDF_INLINE) return <PdfPage base64={preview.pdf} />;
  if (preview.kind === "text" && preview.text)
    return (
      <Text selectable style={[styles.mono, { color: theme.text, backgroundColor: theme.muted }]}>
        {preview.text}
      </Text>
    );
  return <Muted>{t("chat.file.no_preview")}</Muted>;
}

const styles = StyleSheet.create({
  block: { alignSelf: "stretch", marginVertical: 4, gap: 4 },
  caption: { fontSize: 12, fontWeight: "600" },
  loading: { alignSelf: "flex-start", marginVertical: 8 },
  image: { width: "100%", borderRadius: 10 },
  viewer: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)", justifyContent: "center" },
  full: { width: "100%", height: "100%" },
  card: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 10, marginVertical: 4 },
  visualTop: { flexDirection: "row", alignItems: "center", gap: 4 },
  tool: { padding: 6 },
  hidden: { position: "absolute", left: 0, right: 0, top: 0, opacity: 0 },
  sheet: { flex: 1, padding: 16, gap: 12 },
  sheetTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  mono: { fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }), fontSize: 12.5, lineHeight: 18, padding: 10, borderRadius: 8 },
});
