import * as SecureStore from "expo-secure-store";
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

/** El camino del bridge se ofrece en desarrollo, o con `EXPO_PUBLIC_TERMINUS_BRIDGE=1`. */
export const BRIDGE_ENABLED = __DEV__ || process.env.EXPO_PUBLIC_TERMINUS_BRIDGE === "1";
