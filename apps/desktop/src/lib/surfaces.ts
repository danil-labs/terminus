/**
 * Lo que se puede elegir para trabajar, del lado del front. Espeja
 * `src-tauri/src/runtime/surfaces.rs`: una fila de agente puede dar más de una
 * superficie, así que el menú del chat y el riel de Configuración iteran esta
 * lista y no `list_agents`. Quién filtra qué es de cada pantalla — el chat
 * enseña lo utilizable, Configuración lo enseña todo.
 */
// Con extensión: este módulo se carga también desde `node --test`, que no tiene
// el resolvedor de Vite (`SYSTEM.md` § De dónde sale cada frase).
import { t } from "./i18n.ts";
import type { ModelOption } from "./model";
import type { Frase } from "./prose";

/** Un renglón elegible. Espeja `surfaces::Superficie`. */
export type Superficie = {
  id: string;
  /** La fila que la sirve. **Es lo que viaja a `send_message` y lo que la sesión guarda.** */
  agent: string;
  label: string;
  /** Qué mitad del catálogo de su agente ofrece. */
  catalogo: "todo" | "de_pago" | "gratuitos";
  /** Si se puede correr un turno por aquí ahora mismo. */
  usable: boolean;
  /** Qué le falta, en dos palabras. */
  marca: string | null;
  /** La frase entera: qué pasa y dónde se arregla. `null` si es usable o
   *  cuando lo que falta ya lo dice su botón. */
  porque: Frase | null;
};

// Un sufijo -free no garantiza gratuidad; el filtro usa el dato del catálogo.
// null significa que la distinción no aplica a esa superficie.
export function esDe(s: Superficie | undefined, m: ModelOption): boolean {
  if (!s || s.catalogo === "todo") return true;
  return s.catalogo === "gratuitos" ? m.gratis === true : m.gratis !== true;
}

/**
 * Lo que el menú del chat ofrece: lo utilizable, más aquello con lo que corre
 * la tarea abierta. Lo sin autenticar no sale — ni en gris. La superficie de la
 * tarea abierta se queda aunque no sea usable: si desapareciera, el selector
 * caería solo en otra y la tarea seguiría con un agente que no es el suyo, sin
 * que nada lo dijera.
 */
export function paraElMenu(
  todas: Superficie[],
  actual: string | undefined,
): Superficie[] {
  return todas.filter((s) => s.usable || s.id === actual);
}

/**
 * Con qué superficie se está trabajando, derivada y nunca guardada: la tarea
 * persiste agente y modelo (`workspace/sessions.rs`), y cuál mitad enseñar lo dice el
 * modelo con el que corrió.
 *
 * El orden de preferencia:
 *
 * 1. La que ya estaba, si sigue sirviendo a este agente y a este modelo. Sin
 *    esto, cargar el catálogo movería el selector debajo de quien acaba de
 *    elegir.
 * 2. La del agente cuyo catálogo contiene el modelo guardado — una tarea de un
 *    modelo gratuito abre en «Modelos Free».
 * 3. La primera usable de ese agente — la tarea sin modelo todavía.
 * 4. La primera de ese agente aunque no sea usable: la tarea viva con un agente
 *    desconectado se enseña en vez de cambiarla de agente sin decirlo.
 */
export function superficieDe(
  todas: Superficie[],
  agent: string,
  model: string,
  catalogo: ModelOption[],
  actual: string | undefined,
): string | undefined {
  const suyas = todas.filter((s) => s.agent === agent);
  if (suyas.length === 0) return undefined;

  const elegido = catalogo.find((m) => m.id === model);
  const sirve = (s: Superficie) => !elegido || esDe(s, elegido);

  const previa = suyas.find((s) => s.id === actual);
  if (previa && sirve(previa)) return previa.id;

  return (
    suyas.find((s) => s.usable && sirve(s))?.id ??
    suyas.find((s) => sirve(s))?.id ??
    suyas.find((s) => s.usable)?.id ??
    suyas[0].id
  );
}

/**
 * El rótulo de una superficie, traducido cuando el nombre es nuestro: «Claude
 * Code» o «Codex» son nombres propios y van igual en toda lengua; «Modelos
 * Free» y «Locales» son nuestros y sin esto salen en la lengua de Rust.
 *
 * Se distingue por identificador y no por el rótulo: `catalogo` y `agent`
 * cruzan la frontera entre procesos y no cambian con la lengua; comparar contra
 * la cadena «Modelos Free» ataría esto a esa mayúscula en Rust.
 */
export function rotuloDeSuperficie(s: Superficie): string {
  if (s.catalogo === "gratuitos") return t("surfaces.label.free");
  if (s.agent === "opencode-local") return t("surfaces.label.local");
  return s.label;
}
