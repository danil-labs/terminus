/**
 * El código de un fallo del proxy: `detail` es el código, o `{ code, detail }` cuando el
 * motor adjuntó detalle (`extracted/proxy.rs`, `failure`). Comparar `detail` con una cadena
 * deja de casar en cuanto el motor añade detalle.
 */
export function errorCode(e: unknown): string | null {
  if (!e || typeof e !== "object") return null;
  const { detail, code } = e as { detail?: unknown; code?: unknown };
  if (typeof detail === "string") return detail;
  const inner = detail && typeof detail === "object" ? (detail as { code?: unknown }).code : undefined;
  if (typeof inner === "string") return inner;
  return typeof code === "string" ? code : null;
}
