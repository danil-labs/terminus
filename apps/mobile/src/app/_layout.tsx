import type { NotificationResponse } from "expo-notifications";
import { Stack, router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { AccountProvider } from "../lib/account";
import { MachinesProvider } from "../lib/machines";
import { Notifications } from "../lib/notifications";
import { t, w } from "../lib/i18n";
import { pinToVisibleArea } from "../lib/viewport";
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

// Cierra la ventana del navegador del inicio de sesión si vuelve aquí (solo hace algo en web).
WebBrowser.maybeCompleteAuthSession();

type Target = { host?: string; workspace?: string; folder?: string | null; task?: string };

function openTarget(response: NotificationResponse | null) {
  const target = response?.notification.request.content.data as Target | undefined;
  if (!target?.host || !target.workspace || !target.task) return;
  router.push({
    pathname: "/task/[host]/[workspace]/[folder]/[id]",
    params: { host: target.host, workspace: target.workspace, folder: target.folder || "_", id: target.task },
  });
}

export default function RootLayout() {
  const theme = useTheme();

  // En el navegador, una ruta del teléfono que abrió la web de escritorio llega como `?to=` (ver `toPhone` en `apps/desktop/src/web/main.tsx`).
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const to = new URLSearchParams(window.location.search).get("to");
    if (to?.startsWith("/") && !to.startsWith("//")) router.replace(to as never);
  }, []);

  // En el navegador el teclado no achica la página: sin esto se lleva la barra de arriba.
  useEffect(pinToVisibleArea, []);

  useEffect(() => {
    if (!Notifications) return;
    openTarget(Notifications.getLastNotificationResponse());
    Notifications.clearLastNotificationResponse();
    const subscription = Notifications.addNotificationResponseReceivedListener(openTarget);
    return () => subscription.remove();
  }, []);

  return (
    <AccountProvider>
    <MachinesProvider>
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
          <Stack.Screen name="(home)" options={{ headerShown: false }} />
          <Stack.Screen
            name="workspaces"
            options={{ presentation: "formSheet", sheetAllowedDetents: [0.6, 0.95], sheetGrabberVisible: true, title: t("workspaces.title") }}
          />
          <Stack.Screen
            name="filter"
            options={{ presentation: "formSheet", sheetAllowedDetents: [0.6, 0.95], sheetGrabberVisible: true, title: w("shell.sidebar.view.trigger") }}
          />
          <Stack.Screen
            name="agents"
            options={{ presentation: "formSheet", sheetAllowedDetents: [0.5, 0.95], sheetGrabberVisible: true, title: w("shell.agent_dock.title") }}
          />
          <Stack.Screen
            name="preview"
            options={Platform.OS === "web" ? { presentation: "transparentModal", headerShown: false, contentStyle: { backgroundColor: "transparent" }, animation: "none" } : { presentation: "formSheet", sheetAllowedDetents: "fitToContents", sheetGrabberVisible: true, headerShown: false, sheetCornerRadius: 18 }}
          />
          <Stack.Screen name="accounts" options={{ title: w("settings.nav.ai_providers") }} />
          <Stack.Screen name="signin" options={{ headerShown: false }} />
          <Stack.Screen name="auth/callback" options={{ headerShown: false }} />
        </Stack>
      </WorkspacesProvider>
    </MachinesProvider>
    </AccountProvider>
  );
}
