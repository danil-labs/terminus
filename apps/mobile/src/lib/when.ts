/**
 * La hora corta de una fila, como en las listas del teléfono: «ahora», «2 min»,
 * «3 h», «ayer», el día de la semana en los últimos siete días y si no la
 * fecha («27 oct»). Acepta segundos o milisegundos (los motores viejos mandan
 * segundos).
 */
export function shortWhen(at: number | string | null | undefined, lang: "es" | "en", now = Date.now()): string {
  if (at === null || at === undefined || at === "") return "";
  const raw = typeof at === "string" ? Date.parse(at) : at;
  if (!Number.isFinite(raw)) return "";
  const ms = raw < 1e12 ? raw * 1000 : raw;
  const minutes = Math.floor((now - ms) / 60_000);
  if (minutes < 1) return lang === "es" ? "ahora" : "now";
  if (minutes < 60) return `${minutes} min`;
  const date = new Date(ms);
  const today = new Date(now);
  const days = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) / 86_400_000);
  if (days <= 0) return `${Math.floor(minutes / 60)} h`;
  if (days === 1) return lang === "es" ? "ayer" : "yesterday";
  const locale = lang === "es" ? "es-MX" : "en-US";
  if (days < 7) return date.toLocaleDateString(locale, { weekday: "short" }).replace(".", "");
  return date.toLocaleDateString(locale, { day: "numeric", month: "short" }).replace(".", "");
}
