/**
 * Las siete entradas de Configuración y sus pestañas. Las pestañas conservan
 * los ids de los destinos de antes: `setSettings("plugins")` y los enlaces
 * guardados abren la entrada que ahora la contiene.
 */
export const SETTINGS_ENTRIES = [
  { id: "account", group: "you", tabs: ["cuenta-danil", "emails", "security"] },
  { id: "preferences", group: "you", tabs: ["general", "appearance", "notify", "workspaces"] },
  { id: "ai-accounts", group: "you", tabs: ["proveedores-ia"] },
  { id: "machines", group: "you", tabs: ["machines", "entorno", "activity"] },
  { id: "projects", group: "workspace", tabs: ["proyectos", "fuentes", "secrets"] },
  { id: "agents-skills", group: "workspace", tabs: ["agentes", "skills", "plugins"] },
  { id: "connections", group: "workspace", tabs: ["conexiones", "integrations", "radiant"] },
] as const;

export type SettingsEntryId = (typeof SETTINGS_ENTRIES)[number]["id"];
export type SettingsGroup = (typeof SETTINGS_ENTRIES)[number]["group"];

/** La entrada y la pestaña que abre un id de entrada o de destino viejo; `null` si no es ninguno. */
export function settingsTarget(id: string | undefined): { entry: SettingsEntryId; tab: string | null } | null {
  if (!id) return null;
  for (const e of SETTINGS_ENTRIES) {
    if (e.id === id) return { entry: e.id, tab: null };
    if ((e.tabs as readonly string[]).includes(id)) return { entry: e.id, tab: id };
  }
  return null;
}
