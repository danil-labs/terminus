import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Host } from "../lib/hosts";
import { t, w } from "../lib/i18n";
import { type Fleet, useMachines } from "../lib/machines";
import { useTheme } from "./theme";

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * Lo que la persona tiene que saber de sus máquinas, siempre en tono neutro:
 * una máquina apagada no es un error. Encendiéndose, se dice; apagada con
 * copia, de cuándo es lo que se ve.
 */
export function MachineNote({ hosts, fleet, cachedAt }: { hosts: Host[]; fleet: Fleet; cachedAt: number | null }) {
  const theme = useTheme();
  const { reloadComputers } = useMachines();
  const lines: string[] = [];
  if (fleet === "license") lines.push(w("web.computers.license"));
  if (fleet === "error") lines.push(w("web.computers.error"));
  if (fleet === "ok" && !hosts.length) lines.push(w("web.computers.none"));
  for (const host of hosts) {
    if (host.power() === "starting") lines.push(w("shell.machines.waking", { name: host.label }));
    else if (host.power() === "outdated") lines.push(w("web.machines.outdated_action", { name: host.label }));
    else if (host.power() === "off" && host.kind === "computer") {
      lines.push(
        cachedAt !== null
          ? t("machines.cached", { name: host.label, time: time(cachedAt) })
          : host.managed
            ? w("shell.machines.asleep_notice", { name: host.label })
            : w("web.machines.off_action", { name: host.label }),
      );
    }
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
