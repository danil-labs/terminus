import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { Host } from "../lib/hosts";
import { w } from "../lib/i18n";
import { type Fleet, useMachines } from "../lib/machines";
import { useTheme } from "./theme";

/** El cobro vive en la web de Danil, mismo origen que `/terminus/m/`. */
const BILLING_PATH = "/modules/billing?modulo=terminus";

/**
 * Lo que la persona tiene que saber de sus máquinas, siempre en tono neutro:
 * una máquina apagada no es un error. Encendiéndose, se dice; apagada, no se
 * dice nada: la lista de tareas ya enseña lo que guardó.
 */
export function MachineNote({ hosts, fleet }: { hosts: Host[]; fleet: Fleet }) {
  const theme = useTheme();
  const { reloadComputers } = useMachines();
  if (fleet === "license") return <LicenseNote />;
  const lines: string[] = [];
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

/**
 * Sin licencia. Solo la web ofrece la prueba: la app nativa no enseña precios
 * ni lleva al cobro, nada más pide activarlo y deja reintentar.
 */
function LicenseNote() {
  const theme = useTheme();
  const { retryLicense } = useMachines();
  const web = Platform.OS === "web";
  return (
    <View style={[styles.note, { backgroundColor: theme.muted }]} testID="machine-note-license">
      <Text style={{ color: theme.text, fontSize: 15, fontWeight: "600" }}>{w("danil.license.title")}</Text>
      {web ? (
        <>
          <Text style={{ color: theme.textMuted, fontSize: 13 }}>{w("danil.license.body")}</Text>
          <Pressable
            testID="license-start"
            style={[styles.cta, { backgroundColor: theme.primary }]}
            onPress={() => window.location.assign(BILLING_PATH)}
          >
            <Text style={{ color: theme.onPrimary, fontWeight: "600" }}>{w("danil.license.start")}</Text>
          </Pressable>
        </>
      ) : null}
      <Pressable testID="license-retry" onPress={retryLicense}>
        <Text style={{ color: theme.primary, fontWeight: "600" }}>{web ? w("danil.license.retry") : w("web.computers.retry")}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  note: { marginHorizontal: 12, marginTop: 10, padding: 10, borderRadius: 10, gap: 4 },
  cta: { alignSelf: "flex-start", marginVertical: 4, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
});
