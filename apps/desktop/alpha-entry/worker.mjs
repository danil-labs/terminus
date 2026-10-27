const HOST = "alfa-app.danil.ai";
const PREFIX = "/terminus/alpha-api";
const json = (error, status) => Response.json({ error }, {
  status,
  headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
});

function queryFor(url, kind) {
  const fields = kind === "profile" ? {} : {
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
  if (kind !== "profile" && !query.has("account_id")) return null;
  return query;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname !== HOST || url.protocol !== "https:") return json("not_found", 404);
    if (url.pathname === "/terminus") {
      if (request.method !== "GET" && request.method !== "HEAD") return json("method_not_allowed", 405);
      url.pathname = "/terminus/";
      return new Response(null, { status: 308, headers: { Location: url.href, "Cache-Control": "no-store" } });
    }
    if (url.pathname === PREFIX || url.pathname.startsWith(`${PREFIX}/`)) {
      if (request.method !== "GET") return json("method_not_allowed", 405);
      const path = url.pathname.slice(PREFIX.length);
      const kind = path === "/auth/profile" ? "profile" :
        path === "/api/inbox/conversations" ? "list" :
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
      let response;
      try {
        response = await env.APPV2_BFF.fetch(new Request(url, { headers, redirect: "manual" }));
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
    if (!url.pathname.startsWith("/terminus/")) return json("not_found", 404);
    if (request.method !== "GET" && request.method !== "HEAD") return json("method_not_allowed", 405);
    if (!env.TERMINUS_WEB) return json("assets_unavailable", 503);
    if (url.pathname === "/terminus/m/inbox") {
      url.pathname = "/terminus/m/";
      return env.TERMINUS_WEB.fetch(new Request(url, request));
    }
    return env.TERMINUS_WEB.fetch(request);
  },
};
