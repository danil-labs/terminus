import { DropdownMenu, DropdownMenuItem, Host, HorizontalDivider, RNHostView, Text } from "@expo/ui/jetpack-compose";
import { useState } from "react";
import { Text as RNText, View } from "react-native";
import { Icon } from "./Icon";
import { Tap } from "./list";
import type { SpaceMenuProps } from "./SpaceMenu";
import { spaceTitle } from "./spaceTitle";
import { useTheme } from "./theme";

/** Android: el menú de Material anclado al título (`DropdownMenu` de Jetpack Compose). Ver `SpaceMenu.tsx`. */
export function SpaceMenu({ title, items, label }: SpaceMenuProps) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={spaceTitle.wrap}>
      <Host matchContents>
        <DropdownMenu expanded={open} onDismissRequest={() => setOpen(false)} color={theme.raised}>
          <DropdownMenu.Trigger>
            <RNHostView matchContents>
              <Tap testID="space-menu" accessibilityRole="button" accessibilityLabel={label} onPress={() => setOpen(true)} style={spaceTitle.trigger}>
                <RNText numberOfLines={1} style={[spaceTitle.text, { color: theme.text }]}>{title}</RNText>
                <Icon name="chevron-down" size={22} color={theme.textMuted} strokeWidth={2.5} />
              </Tap>
            </RNHostView>
          </DropdownMenu.Trigger>
          <DropdownMenu.Items>
            {items.flatMap((item, i) => [
              item.section && i > 0 ? <HorizontalDivider key={`${item.key}-divider`} /> : null,
              <DropdownMenuItem key={item.key} enabled={!item.disabled} onClick={() => { setOpen(false); item.onPress(); }}>
                <DropdownMenuItem.Text>
                  <Text color={item.destructive ? theme.error : theme.text}>{`${item.checked ? "✓  " : ""}${item.label}${item.count !== undefined ? `   ${item.count}` : ""}`}</Text>
                </DropdownMenuItem.Text>
              </DropdownMenuItem>,
            ])}
          </DropdownMenu.Items>
        </DropdownMenu>
      </Host>
    </View>
  );
}
