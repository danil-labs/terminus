/** En el navegador no hay llavero: lo que se recuerda va en `localStorage`, como en la web de escritorio. */
export const store = {
  get: async (key: string) => localStorage.getItem(key),
  set: async (key: string, value: string) => localStorage.setItem(key, value),
  remove: async (key: string) => localStorage.removeItem(key),
};
