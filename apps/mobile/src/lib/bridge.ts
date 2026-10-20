import { Platform } from "react-native";
import { store } from "./store";
import type { Pairing } from "./hosts";

/**
 * El emparejamiento con el bridge de desarrollo (un Terminus de la red local).
 * Es un camino secundario: el principal son las máquinas de Danil Computers.
 */
const KEY = "terminus.pairing";

export async function loadPairing(): Promise<Pairing | null> {
  const raw = await store.get(KEY);
  return raw ? (JSON.parse(raw) as Pairing) : null;
}

export async function savePairing(pairing: Pairing | null) {
  if (pairing) await store.set(KEY, JSON.stringify(pairing));
  else await store.remove(KEY);
}

/** El camino del bridge se ofrece en desarrollo, o con `EXPO_PUBLIC_TERMINUS_BRIDGE=1`. */
// En el navegador no hay bridge: la web solo habla por el relay con la sesión de la app de Danil.
export const BRIDGE_ENABLED = Platform.OS !== "web" && (__DEV__ || process.env.EXPO_PUBLIC_TERMINUS_BRIDGE === "1");
