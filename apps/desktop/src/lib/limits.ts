/**
 * Cuánto le queda a una cuenta — espejo de `src-tauri/src/limites.rs`.
 *
 * **No es `usage.ts`, y confundirlos arruina los dos.** Aquel mide los tokens
 * que gastó cada turno, con registro propio; este pregunta cuánto queda del
 * plan, y la respuesta la tiene el proveedor. Se llaman distinto en pantalla a
 * propósito: uno es **consumo**, este es **lo que te queda**.
 *
 * Vive aparte de quien lo pinta porque lo miran dos superficies —la barra de
 * abajo y la ficha de cada cuenta en la configuración— y el contrato con Rust
 * tiene que ser uno solo. Dos copias del mismo tipo discriminado es dos sitios
 * donde alguien puede aflojarlo.
 *
 * **Las frases salen del catálogo y no de aquí.** Cada una se resuelve dentro de
 * su función, en el momento de pintar: una constante de módulo se congelaría con
 * la lengua que hubiera al importarse, y cambiar de idioma sin recargar dejaría
 * estas fechas en español debajo de una interfaz en otra lengua, **sin error**
 * (`lib/format.ts` lo cuenta para los números).
 */
import { t } from "./i18n.ts";

/** Una ventana de límite, ya normalizada por Rust. */
export type Window = {
  /** Cómo se llama la ventana en la app: «esta semana», «últimas 5 horas». */
  label: string;
  used_pct: number;
  /** ms epoch. `null` cuando el proveedor no lo dice — no es «ahora». */
  resets_at: number | null;
  /** Segundos del intervalo. Ausente en un caché anterior a este campo. */
  duration_s?: number | null;
  /** Modelo o familia si la bolsa no es la general. */
  scope?: string | null;
};

/**
 * Los cinco modos, como los manda Rust.
 *
 * Son un tipo discriminado y no un objeto con campos opcionales **a propósito**:
 * con `used_pct?: number` la pantalla podría escribir `?? 0` y enseñar un cero
 * cuando en realidad no se supo leer, que es peor que no enseñar nada.
 *
 * `revoked` es su propio modo por lo mismo: es el único fallo que la persona
 * puede arreglar, y la pantalla tiene que ofrecerle el gesto **sin leer la prosa
 * para adivinar de cuál se trata**.
 */
export type Query =
  | { mode: "no_account"; what: string }
  | { mode: "revoked"; what: string; detail: string }
  | { mode: "failed"; what: string; detail: string }
  | { mode: "in_use" }
  // `last`: la última lectura buena, para que la espera no tape el número.
  | {
      mode: "waiting";
      retry_at: number;
      detail: string;
      last?: { windows: Window[]; plan: string | null; fetched_at: number } | null;
    }
  | { mode: "read"; windows: Window[]; plan: string | null; fetched_at: number };

/** Lo que dice que la credencial ya no vale, venga de donde venga. */
export function revocada(q: Query | undefined): boolean {
  return q?.mode === "revoked";
}

/** Lo leído, para cuando ya se sabe que se leyó. */
export type Read = Extract<Query, { mode: "read" }>;

/** Lo que se puede pintar: lo leído, o la última lectura buena que trae una espera. */
export function legible(q: Query | undefined): Read | undefined {
  if (q?.mode === "read") return q;
  if (q?.mode === "waiting" && q.last) return { mode: "read", ...q.last };
  return undefined;
}

/** Lo que queda, redondeado. Rust reporta lo **gastado**; se muestra al revés. */
export function left(w: Window): number {
  return Math.max(0, Math.min(100, Math.round(100 - w.used_pct)));
}

/**
 * El tono del relleno según lo que queda.
 *
 * El color **nunca comunica solo**: al lado siempre va el porcentaje escrito.
 * Aquí solo adelanta la lectura. Y no usa `primary`: el morado de marca
 * es el bisturí de las acciones del agente, no un tinte de gráfica.
 */
export function tono(restante: number): string {
  if (restante <= 5) return "bg-error";
  if (restante <= 20) return "bg-warning";
  return "bg-neutral-500";
}

/**
 * Cuándo vuelve a cero, en palabras. Una fecha absoluta obliga a restar.
 *
 * Sin fecha hay dos casos y no significan lo mismo: una ventana intacta todavía
 * no arrancó —así llega de verdad la de cinco horas cuando no has gastado
 * nada—, y una ventana empezada sin fecha es el proveedor callándose un dato.
 *
 * **Dice «reset» y no «vuelve a empezar en».** La frase larga ocupaba media fila
 * para decir lo que la palabra dice entera, y se repetía en cada ventana de cada
 * cuenta: cuatro renglones de la misma oración alrededor del único dato que
 * cambia. Lo que se recorta es la oración, no la información — los cuatro casos
 * siguen distinguiéndose.
 */
export function cuandoVuelve(ms: number | null, usado: number): string {
  if (ms === null)
    return usado === 0
      ? t("common.limits.not_started")
      : t("common.limits.no_reset_date");
  const falta = ms - Date.now();
  if (falta <= 0) return t("common.limits.reset_done");
  const min = Math.round(falta / 60_000);
  if (min < 60) return t("common.limits.reset_in_min", { count: min });
  const h = Math.round(min / 60);
  if (h < 48) return t("common.limits.reset_in_hours", { count: h });
  return t("common.limits.reset_in_days", { count: Math.round(h / 24) });
}

/**
 * Cuánto falta para que la ventana vuelva a empezar, **corto**: `26m`, `19h 36m`,
 * `5d 23h`.
 *
 * Es el mismo dato que `cuandoVuelve` y no lo reemplaza: aquél es una frase para
 * un panel donde cabe, este es para la franja de 28 px, donde una frase no
 * entra. Dos formatos del mismo número, cada uno para su sitio.
 *
 * Lleva **dos unidades y no una** porque «19 h» y «19 h 36 m» deciden cosas
 * distintas cuando lo que se está mirando es si aguanta hasta mañana. Vacío
 * cuando el proveedor no dice cuándo vuelve: inventar un plazo es peor que no
 * darlo.
 */
export function faltaCorto(ms: number | null): string {
  if (ms === null) return "";
  const falta = ms - Date.now();
  if (falta <= 0) return t("common.limits.due_now");
  const min = Math.floor(falta / 60_000);
  if (min < 60) return t("common.limits.short_min", { count: min });
  const h = Math.floor(min / 60);
  // Las abreviaturas de unidad también salen del catálogo: son lo que se lee en
  // la franja, y no todas las lenguas cortan «hora» por la misma letra.
  if (h < 48)
    return h < 24
      ? t("common.limits.short_hours_min", { hours: h, minutes: min % 60 })
      : t("common.limits.short_hours", { count: h });
  const d = Math.floor(h / 24);
  return t("common.limits.short_days_hours", { days: d, hours: h % 24 });
}

export function haceCuanto(ms: number): string {
  const seg = Math.round((Date.now() - ms) / 1000);
  if (seg < 60) return t("common.ago.just_now");
  const min = Math.round(seg / 60);
  return min < 60
    ? t("common.ago.minutes", { count: min })
    : t("common.ago.hours", { count: Math.round(min / 60) });
}
