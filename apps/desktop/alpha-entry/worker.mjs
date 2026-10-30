// Entrada de alfa-app.danil.ai: sirve Terminus web (TERMINUS_WEB) en la raíz, la entrada con
// WorkOS (session.mjs) y, en /alpha-api, una lista cerrada del BFF de appv2 (APPV2_BFF).
// Lecturas GET: /auth/profile, /auth/emails, /auth/access-request, /auth/account/support-access,
// /api/channels y el inbox, con query acotada. Escrituras POST: los correos de la persona
// (/auth/emails, /auth/emails/verify, /auth/emails/primary, /auth/emails/remove) y
// /auth/access-request, la única sin membresía; todas con Origin exacto, Bearer, JSON de hasta
// 1 KB y exactamente sus campos. Un actor `ai` se rechaza aquí, también al leer la solicitud.
// Al BFF solo van Authorization, Accept, Origin, Referer y un cuerpo reconstruido; nunca cookies.
import { handleAuth } from "./session.mjs";

const HOST = "alfa-app.danil.ai";
// La web vive en la raíz del dominio (build con `TERMINUS_WEB_BASE=/`).
const PREFIX = "/alpha-api";
// Donde vivía antes; sus enlaces y PWA instaladas se mandan a la raíz.
const LEGACY = "/terminus";
const PHONE_ROUTES = ["inbox", "inbox-thread", "inbox-detail", "personalize", "broadcasts", "channels", "attention-agents"].map(route => `/m/${route}`);
const json = (error, status) => Response.json({ error }, {
  status,
  headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
});

// Las únicas escrituras: los correos de la persona (Configuración → Cuenta de Danil) y la
// solicitud de acceso. El correo de esa solicitud sale del token, nunca del cuerpo.
const EMAIL_WRITES = {
  "/auth/emails": ["email"],
  "/auth/emails/verify": ["email", "code"],
  "/auth/emails/primary": ["email"],
  "/auth/emails/remove": ["email"],
};
const ACCESS_REQUEST = "/auth/access-request";
const ACCESS_LIMITS = { phone: 40, name: 120, company: 160 };
const MAX_BODY = 1024;

/** Lee el cuerpo por partes y corta al pasar de `max` bytes: sin Content-Length no se carga entero. */
async function boundedBody(request, max) {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.byteLength;
  }
  return bytes;
}

/** El objeto JSON de una escritura, o null: tipo, tamaño y UTF-8 ya revisados. */
async function jsonBody(request) {
  if (!(request.headers.get("Content-Type") ?? "").toLowerCase().startsWith("application/json")) return null;
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (declared > MAX_BODY) return null;
  const bytes = await boundedBody(request, MAX_BODY);
  if (!bytes) return null;
  let body;
  try {
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
  return body && typeof body === "object" && !Array.isArray(body) ? body : null;
}

/** El cuerpo exacto de una escritura de correos, o null: solo sus campos, todos de texto acotado. */
async function emailBody(request, fields) {
  const body = await jsonBody(request);
  if (!body) return null;
  const keys = Object.keys(body);
  if (keys.length !== fields.length || !fields.every((f) => keys.includes(f))) return null;
  if (typeof body.email !== "string" || body.email.length > 254 || /[\x00-\x1f\x7f]/.test(body.email)) return null;
  if (fields.includes("code") && (typeof body.code !== "string" || !/^\d{6}$/.test(body.code))) return null;
  return Object.fromEntries(fields.map((f) => [f, body[f]]));
}

/** El cuerpo exacto de la solicitud de acceso, o null: `phone` y `locale` siempre; nombre y empresa, si vienen. */
async function accessBody(request) {
  const body = await jsonBody(request);
  if (!body) return null;
  const keys = Object.keys(body);
  if (!keys.every((key) => key === "locale" || Object.hasOwn(ACCESS_LIMITS, key))) return null;
  if (body.locale !== "es" && body.locale !== "en") return null;
  for (const [field, max] of Object.entries(ACCESS_LIMITS)) {
    const value = body[field];
    if (value === undefined && field !== "phone") continue;
    if (typeof value !== "string" || value.length > max || /[\x00-\x1f\x7f]/.test(value)) return null;
  }
  return Object.fromEntries(keys.map((key) => [key, body[key]]));
}

function queryFor(url, kind) {
  const fields = kind === "profile" || kind === "channels" || kind === "emails" || kind === "access" ? {} : kind === "support" ? { account_id: [1, Number.MAX_SAFE_INTEGER] } : {
    account_id: [1, Number.MAX_SAFE_INTEGER],
    limit: [1, 100],
    ...(kind === "list" ? { offset: [0, 100_000] } : { before_id: [1, Number.MAX_SAFE_INTEGER] }),
  };
  const query = new URLSearchParams();
  for (const [key, value] of url.searchParams) {
    const bounds = Object.hasOwn(fields, key) && fields[key];
    const number = Number(value);
    if (!bounds || query.has(key) || !/^\d+$/.test(value) ||
        !Number.isSafeInteger(number) || number < bounds[0] || number > bounds[1]) return null;
    query.set(key, String(number));
  }
  if (kind !== "profile" && kind !== "channels" && kind !== "emails" && kind !== "access" && !query.has("account_id")) return null;
  return query;
}

/** Al BFF; solo vuelve JSON, sin redirecciones, cookies ni caché. */
async function forward(env, upstream) {
  let response;
  try {
    response = await env.APPV2_BFF.fetch(upstream);
  } catch {
    return json("bff_unavailable", 502);
  }
  if (response.status >= 300 && response.status < 400) return json("unexpected_redirect", 502);
  const contentType = response.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) return json("unexpected_response", 502);
  return new Response(response.body, {
    status: response.status,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
      "Pragma": "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** Una escritura: desde esta página, con sesión y el cuerpo exacto de su ruta. */
async function write(request, env, url, path) {
  if (request.headers.get("Origin") !== `https://${HOST}`) return json("forbidden_origin", 403);
  // Quitar la marca convertiría en persona a un turno de IA: se rechaza aquí, como en el BFF.
  if ((request.headers.get("X-Danil-Actor") ?? "").trim().toLowerCase() === "ai") return json("identity_requires_person", 403);
  const authorization = request.headers.get("Authorization");
  if (!authorization || !/^Bearer \S+$/i.test(authorization)) return json("unauthorized", 401);
  if (url.search) return json("invalid_query", 400);
  const body = path === ACCESS_REQUEST ? await accessBody(request) : await emailBody(request, EMAIL_WRITES[path]);
  if (!body) return json("invalid_body", 400);
  if (!env.APPV2_BFF) return json("bff_unavailable", 503);
  const headers = new Headers({ Authorization: authorization, Accept: "application/json", "Content-Type": "application/json", Origin: `https://${HOST}` });
  const referer = request.headers.get("Referer");
  if (referer !== null) headers.set("Referer", referer);
  url.pathname = path;
  url.search = "";
  return forward(env, new Request(url, { method: "POST", headers, body: JSON.stringify(body), redirect: "manual" }));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname !== HOST || url.protocol !== "https:") return json("not_found", 404);
    if (url.pathname === LEGACY || url.pathname.startsWith(`${LEGACY}/`)) {
      if (request.method !== "GET" && request.method !== "HEAD") return json("method_not_allowed", 405);
      url.pathname = url.pathname.slice(LEGACY.length) || "/";
      return new Response(null, { status: 308, headers: { Location: url.href, "Cache-Control": "no-store" } });
    }
    if (url.pathname === PREFIX || url.pathname.startsWith(`${PREFIX}/`)) {
      const path = url.pathname.slice(PREFIX.length);
      if (request.method === "POST" && (path === ACCESS_REQUEST || Object.hasOwn(EMAIL_WRITES, path))) return write(request, env, url, path);
      if (request.method !== "GET") return json("method_not_allowed", 405);
      if (path === ACCESS_REQUEST && (request.headers.get("X-Danil-Actor") ?? "").trim().toLowerCase() === "ai") return json("identity_requires_person", 403);
      const kind = path === "/auth/profile" ? "profile" :
        path === "/auth/emails" ? "emails" :
        path === ACCESS_REQUEST ? "access" :
        path === "/api/inbox/conversations" ? "list" :
        path === "/api/channels" ? "channels" :
        path === "/auth/account/support-access" ? "support" :
        /^\/api\/inbox\/conversations\/[1-9]\d*\/messages$/.test(path) ? "messages" : null;
      if (!kind) return json("not_found", 404);
      if (kind === "messages" && !Number.isSafeInteger(Number(path.split("/")[4]))) return json("invalid_query", 400);
      const query = queryFor(url, kind);
      if (!query) return json("invalid_query", 400);
      const authorization = request.headers.get("Authorization");
      if (!authorization || !/^Bearer \S+$/i.test(authorization)) return json("unauthorized", 401);
      if (!env.APPV2_BFF) return json("bff_unavailable", 503);
      const headers = new Headers({ Authorization: authorization, Accept: "application/json" });
      for (const name of ["Origin", "Referer"]) {
        const value = request.headers.get(name);
        if (value !== null) headers.set(name, value);
      }
      url.pathname = path;
      url.search = query.toString();
      return forward(env, new Request(url, { headers, redirect: "manual" }));
    }
    const signIn = await handleAuth(request, env, url);
    if (signIn) return signIn;
    if (request.method !== "GET" && request.method !== "HEAD") return json("method_not_allowed", 405);
    if (!env.TERMINUS_WEB) return json("assets_unavailable", 503);
    if (PHONE_ROUTES.includes(url.pathname)) {
      url.pathname = "/m/";
      return env.TERMINUS_WEB.fetch(new Request(url, request));
    }
    return env.TERMINUS_WEB.fetch(request);
  },
};
