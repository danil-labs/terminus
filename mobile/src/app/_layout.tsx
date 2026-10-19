import type { NotificationResponse } from "expo-notifications";
import { Stack, router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { ConnectionProvider } from "../lib/connection";
import { Notifications } from "../lib/notifications";
import { t } from "../lib/i18n";
import { WorkspacesProvider } from "../lib/workspaces";
import { useTheme } from "../ui/theme";

Notifications?.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

type Target = { workspace?: string; folder?: string | null; task?: string };

function openTarget(response: NotificationResponse | null) {
  const target = response?.notification.request.content.data as Target | undefined;
  if (!target?.workspace || !target.folder || !target.task) return;
  router.push({ pathname: "/task/[workspace]/[folder]/[id]", params: { workspace: target.workspace, folder: target.folder, id: target.task } });
}

export default function RootLayout() {
  const theme = useTheme();

  useEffect(() => {
    if (!Notifications) return;
    openTarget(Notifications.getLastNotificationResponse());
    Notifications.clearLastNotificationResponse();
    const subscription = Notifications.addNotificationResponseReceivedListener(openTarget);
    return () => subscription.remove();
  }, []);

  return (
    <ConnectionProvider>
      <WorkspacesProvider>
        <StatusBar style="auto" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: theme.surface },
            headerTintColor: theme.text,
            contentStyle: { backgroundColor: theme.bg },
            headerBackButtonDisplayMode: "minimal",
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="workspaces"
            options={{ presentation: "formSheet", sheetAllowedDetents: [0.6, 0.95], sheetGrabberVisible: true, title: t("workspaces.title") }}
          />
        </Stack>
      </WorkspacesProvider>
    </ConnectionProvider>
  );
}
