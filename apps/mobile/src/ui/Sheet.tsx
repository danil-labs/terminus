import type { ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, type IconName } from "./Icon";
import { useTheme } from "./theme";

/**
 * Una hoja desde abajo para los selectores del cuadro de escribir (modelo,
 * permisos, máquina, carpeta, rama, adjuntar): el popover del escritorio en el
 * teléfono. Se cierra tocando fuera o con el gesto atrás de Android.
 */
export function Sheet({ visible, title, onClose, children }: { visible: boolean; title?: string; onClose: () => void; children: ReactNode }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <KeyboardAvoidingView style={styles.root} behavior="padding">
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" />
        <View style={[styles.sheet, { backgroundColor: theme.surface, paddingBottom: insets.bottom + 12, borderColor: theme.border }]}>
          <View style={[styles.grabber, { backgroundColor: theme.border }]} />
          {title ? <Text style={[styles.title, { color: theme.text }]}>{title}</Text> : null}
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 4 }}>
            {children}
          </ScrollView>
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
}: {
  label: string;
  detail?: string | null;
  icon?: IconName;
  left?: ReactNode;
  selected?: boolean;
  disabled?: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.option, { backgroundColor: pressed ? theme.muted : "transparent", opacity: disabled ? 0.45 : 1 }]}
    >
      {left ?? (icon ? <Icon name={icon} size={17} color={theme.textMuted} /> : null)}
      <View style={{ flex: 1, gap: 1 }}>
        <Text numberOfLines={1} style={{ color: theme.text, fontSize: 16, fontWeight: selected ? "600" : "400" }}>
          {label}
        </Text>
        {detail ? (
          <Text numberOfLines={2} style={{ color: theme.textMuted, fontSize: 13 }}>
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
  grabber: { alignSelf: "center", width: 36, height: 5, borderRadius: 3, marginBottom: 6 },
  title: { fontSize: 18, fontWeight: "700", paddingHorizontal: 18, paddingVertical: 8 },
  section: { fontSize: 13, fontWeight: "600", paddingHorizontal: 18, paddingTop: 12, paddingBottom: 4 },
  option: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, paddingVertical: 11, minHeight: 48 },
});
