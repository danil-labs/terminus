import type { ReactNode } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import ReanimatedSwipeable, { type SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import { Icon, type IconName } from "./Icon";
import { Tap } from "./list";
import { useTheme } from "./theme";

/**
 * En la web, gesture-handler deja `touch-action: none` en línea en la fila
 * aunque `ReanimatedSwipeable` pida `pan-y`, y esa regla se acumula hacia
 * adentro: con el dedo sobre una fila la lista no se movía, solo desde los
 * huecos. Con `pan-y` el arrastre vertical es del navegador y el horizontal
 * sigue siendo de la fila.
 */
if (Platform.OS === "web" && typeof document !== "undefined") {
  const style = document.createElement("style");
  style.textContent = "[data-swipe-row], [data-swipe-row] * { touch-action: pan-y !important; }";
  document.head.append(style);
}

export type SwipeAction = { key: string; label: string; icon: IconName; color: string; onPress: () => void };

/**
 * Una fila que se desliza a la izquierda y enseña sus acciones juntas (en
 * Inicio: Fijar · Archivar), igual en iOS, Android y la web. Tocar una acción
 * cierra la fila antes de hacerla.
 */
export function SwipeRow({ actions, children, testID }: { actions: SwipeAction[]; children: ReactNode; testID?: string }) {
  const theme = useTheme();
  if (!actions.length) return <>{children}</>;
  return (
    <View {...({ dataSet: { swipeRow: "" } } as object)}>
    <ReanimatedSwipeable
      testID={testID}
      friction={1.6}
      rightThreshold={40}
      overshootRight={false}
      containerStyle={{ backgroundColor: theme.surface }}
      renderRightActions={(_progress, _translation, swipeable: SwipeableMethods) => (
        <View style={styles.actions}>
          {actions.map((action) => (
            <Tap
              key={action.key}
              testID={testID ? `${testID}-${action.key}` : undefined}
              accessibilityRole="button"
              accessibilityLabel={action.label}
              pressedColor={action.color}
              onPress={() => { swipeable.close(); action.onPress(); }}
              style={[styles.action, { backgroundColor: action.color }]}
            >
              <Icon name={action.icon} size={18} color="#ffffff" />
              <Text style={styles.label}>{action.label}</Text>
            </Tap>
          ))}
        </View>
      )}
    >
      <View style={{ backgroundColor: theme.surface }}>{children}</View>
    </ReanimatedSwipeable>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row" },
  action: { width: 84, alignItems: "center", justifyContent: "center", gap: 4 },
  label: { color: "#ffffff", fontSize: 13, fontWeight: "600" },
});
