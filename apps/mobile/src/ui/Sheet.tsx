import { TEXT } from "@terminus/design";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, type IconName } from "./Icon";
import { SearchField } from "./Search";
import { useTheme } from "./theme";

/**
 * Una hoja desde abajo para los selectores del cuadro de escribir (modelo,
 * permisos, máquina, carpeta, rama, adjuntar): el popover del escritorio en el
 * teléfono. Se cierra tocando fuera o con el gesto atrás de Android. Con
 * `search` lleva un buscador arriba y `children` es una función que recibe lo
 * buscado; la búsqueda se borra al cerrar. Con `detents` (fracciones de la
 * ventana, de menor a mayor) tiene alto fijo, cambia de altura desde el asa y
 * `children` pone su propio scroller: en web no existe el `formSheet`.
 */
export function Sheet({
  visible,
  title,
  search,
  detents,
  onClose,
  children,
}: {
  visible: boolean;
  title?: string;
  search?: string;
  detents?: readonly [number, number];
  onClose: () => void;
  children: ReactNode | ((query: string) => ReactNode);
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (!visible) setQuery("");
  }, [visible]);
  const { height: windowHeight } = useWindowDimensions();
  const [detent, setDetent] = useState(0);
  const [drag, setDrag] = useState(0);
  const height = detents ? Math.max(0, Math.min(windowHeight * detents[1], windowHeight * detents[detent] - drag)) : undefined;
  const measured = useRef({ height: 0, windowHeight, detents });
  measured.current = { height: height ?? 0, windowHeight, detents };
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 4,
      onPanResponderMove: (_, gesture) => setDrag(gesture.dy),
      onPanResponderRelease: () => {
        const now = measured.current;
        const middle = now.detents ? (now.detents[0] + now.detents[1]) / 2 : 0;
        setDrag(0);
        setDetent(now.height / now.windowHeight > middle ? 1 : 0);
      },
      onPanResponderTerminate: () => setDrag(0),
    }),
  ).current;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <KeyboardAvoidingView style={styles.root} behavior="padding">
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" />
        <View style={[styles.sheet, detents ? { height, maxHeight: height } : null, { backgroundColor: theme.surface, paddingBottom: detents ? 0 : insets.bottom + 12, borderColor: theme.border }]}>
          {detents ? (
            <View {...pan.panHandlers} style={styles.handleArea}>
              <Pressable testID="sheet-handle" accessibilityRole="button" accessibilityLabel={`${Math.round(detents[detent === 0 ? 1 : 0] * 100)} %`} onPress={() => setDetent((now) => (now === 0 ? 1 : 0))} style={styles.handle}>
                <View style={[styles.grabber, { backgroundColor: theme.border, marginBottom: 0 }]} />
              </Pressable>
            </View>
          ) : (
            <View style={[styles.grabber, { backgroundColor: theme.border }]} />
          )}
          {title ? <Text style={[styles.title, { color: theme.text }]}>{title}</Text> : null}
          {search ? <SearchField testID="sheet-search" value={query} onChange={setQuery} placeholder={search} /> : null}
          {detents ? (
            <View style={styles.fixed}>{typeof children === "function" ? children(query) : children}</View>
          ) : (
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 4 }}>
              {typeof children === "function" ? children(query) : children}
            </ScrollView>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Un encabezado de grupo dentro de una hoja. */
export function SheetSection({ children }: { children: string }) {
  const theme = useTheme();
  return <Text style={[styles.section, { color: theme.textMuted }]}>{children}</Text>;
}

/** Una opción de una hoja: ícono o marca, rótulo, detalle y si está elegida. */
export function SheetOption({
  label,
  detail,
  icon,
  left,
  selected,
  disabled,
  onPress,
  testID,
  destructive = false,
}: {
  label: string;
  detail?: string | null;
  icon?: IconName;
  left?: ReactNode;
  selected?: boolean;
  disabled?: boolean;
  onPress: () => void;
  testID?: string;
  destructive?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.option, { backgroundColor: pressed ? theme.muted : "transparent", opacity: disabled ? 0.45 : 1 }]}
    >
      {left ?? (icon ? <Icon name={icon} size={17} color={destructive ? theme.failedMark : theme.textMuted} /> : null)}
      <View style={{ flex: 1, gap: 1 }}>
        <Text numberOfLines={1} style={{ color: destructive ? theme.failedMark : theme.text, fontSize: 16, fontWeight: selected ? "600" : "400" }}>
          {label}
        </Text>
        {detail ? (
          <Text numberOfLines={2} style={{ color: theme.textMuted, fontSize: TEXT.ui }}>
            {detail}
          </Text>
        ) : null}
      </View>
      {selected ? <Icon name="check" size={17} color={theme.primary} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: { maxHeight: "80%", borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: StyleSheet.hairlineWidth, paddingTop: 8 },
  // El arrastre va solo en el asa: `touch-action: none` en la lista bloquearía su scroll.
  handleArea: { touchAction: "none", cursor: "grab" } as object,
  handle: { height: 24, alignItems: "center", justifyContent: "center" },
  fixed: { flex: 1, minHeight: 0 },
  grabber: { alignSelf: "center", width: 36, height: 5, borderRadius: 3, marginBottom: 6 },
  title: { fontSize: 18, fontWeight: "700", paddingHorizontal: 18, paddingVertical: 8 },
  section: { fontSize: TEXT.ui, fontWeight: "600", paddingHorizontal: 18, paddingTop: 12, paddingBottom: 4 },
  option: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, paddingVertical: 11, minHeight: 48 },
});
