import { clavesConocidas, t } from "./i18n.ts";
import { prosa, type Prosa } from "./prose.ts";

export type Failure = { what: Prosa; detail: string };

type Data = Record<string, string | number>;
const record = (e: unknown): e is Record<string, unknown> => e !== null && typeof e === "object";
const readable = (e: unknown): e is string =>
  typeof e === "string" && e.trim().length > 0 && !/\[object \w+\]/.test(e);
const whatOf = (e: unknown) => record(e) && "what" in e ? e.what : e;

/** El diagnóstico conserva los objetos y los Error sin depender de su toString. */
function diagnostic(e: unknown): string {
  if (typeof e === "string") return readable(e) ? e : "";
  if (e == null) return "";
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(e, (_key, value: unknown) => {
      if (typeof value === "bigint") return value.toString();
      if (!record(value)) return value;
      if (seen.has(value)) return "[Circular]";
      seen.add(value);
      return value instanceof Error ? { ...value, message: value.message, stack: value.stack, cause: value.cause } : value;
    }) ?? "";
  } catch {
    return "";
  }
}

function phrase(e: unknown, datos?: Data): Prosa | null {
  const clave = claveDe(e);
  if (!clave) return readable(e) ? e : null;
  const supplied = record(e) && record(e.datos)
    ? Object.fromEntries(Object.entries(e.datos).filter(([, v]) =>
        typeof v === "string" || typeof v === "number",
      )) as Data : undefined;
  return { clave, datos: { ...supplied, ...datos } };
}

/** Una estructura inesperada nunca sustituye la explicación por su coerción a texto. */
export function asFailure(e: unknown, datos?: Data): Failure {
  const envelope = record(e) && "what" in e;
  const what = (envelope || claveDe(e)) && phrase(whatOf(e), datos);
  return {
    what: what || { clave: "common.failure.generic" },
    detail: diagnostic(envelope ? e.detail : e),
  };
}

export function prosaDe(e: unknown, datos?: Data): string {
  const what = phrase(whatOf(e), datos);
  if (what) return prosa(what);
  const fallback = t("common.failure.generic");
  return record(e) && readable(e.message) ? `${e.message}\n${fallback}` : fallback;
}

export function detalleDe(e: unknown): string {
  const failure = asFailure(e);
  return failure.detail || prosa(failure.what);
}

/** La clave se conserva para decidir reintentos y acciones, sin depender del idioma. */
export function claveDe(e: unknown): string | null {
  const what = whatOf(e);
  const clave = record(what) ? what.clave : what;
  return typeof clave === "string" && clavesConocidas().has(clave) ? clave : null;
}
