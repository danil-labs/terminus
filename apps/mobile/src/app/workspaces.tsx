import type { AttentionState } from "@terminus/protocol";
import { router } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHomeLabel } from "../lib/homeLabel";
import { t, w } from "../lib/i18n";
import { useMachines } from "../lib/machines";
import { can } from "../lib/pending";
import { useWorkspaces } from "../lib/workspaces";
import { Icon } from "../ui/Icon";
import { Group, GroupFooter, LargeTitle, ListRow, NavBar, pageColor, RoundButton } from "../ui/list";
import { useTheme } from "../ui/theme";
import { WorkspaceAvatar } from "../ui/WorkspaceAvatar";

const NEEDS_YOU = new Set<AttentionState>(["approving", "asked", "failed"]);

/** Crear y administrar workspaces desde el teléfono: no se ve mientras sus comandos no estén en la lista cerrada. */
const MANAGE = can("add_workspace") && can("rename_workspace");

/**
 * Cambiar de workspace, desde la ficha de Inicio: aparte del espacio, como la
 * columna de organizaciones del escritorio. Cada fila trae su ficha, en qué
 * máquinas corre (y si están apagadas) y lo que te necesita ahí. Abrirla no
 * enciende nada.
 */
export default function Workspaces() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const back = useHomeLabel();
  const { attention, hosts } = useMachines();
  const { list, current, select } = useWorkspaces();
  const hostOf = (id: string) => hosts.find((h) => h.id === id);

  return (
    <View style={{ flex: 1, backgroundColor: pageColor(theme) }}>
      <NavBar back={back} right={MANAGE ? <RoundButton icon="plus" label={w("settings.workspaces.manage")} onPress={() => router.push("/settings")} /> : null} />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
        <LargeTitle>{t("workspaces.title")}</LargeTitle>
        <Group inset={68}>
          {list.map((workspace) => {
            const pending = Object.entries(attention)
              .flatMap(([host, ws]) => ws.filter((x) => x.workspace === workspace.members.get(host)).flatMap((x) => x.tasks))
              .filter((task) => NEEDS_YOU.has(task.state)).length;
            const machines = workspace.hosts.map(hostOf).filter((h) => !!h);
            const asleep = machines.length > 0 && machines.every((h) => h.power() !== "on" && h.power() !== "starting");
            const subtitle = [...machines.map((h) => h.label), asleep ? w("web.computers.state.offline") : null].filter(Boolean).join(" · ");
            const chosen = workspace.id === current?.id;
            return (
              <ListRow
                key={workspace.id}
                testID={`workspace-${workspace.id}`}
                left={<WorkspaceAvatar id={workspace.id} name={workspace.name} size={36} />}
                title={workspace.name}
                subtitle={subtitle || undefined}
                right={
                  <View style={styles.right}>
                    {pending ? <View style={[styles.count, { backgroundColor: theme.muted }]}><Text style={{ color: theme.text, fontSize: 12, fontWeight: "600" }}>{pending}</Text></View> : null}
                    {chosen ? <Icon name="check" size={18} color={theme.merged} /> : <View style={{ width: 18 }} />}
                  </View>
                }
                accessibilityLabel={`${workspace.name}${pending ? `, ${pending}` : ""}`}
                onPress={() => {
                  select(workspace.id);
                  router.back();
                }}
              />
            );
          })}
        </Group>
        {list.length ? <GroupFooter>{t("workspaces.count_note")}</GroupFooter> : null}
        {MANAGE ? (
          <>
            <View style={{ height: 20 }} />
            <Group>
              <ListRow testID="manage-workspaces" title={w("settings.workspaces.manage")} chevron onPress={() => router.push("/settings")} />
            </Group>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  right: { flexDirection: "row", alignItems: "center", gap: 10 },
  count: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, alignItems: "center", justifyContent: "center" },
});
