/**
 * La sesión de la cuenta de Danil (Supabase de api.danil.ai). Lo único que el
 * teléfono guarda de la cuenta es esa sesión, en el llavero (`expo-secure-store`).
 * Las direcciones y la llave publicable son públicas; se pueden cambiar con
 * `EXPO_PUBLIC_*` para probar contra un plano de control falso.
 */
import { createClient } from "@supabase/supabase-js";
import type * as CryptoModule from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { AppState } from "react-native";
import { COMPUTERS_ENDPOINT } from "@terminus/computers";

export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || "https://api.danil.ai";
export const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_KEY || "sb_publishable_IGLsyHHpmaXsHFAeSQg9kA_CoCLCyEd";
export const COMPUTERS = process.env.EXPO_PUBLIC_COMPUTERS_ENDPOINT || COMPUTERS_ENDPOINT;

/**
 * `expo-crypto`, o null donde su módulo nativo no viene: Expo Go en Android no
 * lo trae y al importarlo truena antes de pintar nada. Una build propia sí.
 */
function loadCrypto(): typeof CryptoModule | null {
  try {
    return require("expo-crypto") as typeof CryptoModule;
  } catch {
    return null;
  }
}
const Crypto = loadCrypto();

/*
 * PKCE con S256 necesita WebCrypto; Hermes no lo trae. Sin esto supabase-js
 * caería a `plain` con un verificador de Math.random: es lo que pasa en Expo Go
 * en Android, donde solo afecta entrar con Google o Microsoft.
 */
const g = globalThis as unknown as { crypto?: Record<string, unknown> };
g.crypto ??= {};
if (Crypto && typeof g.crypto.getRandomValues !== "function") {
  g.crypto.getRandomValues = <T extends ArrayBufferView>(array: T) => Crypto.getRandomValues(array as never) as T;
}
if (Crypto && typeof g.crypto.randomUUID !== "function") g.crypto.randomUUID = () => Crypto.randomUUID();
if (Crypto && !g.crypto.subtle) {
  g.crypto.subtle = {
    digest: (algorithm: string | { name: string }, data: BufferSource) => {
      const name = typeof algorithm === "string" ? algorithm : algorithm.name;
      if (name.toUpperCase() !== "SHA-256") throw new Error(`digest ${name} not supported`);
      return Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, data);
    },
  };
}

/**
 * El llavero de iOS avisa con valores grandes y una sesión de Supabase pasa de
 * 2 KB: se guarda en trozos, con su cuenta en la clave base.
 */
const CHUNK = 1800;
const secureStorage = {
  async getItem(key: string) {
    const count = Number(await SecureStore.getItemAsync(key));
    if (!count) return null;
    const parts = await Promise.all(Array.from({ length: count }, (_, i) => SecureStore.getItemAsync(`${key}.${i}`)));
    return parts.some((p) => p === null) ? null : parts.join("");
  },
  async setItem(key: string, value: string) {
    const old = Number(await SecureStore.getItemAsync(key)) || 0;
    const parts = value.match(new RegExp(`[\\s\\S]{1,${CHUNK}}`, "g")) ?? [""];
    for (let i = 0; i < parts.length; i++) await SecureStore.setItemAsync(`${key}.${i}`, parts[i]);
    for (let i = parts.length; i < old; i++) await SecureStore.deleteItemAsync(`${key}.${i}`);
    await SecureStore.setItemAsync(key, String(parts.length));
  },
  async removeItem(key: string) {
    const count = Number(await SecureStore.getItemAsync(key)) || 0;
    for (let i = 0; i < count; i++) await SecureStore.deleteItemAsync(`${key}.${i}`);
    await SecureStore.deleteItemAsync(key);
  },
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    storage: secureStorage,
    storageKey: "terminus.danil-session",
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: "pkce",
  },
});

// Refrescar solo con la app al frente: en segundo plano el temporizador no corre bien.
AppState.addEventListener("change", (state) => {
  if (state === "active") void supabase.auth.startAutoRefresh();
  else void supabase.auth.stopAutoRefresh();
});
