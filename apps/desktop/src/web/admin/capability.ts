import { createSupportAccess } from "../../../../../packages/attention/src/support-access.ts";
import type { InboxSession } from "../../../../../packages/attention/src/inbox.ts";

/** «Administración ↗» en Configuración: abre `/admin` si la persona administra algún workspace de Danil. */
export function adminPageCapability(session: InboxSession, href = `${import.meta.env.BASE_URL}admin`) {
  const api = createSupportAccess(session);
  return { href, allowed: async () => (await api.workspaces()).length > 0 };
}
