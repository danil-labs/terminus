import { createSupportAccess } from "../../../../../packages/attention/src/support-access.ts";
import type { InboxSession } from "../../../../../packages/attention/src/inbox.ts";

/** El enlace al Harness en Configuración: abre `/admin` si la persona administra algún workspace de Danil. */
export function adminPageCapability(session: InboxSession, href = `${import.meta.env.BASE_URL}admin`) {
  const api = createSupportAccess(session, fetch, `${import.meta.env.BASE_URL}alpha-api`);
  return { href: (workspace: string | null) => (workspace ? `${href}?workspace=${encodeURIComponent(workspace)}` : href), allowed: async () => (await api.workspaces()).length > 0 };
}
