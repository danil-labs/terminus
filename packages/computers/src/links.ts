/**
 * Qué workspaces de una computadora ve la persona: los vinculados a su cuenta
 * de Danil (`workspaces` de `GET /v1/computers`). El relay ya filtra; esto es
 * la segunda red de cada cliente. Una fila sin `workspaces` es de un plano de
 * control anterior a los vínculos y no se filtra.
 */
import type { Computer } from "./api.ts";

/** Los ids vinculados, o `null` si el plano de control no los dice. */
export function linkedWorkspaces(computer: Pick<Computer, "workspaces">): ReadonlySet<string> | null {
  const list = computer.workspaces;
  return Array.isArray(list) ? new Set(list.filter((id): id is string => typeof id === "string")) : null;
}

/** Si la cuenta tiene al menos un workspace a la vista en alguna de sus computadoras. */
export function hasLinkedWorkspaces(computers: readonly Pick<Computer, "workspaces">[]): boolean {
  return computers.some((c) => {
    const linked = linkedWorkspaces(c);
    return linked === null || linked.size > 0;
  });
}

/** Las filas de workspaces que la persona puede ver. */
export function onlyLinked<R extends { id: string }>(rows: readonly R[], linked: ReadonlySet<string> | null): R[] {
  return linked ? rows.filter((r) => linked.has(r.id)) : [...rows];
}

/**
 * La respuesta de `list_workspaces` o `workspaces_startup` sin los workspaces
 * que no están vinculados; el activo que no se ve queda en `null`.
 */
export function linkedListing<T>(value: T, linked: ReadonlySet<string> | null): T {
  if (!linked || !value || typeof value !== "object" || Array.isArray(value)) return value;
  const listing = value as { workspaces?: unknown; active?: unknown };
  if (!Array.isArray(listing.workspaces)) return value;
  const workspaces = listing.workspaces.filter((w) => typeof w?.id === "string" && linked.has(w.id));
  const active = typeof listing.active === "string" && !linked.has(listing.active) ? null : listing.active;
  return { ...value, workspaces, ...("active" in listing ? { active } : {}) };
}

/** `list_workspace_attention` (una entrada por workspace) sin los que no están vinculados. */
export function linkedAttention<T>(value: T, linked: ReadonlySet<string> | null): T {
  if (!linked || !Array.isArray(value)) return value;
  return value.filter((entry) => {
    const id = (entry as { workspace?: unknown } | null)?.workspace;
    return typeof id !== "string" || linked.has(id);
  }) as T;
}

/** Un evento con `workspace` que no está vinculado no llega; uno sin workspace, sí. */
export function linkedEvent(event: { workspace?: unknown }, linked: ReadonlySet<string> | null): boolean {
  return !linked || typeof event.workspace !== "string" || linked.has(event.workspace);
}
