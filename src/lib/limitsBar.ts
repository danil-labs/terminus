/** Orden y nombres cortos de la franja. Apartado de `limits.ts` para no cargar el catálogo. */
import type { Window } from "./limits.ts";

function alcance(w: Window): string | null {
  const propio = w.scope?.trim();
  if (propio) return propio;
  const i = w.label.indexOf(" · ");
  return i < 0 ? null : w.label.slice(i + 3) || null;
}

function duracion(w: Window): number {
  if (w.duration_s && w.duration_s > 0) return w.duration_s;
  const base = w.label.split(" · ")[0] ?? "";
  if (base === "esta semana") return 604_800;
  if (base === "este mes") return 86_400 * 30;
  const horas = /^últimas (\d+) horas$/.exec(base);
  if (horas) return Number(horas[1]) * 3_600;
  const dias = /^últimos (\d+) días$/.exec(base);
  if (dias) return Number(dias[1]) * 86_400;
  return Number.MAX_SAFE_INTEGER;
}

function implicito(agent: string, w: Window): boolean {
  const a = alcance(w);
  return agent === "antigravity" && !!a && /gemini/i.test(a);
}

function leyendaCorta(scope: string): string {
  return scope
    .replace(/^modelos\s+/i, "")
    .replace(/\s+y\s+/g, ", ")
    .replace(/\s+and\s+/gi, ", ");
}

/**
 * Nombre corto para la franja. Vacío si la bolsa va implícita en la marca.
 *
 * Sin esto, Gemini se escribiría al lado de su propio icono, y «modelos Claude
 * y GPT» no cabe en 28 px.
 */
export function rotuloDeAlcance(agent: string, w: Window): string | null {
  const a = alcance(w);
  if (!a || implicito(agent, w)) return null;
  return leyendaCorta(a);
}

/**
 * Orden de la franja: generales de intervalo corto a largo, luego las de un
 * modelo o familia. Pintar la más gastada primero esconde las 5 horas.
 */
export function enLaFranja(windows: Window[], agent: string): Window[] {
  return [...windows].sort((a, b) => {
    const extraA = Number(alcance(a) !== null && !implicito(agent, a));
    const extraB = Number(alcance(b) !== null && !implicito(agent, b));
    if (extraA !== extraB) return extraA - extraB;
    return duracion(a) - duracion(b);
  });
}

/** Cuánto de la franja se pinta: entera, sin medidores, o sin la leyenda tampoco. */
export type StripStage = "full" | "bars-off" | "compact";

/** Anchos de cada pieza en rem: siguen a `--escala-ui`. */
const MARK_REM = 1.375;
const CHAR_REM = 0.5;
const BAR_REM = 2.625;
const DOT_REM = 1.15;
const ACCOUNT_GAP_REM = 1;
const LEGEND_GAP_REM = 0.75;

/**
 * Lo que la franja pide para escribirse entera, en rem.
 *
 * `accounts` trae, por cuenta activa, las letras de cada ventana. Es una
 * estimación: el desplazamiento horizontal recoge lo que se pase.
 */
export function stripWidthRem(
  accounts: number[][],
  legendChars: number,
  stage: StripStage,
): number {
  const leyenda = stage === "compact" ? 0 : legendChars * CHAR_REM + LEGEND_GAP_REM;
  const cuerpo = accounts.reduce((total, ventanas) => {
    const texto = ventanas.reduce((n, letras) => n + letras * CHAR_REM, 0);
    const puntos = Math.max(0, ventanas.length - 1) * DOT_REM;
    const barra = stage === "full" && ventanas.length > 0 ? BAR_REM : 0;
    return total + MARK_REM + barra + texto + puntos;
  }, 0);
  const entre = Math.max(0, accounts.length - 1) * ACCOUNT_GAP_REM;
  return leyenda + cuerpo + entre;
}

/**
 * La etapa más completa que cabe en el hueco medido.
 *
 * Depende del hueco y de los datos, nunca de lo que ya se pintó: una etapa que
 * se mirara a sí misma oscilaría entre dos.
 */
export function stripStage(
  availableRem: number,
  accounts: number[][],
  legendChars: number,
): StripStage {
  if (stripWidthRem(accounts, legendChars, "full") <= availableRem) return "full";
  if (stripWidthRem(accounts, legendChars, "bars-off") <= availableRem) return "bars-off";
  return "compact";
}
