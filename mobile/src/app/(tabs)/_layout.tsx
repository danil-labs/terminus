import { Redirect } from "expo-router";
import { NativeTabs } from "expo-router/native-tabs";
import { useConnection } from "../../lib/connection";
import { t } from "../../lib/i18n";
import { useTheme } from "../../ui/theme";

const NEEDS_YOU = new Set(["approving", "asked", "failed"]);

/**
 * The system tab bar: Liquid Glass on iOS 26, Material 3 on Android. Two places
 * and "Nueva" apart, like t3code; `role="search"` is what detaches it on iOS.
 */
export default function TabsLayout() {
  const theme = useTheme();
  const { ready, pairing, attention } = useConnection();
  if (!ready) return null;
  if (!pairing) return <Redirect href="/pair" />;
  const pending = attention.flatMap((w) => w.tasks).filter((task) => NEEDS_YOU.has(task.state)).length;
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
