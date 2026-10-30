/**
 * WorkOS sign-in for alfa. The browser never holds a WorkOS or refresh token:
 * at the callback the Worker resolves the person (`resolve_login`) and opens a
 * real Supabase session for `users.uuid`; the cookie keeps the WorkOS session
 * id and that refresh token, sealed. Each POST to `/auth/session`
 * checks the WorkOS session and refreshes in GoTrue, so bans, the hook and RLS
 * stay those of app.danil.ai. Any failure denies; there is no fallback.
 */
const WORKOS_API = "https://api.workos.com";
const HOST_ORIGIN = "https://alfa-app.danil.ai";
const FLOW_COOKIE = "__Host-danil_alfa_flow";
const SESSION_COOKIE = "__Host-danil_alfa";
const FLOW_SECONDS = 600;
const SESSION_SECONDS = 30 * 86_400;
/** The page asks again within this time, so an ended WorkOS session stops it soon. */
export const RECHECK_SECONDS = 600;
const COOKIE_VERSION = "v1";
const SESSION_PAGES = 20;
// Microsoft waits for xms_edov: WorkOS does not expose it, and an unverified email never links a person.
const PROVIDERS = new Set(["authkit", "GoogleOAuth"]);
const ID_RE = /^[A-Za-z0-9_-]{1,200}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

class Denied extends Error {
  constructor(code, status = 401) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
const unavailable = () => new Denied("identity_unavailable", 503);

const encoder = new TextEncoder();
const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function fromB64url(value) {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new Denied("invalid_cookie");
  const text = atob(value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4));
  return Uint8Array.from(text, c => c.charCodeAt(0));
}
const randomToken = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
const now = () => Math.floor(Date.now() / 1000);

export function sessionConfig(env) {
  const clientId = env.WORKOS_CLIENT_ID?.trim();
  const apiKey = env.WORKOS_API_KEY?.trim();
  const supabaseUrl = env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!clientId || !ID_RE.test(clientId) || !apiKey || !supabaseUrl?.startsWith("https://") || !serviceKey ||
      !env.SESSION_COOKIE_KEY) return null;
  return { clientId, apiKey, supabaseUrl, serviceKey, env };
}

async function cookieKey(env) {
  const raw = fromB64url(env.SESSION_COOKIE_KEY.trim());
  if (raw.length !== 32) throw unavailable();
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** AES-GCM with name and version as associated data, so one cookie never opens as the other or as an older format. */
async function seal(env, name, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(`${name}.${COOKIE_VERSION}`) }, await cookieKey(env), encoder.encode(JSON.stringify(value)));
  return `${COOKIE_VERSION}.${b64url(iv)}.${b64url(data)}`;
}

async function open(env, name, sealed) {
  const [version, iv, data, extra] = (sealed ?? "").split(".");
  if (version !== COOKIE_VERSION || !iv || !data || extra !== undefined) throw new Denied("no_session");
  let value;
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64url(iv), additionalData: encoder.encode(`${name}.${COOKIE_VERSION}`) }, await cookieKey(env), fromB64url(data));
    value = JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw new Denied("no_session");
  }
  if (!value || typeof value !== "object" || !Number.isInteger(value.exp) || value.exp <= now()) throw new Denied("no_session");
  return value;
}

function readCookie(request, name) {
  for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}
// `__Host-` needs Path=/. The flow cookie must survive the return from WorkOS (Lax); the session one never leaves the site (Strict).
const setCookie = (name, value, maxAge) => `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=${name === SESSION_COOKIE ? "Strict" : "Lax"}`;

/** A return path on this site, outside the sign-in itself and the data proxy; anything else goes to the root. */
export function safeNext(value) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /^\/(auth|alpha-api)(\/|\?|#|$)/.test(value) || /[\\\x00-\x1f]/.test(value)) return "/";
  try {
    const url = new URL(value, HOST_ORIGIN);
    return url.origin === HOST_ORIGIN ? url.pathname + url.search + url.hash : "/";
  } catch {
    return "/";
  }
}

async function workos(config, path, init = {}) {
  let response;
  try {
    response = await fetch(WORKOS_API + path, {
      ...init,
      headers: { Authorization: `Bearer ${config.apiKey}`, Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}) },
      redirect: "manual",
    });
  } catch {
    throw unavailable();
  }
  if (response.status >= 400 && response.status < 500) throw new Denied("invalid_workos_session");
  if (response.status !== 200) throw unavailable();
  try {
    const body = await response.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("shape");
    return body;
  } catch {
    throw unavailable();
  }
}

async function supabase(config, path, init = {}) {
  let response;
  try {
    response = await fetch(config.supabaseUrl + path, {
      ...init,
      headers: { apikey: config.serviceKey, Authorization: `Bearer ${config.serviceKey}`, Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}) },
      redirect: "manual",
    });
  } catch {
    throw unavailable();
  }
  if (response.status === 404 && path.startsWith("/auth/v1/admin/users/")) throw new Denied("no_login_yet", 403);
  if (response.status >= 400 && response.status < 500 && init.refusal) throw new Denied(init.refusal.code, init.refusal.status);
  if (response.status !== 200) throw unavailable();
  try {
    return await response.json();
  } catch {
    throw unavailable();
  }
}

const rpc = (config, name, args) => supabase(config, `/rest/v1/rpc/${name}`, { method: "POST", body: JSON.stringify(args) });

function sessionIdOf(accessToken) {
  try {
    const claims = JSON.parse(new TextDecoder().decode(fromB64url(accessToken.split(".")[1])));
    return typeof claims.sid === "string" && ID_RE.test(claims.sid) ? claims.sid : null;
  } catch {
    return null;
  }
}

async function checkSession(config, userId, sessionId) {
  let after = null;
  for (let page = 0; page < SESSION_PAGES; page += 1) {
    const query = new URLSearchParams({ limit: "100" });
    if (after) query.set("after", after);
    const body = await workos(config, `/user_management/users/${encodeURIComponent(userId)}/sessions?${query}`);
    if (!Array.isArray(body.data)) throw unavailable();
    const row = body.data.find(r => r?.id === sessionId);
    if (row) {
      const expires = typeof row.expires_at === "string" ? Date.parse(row.expires_at) : NaN;
      if (row.user_id !== userId || row.status !== "active" || row.ended_at != null || !(expires > Date.now())) throw new Denied("session_ended");
      return;
    }
    const next = body.list_metadata?.after;
    if (next == null) throw new Denied("session_ended");
    if (typeof next !== "string" || !ID_RE.test(next) || next === after) throw unavailable();
    after = next;
  }
  throw unavailable();
}

/**
 * WorkOS user → Danil person with a Supabase login. Only the callback calls
 * it: `resolve_login` writes (links logins, may create a person).
 */
async function resolvePerson(config, workosUserId) {
  const user = await workos(config, `/user_management/users/${encodeURIComponent(workosUserId)}`);
  const email = typeof user.email === "string" ? user.email.trim().toLowerCase() : "";
  if (user.id !== workosUserId || !email) throw unavailable();
  if (user.email_verified !== true) throw new Denied("email_not_verified", 403);
  const name = [user.first_name, user.last_name].filter(v => typeof v === "string" && v.trim()).join(" ").trim() || null;
  const personId = await rpc(config, "resolve_login", { p_provider: "workos", p_subject: workosUserId, p_email: email, p_email_verified: user.email_verified === true, p_name: name });
  if (!Number.isSafeInteger(personId) || personId < 1) throw new Denied("unknown_person", 403);
  const rows = await supabase(config, `/rest/v1/users?id=eq.${personId}&select=id,uuid,merged_into_user_id&limit=1`);
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row || row.id !== personId || row.merged_into_user_id != null) throw new Denied("unknown_person", 403);
  if (typeof row.uuid !== "string" || !UUID_RE.test(row.uuid)) throw new Denied("no_login_yet", 403);
  const login = await supabase(config, `/auth/v1/admin/users/${row.uuid}`);
  if (login?.id !== row.uuid || typeof login.email !== "string" || !login.email) throw new Denied("no_login_yet", 403);
  if ((login.banned_until && Date.parse(login.banned_until) > Date.now()) || login.deleted_at) throw new Denied("login_banned", 403);
  return { uuid: row.uuid, loginEmail: login.email };
}

/** GoTrue's answer as the page gets it; the refresh token stays in the cookie. */
function sessionOf(body, uuid) {
  const user = body?.user;
  if (typeof body?.access_token !== "string" || typeof body.refresh_token !== "string" || !body.refresh_token ||
      !Number.isFinite(body.expires_at) || user?.id !== uuid) throw unavailable();
  const meta = user.user_metadata ?? {};
  const name = [meta.full_name, meta.name].find(v => typeof v === "string" && v.trim()) ?? null;
  return {
    refresh: body.refresh_token,
    answer: { access_token: body.access_token, expires_at: Math.min(body.expires_at, now() + RECHECK_SECONDS), user: { user_id: uuid, email: user.email ?? null, name } },
  };
}

/** A real Supabase session for that login, as a magic link would open it; nothing is emailed. */
async function openSupabaseSession(config, person) {
  const link = await supabase(config, "/auth/v1/admin/generate_link", { method: "POST", body: JSON.stringify({ type: "magiclink", email: person.loginEmail }), refusal: { code: "login_banned", status: 403 } });
  const tokenHash = link?.hashed_token ?? link?.properties?.hashed_token;
  if (typeof tokenHash !== "string" || !tokenHash) throw unavailable();
  return sessionOf(await supabase(config, "/auth/v1/verify", { method: "POST", body: JSON.stringify({ type: "magiclink", token_hash: tokenHash }), refusal: { code: "login_banned", status: 403 } }), person.uuid);
}

/** GoTrue refuses a banned, deleted or signed-out login here. */
async function refreshSupabaseSession(config, refreshToken, uuid) {
  return sessionOf(await supabase(config, "/auth/v1/token?grant_type=refresh_token", { method: "POST", body: JSON.stringify({ refresh_token: refreshToken }), refusal: { code: "session_ended", status: 401 } }), uuid);
}

const json = (body, status, headers = {}) => Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
const failure = error => error instanceof Denied ? json({ error: error.code }, error.status) : json({ error: "identity_unavailable" }, 503);

async function start(config, url) {
  const provider = url.searchParams.get("provider") ?? "authkit";
  if (!PROVIDERS.has(provider)) return json({ error: "invalid_provider" }, 400);
  const state = randomToken();
  const verifier = randomToken();
  const challenge = b64url(await crypto.subtle.digest("SHA-256", encoder.encode(verifier)));
  const flow = await seal(config.env, FLOW_COOKIE, { state, verifier, next: safeNext(url.searchParams.get("next")), exp: now() + FLOW_SECONDS });
  const authorize = new URL(`${WORKOS_API}/user_management/authorize`);
  for (const [key, value] of Object.entries({
    client_id: config.clientId, redirect_uri: `${url.origin}/auth/workos/callback`, response_type: "code",
    provider, state, code_challenge: challenge, code_challenge_method: "S256",
  })) authorize.searchParams.set(key, value);
  return new Response(null, { status: 303, headers: { ...NO_STORE, Location: authorize.href, "Set-Cookie": setCookie(FLOW_COOKIE, flow, FLOW_SECONDS) } });
}

function equal(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function callback(config, request, url) {
  const back = (error) => {
    const page = new URL("/auth", url.origin);
    page.searchParams.set("error", error);
    return new Response(null, { status: 303, headers: { ...NO_STORE, Location: page.href, "Set-Cookie": setCookie(FLOW_COOKIE, "", 0) } });
  };
  let flow;
  try {
    flow = await open(config.env, FLOW_COOKIE, readCookie(request, FLOW_COOKIE));
  } catch {
    return back("callback_failed");
  }
  const code = url.searchParams.get("code");
  if (url.searchParams.has("error") || !code || !ID_RE.test(code) || !equal(url.searchParams.get("state"), flow.state)) return back("callback_failed");
  try {
    const answer = await workos(config, "/user_management/authenticate", {
      method: "POST",
      body: JSON.stringify({ client_id: config.clientId, client_secret: config.apiKey, grant_type: "authorization_code", code, code_verifier: flow.verifier }),
    });
    const userId = answer.user?.id;
    const sessionId = typeof answer.access_token === "string" ? sessionIdOf(answer.access_token) : null;
    if (typeof userId !== "string" || !ID_RE.test(userId) || !sessionId) throw unavailable();
    const person = await resolvePerson(config, userId);
    const opened = await openSupabaseSession(config, person);
    const session = await seal(config.env, SESSION_COOKIE, { user: userId, sid: sessionId, uuid: person.uuid, refresh: opened.refresh, exp: now() + SESSION_SECONDS });
    const headers = new Headers({ ...NO_STORE, Location: new URL(flow.next, url.origin).href });
    headers.append("Set-Cookie", setCookie(FLOW_COOKIE, "", 0));
    headers.append("Set-Cookie", setCookie(SESSION_COOKIE, session, SESSION_SECONDS));
    return new Response(null, { status: 303, headers });
  } catch (error) {
    return back(error instanceof Denied && error.status === 403 ? error.code : error instanceof Denied && error.status === 503 ? "identity_unavailable" : "callback_failed");
  }
}

/** The session takes no body: reading stops at the first byte instead of buffering one. */
async function emptyBody(request) {
  if (!request.body) return;
  const reader = request.body.getReader();
  const { done, value } = await reader.read();
  if (!done && value?.length) {
    await reader.cancel();
    throw new Denied("invalid_body", 400);
  }
}

async function issue(config, request) {
  try {
    await emptyBody(request);
    const session = await open(config.env, SESSION_COOKIE, readCookie(request, SESSION_COOKIE));
    if (!ID_RE.test(session.user ?? "") || !ID_RE.test(session.sid ?? "") || !UUID_RE.test(session.uuid ?? "") || typeof session.refresh !== "string") throw new Denied("no_session");
    await checkSession(config, session.user, session.sid);
    const renewed = await refreshSupabaseSession(config, session.refresh, session.uuid);
    const sealed = await seal(config.env, SESSION_COOKIE, { ...session, refresh: renewed.refresh });
    return json(renewed.answer, 200, { "Set-Cookie": setCookie(SESSION_COOKIE, sealed, Math.max(0, session.exp - now())) });
  } catch (error) {
    const response = failure(error);
    if (error instanceof Denied && error.status === 401) response.headers.set("Set-Cookie", setCookie(SESSION_COOKIE, "", 0));
    return response;
  }
}

async function logout(config, request) {
  // Sin sesión de WorkOS que cerrar, entrar de nuevo la reabriría sola: `/auth` se queda en su pantalla.
  let location = new URL("/auth?signed_out=1", HOST_ORIGIN).href;
  try {
    const session = await open(config.env, SESSION_COOKIE, readCookie(request, SESSION_COOKIE));
    if (ID_RE.test(session.sid ?? "")) {
      const end = new URL(`${WORKOS_API}/user_management/sessions/logout`);
      end.searchParams.set("session_id", session.sid);
      end.searchParams.set("return_to", new URL("/auth", HOST_ORIGIN).href);
      location = end.href;
    }
  } catch {
    // No session to end at WorkOS: the cookie is cleared all the same.
  }
  return json({ location }, 200, { "Set-Cookie": setCookie(SESSION_COOKIE, "", 0) });
}

/** `/auth/workos/*`, `/auth/session` and `/auth/logout`; null for any other path. */
export async function handleAuth(request, env, url) {
  const route = url.pathname === "/auth/workos/start" ? "start" :
    url.pathname === "/auth/workos/callback" ? "callback" :
    url.pathname === "/auth/session" ? "session" :
    url.pathname === "/auth/logout" ? "logout" : null;
  if (!route) return null;
  const method = route === "start" || route === "callback" ? "GET" : "POST";
  if (request.method !== method) return json({ error: "method_not_allowed" }, 405);
  if (method === "POST" && request.headers.get("Origin") !== url.origin) return json({ error: "forbidden_origin" }, 403);
  if (method === "POST" && request.headers.get("x-danil-actor")?.trim().toLowerCase() === "ai") return json({ error: "identity_requires_person" }, 403);
  const config = sessionConfig(env);
  if (!config) return json({ error: "sign_in_unavailable" }, 503);
  if (route === "start") return start(config, url);
  if (route === "callback") return callback(config, request, url);
  if (route === "session") return issue(config, request);
  return logout(config, request);
}
