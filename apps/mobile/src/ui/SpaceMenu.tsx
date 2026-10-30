import { Text, View } from "react-native";
import { Icon } from "./Icon";
import { Tap } from "./list";
import { type MenuItem, Popover, useMenuAnchor } from "./Popover";
import { spaceTitle } from "./spaceTitle";
import { useTheme } from "./theme";

export type SpaceMenuProps = { title: string; items: MenuItem[]; label: string };

/**
 * El título grande de Inicio, que es el espacio, con su menú anclado: los
 * espacios con su número de tareas y después Nuevo espacio, Renombrar y
 * Eliminar…. En la web es un popover propio con borde y flecha (`@expo/ui`
 * no tiene menú universal); iOS y Android usan el del sistema
 * (`SpaceMenu.ios.tsx`, `SpaceMenu.android.tsx`).
 */
export function SpaceMenu({ title, items, label }: SpaceMenuProps) {
  const theme = useTheme();
  const anchor = useMenuAnchor();
  return (
    <>
      <View ref={anchor.ref} collapsable={false} style={spaceTitle.wrap}>
        <Tap testID="space-menu" accessibilityRole="button" accessibilityLabel={label} accessibilityHint={title} pressedColor="transparent" onPress={() => void anchor.open()} style={spaceTitle.trigger}>
          <Text numberOfLines={1} accessibilityRole="header" style={[spaceTitle.text, { color: theme.text }]}>{title}</Text>
          <Icon name="chevron-down" size={22} color={theme.textMuted} strokeWidth={2.5} />
        </Tap>
      </View>
      <Popover testID="space-menu-items" anchor={anchor.rect} items={items} onClose={anchor.close} />
    </>
  );
}
