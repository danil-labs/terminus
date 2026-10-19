import { Redirect } from "expo-router";
import { NativeTabs } from "expo-router/native-tabs";
import { useAccount } from "../../lib/account";
import { useMachines } from "../../lib/machines";
import { t } from "../../lib/i18n";
import { useTheme } from "../../ui/theme";

const NEEDS_YOU = new Set(["approving", "asked", "failed"]);

/**
 * The system tab bar: Liquid Glass on iOS 26, Material 3 on Android. Two places
 * and "Nueva" apart, like t3code; `role="search"` is what detaches it on iOS.
 */
export default function TabsLayout() {
  const theme = useTheme();
  const { session } = useAccount();
  const { ready, pairing, attention } = useMachines();
  if (!ready) return null;
  // La cuenta de Danil va primero: un bridge guardado de antes no la salta. Solo
  // el lab sin cuenta entra por el bridge, y lo pide a propósito.
  const bridgeOnly = !!pairing && process.env.EXPO_PUBLIC_TERMINUS_BRIDGE_ONLY === "1";
  if (!session && !bridgeOnly) return <Redirect href="/signin" />;
  const pending = Object.values(attention)
    .flat()
    .flatMap((w) => w.tasks)
    .filter((task) => NEEDS_YOU.has(task.state)).length;
  return (
    <NativeTabs tintColor={theme.primary} minimizeBehavior="onScrollDown">
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>{t("tabs.tasks")}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "list.bullet", selected: "list.bullet" }} md="list" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="notifications">
        <NativeTabs.Trigger.Label>{t("tabs.notifications")}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "bell", selected: "bell.fill" }} md="notifications" />
        {pending ? <NativeTabs.Trigger.Badge>{String(pending)}</NativeTabs.Trigger.Badge> : null}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="new" role="search">
        <NativeTabs.Trigger.Label>{t("tabs.new")}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="square.and.pencil" md="edit_square" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
