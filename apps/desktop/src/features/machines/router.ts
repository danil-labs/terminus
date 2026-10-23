/**
 * El escritorio con la cuenta de Danil, local primero: lo de esta computadora
 * va siempre nativo y pinta aunque no haya red; las otras máquinas de la cuenta
 * solo suman su rebanada (`@terminus/fleet`), y cuando una cambia la ventana
 * vuelve a leer (`harness:machine-slices`).
 *
 * La máquina de una llamada es la de la cabecera `x-terminus-machine`, o la de
 * la ventana; un id de otra máquina en los argumentos es un error antes de
 * mandar. La cuenta y `danil_*` van siempre aquí. Un workspace de la cuenta que
 * esta computadora no tiene se lee de sus miembros y actúa en el primero.
 */
import { type AccountWorkspace, callWorkspace } from "@terminus/computers";
import { AttentionBook, type Envelope, type Fleet, FleetError, type Slice, unwrap } from "@terminus/fleet";
import { t } from "../../lib/i18n.ts";

type Args = Record<string, unknown>;
type Options = { headers?: HeadersInit } | undefined;
export type Invoke = (command: string, args?: Args, options?: Options) => Promise<unknown>;
type Failure = { what: unknown; detail: unknown };

/**
 * Lecturas del contenido de un workspace: cada máquina suma su parte. `list_live_turns`
 * no: son los procesos de esta computadora, los que cerrar la ventana detiene.
 */
const FAN = new Set(["list_projects", "list_portfolios", "list_live_sessions", "list_active_turns", "list_spaces", "list_workspace_attention"]);
const LISTING = new Set(["list_workspaces", "workspaces_startup"]);
/** Lo que crea algo nuevo: en un workspace que esa máquina no tiene, primero lo hace suyo. */
const CREATE = new Set(["send_message", "run_shell_command", "create_project", "clone_project", "start_project_clone"]);
/** Lo que pone una tarea de otra máquina en un space de esta ventana: el space se comparte antes. */
const WITH_SPACE = new Set([...CREATE, "create_empty_session", "move_task_to_space", "set_task_archived"]);
/** De esta computadora por definición: sus cuentas de IA, su sesión de Danil, Radiant. */
const OF_THIS_MACHINE = /(^|_)accounts?($|_)|login|^radiant_|^danil_|^account_relay_token$/;
/** Las órdenes con canal pierden el canal por el relay: vuelve solo la respuesta final. */
const CHANNELS: Record<string, string> = { clone_project: "progress", list_session_git: "progress", watch_task_tree: "changes" };
const UNKNOWN = new Set(["command", "unsupported", "command_not_allowed"]);
/** Lo que abre un archivo en esta computadora: el de una tarea de otra máquina está allá. */
const FILES = /^(site_|typst_live_)|^(open_file_external|tree_open_external)$/;
/** Los demás códigos del relay, con la frase que la ventana ya conoce (los de `proxy.rs`). */
const SERVICE_KEYS: Record<string, string> = {
  service_busy: "shell.service.busy",
  task_busy: "shell.service.busy",
  app_unavailable: "shell.service.engine_down",
  io: "shell.service.unreachable",
  command: "shell.service.command",
  unsupported: "shell.service.command",
  command_not_allowed: "shell.service.command",
};
/** Cada cuánto se vuelve a preguntar la misma lectura a otra máquina mientras la ventana la repite. */
const REFRESH_GAP = 1_500;
const NOTIFY_AFTER = 200;
/** Cuánto vale una lectura del registro de la cuenta, y cuánto espera una lista por ella. */
const REGISTRY_FOR = 30_000;
const REGISTRY_WAIT = 4_000;

/** Qué vuelve a leer la ventana cuando cambia la rebanada de una lectura. */
export type SliceChange = "sessions" | "projects" | "spaces" | "attention";
const CHANGES: Record<string, SliceChange> = {
  list_live_sessions: "sessions",
  list_active_turns: "sessions",
  list_projects: "projects",
  list_portfolios: "projects",
  list_spaces: "spaces",
  list_workspace_attention: "attention",
};

export type RouterConfig = {
  self: string;
  fleet: Fleet;
  /** El IPC de la ventana: el motor de esta computadora. */
  native: Invoke;
  /** El registro de la cuenta (`GET /v1/workspaces`), o `null` si no se pudo leer. */
  registry?: () => Promise<AccountWorkspace[] | null>;
  /** Cambió la rebanada de otra máquina: la ventana vuelve a leer eso. */
  onSlices?: (changes: SliceChange[]) => void;
  /** Los eventos de otra máquina, ya con los ids del panel. */
  deliver?: (events: { name: string; payload: unknown }[]) => void;
  /** «Ejecutar en» para `workspace`, si la persona eligió una máquina. */
  pickedFor?: (workspace: string | null) => string | null;
};

function headerOf(options: Options, name: string): string | null {
  try {
    return new Headers(options?.headers).get(name) || null;
  } catch {
    return null;
  }
}

function withoutHeader(options: Options, name: string): Options {
  if (!options?.headers) return options;
  const headers = new Headers(options.headers);
  headers.delete(name);
  return { ...options, headers: Object.fromEntries(headers.entries()) };
}

function withoutChannel(command: string, args: Args): Args {
  const channel = CHANNELS[command];
  if (!channel || !(channel in args)) return args;
  const { [channel]: _dropped, ...rest } = args;
  return rest;
}

export function createRouter(config: RouterConfig) {
  const { self, fleet, native } = config;
  const attention = new AttentionBook();
  /** Los workspaces que esta computadora tiene, según su última lista; `null` antes de leerla. */
  let local: Set<string> | null = null;
  let active: string | null = null;
  /** Máquinas cuyo motor no sabe hacer suyo un workspace de la cuenta. */
  const stale = new Set<string>();
  const lastRead = new Map<string, number>();
  let pending = new Set<SliceChange>();
  let notifyTimer: ReturnType<typeof setTimeout> | undefined;

  let registryAt = 0;
  let registryRead: Promise<void> | null = null;
  const readRegistry = (): Promise<void> => {
    if (!config.registry || Date.now() - registryAt < REGISTRY_FOR) return Promise.resolve();
    registryRead ??= config
      .registry()
      .catch(() => null)
      .then((list) => {
        registryAt = Date.now();
        // Uno que falla deja el último bueno.
        if (list) fleet.setRegistry(list);
      })
      .finally(() => {
        registryRead = null;
      });
    return Promise.race([registryRead, new Promise<void>((done) => setTimeout(done, REGISTRY_WAIT))]);
  };

  const hasHere = (workspace: string | null) => !workspace || local === null || local.has(workspace);
  /** Un workspace de la cuenta que esta computadora no tiene: vive en sus otras máquinas. */
  const elsewhere = (workspace: string | null) => !hasHere(workspace) && fleet.inRegistry(workspace);
  /** La máquina que atiende un workspace que no está aquí: la primera encendida de sus miembros, o la primera. */
  const leadOf = (workspace: string | null): string | null => {
    const members = fleet.membersOf(workspace).filter((m) => fleet.power(m) !== "outdated");
    return members.find((m) => fleet.power(m) === "on") ?? members[0] ?? null;
  };
  /** Sin elegir, lo nuevo nace en la máquina de la ventana; en un workspace que no está aquí, en su primera. */
  const defaultMachine = (workspace: string | null) => (elsewhere(workspace) ? (leadOf(workspace) ?? self) : self);

  const named = (error: FleetError): Failure => {
    const name = error.machine ? fleet.name(error.machine) : "";
    switch (error.code) {
      // La interfaz nunca ofrece mezclar máquinas: llegar al candado de la flota
      // es un bug. Se registra y la persona ve el fallo genérico, sin explicarle
      // algo que no hizo.
      case "cross_machine":
      case "unknown_machine":
        console.error(`[máquinas] bug: ${error.code}`, error.machine, error.detail);
        return { what: { clave: "shell.service.failed" }, detail: error.code };
      case "machine_off":
        return { what: t("web.machines.off_action", { name }), detail: "machine_off" };
      case "version_mismatch":
        return { what: t("web.machines.outdated_action", { name }), detail: "version_mismatch" };
      case "machine_timeout":
        return { what: t("web.machines.timeout", { name }), detail: "machine_timeout" };
      case "machine_lost":
        return { what: t("web.machines.lost", { name }), detail: "machine_lost" };
      case "license_required":
        return { what: t("web.machines.license_required"), detail: "license_required" };
      case "workspace_mismatch":
        return { what: t("web.machines.workspace_mismatch", { name }), detail: "workspace_mismatch" };
      case "command_failed": {
        // El motor de allá explica por qué en `detail`, como frase o como `Failure`.
        const own = error.detail as { what?: unknown } | string | null;
        if (typeof own === "string" && own) return { what: own, detail: error.code };
        if (own && typeof own === "object" && "what" in own) return own as Failure;
        return { what: { clave: "shell.service.failed" }, detail: error.code };
      }
      case "workspace_not_linked":
        return { what: t("web.workspace_not_linked"), detail: "workspace_not_linked" };
      case "operation_failed": {
        // El motor de allá falló: su propio `Failure` viaja en `detail`.
        const own = error.detail as { what?: unknown } | string | null;
        if (typeof own === "string" || (own && typeof own === "object" && "what" in own)) return own as Failure;
        return { what: { clave: "shell.service.failed" }, detail: error.code };
      }
      default:
        return { what: { clave: SERVICE_KEYS[error.code] ?? "shell.service.failed" }, detail: error.code };
    }
  };
  const missing = (machine: string): Failure => ({ what: t("web.machines.missing_workspace", { name: fleet.name(machine) }), detail: "workspace_missing" });

  function notify(command: string) {
    const change = CHANGES[command];
    if (!change) return;
    pending.add(change);
    clearTimeout(notifyTimer);
    notifyTimer = setTimeout(() => {
      const changes = [...pending];
      pending = new Set();
      config.onSlices?.(changes);
    }, NOTIFY_AFTER);
  }

  const differs = (a: Slice | null, b: Slice) => !a || a.status !== b.status || a.has !== b.has || JSON.stringify(a.value) !== JSON.stringify(b.value);

  /** Pregunta otra vez a `envelope.machine` si hace rato que no; si su rebanada cambió, la ventana relee. */
  function refresh(envelope: Envelope, before: Slice | null) {
    const id = JSON.stringify([envelope.machine, envelope.command, envelope.workspace, envelope.args]);
    const last = lastRead.get(id) ?? 0;
    if (Date.now() - last < REFRESH_GAP) return;
    lastRead.set(id, Date.now());
    void fleet.read(envelope).then(
      (slice) => {
        if (differs(before, slice)) notify(envelope.command);
      },
      () => {},
    );
  }

  /** Una lectura de la barra: lo de aquí ya, más lo último de cada otra máquina del workspace. */
  async function fanRead(command: string, args: Args, workspace: string | null, options: Options): Promise<unknown> {
    const members = command === "list_workspace_attention" ? fleet.machines().map((m) => m.id) : fleet.membersOf(workspace);
    const envelopes = members.map((machine) => ({ machine, workspace, command, args }));
    const here = !elsewhere(workspace);
    const slices: Slice[] = [];
    if (here) {
      const value = await native(command, fleet.argsFor(self, args), options);
      slices.push({ machine: self, status: "ok", has: true, value, at: Date.now() });
      for (const envelope of envelopes) {
        const before = fleet.peek(envelope);
        if (before) slices.push(before);
        refresh(envelope, before);
      }
    } else {
      // Sin parte de aquí: lo último de cada máquina ya, y se relee detrás. Solo sin
      // nada guardado de ninguna se espera a que contesten, con su tope.
      const known = envelopes.map((envelope) => ({ envelope, before: fleet.peek(envelope) }));
      if (known.some(({ before }) => before?.has)) {
        for (const { envelope, before } of known) {
          if (before) slices.push(before);
          refresh(envelope, before);
        }
      } else slices.push(...(await Promise.all(envelopes.map((e) => fleet.read(e)))));
    }
    if (command === "list_workspace_attention") for (const s of slices) if (s.has) attention.set(s.machine, fleet.encode(s.machine, s.value));
    const merged = fleet.merge(command, slices, workspace);
    if (merged !== undefined) return merged;
    // Nadie trajo nada: se dice por qué, y la ventana se queda con lo que tenía.
    const failed = slices.find((s) => s.error) ?? slices[0];
    throw named(new FleetError(failed?.error === "machine_off" || !failed ? "machine_off" : (failed.error ?? "machine_timeout"), failed?.machine ?? leadOf(workspace)));
  }

  /** Una llamada a otra máquina, con el workspace del sobre. */
  async function remote(machine: string, command: string, args: Args, workspace: string | null): Promise<unknown> {
    args = withoutChannel(command, args);
    if (CREATE.has(command) && workspace && fleet.inRegistry(workspace) && !fleet.membersOf(workspace).includes(machine)) await materialize(machine, workspace);
    if (WITH_SPACE.has(command)) args = await withSharedSpace(args);
    if (command === "load_history") {
      // El relay no pagina: la tarea entera, con la forma de la página.
      const session = (await fleet.call({ machine, workspace, command: "load_session", args: { project: args.project, id: args.id } })) as { turns?: unknown[] } | null;
      const total = Array.isArray(session?.turns) ? session.turns.length : 0;
      return { ...session, history: { total, start: 0, end: total, limit: total, has_more: false } };
    }
    return fleet.call({ machine, workspace, command, args });
  }

  /**
   * Lo nuevo en otra máquina nace en el space de la ventana: uno de esta
   * computadora que aún no es de la cuenta se comparte antes (`share_space`), y
   * allá se crea con el mismo id. Si no se puede compartir (workspace sin cuenta,
   * motor anterior), nace sin space, como antes.
   */
  async function withSharedSpace(args: Args): Promise<Args> {
    const space = args.space;
    if (typeof space !== "string" || !space || fleet.isShared(space) || unwrap(space, fleet.remotes())) return args;
    try {
      await native("share_space", { id: space });
      fleet.markShared(space);
      return args;
    } catch {
      return { ...args, space: null };
    }
  }

  /** Una máquina que no tiene el workspace de algo nuevo lo hace suyo primero, con el mismo id. */
  async function materialize(machine: string, workspace: string) {
    if (stale.has(machine)) throw missing(machine);
    try {
      // Por el relay toda llamada dice su workspace (seldon-host #106): el que se hace suyo.
      await fleet.call({ machine, workspace, command: "materialize_workspace", args: { id: workspace } });
    } catch (error) {
      const code = error instanceof FleetError ? error.code : null;
      if (!code || !UNKNOWN.has(code)) throw error;
      stale.add(machine);
      throw missing(machine);
    }
  }

  async function listing(command: string, args: Args, options: Options): Promise<unknown> {
    await readRegistry();
    const value = (await native(command, args, options)) as { workspaces?: { id?: unknown }[]; active?: unknown } | null;
    if (Array.isArray(value?.workspaces)) local = new Set(value.workspaces.map((w) => w?.id).filter((id): id is string => typeof id === "string"));
    if (active === null && typeof value?.active === "string") active = value.active;
    const merged = fleet.merge(command, [{ machine: self, status: "ok", has: true, value, at: Date.now() }], null) as { active?: unknown } | undefined;
    if (!merged) return value;
    // El activo es el de esta ventana, aunque sea un workspace que solo tienen otras máquinas.
    return active && elsewhere(active) ? { ...merged, active } : merged;
  }

  async function poll(args: Args, options: Options): Promise<unknown> {
    const page = (await native("service_poll", args, options)) as { batches?: { events?: { name: string; payload: unknown }[] }[] } | null;
    // El `attention` de aquí habla solo de esta máquina: la ventana recibe la lista de todas.
    if (page && Array.isArray(page.batches) && fleet.machines().length)
      page.batches = page.batches.map((b) =>
        Array.isArray(b?.events) ? { ...b, events: b.events.map((e) => (e.name === "attention" ? { ...e, payload: attention.update(self, e.payload) } : e)) } : b,
      );
    return page;
  }

  function machineList() {
    const workspace = active;
    const lead = defaultMachine(workspace);
    const members = new Set(fleet.membersOf(workspace));
    return [
      { id: self, local: true, active: lead === self, on: true, hosts: hasHere(workspace), materializes: true },
      ...fleet.machines().map((m) => ({
        id: m.id,
        local: false,
        active: lead === m.id,
        on: fleet.power(m.id) === "on",
        hosts: workspace ? members.has(m.id) : null,
        materializes: !stale.has(m.id),
      })),
    ];
  }

  async function handle(command: string, args: Args = {}, options?: Options): Promise<unknown> {
    if (command === "machine_list") return machineList();
    if (command === "machine_select") {
      const id = args.id;
      if (typeof id === "string" && (id === self || fleet.has(id))) return { runtime: null };
    }
    if (OF_THIS_MACHINE.test(command)) return native(command, args, options);
    const machine = headerOf(options, "x-terminus-machine");
    const workspace = headerOf(options, "x-terminus-workspace") ?? active;
    if (FILES.test(command) && ((machine && machine !== self && fleet.has(machine)) || namesOther(args)))
      throw { what: t("shell.machines.local_only"), detail: "machine_files" };
    try {
      if (machine && machine !== self && fleet.has(machine)) return await remote(machine, command, args, callWorkspace(workspace, args));
      // Una máquina que no es de la cuenta (la red local de `fleet.rs`) la resuelve el proxy de la ventana.
      if (machine && machine !== self) return await native(command, args, options);
      const opts = machine === self ? withoutHeader(options, "x-terminus-machine") : options;
      if (command === "set_active_workspace" && typeof args.id === "string") {
        const id = args.id;
        if (elsewhere(id)) {
          active = id;
          return null;
        }
        const value = await native(command, args, opts);
        active = id;
        return value;
      }
      if (LISTING.has(command)) return await listing(command, args, opts);
      if (command === "service_poll") return await poll(args, opts);
      if (FAN.has(command)) return await fanRead(command, args, workspace, opts);
      if (elsewhere(workspace)) {
        const lead = leadOf(workspace);
        if (lead) return await remote(lead, command, args, workspace);
      }
      const value = await native(command, fleet.argsFor(self, args), opts);
      if (command === "remove_workspace" && args.id === active) active = null;
      return value;
    } catch (error) {
      if (error instanceof FleetError) throw named(error);
      throw error;
    }
  }

  const namesOther = (args: Args) => {
    try {
      fleet.argsFor(self, args);
      return false;
    } catch {
      return true;
    }
  };

  /** Eventos de otra máquina: `attention` sale como la lista de todas. */
  function events(machine: string, list: { name: string; payload: unknown }[]) {
    config.deliver?.(list.map((e) => (e.name === "attention" ? { ...e, payload: attention.update(machine, e.payload) } : e)));
  }

  /** Dónde se crea algo nuevo de `workspace` ahora y si esa máquina lo encabeza. */
  function createsOn(workspace: string | null): { machine: string; lead: boolean } {
    const ws = workspace ?? active;
    const picked = config.pickedFor?.(ws) ?? null;
    const machine = picked && (picked === self || fleet.has(picked)) ? picked : defaultMachine(ws);
    return { machine, lead: machine === defaultMachine(ws) };
  }

  return {
    handle,
    events,
    createsOn,
    activeWorkspace: () => active,
    forget(machine: string) {
      attention.forget(machine);
    },
    close() {
      clearTimeout(notifyTimer);
      fleet.close();
    },
  };
}

export type Router = ReturnType<typeof createRouter>;
