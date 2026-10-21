/**
 * Every computer of the person behind one panel. A workspace and its projects
 * keep the same id on every machine (`docs/account-workspace.md`): the panel
 * never renames them, a workspace is one wherever its id is listed, and a
 * project is one row that says which machines have it. Tasks, portfolios and
 * AI accounts keep an id per machine: with more than one computer the panel
 * sees them prefixed with the computer's id, so two machines never collide and
 * a command finds its machine from the ids it carries.
 *
 * `home` (the desktop's own engine) keeps its raw ids and leads every
 * workspace it has: what its window already shows never changes name.
 *
 * Of each other computer the panel shows only the workspaces linked to the
 * account (`linked`); the relay already refuses the rest.
 */
import { linkedAttention, linkedEvents, linkedListing } from "@terminus/computers";
import { mergeAttention } from "@terminus/protocol";

/** `outdated`: its engine speaks another contract, known before asking it anything. `linked`: `null` shows every workspace. */
export type MachineInfo = { id: string; name: string; wakes: boolean; outdated?: boolean; linked?: ReadonlySet<string> | null };
export type MachineStatus = "online" | "offline" | "starting" | "outdated";

type Row = Record<string, unknown>;
type Entry = { workspace: string; tasks: unknown[] };
/** Where a project lives: the machines that have its folder, and whether another can clone it. */
type ProjectPlace = { machines: Set<string>; remote: boolean };
export type Answer = { machine: string; value: unknown };

const SEP = "~";
/** Keys whose string value names a task, portfolio or account of the machine that sent it. */
const KEYS = new Set(["session", "parent", "portfolio", "account"]);
/** Reads of workspace content: each machine of the workspace answers its part. */
export const FAN = new Set(["list_projects", "list_portfolios", "list_live_sessions", "list_active_turns", "list_live_turns"]);
/** Reads that list every machine, whatever the workspace. */
export const EVERYWHERE = new Set(["list_workspaces", "workspaces_startup", "list_accounts", "list_workspace_attention"]);
/** What makes something new where the person chose, when no id says where. */
export const CREATE = new Set(["send_message", "run_shell_command", "create_project", "clone_project", "start_project_clone"]);
/** Answers whose rows carry the id of what they list. */
const ROW_IDS = new Set(["list_portfolios", "list_live_sessions"]);
/** Answers keyed by the id of the task each value is about. */
const KEYED = new Set(["list_session_git"]);
/** Answers that are one object with its own id. */
const OWN_ID = new Set(["load_session", "add_account"]);
/** Keys whose value is an image file on the machine that sent it: `preview_file` must read it there. */
const FILES = new Set(["logo", "background", "avatar"]);
const isPath = (v: string) => /^(\/|~\/|[a-z]:[\\/])/i.test(v);
/** Rows the sidebar marks with their machine. */
const TAGGED = new Set(["list_live_sessions"]);

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
const isEntry = (v: unknown): v is Entry => isRow(v) && typeof v.workspace === "string";

/**
 * `named`: the machine came from an id in the command, not from a choice.
 * `missing`: that machine listed its workspaces and this one is not among them.
 */
export type Route =
  | { machine: string; args: Row; workspace: string | null; named: boolean; missing: boolean }
  | { fan: string[]; args: Row; workspace: string | null };

export class Fleet {
  readonly machines: MachineInfo[];
  readonly multi: boolean;
  /** Workspace → the machines that listed it. */
  private hosts = new Map<string, Set<string>>();
  /** The machines whose workspaces were read: what one of them does not list, it does not have. */
  private listed = new Set<string>();
  /** Workspace → project → where it lives. */
  private projects = new Map<string, Map<string, ProjectPlace>>();
  /** Machines whose engine does not know `materialize_workspace` yet. */
  private stale = new Set<string>();
  /** What each machine says waits for the person, for `attention`. */
  private attention = new Map<string, Entry[]>();
  private outdated = new Set<string>();

  /** `on`: whether a machine answers now; rows from one that does not are marked off. */
  constructor(
    machines: MachineInfo[],
    private readonly on: (machine: string) => boolean = () => true,
    readonly home: string | null = null,
  ) {
    const rest = ordered(machines.filter((m) => m.id !== home));
    const own = machines.find((m) => m.id === home);
    this.machines = own ? [own, ...rest] : rest;
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
    return this.multi && id && machine !== this.home ? `${machine}${SEP}${id}` : id;
  }

  unwrap(value: string): { machine: string; id: string } | null {
    if (!this.multi) return null;
    const m = this.machines.find((x) => x.id !== this.home && value.startsWith(`${x.id}${SEP}`));
    return m ? { machine: m.id, id: value.slice(m.id.length + SEP.length) } : null;
  }

  /** Whether `machine` has `workspace`: `null` until it says which ones it has. */
  has(machine: string, workspace: string | null): boolean | null {
    if (!workspace || !this.multi) return workspace ? true : null;
    if (this.hosts.get(workspace)?.has(machine)) return true;
    return this.listed.has(machine) ? false : null;
  }

  /** The machines that hold a workspace of the panel, in order; before they list theirs, every one that may. */
  membersOf(workspace: string | null): string[] {
    if (!this.multi) return this.usable();
    if (!workspace) return [];
    return this.usable().filter((m) => this.has(m, workspace) !== false);
  }

  /** The workspace `machine` is asked with: the same id, or none if it lacks that one. */
  workspaceOn(machine: string, workspace: string | null): string | null {
    return this.has(machine, workspace) === false ? null : workspace;
  }

  /** Whether `machine` may still be asked to make a workspace of the account its own. */
  materializes(machine: string): boolean {
    return !this.stale.has(machine);
  }

  /** `machine` answered that it does not know `materialize_workspace`. */
  cannotMaterialize(machine: string) {
    this.stale.add(machine);
  }

  /** `machine` made `workspace` its own: it hosts it from now on. */
  materialized(machine: string, workspace: string) {
    const set = this.hosts.get(workspace) ?? new Set<string>();
    this.hosts.set(workspace, set.add(machine));
  }

  /** Where a project of `workspace` lives, once some machine listed it. */
  projectOf(workspace: string | null, project: unknown): ProjectPlace | undefined {
    return workspace && typeof project === "string" && project ? this.projects.get(workspace)?.get(project) : undefined;
  }

  /** Whether a new task of `project` can run on `machine`: it has its folder, or can clone it from its remote. */
  canRun(machine: string, workspace: string | null, project: unknown): boolean {
    const place = this.projectOf(workspace, project);
    return !place || place.remote || place.machines.has(machine);
  }

  /**
   * The workspaces linked to the account on `machine` as a later `GET /v1/computers` says: what it answers next is
   * filtered by them. True if they changed.
   */
  relink(machine: string, linked: ReadonlySet<string> | null): boolean {
    const m = this.info(machine);
    if (!m) return false;
    const before = m.linked ?? null;
    const same = before === linked || (before !== null && linked !== null && before.size === linked.size && [...linked].every((id) => before.has(id)));
    if (same) return false;
    m.linked = linked;
    return true;
  }

  /** What `machine` answered, without the workspaces not linked to the account there. */
  linkedOnly(machine: string, command: string, value: unknown): unknown {
    const linked = this.info(machine)?.linked ?? null;
    if (!linked) return value;
    if (command === "list_workspaces" || command === "workspaces_startup") return linkedListing(value, linked);
    if (command === "list_workspace_attention") return linkedAttention(value, linked);
    return value;
  }

  /** The events of `machine` the account may see: none of a workspace not linked there. */
  linkedEvents<E extends { name: string; payload: unknown; workspace?: string | null }>(machine: string, events: E[]): E[] {
    return linkedEvents(events, this.info(machine)?.linked ?? null);
  }

  /** The args as `machine` understands them; `machines` collects every machine an id in them names. */
  private decode(value: unknown, target: string | null, machines: Set<string>, key: string | null = null): unknown {
    if (typeof value === "string") {
      const own = this.unwrap(value);
      if (!own) {
        // A bare id of a task, portfolio or account is the home machine's: only its ids go unprefixed.
        if (this.home && this.multi && value && key && KEYS.has(key)) machines.add(this.home);
        return value;
      }
      machines.add(own.machine);
      return own.id;
    }
    if (Array.isArray(value)) return value.map((v) => this.decode(v, target, machines, key));
    if (isRow(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, this.decode(v, target, machines, k)]));
    return value;
  }

  /** The machines that answer a read of `workspace`: of one project, only those that have its folder. */
  private fanOf(workspace: string | null, project: unknown): string[] {
    const members = this.membersOf(workspace);
    const place = this.projectOf(workspace, project);
    const having = place ? members.filter((m) => place.machines.has(m)) : [];
    return having.length ? having : members;
  }

  /**
   * Where a command goes: the machine its ids name, the one chosen for something
   * new, every machine of the workspace for its content, or the machine that
   * leads the workspace (or the project it names) for anything else.
   */
  route(command: string, args: Row, workspace: string | null, chosen: string | null, fallback: string): Route {
    if (!this.multi) return { machine: this.machines[0].id, args, workspace, named: false, missing: false };
    const named = new Set<string>();
    this.decode(args, null, named);
    if (named.size > 1) throw new Error("cross_machine");
    const byName = [...named][0] ?? null;
    const byId = byName !== null;
    if (!byName && EVERYWHERE.has(command) && !chosen) return { fan: this.usable(), args, workspace };
    if (!byName && FAN.has(command) && !chosen) return { fan: this.fanOf(workspace, args.project), args, workspace };
    const place = this.projectOf(workspace, args.project);
    const lead = CREATE.has(command) ? null : this.membersOf(workspace).find((m) => !place || place.machines.has(m));
    const machine: string = byName ?? chosen ?? lead ?? fallback;
    return {
      machine,
      args: this.decode(args, machine, new Set()) as Row,
      workspace: this.workspaceOn(machine, workspace),
      named: byId,
      missing: this.has(machine, workspace) === false,
    };
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
    if (KEYED.has(command) && isRow(out)) return Object.fromEntries(Object.entries(out).map(([id, v]) => [this.wrap(machine, id), v]));
    return out;
  }

  /** An event of `machine` for the panel: the bare id of `account-rejected` included, and `attention` for every machine. */
  encodeEvent(machine: string, name: string, payload: unknown): unknown {
    if (name === "account-rejected" && typeof payload === "string") return this.wrap(machine, payload);
    const encoded = this.encode(machine, payload);
    if (name !== "attention" || !this.multi || !Array.isArray(encoded)) return encoded;
    this.attention.set(machine, mergeAttention(this.attention.get(machine) ?? [], encoded.filter(isEntry)));
    return this.attentionList();
  }

  /** The answers of a fan-out joined: lists one after another, each row with its machine. */
  merge(command: string, answers: Answer[], workspace: string | null = null): unknown {
    if (command === "list_workspaces" || command === "workspaces_startup") return this.mergeWorkspaces(answers);
    if (command === "list_accounts") return this.mergeAccounts(answers);
    if (command === "list_projects" && this.multi) return this.mergeProjects(answers, workspace);
    if (command === "list_workspace_attention" && this.multi) {
      for (const { machine, value } of answers) if (Array.isArray(value)) this.attention.set(machine, (this.encode(machine, value) as unknown[]).filter(isEntry));
      return this.attentionList();
    }
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

  private order(machine: string): number {
    return this.machines.findIndex((x) => x.id === machine);
  }

  /** One row per workspace id, from the first machine that lists it, with every machine that has it. */
  private mergeWorkspaces(answers: Answer[]): unknown {
    if (!this.multi) return answers[0]?.value ?? null;
    const lists = answers
      .filter((a) => isRow(a.value) && Array.isArray((a.value as Row).workspaces))
      .map((a) => ({ machine: a.machine, value: a.value as Row, rows: ((a.value as Row).workspaces as Row[]).filter((w) => typeof w?.id === "string") }))
      .sort((a, b) => this.order(a.machine) - this.order(b.machine));
    const rows = new Map<string, { row: Row; owner: string }>();
    for (const { machine, rows: listed } of lists) {
      // What a machine that did not answer listed before still counts: a machine that turns off keeps its workspaces.
      this.listed.add(machine);
      for (const set of this.hosts.values()) set.delete(machine);
      for (const w of listed) {
        const id = w.id as string;
        this.materialized(machine, id);
        if (!rows.has(id)) rows.set(id, { row: w, owner: machine });
      }
    }
    const lead = lists[0];
    if (!lead) return answers[0]?.value ?? null;
    const fileOf = (row: Row, owner: string) => (typeof row.logo === "string" && isPath(row.logo) ? { logo: this.wrap(owner, row.logo) } : {});
    const workspaces = [...rows].map(([id, { row, owner }]) => ({ ...row, ...fileOf(row, owner), id, machines: this.usable().filter((m) => this.hosts.get(id)?.has(m)) }));
    const active = lists.map((l) => (typeof l.value.active === "string" ? l.value.active : null)).find(Boolean) ?? null;
    return { ...(this.encode(lead.machine, lead.value) as Row), workspaces, active };
  }

  /**
   * One row per project id, with the machines that have its folder (`machines`).
   * A row of a machine that only knows it from the account (`materialized: false`)
   * adds no machine; its remote says whether another machine can clone it.
   */
  private mergeProjects(answers: Answer[], workspace: string | null): unknown[] {
    const joined = new Map<string, { row: Row; machines: string[]; remote: string | null; here: boolean }>();
    for (const { machine, value } of [...answers].sort((a, b) => this.order(a.machine) - this.order(b.machine))) {
      if (!Array.isArray(value)) continue;
      for (const raw of value) {
        if (!isRow(raw) || typeof raw.id !== "string") continue;
        const row = this.encode(machine, raw) as Row;
        const here = raw.materialized !== false;
        const seen = joined.get(raw.id);
        const entry = seen ?? { row, machines: [], remote: null, here };
        if (seen && here && !seen.here) Object.assign(entry, { row, here });
        if (here) entry.machines.push(machine);
        entry.remote ??= text(raw.remote_url) || null;
        joined.set(raw.id, entry);
      }
    }
    if (workspace) this.projects.set(workspace, new Map([...joined].map(([id, e]) => [id, { machines: new Set(e.machines), remote: !!e.remote }])));
    return [...joined.values()].map((e) => ({ ...e.row, ...(e.remote ? { remote_url: e.remote } : {}), machines: e.machines }));
  }

  /**
   * What waits for the person in every workspace, from every machine: one entry
   * per workspace with the tasks of all of them. A workspace that had something
   * and no longer does stays with no tasks, so the window reads it as the whole list.
   */
  private attentionList(): Entry[] {
    const known = this.listed.size ? (id: string) => this.hosts.get(id)?.size : () => true;
    const joined = new Map<string, Entry>();
    for (const m of this.machines)
      for (const e of this.attention.get(m.id) ?? []) {
        if (!known(e.workspace)) continue;
        const before = joined.get(e.workspace);
        const tasks = Array.isArray(e.tasks) ? e.tasks : [];
        joined.set(e.workspace, before ? { ...before, tasks: [...before.tasks, ...tasks] } : { ...e, tasks });
      }
    for (const id of this.hosts.keys()) if (!joined.has(id) && this.hosts.get(id)?.size) joined.set(id, { workspace: id, tasks: [] });
    return [...joined.values()];
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
