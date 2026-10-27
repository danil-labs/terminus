import type { MachineResources } from "@terminus/protocol";
import type { JSX } from "solid-js";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
} from "solid-js";
import { invoke } from "../../lib/invoke.ts";
import { t } from "../../lib/i18n";
import { peso } from "../../lib/format";
import { conservar } from "../../lib/sessionRefresh";
import { haceCuanto } from "../../lib/limits";
import { cn } from "../../lib/utils";
import HardDrive from "lucide-solid/icons/hard-drive";
import Trash2 from "lucide-solid/icons/trash-2";
import ChevronRight from "lucide-solid/icons/chevron-right";
import ChevronDown from "lucide-solid/icons/chevron-down";
import Folder from "lucide-solid/icons/folder";
import RefreshCw from "lucide-solid/icons/refresh-cw";
import SquareArrowOutUpRight from "lucide-solid/icons/square-arrow-out-up-right";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/Popover";
import {
  RETARDO_TOOLTIP,
  TooltipContent,
  TooltipRoot,
  TooltipTrigger,
} from "../../ui/Tooltip";
import { Badge } from "../../ui/Badge";
import { ProgressBar } from "../../ui/ProgressBar";
import { type Machine, machineName } from "../machines/store";
import { prosaDe } from "../../ui/Failure";

type Clase = "recuperable" | "git" | "fuente" | "trabajo" | "registro";

type Bloque = { rel: string; clase: Clase; bytes: number };

type TareaConPeso = {
  session: string;
  project: string;
  tarea: string;
  proyecto: string | null;
  bytes: number;
  /** Cuánto de `bytes` se puede tirar. Viene calculado del backend. */
  recuperable: number;
  bloques: Bloque[];
  /** `updated_at` de la tarea en ms; 0 si la medición viene de una caché anterior. */
  actividad?: number;
};

type Suelto = { etiqueta: string; bytes: number; rel: string | null };

type GrupoArchivado = {
  cuantas: number;
  bytes: number;
  recuperable: number;
};

type Almacen = {
  tareas: TareaConPeso[];
  archivadas?: GrupoArchivado;
  bytes: number;
  recuperable: number;
  compartido: Suelto[];
  sueltos: Suelto[];
  medido_en: number;
  aviso: string | null;
};


type Summary = { resources?: MachineResources; workspaceName?: string; loading: boolean; stale?: boolean; error?: string };
type Target = { machine: string; workspace: string; generation: number };

type Liberado = {
  bytes: number;
  cuantos: number;
  detalle: string;
};

type Grupo = {
  clave: string;
  nombre: string;
  tareas: TareaConPeso[];
  bytes: number;
  recuperable: number;
};

const DIA_MS = 86_400_000;

function actividadDe(ms: number | undefined): string {
  if (!ms) return "";
  const dias = Math.floor((Date.now() - ms) / DIA_MS);
  return dias < 1 ? haceCuanto(ms) : t("shell.storage.activity.days", { count: dias });
}

/** Lo que la persona lee de un bloque. La ruta va debajo, como dato. */
function nombreBloque(b: Bloque): string {
  const carpeta = b.rel.split("/").pop() ?? b.rel;
  switch (b.clase) {
    case "git":
      return t("shell.storage.block.git");
    case "fuente":
      return t("shell.storage.block.source");
    case "trabajo":
      return t("shell.storage.block.work");
    case "registro":
      return t("shell.storage.block.record");
  }
  switch (carpeta) {
    case "target":
      return t("shell.storage.block.target");
    case "node_modules":
      return t("shell.storage.block.node_modules");
    case ".pnpm-store":
      return t("shell.storage.block.pnpm_store");
    case ".venv":
      return t("shell.storage.block.venv");
    case "__pycache__":
    case ".pytest_cache":
      return t("shell.storage.block.python_cache");
    case ".gradle":
      return t("shell.storage.block.gradle");
    default:
      return t("shell.storage.block.generated");
  }
}

export default function Almacenamiento(props: {
  workspace: string | null;
  /** Tareas con un turno vivo. */
  trabajando: string[];
  /** Tareas con una pestaña abierta en esta ventana. */
  conPestana: string[];
  onAbrirTarea: (project: string, session: string) => void;
}) {
  const [datos, setDatos] = createSignal<Almacen | null>(null);
  const [abierto, setAbierto] = createSignal(false);
  const [midiendo, setMidiendo] = createSignal(false);
  const [vista, setVista] = createSignal<"proyecto" | "tarea">("proyecto");
  /** Qué tareas están desplegadas, por id. Plegadas por omisión. */
  const [abiertas, setAbiertas] = createSignal<Record<string, boolean>>({});
  /** Grupos plegados o desplegados a mano. Sin entrada, abre solo el más pesado. */
  const [gruposAbiertos, setGruposAbiertos] = createSignal<Record<string, boolean>>({});
  const [compartidoAbierto, setCompartidoAbierto] = createSignal(false);
  /** Lo que dijo el backend cuando no se pudo, en la fila que lo pidió. */
  const [fallo, setFallo] = createSignal<Record<string, string>>({});
  /** Lo que se liberó, en la fila que lo pidió. Un borrado sin confirmación se
   *  lee como que no pasó nada: la lista se reordena y ya. */
  const [liberado, setLiberado] = createSignal<Record<string, string>>({});

  const [inventory, setInventory] = createSignal<Machine[]>([]);
  const [machine, setMachine] = createSignal<string | null>(null);
  const [summaries, setSummaries] = createSignal<Record<string, Summary>>({});
  const [inventoryError, setInventoryError] = createSignal("");
  const [readError, setReadError] = createSignal("");
  const [listing, setListing] = createSignal(false);
  const [operationPending, setOperationPending] = createSignal(false);
  let generation = 0;
  let inventoryRequest = 0;
  let detailRequest = 0;
  const summaryRequests = new Map<string, number>();
  let disposed = false;
  let dataTarget: Target | null = null;

  const selected = () => inventory().find((m) => m.id === machine());
  const current = (target: Target) => !disposed && target.generation === generation
    && target.workspace === props.workspace && target.machine === machine();
  const destination = (target: Target) => ({ headers: {
    "x-terminus-machine": target.machine,
    "x-terminus-workspace": target.workspace,
  } });
  const target = (): Target | null => {
    const m = selected();
    const workspace = props.workspace;
    return m?.on && m.hosts !== false && workspace
      ? { machine: m.id, workspace, generation } : null;
  };
  const canClean = () => !!dataTarget && current(dataTarget) && !!target()
    && !clearing() && !listing() && !midiendo() && !inventoryError() && !readError() && !datos()?.aviso;

  async function readSummary(m: Machine) {
    if (!m.on || disposed) return;
    const context = generation;
    const workspace = props.workspace;
    const request = (summaryRequests.get(m.id) ?? 0) + 1;
    summaryRequests.set(m.id, request);
    const valid = () => !disposed && context === generation && workspace === props.workspace
      && summaryRequests.get(m.id) === request;
    setSummaries((prev) => ({ ...prev, [m.id]: { ...prev[m.id], loading: true, error: undefined } }));
    try {
      // Startup directo: el resumen de disco no requiere ni materializa un workspace.
      const startup = await invoke<{ machine_resources?: MachineResources; workspaces?: { id: string; name: string }[] }>("list_workspaces", {}, {
        headers: { "x-terminus-machine": m.id },
      });
      if (valid()) setSummaries((prev) => ({ ...prev, [m.id]: {
        resources: startup.machine_resources, workspaceName: startup.workspaces?.find((w) => w.id === workspace)?.name, loading: false,
      } }));
    } catch (error) {
      if (valid()) setSummaries((prev) => ({ ...prev, [m.id]: {
        ...prev[m.id], loading: false, error: prosaDe(error),
      } }));
    }
  }

  async function consultar(refrescar = true) {
    const captured = target();
    if (!captured || clearing()) return;
    const request = ++detailRequest;
    setMidiendo(true);
    setReadError("");
    try {
      const value = await invoke<Almacen>("list_storage", { refrescar }, destination(captured));
      if (current(captured) && request === detailRequest) {
        dataTarget = captured;
        setDatos(value);
      }
    } catch (error) {
      if (current(captured) && request === detailRequest) setReadError(prosaDe(error));
    } finally {
      if (current(captured) && request === detailRequest) setMidiendo(false);
    }
  }

  function resetDetail() {
    detailRequest++;
    dataTarget = null;
    setDatos(null);
    setReadError("");
    setMidiendo(false);
    setAbiertas({});
    setGruposAbiertos({});
    setFallo({});
    setLiberado({});
    setCompartidoAbierto(false);
  }

  function choose(m: Machine) {
    if (clearing() || m.id === machine()) return;
    setMachine(m.id);
    resetDetail();
    void openInventory();
  }

  async function openInventory(expected?: Target, refreshDetail = true) {
    if (clearing() || (expected && !current(expected))) return;
    const context = expected?.generation ?? generation;
    const workspace = expected?.workspace ?? props.workspace;
    const request = ++inventoryRequest;
    setListing(true);
    setInventoryError("");
    try {
      const list = await invoke<Machine[]>("machine_list", {}, workspace
        ? { headers: { "x-terminus-workspace": workspace } } : undefined);
      if (disposed || context !== generation || workspace !== props.workspace || request !== inventoryRequest) return;
      setInventory((previous) => conservar(previous, list, (m) => m.id));
      if (!list.some((m) => m.id === machine())) {
        setMachine((list.find((m) => m.active) ?? list[0])?.id ?? null);
        resetDetail();
      }
      for (const m of list) if (m.on) void readSummary(m);
      void consultar(refreshDetail);
    } catch (error) {
      if (!disposed && context === generation && request === inventoryRequest) setInventoryError(prosaDe(error));
    } finally {
      if (!disposed && context === generation && request === inventoryRequest) setListing(false);
    }
  }

  createEffect(on(() => props.workspace, () => {
    generation++;
    inventoryRequest++;
    setInventory([]);
    setMachine(null);
    setSummaries({});
    setInventoryError("");
    setListing(false);
    resetDetail();
    if (abierto() && !clearing()) void openInventory();
  }));
  createEffect(on(abierto, (open) => {
    if (!open) return;
    let running = false;
    let alive = true;
    const sync = async () => {
      if (running || clearing() || listing() || document.visibilityState === "hidden") return;
      running = true;
      const context = generation;
      const workspace = props.workspace;
      const request = inventoryRequest;
      try {
        const list = await invoke<Machine[]>("machine_list");
        if (!alive || disposed || context !== generation || workspace !== props.workspace || request !== inventoryRequest) return;
        for (const m of list) {
          if (m.on || (!inventory().find((old) => old.id === m.id)?.on && !summaries()[m.id]?.loading)) continue;
          summaryRequests.set(m.id, (summaryRequests.get(m.id) ?? 0) + 1);
          setSummaries((prev) => ({ ...prev, [m.id]: { ...prev[m.id], loading: false, stale: true } }));
          if (m.id === machine()) {
            detailRequest++;
            setMidiendo(false);
            setReadError(t("shell.storage.offline"));
          }
        }
        if (!list.some((m) => m.id === machine())) {
          setMachine(null);
          resetDetail();
        }
        setInventoryError("");
        setInventory((previous) => conservar(previous, list, (m) => m.id));
      } catch (error) {
        if (alive && !disposed && context === generation && request === inventoryRequest) setInventoryError(prosaDe(error));
      } finally {
        running = false;
      }
    };
    const changed = () => { void sync(); };
    const timer = setInterval(changed, 5000);
    window.addEventListener("harness:machines", changed);
    window.addEventListener("focus", changed);
    onCleanup(() => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("harness:machines", changed);
      window.removeEventListener("focus", changed);
    });
  }));
  onCleanup(() => { disposed = true; generation++; detailRequest++; inventoryRequest++; });

  const clearing = operationPending;

  const tareas = createMemo(() => datos()?.tareas ?? []);
  /** El peso de la tarea más gorda: es la escala de las barras. */
  const tope = createMemo(() =>
    tareas().reduce((n, t) => Math.max(n, t.bytes), 0),
  );

  const grupos = createMemo<Grupo[]>(() => {
    const porProyecto = new Map<string, Grupo>();
    for (const tarea of tareas()) {
      const grupo = porProyecto.get(tarea.project) ?? {
        clave: tarea.project,
        nombre: tarea.proyecto ?? t("shell.storage.no_project"),
        tareas: [],
        bytes: 0,
        recuperable: 0,
      };
      grupo.tareas.push(tarea);
      grupo.bytes += tarea.bytes;
      grupo.recuperable += tarea.recuperable;
      porProyecto.set(tarea.project, grupo);
    }
    return [...porProyecto.values()].sort((a, b) => b.bytes - a.bytes);
  });

  const grupoAbierto = (clave: string) =>
    gruposAbiertos()[clave] ?? clave === grupos()[0]?.clave;

  const cuantasTareas = () =>
    tareas().length + (datos()?.archivadas?.cuantas ?? 0);
  const fraccionRecuperable = () => {
    const total = datos()?.bytes ?? 0;
    return total ? Math.min(1, (datos()?.recuperable ?? 0) / total) : 0;
  };

  async function clean(key: string, perform: (captured: Target) => Promise<Liberado>) {
    const captured = target();
    if (!captured || !canClean()) return;
    setOperationPending(true);
    setFallo((prev) => ({ ...prev, [key]: "" }));
    setLiberado((prev) => ({ ...prev, [key]: "" }));
    try {
      const list = await invoke<Machine[]>("machine_list", {}, {
        headers: { "x-terminus-workspace": captured.workspace },
      });
      if (!current(captured)) return;
      setInventory((previous) => conservar(previous, list, (m) => m.id));
      const ready = list.find((m) => m.id === captured.machine);
      if (!ready?.on || ready.hosts === false) {
        setFallo((prev) => ({ ...prev, [key]: !ready?.on ? t("shell.storage.offline") : t("shell.storage.workspace_missing") }));
        return;
      }
      const result = await perform(captured);
      if (current(captured)) {
        if (result.detalle) setFallo((prev) => ({ ...prev, [key]: result.detalle }));
        setLiberado((prev) => ({ ...prev, [key]: t("shell.storage.removed_logical", { size: peso(result.bytes) }) }));
      }
    } catch (error) {
      if (current(captured)) setFallo((prev) => ({ ...prev, [key]: prosaDe(error) }));
    } finally {
      setOperationPending(false);
      if (current(captured)) {
        await openInventory(captured, false);
      } else if (abierto()) {
        void openInventory();
      }
    }
  }

  async function vaciar(tarea: TareaConPeso, rutas: string[]) {
    const project = tarea.project;
    const session = tarea.session;
    const paths = [...rutas];
    await clean(`${project}/${session}`, (captured) => invoke<Liberado>("reclaim_storage", {
      project, session, rutas: paths,
    }, destination(captured)));
  }

  async function vaciarCache() {
    await clean("cache", (captured) => invoke<Liberado>("empty_build_cache", {}, destination(captured)));
  }

  async function recoger() {
    await clean("orphans", (captured) => invoke<Liberado>("collect_orphans", {}, destination(captured)));
  }

  function abrirTarea(tarea: TareaConPeso) {
    if (!selected()?.active || !dataTarget || !current(dataTarget)) return;
    setAbierto(false);
    props.onAbrirTarea(tarea.project, tarea.session);
  }

  /** Un botón de icono de la fila, con su globo. */
  function Accion(props2: {
    etiqueta: string;
    onClick: () => void;
    disabled?: boolean;
    tono?: "aviso";
    children: JSX.Element;
  }) {
    return (
      <TooltipRoot openDelay={RETARDO_TOOLTIP} placement="top">
        <TooltipTrigger
          as={(p: object) => (
            <button
              {...p}
              type="button"
              class={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-sm outline-none hover:bg-surface-muted focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:opacity-60",
                props2.tono === "aviso"
                  ? "text-warning-strong"
                  : "text-neutral-500 hover:text-neutral-950",
              )}
              disabled={props2.disabled}
              aria-label={props2.etiqueta}
              // Reenvía el clic del disparador antes de hacer lo suyo: Kobalte
              // no compone manejadores como hacía Radix con `asChild`, así que
              // un `onClick` encima del `{...p}` borra el que cierra el globo.
              // Lo comprueba `tests/unit/triggers.test.mjs`.
              onClick={(e: MouseEvent) => {
                (p as { onClick?: (e: MouseEvent) => void }).onClick?.(e);
                props2.onClick();
              }}
            >
              {props2.children}
            </button>
          )}
        />
        <TooltipContent class="whitespace-nowrap">
          {props2.etiqueta}
        </TooltipContent>
      </TooltipRoot>
    );
  }

  /** Ámbar lo que se puede tirar, gris lo que se conserva. */
  function Barra(props2: { bytes: number; recuperable: number; escala: number; alto?: string }) {
    const ancho = () => (props2.escala ? (props2.bytes / props2.escala) * 100 : 0);
    const tirable = () => (props2.bytes ? (props2.recuperable / props2.bytes) * 100 : 0);
    return (
      <span class={cn("flex w-full overflow-hidden rounded-full bg-surface-muted", props2.alto ?? "h-1")}>
        <span class="flex h-full" style={{ width: `${ancho()}%` }}>
          <span class="h-full bg-warning-strong/80" style={{ width: `${tirable()}%` }} />
          <span class="h-full flex-1 bg-neutral-500/45" />
        </span>
      </span>
    );
  }

  function Estado(props2: { session: string }) {
    return (
      <Show when={selected()?.active}>
      <Show
        when={props.trabajando.includes(props2.session)}
        fallback={
          <Show when={props.conPestana.includes(props2.session)}>
            <Badge class="px-1.5 py-0 text-[0.625rem]">{t("shell.storage.state.open_tab")}</Badge>
          </Show>
        }
      >
        <Badge tone="success" class="px-1.5 py-0 text-[0.625rem]">{t("shell.storage.state.working")}</Badge>
      </Show>
      </Show>
    );
  }

  /**
   * Una tarea: su título, cuándo se tocó, su peso y su barra; abierta, sus
   * bloques con nombre. Al pasar por encima, el peso cede a abrir y vaciar.
   */
  function Fila(props2: { t: TareaConPeso; conProyecto?: boolean }) {
    const clave = () => `${props2.t.project}/${props2.t.session}`;
    const abierta = () => !!abiertas()[clave()];
    const tirables = () => props2.t.bloques.filter((b) => b.clase === "recuperable");
    const vaciarTodo = () => void vaciar(props2.t, tirables().map((b) => b.rel));
    return (
      <li class={cn("group rounded-md", abierta() && "bg-surface-muted/60")}>
        <div class="flex min-w-0 items-center gap-1 rounded-md pr-1.5 hover:bg-surface-muted focus-within:bg-surface-muted">
          <button
            type="button"
            class="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pl-1.5 text-left outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
            aria-expanded={abierta()}
            onClick={() =>
              setAbiertas((a) => ({ ...a, [clave()]: !a[clave()] }))
            }
          >
            <Show when={abierta()} fallback={<ChevronRight size={12} class="shrink-0 text-neutral-500" aria-hidden />}>
              <ChevronDown size={12} class="shrink-0 text-neutral-500" aria-hidden />
            </Show>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-xs font-medium text-neutral-950">
                {props2.t.tarea}
              </span>
              <span class="flex min-w-0 items-center gap-1.5 text-[0.6875rem] text-neutral-500">
                <Show when={props2.conProyecto && props2.t.proyecto}>
                  {(p) => <span class="truncate">{p()}</span>}
                </Show>
                <Show when={actividadDe(props2.t.actividad)}>
                  {(a) => <span class="shrink-0">{a()}</span>}
                </Show>
                <Estado session={props2.t.session} />
              </span>
            </span>
          </button>
          <span class="shrink-0 font-mono text-xs tabular-nums text-neutral-950 group-hover:hidden group-focus-within:hidden">
            {peso(props2.t.bytes)}
          </span>
          <span class="hidden shrink-0 items-center gap-0.5 group-hover:flex group-focus-within:flex">
            <Accion disabled={!selected()?.active} etiqueta={t("shell.storage.open_task")} onClick={() => abrirTarea(props2.t)}>
              <SquareArrowOutUpRight size={12} aria-hidden />
            </Accion>
            <Show when={tirables().length}>
              <Accion
                etiqueta={t("shell.storage.empty_task", { size: peso(props2.t.recuperable) })}
                tono="aviso"
                disabled={!canClean()}
                onClick={vaciarTodo}
              >
                <Trash2 size={12} aria-hidden />
              </Accion>
            </Show>
          </span>
        </div>
        {/* La escala es el peso de la tarea más gorda, no el total del
            workspace: comparadas contra el total, todas las filas salen
            igual de cortas y la barra deja de decir nada. */}
        <div class="pb-1.5 pl-6 pr-1.5">
          <Barra bytes={props2.t.bytes} recuperable={props2.t.recuperable} escala={tope()} />
        </div>

        <Show when={abierta()}>
          <ul class="m-0 list-none pb-2 pl-6 pr-1.5">
            <For each={props2.t.bloques}>
              {(b) => (
                <li class="flex min-w-0 items-center gap-2 py-1">
                  <span class="min-w-0 flex-1">
                    <span
                      class={cn(
                        "block truncate text-xs",
                        b.clase === "recuperable" ? "text-neutral-950" : "text-neutral-700",
                      )}
                    >
                      {nombreBloque(b)}
                    </span>
                    <span class="block truncate font-mono text-[0.625rem] text-neutral-500">
                      {b.rel}
                    </span>
                  </span>
                  <span class="shrink-0 font-mono text-[0.6875rem] tabular-nums text-neutral-500">
                    {peso(b.bytes)}
                  </span>
                  {/* Solo lo recuperable lleva botón. Un bloque de fuente o de
                      `.git` no tiene gesto de tirarlo, y esa ausencia es la
                      explicación. */}
                  <Show
                    when={b.clase === "recuperable"}
                    fallback={<span class="size-6 shrink-0" aria-hidden />}
                  >
                    <Accion
                      etiqueta={t("shell.storage.empty_one")}
                      tono="aviso"
                      disabled={!canClean()}
                      onClick={() => void vaciar(props2.t, [b.rel])}
                    >
                      <Trash2 size={12} aria-hidden />
                    </Accion>
                  </Show>
                </li>
              )}
            </For>

            <li class="flex flex-wrap items-center gap-2 pt-1.5">
              <button
                type="button"
                class="flex items-center gap-1.5 rounded-md border border-border-strong bg-surface px-2 py-1 text-[0.6875rem] font-medium text-neutral-950 outline-none hover:bg-surface-muted focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                disabled={!selected()?.active}
                onClick={() => abrirTarea(props2.t)}
              >
                <SquareArrowOutUpRight size={12} aria-hidden />
                {t("shell.storage.open_task")}
              </button>
              <Show when={tirables().length}>
                <button
                  type="button"
                  class="flex items-center gap-1.5 rounded-md border border-warning-strong/40 bg-warning/10 px-2 py-1 text-[0.6875rem] font-medium text-warning-strong outline-none hover:bg-warning/20 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:opacity-60"
                  disabled={!canClean()}
                  onClick={vaciarTodo}
                >
                  <Trash2 size={12} aria-hidden />
                  {t("shell.storage.empty_task", {
                    size: peso(props2.t.recuperable),
                  })}
                </button>
              </Show>
            </li>

            {/* Lo que pasó cuando no se pudo, en la fila que lo pidió: un botón
                que no hace nada y no dice por qué manda a pulsarlo otra vez. */}
            <Show when={fallo()[clave()]}>
              {(f) => (
                <li class="py-0.5 text-[0.6875rem] text-warning-strong">{f()}</li>
              )}
            </Show>
            <Show when={liberado()[clave()]}>
              {(l) => (
                <li class="py-0.5 text-[0.6875rem] text-neutral-500">{l()}</li>
              )}
            </Show>
          </ul>
        </Show>
      </li>
    );
  }

  function GrupoDeProyecto(props2: { g: Grupo }) {
    const abiertoG = () => grupoAbierto(props2.g.clave);
    return (
      <li>
        <button
          type="button"
          class="flex w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left outline-none hover:bg-surface-muted focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
          aria-expanded={abiertoG()}
          onClick={() =>
            setGruposAbiertos((g) => ({ ...g, [props2.g.clave]: !abiertoG() }))
          }
        >
          <Show when={abiertoG()} fallback={<ChevronRight size={12} class="shrink-0 text-neutral-500" aria-hidden />}>
            <ChevronDown size={12} class="shrink-0 text-neutral-500" aria-hidden />
          </Show>
          <Folder size={12} class="shrink-0 text-neutral-500" aria-hidden />
          <span class="truncate text-xs font-semibold text-neutral-950">{props2.g.nombre}</span>
          <span class="shrink-0 text-[0.6875rem] text-neutral-500">
            {t("shell.storage.group.tasks", { count: props2.g.tareas.length })}
          </span>
          <span class="ml-auto flex shrink-0 items-center gap-2">
            <Show when={props2.g.recuperable > 0}>
              <span class="text-[0.6875rem] text-warning-strong">
                {t("shell.storage.group.reclaimable", { size: peso(props2.g.recuperable) })}
              </span>
            </Show>
            <span class="font-mono text-xs font-semibold tabular-nums text-neutral-950">
              {peso(props2.g.bytes)}
            </span>
          </span>
        </button>
        <Show when={abiertoG()}>
          <ul class="m-0 list-none pl-3">
            <For each={props2.g.tareas}>{(tarea) => <Fila t={tarea} />}</For>
          </ul>
        </Show>
      </li>
    );
  }

  function comparable(disk: MachineResources["storage"][number]) {
    return [disk.total_bytes, disk.free_bytes, disk.available_bytes].every((n) => Number.isFinite(n) && n >= 0)
      && (disk.total_bytes > 0) && disk.free_bytes <= disk.total_bytes && disk.available_bytes <= disk.free_bytes;
  }

  const summaryStale = (m: Machine, summary: Summary | undefined) => !!summary?.resources
    && (!m.on || !!summary.stale || !!summary.error || Date.now() - summary.resources.measured_at > 300_000);

  function Disk(props2: { disk: MachineResources["storage"][number] }) {
    const used = () => props2.disk.total_bytes - props2.disk.free_bytes;
    return (
      <div class="mt-2">
        <p class="m-0 truncate text-[0.6875rem] text-neutral-500">{t("shell.storage.engine_data")}</p>
        <Show when={comparable(props2.disk)} fallback={<p class="m-0 text-xs text-neutral-500">{t("shell.storage.capacity_unavailable")}</p>}>
          <ProgressBar class="my-1.5 h-2 border border-neutral-500" value={used()} max={props2.disk.total_bytes}
            label={t("shell.storage.disk_aria", { used: peso(used()), free: peso(props2.disk.free_bytes), total: peso(props2.disk.total_bytes) })}
            barClass="bg-neutral-500" />
          <p class="m-0 flex flex-wrap gap-x-3 text-[0.6875rem] text-neutral-500">
            <span>{t("shell.storage.disk_used", { size: peso(used()) })}</span>
            <span>{t("shell.storage.disk_free", { size: peso(props2.disk.free_bytes) })}</span>
            <span>{t("shell.storage.disk_total", { size: peso(props2.disk.total_bytes) })}</span>
          </p>
          <Show when={props2.disk.available_bytes !== props2.disk.free_bytes}>
            <p class="m-0 mt-1 text-[0.6875rem] text-neutral-500">{t("shell.storage.disk_available", { size: peso(props2.disk.available_bytes) })}</p>
          </Show>
        </Show>
      </div>
    );
  }

  function MachineDisks(props2: { machine: Machine }) {
    const summary = () => summaries()[props2.machine.id];
    return (
      <>
        <Show when={summary()?.loading}><p class="m-0 mt-1 text-xs text-neutral-500">{t("shell.storage.measuring")}</p></Show>
        <Show when={summary()?.error}><p role="alert" class="m-0 mt-1 whitespace-pre-wrap text-xs text-error-strong">{summary()?.error}</p></Show>
        <Show when={summaryStale(props2.machine, summary())}><p role="status" class="m-0 mt-1 text-xs text-warning-strong">{t("shell.storage.stale")}</p></Show>
        <Show when={summary()?.resources} fallback={<Show when={!summary()?.loading}><p class="m-0 mt-1 text-xs text-neutral-500">{t("shell.storage.capacity_unavailable")}</p></Show>}>
          {(resources) => <>
            <Show when={resources().error}>
              <p role="alert" class="m-0 mt-1 text-xs text-warning-strong">{resources().error === "measurement_failed" ? t("shell.storage.measurement_failed") : t("shell.storage.unsupported")}</p>
            </Show>
            <p class="m-0 mt-1 text-[0.6875rem] text-neutral-500">{resources().error ? t("shell.storage.attempted", { when: haceCuanto(resources().measured_at) }) : t("shell.storage.measured", { when: haceCuanto(resources().measured_at) })}</p>
            <For each={resources().storage}>{(disk) => <Disk disk={disk} />}</For>
            <Show when={resources().storage.length === 0 && !resources().error}><p class="m-0 mt-1 text-xs text-neutral-500">{t("shell.storage.capacity_unavailable")}</p></Show>
          </>}
        </Show>
        <p class="m-0 mt-2 text-[0.6875rem] text-neutral-500">{t("shell.storage.attribution_unknown")}</p>
      </>
    );
  }

  function MachineRow(props2: { machine: Machine }) {
    const summary = () => summaries()[props2.machine.id];
    return (
      <button type="button" data-storage-machine={props2.machine.id} disabled={clearing()} aria-pressed={machine() === props2.machine.id}
        class={cn("block w-full border-b border-border px-3 py-2 text-left outline-none hover:bg-surface-muted focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-60", machine() === props2.machine.id && "bg-surface-muted")}
        onClick={() => choose(props2.machine)}>
        <span class="flex items-center justify-between gap-2 text-xs">
          <span class="truncate font-semibold text-neutral-950">{machineName(props2.machine.id, props2.machine.local)}</span>
          <span class="shrink-0 text-neutral-500">{!props2.machine.on ? t("shell.storage.offline") : summary()?.loading ? t("shell.storage.measuring") : summary()?.error || summary()?.resources?.error ? t("shell.storage.summary_error") : t("shell.machines.on")}</span>
        </span>
        <Show when={summary()?.resources} fallback={<span class="block mt-1 text-[0.6875rem] text-neutral-500">{t("shell.storage.capacity_unavailable")}</span>}>
          {(resources) => <>
            <span class="block mt-1 text-[0.6875rem] text-neutral-500">{resources().error ? t("shell.storage.attempted", { when: haceCuanto(resources().measured_at) }) : t("shell.storage.measured", { when: haceCuanto(resources().measured_at) })}</span>
            <Show when={summaryStale(props2.machine, summary())}><span class="block mt-1 text-[0.6875rem] text-warning-strong">{t("shell.storage.stale")}</span></Show>
            <For each={resources().storage}>{(disk) => <Disk disk={disk} />}</For>
          </>}
        </Show>
      </button>
    );
  }

  return (
    <Popover
      open={abierto()}
      onOpenChange={(v: boolean) => {
        setAbierto(v);
        if (v && !clearing()) void openInventory();
      }}
      placement="top"
      gutter={6}
    >
      {/* El disparador **no lleva `onClick` propio**: Kobalte no compone
          manejadores como hacía Radix con `asChild`, así que el último gana y el
          panel dejaría de abrirse. Lo que hay que hacer al abrir va en
          `onOpenChange`. */}
      <PopoverTrigger
        as={(p: object) => (
          <button
            {...p}
            class="flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5 text-neutral-500 outline-none transition-colors hover:bg-surface-muted hover:text-neutral-950 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary data-[expanded]:bg-surface-muted"
            aria-label={t("shell.storage.title")}
            title={t("shell.storage.title")}
          >
            <HardDrive
              size={12}
              class={midiendo() || clearing() ? "animate-pulse" : undefined}
              aria-hidden
            />
            <span>{t("shell.storage.title")}</span>
          </button>
        )}
      />

      <PopoverContent
        class="flex max-h-[min(560px,var(--kb-popper-content-available-height))] w-[520px] max-w-[calc(100vw-16px)] flex-col p-0"
        onOpenAutoFocus={(e: Event) => e.preventDefault()}
      >
        <div class="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
          <h2 class="m-0 flex items-center gap-1.5 text-xs font-semibold text-neutral-950">
            <HardDrive size={12} class="text-neutral-500" aria-hidden />
            {t("shell.storage.title")}
          </h2>
          <span class="flex items-center gap-1">
            <span class="font-mono text-[0.6875rem] tabular-nums text-neutral-500">
              {clearing()
                ? t("shell.storage.emptying")
                : midiendo()
                  ? t("shell.storage.measuring")
                  : datos() ? haceCuanto(datos()!.medido_en) : ""}
            </span>
            <Accion
              etiqueta={inventoryError() || readError() || summaries()[machine() ?? ""]?.error || summaries()[machine() ?? ""]?.resources?.error ? t("shell.storage.retry") : t("shell.storage.remeasure")}
              disabled={midiendo() || clearing() || listing()}
              onClick={() => void openInventory()}
            >
              <RefreshCw size={12} class={midiendo() ? "animate-spin-steps" : undefined} aria-hidden />
            </Accion>
          </span>
        </div>

        <div class="min-h-0 overflow-y-auto">
          <Show when={inventoryError()}>
            <p role="alert" class="m-0 px-3 py-2 text-xs text-error-strong">{inventoryError()}</p>
          </Show>
          <Show when={listing()}>
            <p role="status" class="m-0 px-3 py-2 text-xs text-neutral-500">{t("shell.storage.measuring")}</p>
          </Show>
          <Show when={!listing() && !inventoryError() && inventory().length === 0}>
            <p class="m-0 px-3 py-2 text-xs text-neutral-500">{t("shell.storage.no_machines")}</p>
          </Show>
          <For each={inventory()}>{(m) => <MachineRow machine={m} />}</For>
          <Show when={selected()}>{(m) => (
            <section class="border-b border-border px-3 py-3">
              <h3 class="m-0 text-xs font-semibold text-neutral-950">{machineName(m().id, m().local)}</h3>
              <MachineDisks machine={m()} />
              <p class="m-0 mt-3 text-xs font-semibold text-neutral-950">
                {t("shell.storage.workspace_scope", { workspace: summaries()[m().id]?.workspaceName ?? props.workspace ?? "—" })}
              </p>
              <Show when={!m().on}>
                <p role="status" class="m-0 mt-1 text-xs text-warning-strong">{t("shell.storage.offline")}</p>
              </Show>
              <Show when={m().hosts === false || !props.workspace}>
                <p role="status" class="m-0 mt-1 text-xs text-neutral-500">{t("shell.storage.workspace_missing")}</p>
              </Show>
              <Show when={readError()}>
                <p role="alert" class="m-0 mt-1 whitespace-pre-wrap text-xs text-error-strong">{readError()}</p>
              </Show>
              <Show when={midiendo()}>
                <p role="status" class="m-0 mt-1 text-xs text-neutral-500">{t("shell.storage.measuring")}</p>
              </Show>
              <Show when={datos()?.aviso}>
                <p role="status" class="m-0 mt-1 text-xs text-warning-strong">{t("shell.storage.incomplete")} {datos()?.aviso}</p>
              </Show>
              <Show when={datos()}>
                <p class="m-0 mt-1 text-[0.6875rem] text-neutral-500">{t("shell.storage.measured", { when: haceCuanto(datos()!.medido_en) })}</p>
                <Show when={!m().on || !!readError() || Date.now() - datos()!.medido_en > 300_000}>
                  <p role="status" class="m-0 mt-1 text-xs text-warning-strong">{t("shell.storage.stale")}</p>
                </Show>
              </Show>
            </section>
          )}</Show>
        <Show when={datos()}>
          <div class="flex shrink-0 flex-col gap-2 border-b border-border px-3 py-3">
            <p class="m-0 flex items-baseline gap-2">
              <span class="font-mono text-lg font-semibold tabular-nums text-neutral-950">
                {peso(datos()?.bytes ?? 0)}
              </span>
              <span class="text-[0.6875rem] text-neutral-500">
                {t("shell.storage.in_tasks", { count: cuantasTareas() })}
              </span>
            </p>
            <span class="flex h-2 w-full overflow-hidden rounded-full bg-surface-muted">
              <span class="h-full bg-warning-strong/80" style={{ width: `${fraccionRecuperable() * 100}%` }} />
              <span class="h-full flex-1 bg-neutral-500/45" />
            </span>
            <p class="m-0 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.6875rem]">
              <span class="flex items-center gap-1 font-medium text-warning-strong">
                <span class="size-1.5 rounded-full bg-warning-strong" aria-hidden />
                {t("shell.storage.reclaimable", { size: peso(datos()?.recuperable ?? 0) })}
              </span>
              <span class="flex items-center gap-1 text-neutral-500">
                <span class="size-1.5 rounded-full bg-neutral-500" aria-hidden />
                {t("shell.storage.permanent", {
                  size: peso(
                    Math.max(0, (datos()?.bytes ?? 0) - (datos()?.recuperable ?? 0)),
                  ),
                })}
              </span>
            </p>
          </div>

          <div class="flex shrink-0 items-center px-3 pt-2">
            <div class="flex items-center gap-0.5 rounded-md bg-surface-muted p-0.5" role="group">
              <For each={["proyecto", "tarea"] as const}>
                {(v) => (
                  <button
                    type="button"
                    class={cn(
                      "rounded-sm px-2 py-0.5 text-[0.6875rem] outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-primary",
                      vista() === v
                        ? "bg-surface font-medium text-neutral-950 shadow-sm"
                        : "text-neutral-500 hover:text-neutral-950",
                    )}
                    aria-pressed={vista() === v}
                    onClick={() => setVista(v)}
                  >
                    {v === "proyecto" ? t("shell.storage.view.by_project") : t("shell.storage.view.by_task")}
                  </button>
                )}
              </For>
            </div>
          </div>

          <div class="px-1.5 pb-1.5 pt-1">
            <Show
              when={tareas().length || (datos()?.archivadas?.cuantas ?? 0)}
              fallback={
                <p class="m-0 px-3 py-4 text-center text-xs text-neutral-500">
                  {clearing()
                    ? t("shell.storage.emptying")
                    : midiendo()
                      ? t("shell.storage.measuring")
                      : t("shell.storage.none")}
                </p>
              }
            >
              <Show
                when={vista() === "proyecto"}
                fallback={
                  <ul class="m-0 list-none p-0">
                    <For each={tareas()}>{(tarea) => <Fila t={tarea} conProyecto />}</For>
                  </ul>
                }
              >
                <ul class="m-0 list-none p-0">
                  <For each={grupos()}>{(g) => <GrupoDeProyecto g={g} />}</For>
                </ul>
              </Show>
              <Show when={(datos()?.archivadas?.cuantas ?? 0) > 0}>
                <section class="mt-1 border-t border-border px-1.5 py-2">
                  <div class="flex items-center gap-2">
                    <span class="min-w-0 flex-1 text-[0.6875rem] font-semibold uppercase tracking-wide text-neutral-500">
                      {t("shell.storage.archived", {
                        n: datos()?.archivadas?.cuantas ?? 0,
                      })}
                    </span>
                    <span class="shrink-0 font-mono text-[0.6875rem] tabular-nums text-neutral-500">
                      {peso(datos()?.archivadas?.bytes ?? 0)}
                    </span>
                  </div>
                  <p class="m-0 mt-0.5 text-[0.6875rem] text-neutral-500">
                    {t("shell.storage.archived.why")}
                  </p>
                </section>
              </Show>
            </Show>

            {/* Plegado por omisión: no es accionable desde aquí. Se abre para
                contestar «¿y el resto de dónde sale?», que es la pregunta que
                deja un total mayor que la suma de las filas. */}
            <section class="border-t border-border">
              <button
                type="button"
                class="flex w-full items-center gap-1.5 px-1.5 py-2 text-left text-[0.6875rem] font-semibold uppercase tracking-wide text-neutral-500 outline-none hover:bg-surface-muted hover:text-neutral-950 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                aria-expanded={compartidoAbierto()}
                onClick={() => setCompartidoAbierto((v) => !v)}
              >
                <Show
                  when={compartidoAbierto()}
                  fallback={<ChevronRight size={12} aria-hidden />}
                >
                  <ChevronDown size={12} aria-hidden />
                </Show>
                <span>{t("shell.storage.shared")}</span>
                <span class="ml-auto font-mono tabular-nums">
                  {peso(
                    (datos()?.compartido ?? []).reduce((n, s) => n + s.bytes, 0),
                  )}
                </span>
              </button>
              <Show when={compartidoAbierto()}>
                {/* El motor limita esta caché al workspace capturado. */}
                <ul
                  class="m-0 list-none px-1.5 pb-2.5"
                  title={t("shell.storage.shared.why")}
                >
                  <For each={datos()?.compartido ?? []}>
                    {(s) => (
                      <li class="flex min-w-0 items-center gap-2 py-0.5">
                        <span class="min-w-0 flex-1 truncate text-[0.6875rem] text-neutral-500">
                          {s.etiqueta}
                        </span>
                        <span class="shrink-0 font-mono text-[0.6875rem] tabular-nums text-neutral-500">
                          {peso(s.bytes)}
                        </span>
                        <Show when={s.rel}>
                          <Accion etiqueta={t("shell.storage.empty_cache")} tono="aviso"
                            disabled={!canClean()} onClick={() => void vaciarCache()}>
                            <Trash2 size={12} aria-hidden />
                          </Accion>
                        </Show>
                      </li>
                    )}
                  </For>
                </ul>
                <Show when={liberado().cache}>
                  <p role="status" class="m-0 px-1.5 pb-2 text-xs text-neutral-500">{liberado().cache}</p>
                </Show>
                <Show when={fallo().cache}>
                  <p role="alert" class="m-0 px-1.5 pb-2 text-xs text-error-strong">{fallo().cache}</p>
                </Show>
              </Show>
            </section>

            <Show when={fallo().orphans}>
              <p role="alert" class="m-0 px-1.5 py-2 text-xs text-error-strong">{fallo().orphans}</p>
            </Show>
            <Show when={liberado().orphans}>
              <p role="status" class="m-0 px-1.5 py-2 text-xs text-neutral-500">{liberado().orphans}</p>
            </Show>
            {/* Lo que quedó de tareas borradas. Solo se pinta si hay: una
                sección permanente que dice «nada» es alto robado. */}
            <Show when={datos()?.sueltos.length}>
              <section class="border-t border-border px-1.5 py-2">
                <div class="flex items-center gap-2">
                  <span class="min-w-0 flex-1 text-[0.6875rem] font-semibold uppercase tracking-wide text-neutral-500">
                    {t("shell.storage.orphans", {
                      n: datos()?.sueltos.length ?? 0,
                    })}
                  </span>
                  <span class="shrink-0 font-mono text-[0.6875rem] tabular-nums text-neutral-500">
                    {peso((datos()?.sueltos ?? []).reduce((n, s) => n + s.bytes, 0))}
                  </span>
                  <Accion
                    etiqueta={t("shell.storage.collect")}
                    tono="aviso"
                    disabled={!canClean()}
                    onClick={() => void recoger()}
                  >
                    <Trash2 size={12} />
                  </Accion>
                </div>
                <p class="m-0 mt-0.5 text-[0.6875rem] text-neutral-500">
                  {t("shell.storage.orphans.why")}
                </p>
              </section>
            </Show>
          </div>
        </Show>
        </div>
      </PopoverContent>
    </Popover>
  );
}
