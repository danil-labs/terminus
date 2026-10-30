/**
 * El logo y el fondo de los chats que un workspace guarda en la cuenta
 * (`logo_url` / `background_url` de `GET /v1/workspaces`). Se leen con la
 * sesión de la persona y solo del origen del plano de control: la sesión no
 * va a ningún otro sitio. Lo que no es PNG, JPEG o WebP, o pasa del tamaño
 * de su clase, no se pinta. La web de escritorio y el teléfono los leen igual.
 */
import { apiUrl } from "./api.ts";

export type AccountAssetKind = "logo" | "background";

export const ACCOUNT_ASSET_TYPES: readonly string[] = ["image/png", "image/jpeg", "image/webp"];
export const ACCOUNT_ASSET_MAX_BYTES: Record<AccountAssetKind, number> = { logo: 1024 * 1024, background: 6 * 1024 * 1024 };

/** Lo que hace falta de `fetch` para traer una imagen. */
export type BlobFetch = (input: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; blob(): Promise<Blob> }>;

const globalBlobFetch: BlobFetch = (input, init) => (globalThis.fetch as unknown as BlobFetch)(input, init);

/** La dirección del asset si es del origen del plano de control; si no, `null`. */
export function accountAssetUrl(endpoint: string, url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const target = new URL(url);
    return target.origin === new URL(apiUrl(endpoint, "/")).origin ? target.href : null;
  } catch {
    return null;
  }
}

/**
 * La imagen como `Blob`, o `null` si no se puede pintar: otro origen, una
 * respuesta que no es 2xx, otro tipo, demasiado grande o un fallo de red.
 * `onUnauthorized` se llama con un 401 (la sesión venció).
 */
export async function readAccountAsset(
  endpoint: string,
  url: string | null | undefined,
  kind: AccountAssetKind,
  token: string,
  f: BlobFetch = globalBlobFetch,
  onUnauthorized?: () => void,
): Promise<Blob | null> {
  const target = accountAssetUrl(endpoint, url);
  if (!target) return null;
  try {
    const response = await f(target, { headers: { authorization: `Bearer ${token}` } });
    if (response.status === 401) onUnauthorized?.();
    if (!response.ok) return null;
    const blob = await response.blob();
    return ACCOUNT_ASSET_TYPES.includes(blob.type) && blob.size <= ACCOUNT_ASSET_MAX_BYTES[kind] ? blob : null;
  } catch {
    return null;
  }
}
