import { Redirect, Stack } from "expo-router";
import { Platform } from "react-native";
import { useAccount } from "../../lib/account";
import { useMachines } from "../../lib/machines";
import { t } from "../../lib/i18n";
import { useTheme } from "../../ui/theme";

/**
 * Sin barra de pestañas: Tareas es la pantalla de entrada y, arriba a la
 * derecha, «Nueva tarea» y Notificaciones se abren encima con su botón de volver.
 */
export default function HomeLayout() {
  const theme = useTheme();
  const { session } = useAccount();
  const { ready, pairing } = useMachines();
  if (!ready) return null;
  // La cuenta de Danil va primero: un bridge guardado de antes no la salta. En iOS
  // siempre se pide; en Android el lab sin cuenta entra por el bridge a propósito.
  const bridgeOnly = Platform.OS !== "ios" && !!pairing && process.env.EXPO_PUBLIC_TERMINUS_BRIDGE_ONLY === "1";
  if (!session && !bridgeOnly) return <Redirect href="/signin" />;
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.surface },
        headerTintColor: theme.text,
        contentStyle: { backgroundColor: theme.bg },
        headerBackButtonDisplayMode: "minimal",
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="new" options={{ title: t("new.title") }} />
      <Stack.Screen name="notifications" options={{ title: t("tabs.notifications") }} />
    </Stack>
  );
}
