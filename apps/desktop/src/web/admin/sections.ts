/** Qué ve cada cuenta en `/admin`: reglas por plan y rol, y los órdenes de menú que se están comparando. */
export type AccountKind = "personal" | "teams" | "enterprise";
export type Section = "general" | "usage" | "members" | "support" | "audit" | "skills" | "mcp" | "agents" | "rules" | "workspaces" | "plan" | "identity";
export type MenuOrder = "scope" | "task" | "flat";
export type GroupName = "workspace" | "people" | "control" | "shared" | "organization" | "summary";

/** El plan manda; sin plan, una cuenta sin organización es personal. */
export function accountKind(account: { organization: string | null; plan: string | null }): AccountKind {
  const plan = account.plan?.toLowerCase() ?? "";
  if (plan.includes("enterprise")) return "enterprise";
  if (plan.includes("personal") || !account.organization) return "personal";
  return "teams";
}

const BY_KIND: Record<AccountKind, readonly Section[]> = {
  personal: ["general", "usage", "audit", "support", "plan"],
  teams: ["general", "usage", "members", "support", "audit", "skills", "mcp", "agents", "rules", "workspaces", "plan"],
  enterprise: ["general", "usage", "members", "support", "audit", "skills", "mcp", "agents", "rules", "workspaces", "plan", "identity"],
};

/** Un miembro solo lee: su consumo y lo que rige su trabajo. */
const FOR_MEMBERS: readonly Section[] = ["usage", "rules", "skills", "mcp", "agents"];

/** Lo que esta cuenta puede abrir: `available` son las secciones con fuente de datos, así nada sin backend aparece. */
export function visibleSections(kind: AccountKind, manager: boolean, available: ReadonlySet<Section>): Section[] {
  return BY_KIND[kind].filter((section) => available.has(section) && (manager || FOR_MEMBERS.includes(section)));
}

export const MENUS: Record<MenuOrder, { group: GroupName; sections: Section[] }[]> = {
  scope: [
    { group: "workspace", sections: ["general", "members", "support", "audit"] },
    { group: "shared", sections: ["skills", "mcp", "agents"] },
    { group: "control", sections: ["rules", "usage"] },
    { group: "organization", sections: ["workspaces", "plan", "identity"] },
  ],
  task: [
    { group: "summary", sections: ["general", "usage", "audit"] },
    { group: "people", sections: ["members", "support"] },
    { group: "control", sections: ["rules", "skills", "mcp", "agents"] },
    { group: "organization", sections: ["workspaces", "plan", "identity"] },
  ],
  flat: [
    { group: "summary", sections: ["general", "usage", "rules", "members", "audit", "skills", "mcp", "agents", "support", "workspaces", "plan", "identity"] },
  ],
};

/** El menú sin lo que la cuenta no ve; un grupo vacío no sale. */
export function menuFor(order: MenuOrder, visible: readonly Section[]) {
  return MENUS[order].flatMap((entry) => {
    const sections = entry.sections.filter((section) => visible.includes(section));
    return sections.length ? [{ group: entry.group, sections }] : [];
  });
}
