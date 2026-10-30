// Difusiones por la entrada alfa: listas cerradas de rutas del BFF de appv2, con query y cuerpo
// reconstruidos campo por campo. Una ruta nueva aquí es un cambio de frontera y se revisa.
const ID = "[1-9]\\d{0,15}";
const CAMPAIGN = `/api/marketing/campaigns/(${ID})`;
const TEMPLATE = `/api/marketing/templates/(${ID})`;
const KB = 1024;
const JSON_MAX = 64 * KB;
// Unos 60 000 ids de contacto.
const IDS_MAX = 512 * KB;
// El archivo de encabezado de una plantilla; el Worker lo lee entero antes de reenviarlo.
const MEDIA_MAX = 16 * 1024 * KB;

const safeId = (value) => Number.isSafeInteger(value) && value > 0;
const none = (params) => ([...params.keys()].length === 0 ? new URLSearchParams() : null);
const accountOnly = (params) => {
  const keys = [...params.keys()];
  const account = Number(params.get("account_id"));
  if (keys.length !== 1 || keys[0] !== "account_id" || !/^\d+$/.test(params.get("account_id")) || !safeId(account)) return null;
  return new URLSearchParams({ account_id: String(account) });
};
const page = (params) => {
  const limit = Number(params.get("limit")), offset = Number(params.get("offset"));
  if ([...params.keys()].sort().join() !== "limit,offset" || !/^\d+$/.test(params.get("limit")) || !/^\d+$/.test(params.get("offset")) || limit < 1 || limit > 200 || !Number.isSafeInteger(offset) || offset > 1_000_000) return null;
  return new URLSearchParams({ limit: String(limit), offset: String(offset) });
};
const approvedOnly = (params) => {
  if (!params.size) return new URLSearchParams();
  return params.size === 1 && params.get("status") === "APPROVED" ? new URLSearchParams({ status: "APPROVED" }) : null;
};

const READS = [
  ["/auth/account/features", accountOnly], ["/auth/account/my-permissions", accountOnly],
  ["/api/marketing/campaigns", none], [`${CAMPAIGN}/stats`, none], [`${CAMPAIGN}/messages`, page],
  ["/api/marketing/templates", approvedOnly], [TEMPLATE, none], [`${TEMPLATE}/channels`, none],
  ["/api/contacts", none], ["/api/contacts/metadata-keys", none],
  ["/api/funnels", none], [`/api/funnels/(${ID})/board`, none],
].map(([path, query]) => [new RegExp(`^${path}$`), query]);

/** El validador de la query de una lectura permitida, o null si la ruta no es de Difusiones. */
export function broadcastRead(path) {
  return READS.find(([pattern]) => pattern.test(path))?.[1] ?? null;
}

const object = (bytes) => {
  try {
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
};
const isJson = (type) => type.toLowerCase().startsWith("application/json");
const text = (value, max, min = 0) => typeof value === "string" && value.length >= min && value.length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value);
const only = (value, allowed) => Object.keys(value).every((key) => allowed.includes(key));
const exact = (fields) => (parse) => (bytes, type) => {
  const value = isJson(type) ? object(bytes) : null;
  if (!value || !only(value, fields) || !parse(value)) return null;
  return JSON.stringify(Object.fromEntries(fields.filter((field) => value[field] !== undefined).map((field) => [field, value[field]])));
};

const mapping = (value) => value === undefined || (value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length <= 100 && Object.entries(value).every(([key, item]) => text(key, 100, 1) && text(item, 1024, 1)));
const header = (value) => value === null || value === undefined || (typeof value === "object" && only(value, ["format", "text", "media_url"]) && ["TEXT", "IMAGE", "VIDEO", "DOCUMENT"].includes(value.format) && (value.text == null || text(value.text, 60)) && (value.media_url == null || text(value.media_url, 2048)));
const body = (value) => value === undefined || (value && typeof value === "object" && only(value, ["text"]) && text(value.text, 1024, 1));
const footer = (value) => value === null || value === undefined || (typeof value === "object" && only(value, ["text"]) && text(value.text, 60, 1));
const templateCore = (value) => (value.name === undefined || (text(value.name, 512, 1) && /^[a-z0-9_]+$/.test(value.name))) && (value.category === undefined || ["MARKETING", "UTILITY"].includes(value.category)) && (value.language === undefined || text(value.language, 12, 2)) && (value.channel_id === undefined || safeId(value.channel_id)) && header(value.header) && body(value.body) && footer(value.footer);

const TEMPLATE_FIELDS = ["channel_id", "name", "category", "language", "header", "body", "footer"];
const createCampaign = exact(["template_id", "channel_id", "name", "variable_mapping"])((value) => safeId(value.template_id) && safeId(value.channel_id) && text(value.name, 200, 1) && mapping(value.variable_mapping));
const addContacts = exact(["contact_account_ids"])((value) => Array.isArray(value.contact_account_ids) && value.contact_account_ids.length > 0 && value.contact_account_ids.every(safeId));
const schedule = exact(["scheduled_at"])((value) => text(value.scheduled_at, 40, 1) && !Number.isNaN(Date.parse(value.scheduled_at)));
const createTemplate = exact([...TEMPLATE_FIELDS, "submit"])((value) => safeId(value.channel_id) && value.name !== undefined && value.category !== undefined && value.body !== undefined && typeof value.submit === "boolean" && templateCore(value));
const updateTemplate = exact(TEMPLATE_FIELDS)(templateCore);
const syncTemplates = exact([])(() => true);
const requestAccess = exact(["account_id", "feature", "phone"])((value) => safeId(value.account_id) && value.feature === "campaigns" && text(value.phone, 40, 7));
const media = (bytes, type) => (/^multipart\/form-data;\s*boundary=/i.test(type) ? bytes : null);

const WRITES = [
  ["POST", "/api/marketing/campaigns", { parse: createCampaign, max: JSON_MAX }],
  ["POST", `${CAMPAIGN}/contacts`, { parse: addContacts, max: IDS_MAX }],
  ["POST", `${CAMPAIGN}/(?:start|pause|resume|cancel)`, { parse: null, max: 0 }],
  ["POST", `${CAMPAIGN}/schedule`, { parse: schedule, max: KB }],
  ["POST", "/api/marketing/templates", { parse: createTemplate, max: JSON_MAX }],
  ["POST", "/api/marketing/templates/sync", { parse: syncTemplates, max: KB }],
  ["PATCH", TEMPLATE, { parse: updateTemplate, max: JSON_MAX }],
  ["POST", `${TEMPLATE}/submit`, { parse: null, max: 0 }],
  ["DELETE", TEMPLATE, { parse: null, max: 0 }],
  ["POST", "/api/media", { parse: media, max: MEDIA_MAX, multipart: true }],
  ["POST", "/auth/account/request-access", { parse: requestAccess, max: KB }],
].map(([method, path, route]) => [method, new RegExp(`^${path}$`), route]);

/** La ruta de una escritura permitida, o null. */
export function broadcastWrite(method, path) {
  return WRITES.find(([allowed, pattern]) => allowed === method && pattern.test(path))?.[2] ?? null;
}
