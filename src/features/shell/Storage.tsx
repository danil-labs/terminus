import type { JSX } from "solid-js";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
} from "solid-js";
import { invoke } from "../../lib/invoke.ts";
import { t } from "../../lib/i18n";
import { peso } from "../../lib/format";
import { storageRefresh } from "../../lib/storageRefresh";
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
import { prosaDe } from "../../ui/Failure";

// El repositorio principal es de la persona; se mide el workspace, incluidos
// sus worktrees. Refrescar solo la sesión deja fuera lo que más puede crecer.

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
  /** La tarea que se está vaciando: sus botones se bloquean solos. */
  const [vaciando, setVaciando] = createSignal<Record<string, boolean>>({});
  /** Lo que dijo el backend cuando no se pudo, en la fila que lo pidió. */
  const [fallo, setFallo] = createSignal<Record<string, string>>({});
  /** Lo que se liberó, en la fila que lo pidió. Un borrado sin confirmación se
   *  lee como que no pasó nada: la lista se reordena y ya. */
  const [liberado, setLiberado] = createSignal<Record<string, string>>({});
  const [recogiendo, setRecogiendo] = createSignal(false);
  /** La caché de compilación se está vaciando: su botón se bloquea solo. */
  const [vaciandoCache, setVaciandoCache] = createSignal(false);

  const refresh = storageRefresh<Almacen>({
    read: (refrescar) => invoke<Almacen>("list_storage", { refrescar }),
    receive: setDatos,
    measuring: setMidiendo,
    fail: (e) => setDatos((previo) => ({
      tareas: [], archivadas: { cuantas: 0, bytes: 0, recuperable: 0 },
      bytes: 0, recuperable: 0, compartido: [], sueltos: [], medido_en: 0,
      ...previo,
      aviso: prosaDe(e),
    })),
  });
  const consultar = refresh.refresh;

  onMount(() => {
    const freshness = 300_000;
    let disposed = false;
    let runningTurns = 0;
    let lastRefresh = 0;
    let scheduled: ReturnType<typeof setTimeout> | undefined;
    // Cerrado se mide una vez por arranque. El barrido recorre `node_modules` y
    // `target` de cada tarea: medido en un log de 4 h 43, 112 barridos, 55 s de
    // mediana y 2 h 43 de disco, con el panel cerrado casi todo el rato.
    let medidoCerrado = false;
    const update = () => {
      // Medir encima de un borrado devuelve una foto a medias; el que borra
      // pide la suya al acabar.
      if (clearing()) return;
      if (!abierto()) {
        // Con un turno vivo el barrido le compite el disco.
        if (runningTurns > 0) return;
        if (medidoCerrado) return;
        medidoCerrado = true;
      }
      lastRefresh = Date.now();
      void consultar(true);
    };
    const schedule = () => {
      if (scheduled !== undefined) return;
      scheduled = setTimeout(() => {
        scheduled = undefined;
        update();
      }, Math.max(1500, freshness - (Date.now() - lastRefresh)));
    };
    const visible = () => {
      if (document.visibilityState === "visible") schedule();
    };
    createEffect(on(abierto, (open) => open && schedule(), { defer: true }));
    const turnsChanged = (event: Event) => {
      runningTurns = (event as CustomEvent<number>).detail;
      if (runningTurns === 0) schedule();
    };
    const changed = () => {
      medidoCerrado = false;
      setDatos(null);
      setAbiertas({});
      setGruposAbiertos({});
      setFallo({});
      setLiberado({});
      lastRefresh = Date.now();
      void refresh.reset();
    };
    const mountedAt = Date.now();
    void consultar(false).then(() => {
      lastRefresh = datos()?.medido_en ?? 0;
      if (!disposed && lastRefresh < mountedAt - freshness) schedule();
    });
    const interval = setInterval(visible, freshness);
    window.addEventListener("harness:turn", turnsChanged);
    window.addEventListener("harness:workspace", changed);
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    onCleanup(() => {
      disposed = true;
      refresh.dispose();
      clearTimeout(scheduled);
      clearInterval(interval);
      window.removeEventListener("harness:turn", turnsChanged);
      window.removeEventListener("harness:workspace", changed);
      window.removeEventListener("focus", visible);
      document.removeEventListener("visibilitychange", visible);
    });
  });

  /** Hay un borrado en marcha. Un `remove_dir_all` de decenas de gigas tarda
   *  minutos, y lo que se mida encima suena a que el disco está roto: el panel
   *  espera en vez de contar a medias. */
  const clearing = createMemo(
    () =>
      vaciandoCache() ||
      recogiendo() ||
      Object.values(vaciando()).some(Boolean),
  );

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

  async function vaciar(tarea: TareaConPeso, rutas: string[]) {
    const clave = `${tarea.project}/${tarea.session}`;
    setVaciando((v) => ({ ...v, [clave]: true }));
    setFallo((f) => ({ ...f, [clave]: "" }));
    setLiberado((l) => ({ ...l, [clave]: "" }));
    try {
      const r = await invoke<Liberado>("reclaim_storage", {
        project: tarea.project,
        session: tarea.session,
        rutas,
      });
      if (r.detalle) setFallo((f) => ({ ...f, [clave]: r.detalle }));
      if (r.cuantos) {
        const frase = t("shell.storage.freed", { size: peso(r.bytes) });
        setLiberado((l) => ({ ...l, [clave]: frase }));
      }
    } catch (e) {
      setFallo((f) => ({ ...f, [clave]: prosaDe(e) }));
    } finally {
      setVaciando((v) => ({ ...v, [clave]: false }));
      // El comando de limpieza ya actualizó la medición del workspace.
      await consultar(false);
    }
  }

  async function vaciarCache() {
    setVaciandoCache(true);
    try {
      const r = await invoke<Liberado>("empty_build_cache");
      if (r.cuantos) {
        const frase = t("shell.storage.freed", { size: peso(r.bytes) });
        setLiberado((l) => ({ ...l, cache: frase }));
      }
    } catch (e) {
      setFallo((f) => ({ ...f, cache: prosaDe(e) }));
    } finally {
      setVaciandoCache(false);
      await consultar(false);
    }
  }

  async function recoger() {
    setRecogiendo(true);
    try {
      await invoke<Liberado>("collect_orphans");
    } catch {
      // No hay nada que la persona pueda arreglar desde aquí: lo que quede se
      // vuelve a enseñar en la lista, que es la señal.
    } finally {
      setRecogiendo(false);
      await consultar(false);
    }
  }

  function abrirTarea(tarea: TareaConPeso) {
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
              // Lo comprueba `scripts/triggers.test.mjs`.
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
            <Accion etiqueta={t("shell.storage.open_task")} onClick={() => abrirTarea(props2.t)}>
              <SquareArrowOutUpRight size={12} aria-hidden />
            </Accion>
            <Show when={tirables().length}>
              <Accion
                etiqueta={t("shell.storage.empty_task", { size: peso(props2.t.recuperable) })}
                tono="aviso"
                disabled={vaciando()[clave()]}
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
                      disabled={vaciando()[clave()]}
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
                onClick={() => abrirTarea(props2.t)}
              >
                <SquareArrowOutUpRight size={12} aria-hidden />
                {t("shell.storage.open_task")}
              </button>
              <Show when={tirables().length}>
                <button
                  type="button"
                  class="flex items-center gap-1.5 rounded-md border border-warning-strong/40 bg-warning/10 px-2 py-1 text-[0.6875rem] font-medium text-warning-strong outline-none hover:bg-warning/20 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:opacity-60"
                  disabled={vaciando()[clave()]}
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

  return (
    <Popover
      open={abierto()}
      onOpenChange={(v: boolean) => {
        setAbierto(v);
        if (v && !clearing()) void consultar(true);
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
            aria-label={datos()?.aviso ? t("shell.storage.unavailable") : !datos()
              ? t("shell.storage.measuring")
              : t("shell.storage.aria", {
                total: peso(datos()?.bytes ?? 0),
                free: peso(datos()?.recuperable ?? 0),
              })}
            title={clearing()
              ? t("shell.storage.emptying")
              : midiendo()
                ? t("shell.storage.measuring")
                : haceCuanto(datos()?.medido_en ?? 0)}
          >
            <HardDrive
              size={12}
              class={midiendo() || clearing() ? "animate-pulse" : undefined}
              aria-hidden
            />
            <span class="font-mono tabular-nums">{datos()?.aviso
              ? t("shell.storage.unavailable")
              : datos() ? peso(datos()?.bytes ?? 0) : t("shell.storage.measuring")}</span>
          </button>
        )}
      />

      <PopoverContent
        class="flex max-h-[min(560px,var(--kb-popper-content-available-height))] w-[440px] flex-col p-0"
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
                  : haceCuanto(datos()?.medido_en ?? Date.now())}
            </span>
            <Accion
              etiqueta={t("shell.storage.remeasure")}
              disabled={midiendo() || clearing()}
              onClick={() => void consultar(true)}
            >
              <RefreshCw size={12} class={midiendo() ? "animate-spin-steps" : undefined} aria-hidden />
            </Accion>
          </span>
        </div>

        <Show
          when={!datos()?.aviso || clearing()}
          fallback={
            /* No se pudo medir. **Se dice, y no se enseña un panel vacío**: una
               lista sin filas se lee como «no ocupa nada», que es otra cosa.
               Mientras se borra no se dice: las rutas que faltan son las que se
               están llevando, y el aviso acusaría al disco de lo que hizo la
               persona. */
            <p class="m-0 px-3 py-4 text-xs text-warning-strong">
              {t("shell.storage.incomplete")}
              <span class="block whitespace-pre-wrap font-mono">{datos()?.aviso}</span>
            </p>
          }
        >
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

          <div class="min-h-0 flex-1 overflow-y-auto px-1.5 pb-1.5 pt-1">
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
                {/* Casi todo aquí se enseña y no se toca: el material se
                    gestiona en Contexto y las cuentas en Configuración, que es
                    donde cada cosa tiene su gesto. La excepción es la que no
                    tiene ninguno —la caché de compilación—, y por eso trae
                    `rel`: enseñar siete gigas sin salida es peor que no
                    enseñarlos. */}
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
                          <Accion
                            etiqueta={t("shell.storage.empty_cache")}
                            tono="aviso"
                            disabled={vaciandoCache()}
                            onClick={vaciarCache}
                          >
                            <Trash2 size={12} aria-hidden />
                          </Accion>
                        </Show>
                      </li>
                    )}
                  </For>
                </ul>
                <Show when={liberado().cache}>
                  <p class="m-0 px-1.5 pb-2 text-[0.6875rem] text-neutral-500">
                    {liberado().cache}
                  </p>
                </Show>
                <Show when={fallo().cache}>
                  <p class="m-0 px-1.5 pb-2 text-[0.6875rem] text-warning-strong">
                    {fallo().cache}
                  </p>
                </Show>
              </Show>
            </section>

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
                    disabled={recogiendo()}
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
      </PopoverContent>
    </Popover>
  );
}
