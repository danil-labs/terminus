import { router } from "expo-router";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { MOBILE_WEB_DIR, WEB_LAYOUT_KEY } from "@terminus/design";
import type { AttentionState } from "@terminus/protocol";
import { useAccount } from "../lib/account";
import { BRIDGE_ENABLED } from "../lib/bridge";
import type { Host } from "../lib/hosts";
import { t, w } from "../lib/i18n";
import { useMachines } from "../lib/machines";
import { useWorkspaces } from "../lib/workspaces";
import { Avatar, Badge, Dot, Row, SectionTitle, SheetTitle } from "../ui/components";
import { TaskMark, type TaskState, topState } from "../ui/TaskStatus";
import { Icon } from "../ui/Icon";
import { useTheme } from "../ui/theme";

const NEEDS_YOU = new Set<AttentionState>(["approving", "asked", "failed"]);

/**
 * La raíz de la web de escritorio: la que fijó la compilación
 * (`EXPO_PUBLIC_TERMINUS_WEB_BASE`, `web-mobile.mjs`); sin ella, lo que hay
 * antes de `/m` en la ruta, con o sin barra final.
 */
function desktopBase(): string {
  const built = process.env.EXPO_PUBLIC_TERMINUS_WEB_BASE?.trim();
  if (built) return built.endsWith("/") ? built : `${built}/`;
  const path = window.location.pathname;
  const at = path.search(new RegExp(`/${MOBILE_WEB_DIR}(/|$)`));
  return at >= 0 ? `${path.slice(0, at)}/` : "/";
}

/**
 * La columna de workspaces del escritorio, como hoja: cada workspace con lo que
 * espera en él, las máquinas de la persona con su estado (encendida, apagada,
 * encendiéndose: nunca un error), la cuenta y la conexión de desarrollo.
 * Abrir esta hoja no enciende nada.
 */
export default function WorkspaceSwitcher() {
  const theme = useTheme();
  const { email, signOut, session } = useAccount();
  const { attention, hosts, pairing, pair, registry } = useMachines();
  const { list, current, select } = useWorkspaces();
  const several = hosts.length > 1;
  const labelOf = (id: string) => hosts.find((h) => h.id === id)?.label ?? id;
  const power = (host: Host) =>
    host.power() === "on" ? w("web.computers.state.online") : host.power() === "starting" ? w("web.computers.state.starting") : host.power() === "outdated" ? w("web.computers.state.outdated") : w("web.computers.state.offline");
  const dot = (host: Host) => (host.power() === "on" ? theme.success : host.power() === "starting" ? theme.info : theme.border);

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingVertical: 8 }}>
      <SheetTitle>{t("workspaces.title")}</SheetTitle>
      {list.map((workspace) => {
        const tasks = Object.entries(attention).flatMap(([host, ws]) => ws.filter((x) => x.workspace === workspace.members.get(host)).flatMap((x) => x.tasks));
        const pending = tasks.filter((task) => NEEDS_YOU.has(task.state)).length;
        const folded = topState(tasks.map((task) => task.state as TaskState));
        return (
          <Row
            key={workspace.id}
            testID={`workspace-${workspace.id}`}
            left={<Avatar name={workspace.name} size={40} />}
            title={workspace.name}
            bold={workspace.id === current?.id}
            right={pending ? <Badge count={pending} /> : <TaskMark state={folded} />}
            subtitle={several ? workspace.hosts.map(labelOf).join(" · ") : undefined}
            onPress={() => {
              select(workspace.id);
              router.back();
            }}
          />
        );
      })}

      {session && registry?.length ? (
        <>
          <SectionTitle>{t("memory.title")}</SectionTitle>
          {registry.map((workspace) => (
            <Row
              key={workspace.id}
              testID={`memory-${workspace.id}`}
              left={<Icon name="brain" size={20} color={theme.textMuted} />}
              title={t("memory.open", { name: workspace.name })}
              subtitle={t("memory.subtitle")}
              right={<Icon name="chevron-right" size={16} color={theme.textMuted} />}
              onPress={() => {
                router.back();
                router.push({ pathname: "/memory/[workspace]", params: { workspace: workspace.id } });
              }}
            />
          ))}
        </>
      ) : null}

      <SectionTitle>{t("machines.title")}</SectionTitle>
      {hosts.map((host) => (
        <Row
          key={host.id}
          testID={`machine-${host.id}`}
          left={<Dot color={dot(host)} />}
          title={host.label}
          subtitle={`${power(host)} · ${host.kind === "bridge" ? t("signin.dev_bridge") : host.managed ? t("machines.managed") : t("machines.own")}`}
        />
      ))}
      {hosts.length ? (
        <Row
          testID="open-accounts"
          left={<Icon name="key-round" size={20} color={theme.textMuted} />}
          title={w("settings.nav.ai_providers")}
          subtitle={t("accounts.subtitle")}
          right={<Icon name="chevron-right" size={16} color={theme.textMuted} />}
          onPress={() => {
            router.back();
            router.push("/accounts");
          }}
        />
      ) : null}

      {session ? (
        <>
          <SectionTitle>{t("account.title")}</SectionTitle>
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={{ color: theme.text, fontWeight: "600" }}>{email}</Text>
          </View>
          <Pressable
            testID="sign-out"
            style={[styles.button, { borderColor: theme.failedMark }]}
            onPress={() => {
              router.back();
              void signOut();
            }}
          >
            <Text style={{ color: theme.failedMark, fontWeight: "600" }}>{t("account.sign_out")}</Text>
          </Pressable>
        </>
      ) : (
        <Pressable testID="sign-in" style={[styles.button, { borderColor: theme.primary }]} onPress={() => router.push("/signin")}>
          <Text style={{ color: theme.primary, fontWeight: "600" }}>{t("signin.title")}</Text>
        </Pressable>
      )}

      {Platform.OS === "web" ? (
        <Pressable
          testID="desktop-layout"
          style={[styles.button, { borderColor: theme.border }]}
          onPress={() => {
            localStorage.setItem(WEB_LAYOUT_KEY, "desktop");
            window.location.assign(desktopBase());
          }}
        >
          <Text style={{ color: theme.text }}>{t("web.desktop_layout")}</Text>
        </Pressable>
      ) : null}

      {BRIDGE_ENABLED ? (
        <>
          <SectionTitle>{t("you.connection")}</SectionTitle>
          {pairing ? (
            <>
              <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <Text style={{ color: theme.text, fontWeight: "600" }}>{pairing.url}</Text>
              </View>
              <Pressable
                testID="disconnect"
                style={[styles.button, { borderColor: theme.border }]}
                onPress={() => {
                  router.back();
                  void pair(null);
                }}
              >
                <Text style={{ color: theme.text, fontWeight: "600" }}>{t("home.disconnect")}</Text>
              </Pressable>
            </>
          ) : (
            <Pressable testID="connect-bridge" style={[styles.button, { borderColor: theme.border }]} onPress={() => router.push("/pair")}>
              <Text style={{ color: theme.text }}>{t("signin.dev_bridge")}</Text>
            </Pressable>
          )}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 12, padding: 14, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, gap: 4 },
  button: { margin: 12, padding: 12, borderRadius: 10, borderWidth: 1, alignItems: "center" },
});
