import { For, Show, createSignal, createMemo, onMount, type JSX } from "solid-js";
import { invoke } from "../../lib/invoke.ts";
import ChevronDown from "lucide-solid/icons/chevron-down";
import ChevronRight from "lucide-solid/icons/chevron-right";
import Columns2 from "lucide-solid/icons/columns-2";
import Rows2 from "lucide-solid/icons/rows-2";
import UnfoldVertical from "lucide-solid/icons/unfold-vertical";
import SquareArrowOutUpRight from "lucide-solid/icons/square-arrow-out-up-right";
import { FailureNote, asFailure, type Failure } from "../../ui/Failure";
import { cn } from "../../lib/utils";
import { t } from "../../lib/i18n";
import { createPref } from "../../lib/prefs";
import { ajuste } from "../../lib/wrap";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import {
  filasDosPaneles,
  marcarLineas,
  parsearDiff,
  saltoEntre,
  type ArchivoDiff,
  type Fila,
  type Hunk,
  type Linea,
  type Tramo,
} from "./diff";

/**
 * Los cambios observados en un árbol de trabajo, archivo por archivo.
 *
 * **Aquí es una revisión, no un editor.** Se lee lo que cambió y el contexto que
 * lo rodea; en este bloque no se escribe. Un diff no es un sitio donde escribir
 * —la mitad de sus líneas son del archivo de antes y no existen ya—, así que
 * cada fila lleva **el salto a la pestaña del archivo** (`FileViewer.tsx`), que
 * es donde sí se escribe: sin él, quien ve algo que corregir tiene que abrir la
 * pestaña Código, encontrar el repositorio, desplegar su árbol y bajar hasta la
 * misma ruta que tenía delante. Qué acota lo que se escribe, en
 * `development::tree_write`.
 *
 * **El contexto se despliega, y por eso hace falta un segundo comando.** `git
 * diff` da tres líneas alrededor de cada trozo, y un cambio leído sin lo que lo
 * rodea no se puede juzgar: `tree_patch` recalcula ese archivo con el archivo
 * entero de contexto. Se pide solo al desplegar — traer todos los archivos
 * enteros de golpe es megabytes que casi nadie va a leer.
 *
 * **Sin resaltado de sintaxis, y es una decisión.** Lo que hay que distinguir es
 * qué entró y qué salió, y eso lo dice la línea entera. Un resaltador son
 * cientos de kilobytes de gramáticas para teñir palabras que no deciden nada en
 * una revisión.
 */

type Disposicion = "unified" | "split";

const [disposicionGuardada, setDisposicion] = createPref<Disposicion>("diff.layout", "unified");
const disposicion = (): Disposicion => (disposicionGuardada() === "split" ? "split" : "unified");

/** `delivery/development/` · `Cambios`. */
export type Cambios = {
  base: string;
  files: { path: string; added: number; removed: number; status: string }[];
  added: number;
  removed: number;
  patch: string;
  truncated: boolean;
  warnings: string[];
};

type DiffDeArbol = {
  patch: string;
  retired: boolean;
};

/**
 * Contra qué se mide lo que se pinta, **dentro de un árbol de la tarea**.
 *
 * **`arbol` es un marcador y `turno` es un registro**, y la diferencia no es de
 * implementación: el acumulado dice cómo está el árbol AHORA contra su base, y
 * cambia con cada turno; el rango dice qué pasó entre dos fotos concretas y
 * sigue diciendo lo mismo dentro de un mes. Un turno pintado con el acumulado le
 * atribuiría lo que hicieron los de después.
 *
 * Los dos llevan `arbol` porque una tarea escribe en más de un sitio y cada uno
 * guarda sus fotos aparte: sin él, un sha no se puede resolver.
 */
export type Origen =
  | { tipo: "arbol"; arbol: string }
  | { tipo: "turno"; arbol: string; before: string; after: string };

/**
 * El resumen de un patch, contado de sus propias líneas.
 *
 * `tree_changes` trae el recuento del `--numstat` de git; un rango de árboles
 * llega como texto y punto. Contar aquí evita un segundo viaje al backend para
 * pedir lo que ya está en la mano.
 */
function previaDePatch(patch: string): Cambios {
  const archivos = parsearDiff(patch);
  return {
    base: "",
    files: archivos.map((a) => ({
      path: a.ruta,
      added: a.added,
      removed: a.removed,
      status: a.estado[0].toUpperCase(),
    })),
    added: archivos.reduce((n, a) => n + a.added, 0),
    removed: archivos.reduce((n, a) => n + a.removed, 0),
    patch,
    truncated: false,
    warnings: [],
  };
}

export default function Cambios(props: {
  project: string;
  session: string;
  origen: Origen;
  /**
   * El tope de alto del bloque, para que scrollee dentro y no empuje el hilo.
   *
   * Solo lo usa el bloque del chat. En la pestaña no hay tope: **el que scrollea
   * es el cuerpo de la columna**, uno solo. Con un scroll dentro de otro, la
   * rueda actúa sobre el de dentro hasta que se acaba, y llegar al final de la
   * lista de archivos exigía adivinar dónde poner el cursor.
   */
  alto?: string;
  /**
   * Las clases del marco —el borde, el redondeo—, si quien llama quiere uno.
   *
   * **Lo pinta este bloque y no quien lo monta, porque solo aquí se sabe si hay
   * algo que enmarcar.** Envuelto desde fuera, un turno sin archivos que enseñar
   * dejaba una caja con borde y nada dentro: ver el `Show` del `return`.
   */
  marco?: string;
  /**
   * Abrir esa ruta como pestaña del centro. El árbol lo pone quien llama
   * (`TurnChanges.tsx`): desde aquí la ruta sola no identifica un archivo.
   */
  onAbrir: (ruta: string) => void;
}) {
  const [previa, setPrevia] = createSignal<Cambios | null>(null);
  const [cargando, setCargando] = createSignal(true);
  const [fallo, setFallo] = createSignal<Failure | null>(null);
  const [retirado, setRetirado] = createSignal(false);
  /** El diff con el archivo entero, por ruta, cuando alguien lo desplegó. */
  const [enteros, setEnteros] = createSignal<Record<string, ArchivoDiff>>({});

  const archivos = createMemo(() => {
    const base = parsearDiff(previa()?.patch ?? "");
    const completos = enteros();
    return base.map((a) => completos[a.ruta] ?? a);
  });

  async function diffDelTurno(
    o: Extract<Origen, { tipo: "turno" }>,
    path: string | null,
  ): Promise<string> {
    const diff = await invoke<DiffDeArbol>("tree_diff", {
      project: props.project,
      session: props.session,
      tree: o.arbol,
      before: o.before,
      after: o.after,
      path,
    });
    setRetirado(diff.retired);
    return diff.patch;
  }

  onMount(() => {
    const o = props.origen;
    const pedido =
      o.tipo === "arbol"
        ? invoke<Cambios>("tree_changes", {
            project: props.project,
            session: props.session,
            tree: o.arbol,
          })
        : diffDelTurno(o, null).then(previaDePatch);
    pedido
      .then(setPrevia)
      .catch((e) => setFallo(asFailure(e)))
      .finally(() => setCargando(false));
  });

  /** Trae ese archivo con todo su contexto y reemplaza lo que se está pintando. */
  async function desplegar(ruta: string) {
    if (enteros()[ruta]) return;
    try {
      const o = props.origen;
      const patch =
        o.tipo === "arbol"
          ? await invoke<string>("tree_patch", {
              project: props.project,
              session: props.session,
              tree: o.arbol,
              path: ruta,
            })
          : await diffDelTurno(o, ruta);
      const [entero] = parsearDiff(patch);
      if (entero) setEnteros({ ...enteros(), [ruta]: entero });
    } catch (e) {
      setFallo(asFailure(e));
    }
  }

  /**
   * Si hay algo que enseñar. **Sin esto no se pinta nada, ni siquiera el
   * marco.**
   *
   * Un «El agente todavía no ha cambiado nada aquí» sería relleno: este bloque
   * solo se monta debajo de un turno que tocó código, así que esa frase solo
   * aparece con el rango mal calculado —una por cada copia de trabajo abierta— y
   * lo que comunica es ese defecto. Un diff vacío no ocupa sitio.
   *
   * El fallo y el aviso de recorte sí se enseñan: los dos dicen que lo que se
   * está mirando no es lo que se pidió, y callarlos deja revisar a ciegas.
   */
  const hayAlgo = () =>
    cargando() ||
    retirado() ||
    archivos().length > 0 ||
    Boolean(previa()?.truncated) ||
    Boolean(fallo());

  return (
    <Show when={hayAlgo()}>
      <div
        class={cn(
          "grid content-start gap-2 p-3",
          props.marco,
          props.alto && `overflow-y-auto ${props.alto}`,
        )}
      >
        <Show
          when={!cargando()}
          fallback={<p class="m-0 text-xs text-neutral-500">{t("code.comparing")}</p>}
        >
          <Show when={archivos().length > 0}>
            <div class="flex items-center gap-2">
              <h4 class="m-0 flex min-w-0 flex-1 items-baseline gap-2 text-[0.8125rem] font-semibold">
                {props.origen.tipo === "turno"
                  ? t("code.changes.observed_during_turn")
                  : t("code.files.count", { count: archivos().length })}
                <span class="font-mono text-[0.75rem] font-normal">
                  <span class="text-success-strong">+{previa()?.added ?? 0}</span>{" "}
                  <span class="text-error-strong">−{previa()?.removed ?? 0}</span>
                </span>
              </h4>
              <SelectorDeDisposicion />
            </div>

            <For each={archivos()}>
              {(a) => (
                <Archivo
                  archivo={a}
                  onDesplegar={() => void desplegar(a.ruta)}
                  onAbrir={() => props.onAbrir(a.ruta)}
                />
              )}
            </For>
          </Show>

          <Show when={retirado()}>
            <p class="m-0 text-xs text-neutral-500">{t("code.changes.retired")}</p>
          </Show>

          {/* Un diff recortado que parece entero es una revisión que no vale: se
              dice, y se dice arriba de lo que sí se ve. */}
          <Show when={previa()?.truncated}>
            <p class="m-0 rounded-md border border-border bg-surface-raised px-2.5 py-2 text-[0.75rem]">
              {t("code.changes.truncated")}
            </p>
          </Show>
        </Show>

        <Show when={fallo()}>{(f) => <FailureNote f={f()} />}</Show>
      </div>
    </Show>
  );
}

export function SelectorDeDisposicion() {
  return (
    <div role="group" aria-label={t("code.diff.layout.label")} class="flex shrink-0 gap-0.5">
      <BotonDeDisposicion
        pulsado={disposicion() === "unified"}
        etiqueta={t("code.diff.layout.unified")}
        onClick={() => setDisposicion("unified")}
      >
        <Rows2 size={13} />
      </BotonDeDisposicion>
      <BotonDeDisposicion
        pulsado={disposicion() === "split"}
        etiqueta={t("code.diff.layout.split")}
        onClick={() => setDisposicion("split")}
      >
        <Columns2 size={13} />
      </BotonDeDisposicion>
    </div>
  );
}

function BotonDeDisposicion(props: {
  pulsado: boolean;
  etiqueta: string;
  onClick: () => void;
  children: JSX.Element;
}) {
  return (
    <Button
      variant={props.pulsado ? "secondary" : "ghost"}
      size="compact"
      class={cn("size-6 px-0", !props.pulsado && "text-neutral-500 hover:text-neutral-950")}
      aria-pressed={props.pulsado}
      aria-label={props.etiqueta}
      title={props.etiqueta}
      onClick={() => props.onClick()}
    >
      {props.children}
    </Button>
  );
}

/**
 * Cómo se nombra lo que le pasó al archivo. **`cambiado` no lleva etiqueta**: es
 * el caso normal y ponerle una sería repetir lo que ya dice estar en la lista.
 *
 * Función y no un mapa de módulo por dos cosas: `t()` lee la lengua al llamarse
 * —en una constante se congelaría en la del arranque—, y `scripts/locales.mjs`
 * solo ve las claves escritas enteras, así que una armada al vuelo se
 * reportaría como huérfana.
 */
function estadoDe(estado: ArchivoDiff["estado"]): string {
  if (estado === "nuevo") return t("code.status.new");
  if (estado === "borrado") return t("code.status.deleted");
  if (estado === "renombrado") return t("code.status.renamed");
  return "";
}

/** Un archivo: su cabecera con el recuento, y sus trozos debajo. */
function Archivo(props: {
  archivo: ArchivoDiff;
  onDesplegar: () => void;
  onAbrir: () => void;
}) {
  /**
   * **Cerrado al nacer, en los dos sitios.** Abierto, un cambio de quince
   * archivos es una pared de diff que hay que recorrer entera para saber qué
   * tocó; cerrado, la lista es el índice —ruta, `+N −M`— y el diff se pide de
   * uno en uno. Es lo que ya hacía el bloque del chat, y no había motivo para
   * que la pestaña se comportara distinta.
   */
  const [abierto, setAbierto] = createSignal(false);

  /**
   * **La carpeta se apaga y el nombre queda fuerte.** En una lista de quince
   * rutas que empiezan igual —`src-tauri/src/…`— lo que distingue una fila es lo
   * último, y con todo al mismo peso hay que leerlas enteras para encontrarla.
   */
  const partes = () => {
    const i = props.archivo.ruta.lastIndexOf("/");
    return i < 0
      ? { carpeta: "", nombre: props.archivo.ruta }
      : { carpeta: props.archivo.ruta.slice(0, i + 1), nombre: props.archivo.ruta.slice(i + 1) };
  };

  return (
    <section class="overflow-hidden rounded-md border border-border">
      <header
        class="group flex items-center gap-2 border-b border-border bg-surface-raised px-2.5 py-1.5"
        classList={{ "border-b-0": !abierto() }}
      >
        <button
          class="flex min-w-0 flex-1 items-center gap-1.5 text-left outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          aria-expanded={abierto()}
          onClick={() => setAbierto(!abierto())}
        >
          {abierto() ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span class="min-w-0 truncate font-mono text-[0.75rem]">
            <span class="text-neutral-500">{partes().carpeta}</span>
            <span class="font-semibold">{partes().nombre}</span>
          </span>
        </button>
        <Show when={estadoDe(props.archivo.estado)}>
          {(e) => <Badge forma="dato" class="shrink-0 text-[0.625rem]">{e()}</Badge>}
        </Show>
        <span class="shrink-0 font-mono text-[0.6875rem]">
          <span class="text-success-strong">+{props.archivo.added}</span>{" "}
          <span class="text-error-strong">−{props.archivo.removed}</span>
        </span>
        {/* **Fuera del botón que pliega**, como «Publicar» en `Code.tsx`: un
            botón dentro de otro no es HTML válido y el clic acabaría plegando en
            vez de abrir.

            **Al posar el ratón, y no siempre a la vista.** Es el reparto de la
            × de la tira de pestañas: con quince archivos, quince iconos
            encendidos compiten con las rutas, que es lo que se recorre para
            encontrar la fila. Ocupa su hueco igual estando invisible, así que la
            columna del `+N −M` no baila entre una fila y la de al lado, y
            `group-focus-within` lo enciende para quien llega tabulando.

            `-my-1` para que el objetivo sea de 24 px sin estirar la fila: la
            caja se come el `py-1.5` de la cabecera en vez de sumarse a él.

            **Un borrado no se abre**: su ruta es la que tenía y ya no hay
            archivo que leer. Se deshabilita en vez de esconderse, para que el
            hueco siga diciendo que aquí hay un control. */}
        <button
          type="button"
          class="-my-1 grid size-6 shrink-0 place-items-center rounded-sm text-neutral-500 opacity-0 outline-none focus-visible:opacity-100 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary enabled:hover:bg-surface-muted enabled:hover:text-neutral-950 disabled:cursor-default group-hover:opacity-100 group-focus-within:opacity-100"
          disabled={props.archivo.estado === "borrado"}
          aria-label={t("code.file.open_aria", { ruta: props.archivo.ruta })}
          title={
            props.archivo.estado === "borrado"
              ? t("code.file.deleted_open")
              : t("code.file.open")
          }
          onClick={() => props.onAbrir()}
        >
          <SquareArrowOutUpRight size={13} />
        </button>
      </header>

      <Show when={abierto()}>
        <CuerpoDeArchivo archivo={props.archivo} onDesplegar={props.onDesplegar} />
      </Show>
    </section>
  );
}

/**
 * Las líneas de un archivo: sus trozos y los tramos que faltan entre ellos.
 *
 * **Aparte de [`Archivo`] para que el árbol lo use sin su cabecera.** Desde el
 * árbol ya se sabe qué archivo se abrió —lo dice la fila de volver—, así que
 * repetir la ruta con su recuento sería el mismo dato dos veces en el mismo
 * renglón. Lo que no puede haber es un segundo dibujante de líneas: dos divergen
 * y quien revisa deja de saber si mira lo mismo.
 */
export function CuerpoDeArchivo(props: {
  archivo: ArchivoDiff;
  onDesplegar: () => void;
  /** Ocupa el alto de su caja y lleva sus propios scrolls: la barra horizontal queda abajo. */
  llena?: boolean;
}) {
  // Un archivo sin cambios pintaría dos paneles idénticos.
  const conCambios = () => props.archivo.added + props.archivo.removed > 0;
  const dosPaneles = () => conCambios() && disposicion() === "split";
  const paneles: HTMLDivElement[] = [];
  // Solo arrastra el panel que la persona mueve: si el arrastrado devolviera su
  // scroll redondeado al primero, los dos se corregirían entre sí y el diff tiembla.
  let lider: HTMLDivElement | null = null;
  const tomar = (el: HTMLDivElement) => {
    lider = el;
  };
  const acompasar = (origen: HTMLDivElement) => {
    if (origen !== lider) return;
    for (const p of paneles) if (p !== origen && p.isConnected) p.scrollTop = origen.scrollTop;
  };
  const saltosAntes = (i: number) =>
    i === 0 ? props.archivo.hunks[0].desdeNueva - 1 : saltoEntre(props.archivo.hunks[i - 1], props.archivo.hunks[i]);
  return (
    <Show
      when={!props.archivo.binario}
      fallback={
        <p class="m-0 px-2.5 py-2 text-[0.75rem] text-neutral-500">
          {t("code.file.binary")}
        </p>
      }
    >
      <div
        class={cn(
          "w-full min-w-0 bg-surface-muted font-mono text-xs leading-[1.55]",
          !props.llena
            ? "overflow-x-auto"
            : dosPaneles() && !ajuste()
              ? "h-full overflow-hidden"
              : "h-full overflow-auto",
        )}
      >
        <Show
          when={dosPaneles()}
          fallback={
            <div class={cn(!ajuste() && "w-max min-w-full")}>
              <For each={props.archivo.hunks}>
                {(h, i) => (
                  <>
                    {/* Antes del primer trozo también falta archivo, y saberlo es
                        lo que dice si el cambio está al principio o en el medio. */}
                    <Salto cuantas={saltosAntes(i())} onDesplegar={props.onDesplegar} />
                    <Trozo hunk={h} />
                  </>
                )}
              </For>
            </div>
          }
        >
          <Show
            when={ajuste()}
            fallback={
              /* Sin ajuste cada fila mide un renglón: cada panel lleva su scroll
                 horizontal y las filas siguen casando. */
              <div class={cn("grid grid-cols-2", props.llena && "h-full")}>
                <Panel archivo={props.archivo} lado="antes" saltos={saltosAntes} onDesplegar={props.onDesplegar} llena={props.llena} ref={(el) => paneles.push(el)} onScroll={acompasar} onTomar={tomar} />
                <Panel archivo={props.archivo} lado="despues" saltos={saltosAntes} onDesplegar={props.onDesplegar} llena={props.llena} ref={(el) => paneles.push(el)} onScroll={acompasar} onTomar={tomar} />
              </div>
            }
          >
            {/* Con ajuste una fila crece por su lado largo: la rejilla por filas
                es lo que mantiene a las dos mitades a la misma altura. */}
            <div class="grid grid-cols-2">
              <For each={props.archivo.hunks}>
                {(h, i) => (
                  <>
                    <Salto cuantas={saltosAntes(i())} onDesplegar={props.onDesplegar} />
                    <FilasDeTrozo hunk={h}>
                      {(f, tramos) => (
                        <>
                          <Lado hunk={h} indice={f.antes} tramos={tramos} lado="antes" />
                          <Lado hunk={h} indice={f.despues} tramos={tramos} lado="despues" />
                        </>
                      )}
                    </FilasDeTrozo>
                  </>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </div>
    </Show>
  );
}

/** Un lado de los dos paneles sin ajuste: todos los trozos, con su scroll horizontal propio. */
function Panel(props: {
  archivo: ArchivoDiff;
  lado: "antes" | "despues";
  saltos: (i: number) => number;
  onDesplegar: () => void;
  llena?: boolean;
  ref: (el: HTMLDivElement) => void;
  onScroll: (el: HTMLDivElement) => void;
  onTomar: (el: HTMLDivElement) => void;
}) {
  return (
    <div
      ref={props.ref}
      onScroll={(e) => props.llena && props.onScroll(e.currentTarget)}
      onWheel={(e) => props.onTomar(e.currentTarget)}
      onPointerDown={(e) => props.onTomar(e.currentTarget)}
      onTouchStart={(e) => props.onTomar(e.currentTarget)}
      onFocusIn={(e) => props.onTomar(e.currentTarget)}
      class={cn(
        "min-w-0",
        props.llena ? "h-full overflow-auto" : "overflow-x-auto",
        props.lado === "antes" && "border-r border-border",
      )}
    >
      <div class="w-max min-w-full">
        <For each={props.archivo.hunks}>
          {(h, i) => (
            <>
              {/* El salto sale en los dos paneles para que las filas sigan casando;
                  el segundo no entra en el orden de tabulación. */}
              <Salto
                cuantas={props.saltos(i())}
                onDesplegar={props.onDesplegar}
                eco={props.lado === "despues"}
              />
              <FilasDeTrozo hunk={h}>
                {(f, tramos) => (
                  <Lado
                    hunk={h}
                    indice={props.lado === "antes" ? f.antes : f.despues}
                    tramos={tramos}
                    lado={props.lado}
                  />
                )}
              </FilasDeTrozo>
            </>
          )}
        </For>
      </div>
    </div>
  );
}

function FilasDeTrozo(props: {
  hunk: Hunk;
  children: (fila: Fila, tramos: Tramo[][]) => JSX.Element;
}) {
  const tramos = createMemo(() => marcarLineas(props.hunk.lineas));
  const filas = createMemo(() => filasDosPaneles(props.hunk.lineas));
  return <For each={filas()}>{(f) => props.children(f, tramos())}</For>;
}

/** Las clases del texto de una línea: una sola fila con scroll, o varias con ajuste. */
const textoDeLinea = () =>
  ajuste() ? "min-w-0 flex-1 whitespace-pre-wrap break-words pr-4 pl-1" : "whitespace-pre pr-4 pl-1";

/** Las líneas de un trozo en la vista unificada, con su número real a la izquierda. */
function Trozo(props: { hunk: Hunk }) {
  const tramos = createMemo(() => marcarLineas(props.hunk.lineas));
  return (
    <For each={props.hunk.lineas}>
      {(l, i) => (
        <div
          class={cn(
            "flex border-l-2",
            l.tipo === "add" && "border-success bg-diff-add",
            l.tipo === "del" && "border-error bg-diff-del",
            l.tipo === "ctx" && "border-transparent",
          )}
        >
          <Numero tipo={l.tipo} n={l.nueva ?? l.vieja} class="w-9" />
          <span class={textoDeLinea()}>
            <Texto linea={l} tramos={tramos()[i()]} />
          </span>
        </div>
      )}
    </For>
  );
}

/** Media fila de los dos paneles: número y texto, o el hueco del lado corto. */
function Lado(props: {
  hunk: Hunk;
  indice: number | null;
  tramos: Tramo[][];
  lado: "antes" | "despues";
}) {
  const linea = () => (props.indice === null ? null : props.hunk.lineas[props.indice]);
  return (
    <div
      class={cn(
        "flex min-w-0 border-l-2",
        linea()?.tipo === "add" && "border-success bg-diff-add",
        linea()?.tipo === "del" && "border-error bg-diff-del",
        (linea() === null || linea()?.tipo === "ctx") && "border-transparent",
        linea() === null && "bg-surface-raised",
        ajuste() && props.lado === "antes" && "border-r border-r-border",
      )}
    >
      <Show
        when={linea()}
        fallback={<span class="whitespace-pre"> </span>}
      >
        {(l) => (
          <>
            <Numero
              tipo={l().tipo}
              n={props.lado === "antes" ? l().vieja : l().nueva}
              class="w-11"
            />
            <span class={textoDeLinea()}>
              <Texto linea={l()} tramos={props.indice === null ? [] : props.tramos[props.indice]} />
            </span>
          </>
        )}
      </Show>
    </div>
  );
}

function Numero(props: { tipo: Linea["tipo"]; n: number | null; class: string }) {
  return (
    /* **El número también va de color, y no es adorno.** Es lo que
       distingue las dos filas cuando el fondo es tan tenue como debe ser,
       y lo que dice de qué archivo es ese número: el de una borrada es su
       línea en el archivo de antes, el de una añadida en el de ahora. Sin
       color, dos filas seguidas con el mismo 112 se leen como un error.

       `tabular-nums` para que la columna no baile al pasar de 99 a 100, y
       `select-none` para que copiar el bloque no se lleve los números. */
    <span
      class={cn(
        "shrink-0 select-none pr-2 text-right tabular-nums",
        props.tipo === "add" && "text-success-strong",
        props.tipo === "del" && "text-error-strong",
        props.tipo === "ctx" && "text-neutral-500",
        props.class,
      )}
    >
      {props.n}
    </span>
  );
}

/** El texto de la línea, con los tramos que cambiaron sobre un fondo más fuerte. */
function Texto(props: { linea: Linea; tramos: Tramo[] }) {
  return (
    <Show when={props.tramos.length > 0} fallback={props.linea.texto || " "}>
      {cortar(props.linea.texto, props.tramos).map(([trozo, marcado]) =>
        marcado ? (
          <span
            class={cn(
              "rounded-[2px]",
              props.linea.tipo === "add" ? "bg-diff-add-word" : "bg-diff-del-word",
            )}
          >
            {trozo}
          </span>
        ) : (
          trozo
        ),
      )}
    </Show>
  );
}

function cortar(texto: string, tramos: Tramo[]): [string, boolean][] {
  const piezas: [string, boolean][] = [];
  let desde = 0;
  for (const [inicio, fin] of tramos) {
    if (inicio > desde) piezas.push([texto.slice(desde, inicio), false]);
    piezas.push([texto.slice(inicio, fin), true]);
    desde = fin;
  }
  if (desde < texto.length) piezas.push([texto.slice(desde), false]);
  return piezas;
}

/** El tramo que git no mandó, y el gesto para traerlo. */
function Salto(props: { cuantas: number; onDesplegar: () => void; eco?: boolean }) {
  return (
    <Show when={props.cuantas > 0}>
      <button
        class="col-span-full flex w-full items-center gap-2 border-y border-border bg-surface-raised px-2 py-1 text-left text-[0.6875rem] text-neutral-500 outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        onClick={props.onDesplegar}
        title={t("code.gap.title")}
        tabindex={props.eco ? -1 : undefined}
        aria-hidden={props.eco ? true : undefined}
      >
        <UnfoldVertical size={12} class="shrink-0" />
        {t("code.gap.lines", { count: props.cuantas })}
      </button>
    </Show>
  );
}
