import { THEMES, type ThemeTokens } from "@terminus/design";
import { useColorScheme } from "react-native";

export type Theme = ThemeTokens;

/** The desktop's default themes, Violeta and Grafito, following the system. */
export function useTheme(): Theme {
  return useColorScheme() === "dark" ? THEMES.dark : THEMES.light;
}
