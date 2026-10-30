import { RADIUS } from "@terminus/design";
import { StyleSheet } from "react-native";

/** Las medidas del título grande de Inicio, iguales en las tres plataformas. */
export const spaceTitle = StyleSheet.create({
  wrap: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 8, alignSelf: "flex-start", maxWidth: "100%" },
  trigger: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: RADIUS.lg, minHeight: 44 },
  text: { fontSize: 34, fontWeight: "800", letterSpacing: -0.5, flexShrink: 1 },
});
