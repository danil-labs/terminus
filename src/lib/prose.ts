/**
 * La prosa que manda el backend: una clave y sus datos, traducida aquí.
 *
 * El texto de interfaz se traduce donde se pinta: la lengua es del workspace
 * (`workspaces::Workspace::lengua`) y se resuelve en `lib/i18n.ts`, así que una
 * cadena escrita en Rust llegaría a la pantalla en español pase lo que pase con
 * el selector de idioma. Los datos —un repo, una rama, una ruta, la salida de
 * `git`— siguen viajando como texto: no hay nada que traducir en ellos.
 *
 * `Prosa` es `string | Frase` porque la migración va módulo por módulo
 * (`util::Prosa` es el mismo tipo con `serde(untagged)`): una cadena es un
 * módulo sin migrar y se pinta tal cual. Cuando no quede ninguna, `Cruda` se
 * borra en Rust —rompe la compilación en cada sitio que quede— y esta unión se
 * colapsa a `Frase`.
 *
 * Una clave desconocida no puede pasar dentro de un build: catálogo y backend
 * viajan en el mismo binario y `scripts/locales.mjs` falla `pnpm verificar` si
 * Rust pide una clave que `es` no define; a un paquete de terceros incompleto
 * lo cubre la cascada de `t()`, que cae a `es`. Con el guarda apagado se pinta
 * la clave —`mcp.error.no_binary`—, feo a propósito: se reporta y se busca con
 * `grep`. En DEV, `t()` avisa por consola.
 */
// Con extensión: estos módulos se cargan también desde `node --test`, que no
// tiene el resolvedor de Vite (`SYSTEM.md` § De dónde sale cada frase).
import { t } from "./i18n.ts";

/** Lo que manda un backend ya migrado. Espeja `util::Frase`. */
export type Frase = {
  clave: string;
  /**
   * Lo que se interpola en `{nombre}`. Los números llegan **como números**
   * porque `t()` elige la forma del plural con `Intl.PluralRules` sobre
   * `count`; un `"3"` funciona por `Number()` y un `"3 archivos"` no, sin dar
   * error.
   */
  datos?: Record<string, string | number>;
};

/** Una clave que se traduce, o prosa cruda de un módulo sin migrar. */
export type Prosa = string | Frase;

export function prosa(p: Prosa): string {
  return typeof p === "string" ? p : t(p.clave, p.datos);
}
