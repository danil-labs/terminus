import { ALPHA_DEMO, alphaMemory } from "./alpha-mode";
/** En el navegador no hay llavero: lo que se recuerda va en `localStorage`, como en la web de escritorio. */
export const store = {
  get: async (key: string) => ALPHA_DEMO ? alphaMemory.get(key) ?? null : localStorage.getItem(key),
  set: async (key: string, value: string) => ALPHA_DEMO ? void alphaMemory.set(key, value) : localStorage.setItem(key, value),
  remove: async (key: string) => ALPHA_DEMO ? void alphaMemory.delete(key) : localStorage.removeItem(key),
};
