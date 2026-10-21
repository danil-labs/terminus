/**
 * The person of the Danil account in the browser: name, email and photo from
 * the control plane (`GET /v1/me`), and changing or removing the photo
 * (`PUT`/`DELETE /v1/me/avatar`) with the person's session. The photo is read
 * as bytes and shown as a `data:` URI: the page's CSP loads no remote images.
 */
import type { AccountProfile, AccountProfileSource, PreparedPhoto } from "../features/settings/account-profile.ts";
import { blobToDataUrl, PHOTO_MAX_BYTES, PHOTO_TYPES } from "../features/settings/account-profile.ts";
import { apiUrl } from "./computers.ts";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

type Me = { name?: unknown; email?: unknown; avatar_url?: unknown; avatar_source?: unknown };

/** A refused call, shaped like an engine failure so the panel words it the same way. */
const refused = (code: string) => Object.assign(new Error(code), { detail: code });

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export function webAccountProfile(
  endpoint: string,
  getToken: () => string | Promise<string>,
  onUnauthorized?: () => void,
  f: Fetch = (input, init) => fetch(input, init),
): AccountProfileSource {
  const origin = new URL(apiUrl(endpoint, "/")).origin;

  async function call(url: string, init: RequestInit = {}): Promise<Response> {
    const token = await getToken();
    const response = await f(url, { ...init, headers: { ...init.headers, authorization: `Bearer ${token}` } });
    if (response.status === 401) onUnauthorized?.();
    return response;
  }

  /** The photo only from the control plane's own origin: the session goes nowhere else. */
  async function photo(url: string | null): Promise<string | null> {
    if (!url) return null;
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      return null;
    }
    if (target.origin !== origin) return null;
    const response = await call(target.href).catch(() => null);
    if (!response?.ok) return null;
    const blob = await response.blob();
    if (!PHOTO_TYPES.includes(blob.type) || blob.size > PHOTO_MAX_BYTES) return null;
    return blobToDataUrl(blob);
  }

  async function profile(response: Response): Promise<AccountProfile> {
    const body = (await response.json().catch(() => null)) as (Me & { error?: { code?: unknown } }) | null;
    if (!response.ok) throw refused(text(body?.error?.code) ?? "unavailable");
    const shown = await photo(text(body?.avatar_url));
    const source = body?.avatar_source === "danil" || body?.avatar_source === "provider" ? body.avatar_source : null;
    return { name: text(body?.name), email: text(body?.email), photo: shown, source: shown ? source : null };
  }

  return {
    read: async () => profile(await call(apiUrl(endpoint, "/v1/me"))),
    setPhoto: async (p: PreparedPhoto) =>
      profile(await call(apiUrl(endpoint, "/v1/me/avatar"), { method: "PUT", headers: { "content-type": p.type }, body: p.blob })),
    removePhoto: async () => profile(await call(apiUrl(endpoint, "/v1/me/avatar"), { method: "DELETE" })),
  };
}
