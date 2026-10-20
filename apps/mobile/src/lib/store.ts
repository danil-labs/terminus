import * as SecureStore from "expo-secure-store";

/** Lo que el teléfono recuerda entre aperturas, en el llavero. En el navegador, `store.web.ts`. */
export const store = {
  get: (key: string) => SecureStore.getItemAsync(key),
  set: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  remove: (key: string) => SecureStore.deleteItemAsync(key),
};
