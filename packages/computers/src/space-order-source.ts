import { apiUrl, listWorkspaces, type Fetch } from "./api.ts";
import { spaceOrder, type SpaceOrderSource } from "./space-order.ts";

/** Guarda solo esta preferencia con la versión vigente, sin pisar otros ajustes. */
export function createSpaceOrderSource(endpoint: string, token: () => Promise<string>, fetcher: Fetch = globalThis.fetch): SpaceOrderSource {
  const readWorkspace = async (id: string) => {
    const answer = await listWorkspaces(endpoint, await token(), fetcher);
    if (answer.kind !== "ok") throw new Error("space_order_unavailable");
    return answer.value.find(workspace => workspace.id === id) ?? null;
  };
  return {
    async read(id) {
      const workspace = await readWorkspace(id);
      return workspace ? spaceOrder(workspace) : null;
    },
    async save(id, ids) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const workspace = await readWorkspace(id);
        if (!workspace) throw new Error("space_order_unavailable");
        const remaining = new Set(spaceOrder(workspace));
        const ordered = [...new Set(ids)].filter(id => remaining.delete(id));
        ordered.push(...remaining);
        const response = await fetcher(apiUrl(endpoint, `/v1/workspaces/${encodeURIComponent(id)}`), {
          method: "PATCH",
          headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
          body: JSON.stringify({ settings_version: workspace.settings_version, settings: { space_order: JSON.stringify(ordered) } }),
        });
        if (response.ok) return ordered;
        const body = await response.json().catch(() => null) as { error?: string | { code?: string } } | null;
        const code = typeof body?.error === "string" ? body.error : body?.error?.code;
        if (response.status !== 409 || code !== "settings_conflict") throw new Error("space_order_unavailable");
      }
      throw new Error("space_order_unavailable");
    },
  };
}
