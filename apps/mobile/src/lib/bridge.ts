import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import type { Pairing } from "./hosts";

/**
 * El emparejamiento con el bridge de desarrollo (un Terminus de la red local).
 * Es un camino secundario: el principal son las máquinas de Danil Computers.
 */
const KEY = "terminus.pairing";

export async function loadPairing(): Promise<Pairing | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  return raw ? (JSON.parse(raw) as Pairing) : null;
}

export async function savePairing(pairing: Pairing | null) {
  if (pairing) await SecureStore.setItemAsync(KEY, JSON.stringify(pairing));
  else await SecureStore.deleteItemAsync(KEY);
}

/** El camino del bridge solo existe en desarrollo: una build de verdad sincroniza con la cuenta de Danil. */
export const BRIDGE_ENABLED = __DEV__;

/**
 * El lab sin cuenta: en desarrollo, en Android y con
 * `EXPO_PUBLIC_TERMINUS_BRIDGE_ONLY=1`, el bridge sincroniza sin sesión de Danil.
 * En cualquier otro caso, sin sesión no se sincroniza nada.
 */
export const BRIDGE_WITHOUT_ACCOUNT = BRIDGE_ENABLED && Platform.OS !== "ios" && process.env.EXPO_PUBLIC_TERMINUS_BRIDGE_ONLY === "1";
