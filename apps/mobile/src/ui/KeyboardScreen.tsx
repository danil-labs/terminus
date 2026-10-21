import { HeaderHeightContext } from "expo-router/react-navigation";
import { useContext, type ReactNode } from "react";
import { KeyboardAvoidingView, type StyleProp, type ViewStyle } from "react-native";

/**
 * A screen whose text box must stay above the keyboard. "padding" on both
 * platforms: Android draws edge to edge since SDK 54 and no longer resizes the
 * window for the keyboard. The offset is the header actually drawn above it.
 */
export function KeyboardScreen({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const header = useContext(HeaderHeightContext) ?? 0;
  return (
    <KeyboardAvoidingView style={[{ flex: 1 }, style]} behavior="padding" keyboardVerticalOffset={header}>
      {children}
    </KeyboardAvoidingView>
  );
}
