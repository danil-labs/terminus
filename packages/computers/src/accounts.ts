/**
 * Las cuentas de IA de la persona en todas sus máquinas, como el panel de la
 * web: cada credencial registrada conserva su tarjeta y su consumo. El correo
 * es una etiqueta: una persona puede tener cuentas Personal y Team con el
 * mismo correo. Sin un id compartido de credencial no se unen máquinas.
 */
import { word } from "../../design/src/index.ts";

type Lang = "es" | "en";

export type AccountRowLike = { id: string; label?: string | null; identity?: string | null };

/** Una máquina donde la cuenta tiene sesión: su id local allí y si está encendida. */
export type AccountMember = { machine: string; id: string; on: boolean };

export type AccountGroup<R extends AccountRowLike = AccountRowLike> = {
  /** `provider:máquina~id`: el correo no identifica una credencial. */
  key: string;
  provider: string;
  /** La fila de la credencial registrada en esa máquina. */
  row: R;
  /** El correo en minúsculas; `null` si el CLI no lo dice. */
  email: string | null;
  members: AccountMember[];
  /** De qué credencial y máquina se lee el consumo. */
  usageFrom: AccountMember;
};

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** `lists` en el orden de las máquinas (`orderComputers`), una por máquina, todas del mismo proveedor. */
export function groupAccounts<R extends AccountRowLike>(
  provider: string,
  lists: readonly { machine: string; on: boolean; accounts: readonly R[] }[],
): AccountGroup<R>[] {
  const groups: AccountGroup<R>[] = [];
  for (const { machine, on, accounts } of lists) {
    for (const row of accounts) {
      if (typeof row?.id !== "string") continue;
      const member = { machine, id: row.id, on };
      const email = text(row.identity).toLowerCase() || null;
      groups.push({ key: `${provider}:${machine}~${row.id}`, provider, row, email, members: [member], usageFrom: member });
    }
  }
  return groups;
}

/** Lo que queda de una ventana, de 0 a 100: el motor da lo usado. */
export function windowLeft(window: { used_pct: number }): number {
  const left = Math.round(100 - (Number.isFinite(window.used_pct) ? window.used_pct : 0));
  return Math.max(0, Math.min(100, left));
}

/** El tono de la barra, como `tono()` del escritorio: nunca el color primario. */
export function usageTone(left: number): "error" | "warning" | "neutral" {
  if (left <= 5) return "error";
  if (left <= 20) return "warning";
  return "neutral";
}

/**
 * Cuándo vuelve a empezar una ventana (`cuandoVuelve` del escritorio). Sin
 * fecha hay dos casos: intacta todavía no arrancó; empezada, el proveedor no
 * dio el dato. `resetsAt` en ms de época.
 */
export function resetLabel(lang: Lang, resetsAt: number | null, usedPct: number, now = Date.now()): string {
  if (resetsAt === null) return word(lang, usedPct === 0 ? "common.limits.not_started" : "common.limits.no_reset_date");
  const left = resetsAt - now;
  if (left <= 0) return word(lang, "common.limits.reset_done");
  const min = Math.round(left / 60_000);
  if (min < 60) return word(lang, "common.limits.reset_in_min", { count: min });
  const h = Math.round(min / 60);
  if (h < 48) return word(lang, "common.limits.reset_in_hours", { count: h });
  return word(lang, "common.limits.reset_in_days", { count: Math.round(h / 24) });
}

/** «resta 62% · reset en 3 h». */
export function windowLabel(lang: Lang, window: { used_pct: number; resets_at: number | null }, now = Date.now()): string {
  return word(lang, "settings.account_card.window_left", { left: windowLeft(window), when: resetLabel(lang, window.resets_at, window.used_pct, now) });
}
