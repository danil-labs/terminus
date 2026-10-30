import { Button, Divider, Host, Menu, Text } from "@expo/ui/swift-ui";
import { font, foregroundStyle } from "@expo/ui/swift-ui/modifiers";
import { View } from "react-native";
import type { SFSymbol } from "sf-symbols-typescript";
import type { IconName } from "./Icon";
import type { SpaceMenuProps } from "./SpaceMenu";
import { spaceTitle } from "./spaceTitle";
import { useTheme } from "./theme";

/** Los íconos del menú en su par de SF Symbols: el menú es el del sistema. */
const SYMBOLS: Partial<Record<IconName, SFSymbol>> = { plus: "plus", pencil: "pencil", "trash-2": "trash" };

/** iOS: el menú del sistema anclado al título (`Menu` de SwiftUI). Ver `SpaceMenu.tsx`. */
export function SpaceMenu({ title, items }: SpaceMenuProps) {
  const theme = useTheme();
  return (
    <View style={spaceTitle.wrap}>
      <Host matchContents>
        <Menu label={<Text modifiers={[font({ size: 34, weight: "heavy" }), foregroundStyle(theme.text)]}>{`${title} ⌄`}</Text>}>
          {items.flatMap((item, i) => [
            item.section && i > 0 ? <Divider key={`${item.key}-divider`} /> : null,
            <Button
              key={item.key}
              label={item.count !== undefined ? `${item.label}  ${item.count}` : item.label}
              systemImage={item.checked ? "checkmark" : item.icon ? SYMBOLS[item.icon] : undefined}
              role={item.destructive ? "destructive" : "default"}
              onPress={item.onPress}
            />,
          ])}
        </Menu>
      </Host>
    </View>
  );
}
