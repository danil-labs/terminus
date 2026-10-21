import { Redirect, Stack } from "expo-router";
import { useAccount } from "../../lib/account";
import { BRIDGE_WITHOUT_ACCOUNT } from "../../lib/bridge";
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
  // La cuenta de Danil va primero: un bridge guardado de antes no la salta. Solo el
  // lab sin cuenta (desarrollo, Android) entra por el bridge a propósito.
  const bridgeOnly = BRIDGE_WITHOUT_ACCOUNT && !!pairing;
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
