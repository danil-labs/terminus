import { Pressable, StyleSheet } from "react-native";
import { Icon } from "./Icon";
import { useTheme } from "./theme";

export function SendButton({ disabled = false, onPress, label, testID = "send" }: { disabled?: boolean; onPress: () => void; label: string; testID?: string }) {
  const theme = useTheme();
  return <Pressable testID={testID} disabled={disabled} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} style={[styles.button, { backgroundColor: theme.primary, opacity: disabled ? 0.4 : 1 }]}>
    <Icon name="arrow-up" size={17} color={theme.onPrimary} strokeWidth={2.5} />
  </Pressable>;
}

const styles = StyleSheet.create({
  button: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
});
