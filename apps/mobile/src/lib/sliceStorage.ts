import type { StorageLike } from "@terminus/fleet";
import { store } from "./store";

const KEY = "terminus.fleet.slices";

/**
 * Donde la flota guarda la última rebanada de cada máquina. La flota lee y
 * escribe síncrono y el teléfono guarda asíncrono: se carga una vez antes de
 * crearla y cada escritura se manda detrás.
 */
export async function sliceStorage(): Promise<StorageLike> {
  const saved = await store.get(KEY).catch(() => null);
  const memory = new Map<string, string>();
  return {
    getItem: (key) => (memory.has(key) ? (memory.get(key) as string) : saved),
    setItem: (_key, value) => {
      memory.set(_key, value);
      void store.set(KEY, value).catch(() => {});
    },
    removeItem: (key) => {
      memory.delete(key);
      void store.remove(KEY).catch(() => {});
    },
  };
}
