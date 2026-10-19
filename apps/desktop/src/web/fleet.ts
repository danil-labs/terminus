/**
 * Every computer of the person behind one panel. Each engine keeps its own
 * random ids: with more than one computer the panel sees them prefixed with the
 * computer's id, so two machines never collide and a command finds its machine
 * from the ids it carries. With one computer nothing is renamed.
 *
 * Workspaces of different computers that are the same (same provider and
 * remote, or else the same name) show as one; its projects and tasks come
 * from each machine, each row marked with its machine.
 */

/** `outdated`: its engine speaks another contract, known before asking it anything. */
export type MachineInfo = { id: string; name: string; wakes: boolean; outdated?: boolean };
export type MachineStatus = "online" | "offline" | "starting" | "outdated";

type Row = Record<string, unknown>;
type Group = { id: string; members: Map<string, string> };
export type Answer = { machine: string; value: unknown };

const SEP = "~";
/** Keys whose string value names a workspace, project, task or account of the machine that sent it. */
const KEYS = new Set(["workspace", "project", "session", "parent", "portfolio", "account"]);
/** Reads of workspace content: each machine of the workspace answers its part. */
export const FAN = new Set(["list_projects", "list_portfolios", "list_live_sessions", "list_active_turns", "list_live_turns"]);
/** Reads that list every machine, whatever the workspace. */
export const EVERYWHERE = new Set(["list_workspaces", "workspaces_startup", "list_accounts"]);
/** What makes something new where the person chose, when no id says where. */
export const CREATE = new Set(["send_message", "run_shell_command", "create_project", "clone_project"]);
/** Answers whose rows carry the id of what they list. */
const ROW_IDS = new Set(["list_projects", "list_portfolios", "list_live_sessions"]);
/** Answers that are one object with its own id. */
const OWN_ID = new Set(["load_session", "create_project", "clone_project", "add_account"]);
/** Keys whose value is an image file on the machine that sent it: `preview_file` must read it there. */
const FILES = new Set(["logo", "background", "avatar"]);
const isPath = (v: string) => /^(\/|~\/|[a-z]:[\\/])/i.test(v);
/** Rows the sidebar marks with their machine. */
const TAGGED = new Set(["list_projects", "list_live_sessions"]);

// `self` is the person's own machine: the relay cannot start it.
const MANAGED_PROVIDERS = new Set(["aws-ec2"]);
const UNWAKEABLE_KINDS = new Set(["physical", "computer", "vps", "self_hosted", "byo"]);

/** Whether the relay can start this computer: a managed VM yes, a computer of the person's own no. */
export function wakes(c: { provider?: string | null; kind?: string | null; wakeable?: boolean | null }): boolean {
  if (typeof c.wakeable === "boolean") return c.wakeable;
  if (c.kind && UNWAKEABLE_KINDS.has(c.kind)) return false;
  return !c.provider || MANAGED_PROVIDERS.has(c.provider);
}

/** Managed computers first, then by name; the order decides which machine leads a shared workspace. */
export function ordered(machines: MachineInfo[]): MachineInfo[] {
  return [...machines].sort((a, b) => Number(b.wakes) - Number(a.wakes) || a.name.localeCompare(b.name));
}

const isRow = (v: unknown): v is Row => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** `named`: the machine came from an id in the command, not from a choice. */
export type Route = { machine: string; args: Row; workspace: string | null; named: boolean } | { fan: string[]; args: Row; workspace: string | null };

export class Fleet {
  readonly machines: MachineInfo[];
  readonly multi: boolean;
  private groups: Group[] = [];
  /** The workspaces each machine listed last, to name a workspace for a machine outside the active one. */
  private seen = new Map<string, string[]>();
  private outdated = new Set<string>();

  /** `on`: whether a machine answers now; rows from one that does not are marked off. */
  constructor(machines: MachineInfo[], private readonly on: (machine: string) => boolean = () => true) {
    this.machines = ordered(machines);
    this.multi = this.machines.length > 1;
    for (const m of machines) if (m.outdated) this.outdated.add(m.id);
  }

  info(id: string): MachineInfo | undefined {
    return this.machines.find((m) => m.id === id);
  }

  name(id: string): string {
    return this.info(id)?.name ?? id;
  }

  markOutdated(id: string) {
    this.outdated.add(id);
  }

  isOutdated(id: string): boolean {
    return this.outdated.has(id);
  }

  /** The machines that take part: an outdated one is left out and never breaks the panel. */
  usable(): string[] {
    return this.machines.map((m) => m.id).filter((id) => !this.outdated.has(id));
  }

  wrap(machine: string, id: string): string {
    return this.multi && id ? `${machine}${SEP}${id}` : id;
  }

  unwrap(value: string): { machine: string; id: string } | null {
    if (!this.multi) return null;
    const m = this.machines.find((x) => value.startsWith(`${x.id}${SEP}`));
    return m ? { machine: m.id, id: value.slice(m.id.length + SEP.length) } : null;
  }

  private group(id: string | null | undefined): Group | undefined {
    return id ? this.groups.find((g) => g.id === id) : undefined;
  }

  /** The machines that hold a workspace of the panel, in order. */
  membersOf(workspace: string | null): string[] {
    const g = this.group(workspace);
    if (!g) {
      const own = workspace ? this.unwrap(workspace) : null;
      return own ? [own.machine] : this.multi ? [] : this.usable();
    }
    return this.usable().filter((m) => g.members.has(m));
  }

  /** The workspace of `machine` behind the panel's `workspace`, or another of its own if it lacks that one. */
  workspaceOn(machine: string, workspace: string | null): string | null {
    if (!this.multi) return workspace;
    const g = this.group(workspace);
    if (g?.members.has(machine)) return g.members.get(machine) ?? null;
    const own = workspace ? this.unwrap(workspace) : null;
    if (own?.machine === machine) return own.id;
    return this.seen.get(machine)?.[0] ?? null;
  }

  /** The panel's id for a workspace of `machine`. */
  workspaceId(machine: string, raw: string): string {
    if (!this.multi || !raw) return raw;
    return this.groups.find((g) => g.members.get(machine) === raw)?.id ?? this.wrap(machine, raw);
  }

  /** The args as `machine` understands them; `machines` collects every machine an id in them names. */
  private decode(value: unknown, target: string | null, machines: Set<string>): unknown {
    if (typeof value === "string") {
      const g = this.group(value);
      if (g) return target ? (g.members.get(target) ?? value) : value;
      const own = this.unwrap(value);
      if (!own) return value;
      machines.add(own.machine);
      return own.id;
    }
    if (Array.isArray(value)) return value.map((v) => this.decode(v, target, machines));
    if (isRow(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, this.decode(v, target, machines)]));
    return value;
  }

  /**
   * Where a command goes: the machine its ids name, the one chosen for something
   * new, every machine of the workspace for its content, or the machine that
   * leads the workspace for anything else.
   */
  route(command: string, args: Row, workspace: string | null, chosen: string | null, fallback: string): Route {
    if (!this.multi) return { machine: this.machines[0].id, args, workspace, named: false };
    const named = new Set<string>();
    this.decode(args, null, named);
    const g = this.group(workspace);
    const own = !g && workspace ? this.unwrap(workspace) : null;
    if (own) named.add(own.machine);
    if (named.size > 1) throw new Error("cross_machine");
    let machine = [...named][0] ?? null;
    const byId = machine !== null;
    if (!machine && EVERYWHERE.has(command) && !chosen) return { fan: this.usable(), args, workspace };
    if (!machine && FAN.has(command) && !chosen) return { fan: this.membersOf(workspace), args, workspace };
    machine ??= chosen ?? (CREATE.has(command) ? fallback : (this.membersOf(workspace)[0] ?? fallback));
    return { machine, args: this.decode(args, machine, new Set()) as Row, workspace: this.workspaceOn(machine, workspace), named: byId };
  }

  /** `args` decoded for one machine of a fan-out. */
  argsFor(machine: string, args: Row): Row {
    return this.multi ? (this.decode(args, machine, new Set()) as Row) : args;
  }

  /** An answer or event of `machine` with the panel's ids. */
  encode(machine: string, value: unknown, command = ""): unknown {
    if (!this.multi) return value;
    if (command === "list_active_turns" && Array.isArray(value)) return value.map((v) => (typeof v === "string" ? this.wrap(machine, v) : v));
    if (command === "send_message" && typeof value === "string") return this.wrap(machine, value);
    const walk = (v: unknown, key: string | null): unknown => {
      if (typeof v === "string") {
        if (!key || !v) return v;
        if (key === "workspace") return this.workspaceId(machine, v);
        return KEYS.has(key) || (FILES.has(key) && isPath(v)) ? this.wrap(machine, v) : v;
      }
      if (Array.isArray(v)) return v.map((x) => walk(x, key));
      if (isRow(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]));
      return v;
    };
    const out = walk(value, null);
    const ownId = (row: Row) => (typeof row.id === "string" ? { ...row, id: this.wrap(machine, row.id) } : row);
    const tag = (row: Row) => (TAGGED.has(command) ? { ...row, machine, machine_on: this.on(machine) } : row);
    if (ROW_IDS.has(command) && Array.isArray(out)) return out.map((r) => (isRow(r) ? tag(ownId(r)) : r));
    if (OWN_ID.has(command) && isRow(out)) return ownId(out);
    return out;
  }

  /** An event of `machine` for the panel: the bare id of `account-rejected` included. */
  encodeEvent(machine: string, name: string, payload: unknown): unknown {
    if (name === "account-rejected" && typeof payload === "string") return this.wrap(machine, payload);
    return this.encode(machine, payload);
  }

  /** The answers of a fan-out joined: lists one after another, each row with its machine. */
  merge(command: string, answers: Answer[]): unknown {
    if (command === "list_workspaces" || command === "workspaces_startup") return this.mergeWorkspaces(answers);
    if (command === "list_accounts") return this.mergeAccounts(answers);
    const parts = answers.map(({ machine, value }) => this.encode(machine, value, command));
    if (parts.length === 0) return Array.isArray(answers[0]?.value) ? [] : null;
    if (parts.every(Array.isArray)) {
      const all = (parts as unknown[][]).flat();
      if (command !== "list_live_sessions") return all;
      const at = (r: unknown) => (isRow(r) && typeof r.updated_at === "number" ? r.updated_at : 0);
      return all.sort((a, b) => at(b) - at(a));
    }
    if (parts.every(isRow)) {
      const joined: Row = { ...(parts[0] as Row) };
      for (const p of parts.slice(1) as Row[])
        for (const [k, v] of Object.entries(p)) if (Array.isArray(v) && Array.isArray(joined[k])) joined[k] = [...(joined[k] as unknown[]), ...v];
      return joined;
    }
    return parts.find((p) => p !== null && p !== undefined) ?? null;
  }

  /** One workspace for the ones that are the same on several machines; the first machine leads. */
  private mergeWorkspaces(answers: Answer[]): unknown {
    if (!this.multi) return answers[0]?.value ?? null;
    const lists = answers
      .filter((a) => isRow(a.value) && Array.isArray((a.value as Row).workspaces))
      .map((a) => ({ machine: a.machine, value: a.value as Row, rows: ((a.value as Row).workspaces as Row[]).filter((w) => typeof w?.id === "string") }));
    const order = (m: string) => this.machines.findIndex((x) => x.id === m);
    lists.sort((a, b) => order(a.machine) - order(b.machine));
    const groups: (Group & { row: Row; rows: Map<string, Row> })[] = [];
    for (const { machine, rows } of lists) {
      this.seen.set(machine, rows.map((w) => w.id as string));
      const free = groups.filter((g) => !g.members.has(machine));
      const pick = (same: (a: Row, b: Row) => boolean, w: Row) => {
        const theirs = free.filter((g) => same(g.row, w));
        const mine = rows.filter((x) => same(x, w));
        return theirs.length === 1 && mine.length === 1 ? theirs[0] : undefined;
      };
      const remote = (a: Row, b: Row) => !!text(a.provider) && !!text(a.remote) && a.provider === b.provider && a.remote === b.remote;
      const named = (a: Row, b: Row) => !!text(a.name) && text(a.name).toLowerCase() === text(b.name).toLowerCase();
      for (const w of rows) {
        const g = pick(remote, w) ?? pick(named, w);
        if (g) {
          g.members.set(machine, w.id as string);
          g.rows.set(machine, w);
          free.splice(free.indexOf(g), 1);
        } else groups.push({ id: this.wrap(machine, w.id as string), members: new Map([[machine, w.id as string]]), row: w, rows: new Map([[machine, w]]) });
      }
    }
    // A machine that joins a workspace later keeps its panel id and row: the open workspace does not change under the person.
    const kept = new Set<string>();
    for (const g of groups) {
      const before = this.groups.find((b) => !kept.has(b.id) && [...g.members].some(([m, raw]) => b.members.get(m) === raw));
      if (!before) continue;
      kept.add(before.id);
      g.id = before.id;
      const owner = this.unwrap(before.id)?.machine;
      if (owner && g.rows.has(owner)) g.row = g.rows.get(owner) as Row;
    }
    this.groups = groups.map(({ id, members }) => ({ id, members }));
    const lead = lists[0];
    if (!lead) return answers[0]?.value ?? null;
    const fileOf = (g: (typeof groups)[number]) => {
      const owner = [...g.rows].find(([, r]) => r === g.row)?.[0];
      return typeof g.row.logo === "string" && owner && isPath(g.row.logo) ? { logo: this.wrap(owner, g.row.logo) } : {};
    };
    const workspaces = groups.map((g) => ({ ...g.row, ...fileOf(g), id: g.id, machines: [...g.members.keys()] }));
    const active = lists.map((l) => (typeof l.value.active === "string" ? this.workspaceId(l.machine, l.value.active) : null)).find(Boolean) ?? null;
    return { ...(this.encode(lead.machine, lead.value) as Row), workspaces, active };
  }

  /**
   * One account per provider and email, with the machines it is signed in on;
   * its usage is read once, from the first of them. Without an email it stays
   * its own, named with its machine.
   */
  private mergeAccounts(answers: Answer[]): unknown {
    if (!this.multi) return answers[0]?.value ?? null;
    const lists = answers.filter((a) => isRow(a.value) && Array.isArray((a.value as Row).accounts));
    const lead = lists[0];
    if (!lead) return answers[0]?.value ?? null;
    type Member = { machine: string; id: string; on: boolean };
    const cards: { row: Row; members: Member[]; key: string | null; active: boolean }[] = [];
    for (const { machine, value } of lists) {
      const list = value as Row;
      for (const a of list.accounts as Row[]) {
        if (typeof a?.id !== "string") continue;
        const member = { machine, id: this.wrap(machine, a.id), on: this.on(machine) };
        const email = text(a.identity).toLowerCase();
        let card = email ? cards.find((c) => c.key === email) : undefined;
        if (card) card.members.push(member);
        else {
          card = { row: email ? a : { ...a, label: `${text(a.label) || a.id} · ${this.name(machine)}` }, members: [member], key: email || null, active: false };
          cards.push(card);
        }
        // The lead machine's active account is the one the panel calls active.
        if (machine === lead.machine && list.active === a.id) card.active = true;
      }
    }
    const shown = (c: (typeof cards)[number]) => c.members.find((m) => m.on) ?? c.members[0];
    const accounts = cards.map((c) => ({ ...c.row, id: shown(c).id, machines: c.members }));
    const active = accounts.find((_, i) => cards[i].active)?.id ?? null;
    return { ...(lead.value as Row), active, accounts };
  }
}
