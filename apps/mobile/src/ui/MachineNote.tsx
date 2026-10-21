import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Host } from "../lib/hosts";
import { w } from "../lib/i18n";
import { type Fleet, useMachines } from "../lib/machines";
import { useTheme } from "./theme";

/**
 * Lo que la persona tiene que saber de sus máquinas, siempre en tono neutro:
 * una máquina apagada no es un error. Encendiéndose, se dice; apagada, no se
 * dice nada: la lista de tareas ya enseña lo que guardó.
 */
export function MachineNote({ hosts, fleet }: { hosts: Host[]; fleet: Fleet }) {
  const theme = useTheme();
  const { reloadComputers } = useMachines();
  const lines: string[] = [];
  if (fleet === "license") lines.push(w("web.computers.license"));
  if (fleet === "error") lines.push(w("web.computers.error"));
  if (fleet === "ok" && !hosts.length) lines.push(w("web.computers.none"));
  for (const host of hosts) {
    if (host.power() === "starting") lines.push(w("shell.machines.waking", { name: host.label }));
    else if (host.power() === "outdated") lines.push(w("web.machines.outdated_action", { name: host.label }));
  }
  if (!lines.length) return null;
  return (
    <View style={[styles.note, { backgroundColor: theme.muted }]} testID="machine-note">
      {lines.map((line) => (
        <Text key={line} style={{ color: theme.textMuted, fontSize: 13 }}>
          {line}
        </Text>
      ))}
      {fleet === "error" ? (
        <Pressable onPress={() => void reloadComputers()}>
          <Text style={{ color: theme.primary, fontWeight: "600" }}>{w("web.computers.retry")}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  note: { marginHorizontal: 12, marginTop: 10, padding: 10, borderRadius: 10, gap: 4 },
});
