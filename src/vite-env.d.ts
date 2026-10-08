/**
 * Los tipos que Vite añade a `import.meta`.
 *
 * Hacía falta al llegar `lib/i18n.ts`: los catálogos se recogen con
 * `import.meta.glob`, y sin esta referencia `tsc` no conoce ni `glob` ni `env`.
 *
 * **El glob no es comodidad.** Con imports uno a uno, un archivo de catálogo
 * nuevo que nadie importara quedaría fuera del bundle mientras
 * `scripts/locales.mjs` —que lee el disco— lo daría por bueno: el guarda vería
 * la clave y la app no. Así los dos miran el mismo conjunto.
 */
/// <reference types="vite/client" />
