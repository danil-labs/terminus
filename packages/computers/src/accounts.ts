/**
 * Las cuentas de IA de la persona en todas sus máquinas, como el panel de la
 * web (#154): una tarjeta por proveedor y correo, con su consumo leído una
 * vez (de la primera máquina encendida donde está) y una chapa por máquina
 * donde tiene la sesión iniciada. Sin correo, la cuenta queda sola y se nombra
 * con su máquina. Es la regla de `mergeAccounts` en `apps/desktop/src/web/fleet.ts`.
 */
import { word } from "../../design/src/index.ts";

type Lang = "es" | "en";

export type AccountRowLike = { id: string; label?: string | null; identity?: string | null };

/** Una máquina donde la cuenta tiene sesión: su id local allí y si está encendida. */
export type AccountMember = { machine: string; id: string; on: boolean };

export type AccountGroup<R extends AccountRowLike = AccountRowLike> = {
  /** `provider:correo`, o `provider:máquina~id` sin correo. */
  key: string;
  provider: string;
  /** La fila de la primera máquina que la tiene. */
  row: R;
  /** El correo en minúsculas; `null` si el CLI no lo dice. */
  email: string | null;
  members: AccountMember[];
  /** De qué máquina se lee el consumo: la primera encendida, si no la primera. */
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
      const known = email ? groups.find((g) => g.email === email) : undefined;
      if (known) {
        known.members.push(member);
        if (!known.usageFrom.on && on) known.usageFrom = member;
      } else {
        groups.push({ key: `${provider}:${email ?? `${machine}~${row.id}`}`, provider, row, email, members: [member], usageFrom: member });
      }
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
