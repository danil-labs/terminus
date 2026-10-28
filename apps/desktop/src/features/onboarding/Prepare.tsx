import CircleCheck from "lucide-solid/icons/circle-check";
import Circle from "lucide-solid/icons/circle";
import ListChecks from "lucide-solid/icons/list-checks";
import SquareTerminal from "lucide-solid/icons/square-terminal";
import TriangleAlert from "lucide-solid/icons/triangle-alert";
import { For, Match, Show, Switch } from "solid-js";
import { t } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { CancelButton, RemoveButton } from "../../ui/IconAction";
import { BARRA_DE_TERMINAL, CUERPO_DE_TERMINAL, NOMBRE_DE_TERMINAL, TerminalCursor } from "../../ui/Terminal";
import { Spinner } from "../../ui/Spinner";

export type EstadoDeEtapa = "waiting" | "running" | "succeeded" | "failed" | "skipped";
/** El estado de una fila como lo pinta el diseño: en espera, corriendo, lista, fallida, omitida o desinstalándose. */
export type Paso = "wait" | "run" | "ok" | "fail" | "skip" | "bye";
export type Vista = "sencilla" | "terminal";
export type Tono = "ok" | "info" | "warn" | "error" | "out" | "err" | "etapa" | "omite" | "aviso";
export type Linea = { tono: Tono; texto: string };

export type FilaDeEtapa = {
  name: string;
  label: string;
  essential: boolean;
  paso: Paso;
  /** Lo que se quiere instalar; solo cuenta en los opcionales. */
  quiere: boolean;
  detalle: string;
  version: string;
  descripcion: string;
  removable?: boolean;
};

export type Instalacion = {
  titulo: string;
  subtitulo: string;
  estado: string;
  porcentaje: number;
  /** La corrida acabó y no queda nada suelto en curso. */
  terminado: boolean;
  corriendo: boolean;
  hechas: number;
  total: number;
  esenciales: FilaDeEtapa[];
  opcionales: FilaDeEtapa[];
  lineas: Linea[];
  descarga: string | null;
};

/** Lo que se puede hacer con un opcional desde cualquiera de las dos vistas. */
export type AccionesDeOpcional = {
  onMarcar: (name: string, marcado: boolean) => void;
  onCancelar: (name: string) => void;
  onDesinstalar: (name: string) => void;
};

const MARCA: Record<Tono, string> = {
  ok: "✓",
  info: "→",
  warn: "⚠",
  error: "✗",
  out: " ",
  err: " ",
  etapa: "▸",
  omite: "–",
  aviso: "–",
};
const COLOR: Record<Tono, string> = {
  ok: "text-terminal-ok",
  info: "text-terminal-text",
  warn: "text-terminal-warn",
  error: "text-terminal-error",
  out: "text-terminal-muted",
  err: "text-terminal-muted/70",
  etapa: "text-terminal-accent",
  omite: "text-terminal-text",
  aviso: "text-terminal-warn",
};

/** El selector de la vista, solo con íconos: lista sencilla o terminal. */
export function SelectorDeVista(props: { vista: Vista; onCambiar: (v: Vista) => void; class?: string }) {
  const opciones = () =>
    [
      { v: "sencilla" as const, label: t("setup.view.simple"), Icono: ListChecks },
      { v: "terminal" as const, label: t("setup.view.terminal"), Icono: SquareTerminal },
    ] as const;
  return (
    <div
      role="radiogroup"
      aria-label={t("setup.view.label")}
      class={cn("flex gap-0.5 rounded-[7px] bg-surface-muted p-0.5", props.class)}
    >
      <For each={opciones()}>
        {(o) => (
          <button
            type="button"
            role="radio"
            aria-checked={props.vista === o.v}
            aria-label={o.label}
            title={o.label}
            class={cn(
              "grid h-[26px] w-[30px] cursor-pointer place-items-center rounded-[5px] border outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
              props.vista === o.v
                ? "border-border bg-surface-raised text-neutral-950"
                : "border-transparent text-neutral-500 hover:text-neutral-950",
            )}
            onClick={() => props.onCambiar(o.v)}
          >
            <o.Icono size={15} aria-hidden="true" />
          </button>
        )}
      </For>
    </div>
  );
}

function IconoDeEtapa(props: { paso: Paso }) {
  return (
    <Switch fallback={<Circle size={16} class="shrink-0 text-border-strong" aria-hidden="true" />}>
      <Match when={props.paso === "run" || props.paso === "bye"}>
        <Spinner class="text-primary" />
      </Match>
      <Match when={props.paso === "ok"}>
        <CircleCheck size={16} class="shrink-0 text-success-strong" aria-hidden="true" />
      </Match>
      <Match when={props.paso === "fail"}>
        <TriangleAlert size={16} class="shrink-0 text-warning-strong" aria-hidden="true" />
      </Match>
    </Switch>
  );
}

const marcado = (f: FilaDeEtapa) => f.paso === "ok" || f.paso === "run" || ((f.paso === "wait" || f.paso === "fail") && f.quiere);
/** Mientras corre la instalación, lo omitido o fallido espera a que termine para poder elegirse otra vez. */
const fija = (i: Instalacion, f: FilaDeEtapa) =>
  f.paso === "run" || f.paso === "ok" || f.paso === "bye" || ((f.paso === "skip" || f.paso === "fail") && !i.terminado);

/** Un loader, el paso que va, un solo progreso que nunca retrocede y las filas con su estado. */
export function VistaSencilla(props: { i: Instalacion } & AccionesDeOpcional) {
  return (
    <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded-lg border border-border bg-surface-raised px-5 py-[18px]">
      <div class="flex items-center gap-3">
        <Show when={props.i.terminado} fallback={<Spinner size={30} class="text-primary" />}>
          <CircleCheck size={30} stroke-width={2} class="shrink-0 text-success-strong" aria-hidden="true" />
        </Show>
        <div class="min-w-0">
          <h2 class="m-0 truncate text-base leading-tight font-semibold tracking-[-0.01em] text-neutral-950">
            {props.i.titulo}
          </h2>
          <p class="m-0 mt-0.5 text-xs text-neutral-500">{props.i.subtitulo}</p>
        </div>
        <span class="ml-auto shrink-0 text-[22px] font-bold whitespace-nowrap tabular-nums text-neutral-950">
          {props.i.porcentaje} %
        </span>
      </div>
      <div
        class="h-1.5 overflow-hidden rounded-full bg-surface-muted"
        role="progressbar"
        aria-label={t("setup.progress")}
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={props.i.porcentaje}
      >
        <div class="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${props.i.porcentaje}%` }} />
      </div>
      <ol class="m-0 list-none border-t border-border p-0 pt-1">
        <For each={props.i.esenciales}>
          {(f) => (
            <li class={cn("flex min-h-[30px] items-center gap-2.5 px-0.5 text-[13px]", f.paso === "wait" && "text-neutral-500")}>
              <IconoDeEtapa paso={f.paso} />
              <span class={cn(f.paso !== "wait" && "text-neutral-950", f.paso === "run" && "font-semibold")}>{f.label}</span>
              <span class="ml-auto truncate text-right text-[11px] text-neutral-500">{f.detalle}</span>
            </li>
          )}
        </For>
      </ol>
      <Show when={props.i.opcionales.length > 0}>
        <div class="grid gap-1 border-t border-border pt-2">
          <p class="m-0 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <strong class="text-xs font-semibold text-neutral-950">{t("setup.optional.title")}</strong>
            <span class="text-[11px] text-neutral-500">{t("setup.optional.hint")}</span>
          </p>
          <ol class="m-0 list-none p-0">
            <For each={props.i.opcionales}>
              {(f) => (
                <li class={cn("flex min-h-[38px] items-center gap-2.5 px-0.5 text-[13px]", f.paso === "skip" && "text-neutral-500")}>
                  <label class={cn("flex min-w-0 flex-1 items-center gap-2.5", !fija(props.i, f) && "cursor-pointer")}>
                    <Switch
                      fallback={
                        <input
                          type="checkbox"
                          class="m-0 size-4 shrink-0 cursor-pointer accent-primary disabled:cursor-default disabled:opacity-50"
                          checked={marcado(f)}
                          disabled={fija(props.i, f)}
                          aria-label={t("setup.optional.install", { name: f.label })}
                          onChange={(e) => props.onMarcar(f.name, e.currentTarget.checked)}
                        />
                      }
                    >
                      <Match when={f.paso === "ok"}>
                        <CircleCheck size={16} class="shrink-0 text-success-strong" aria-hidden="true" />
                      </Match>
                      <Match when={f.paso === "run" || f.paso === "bye"}>
                        <Spinner class="text-primary" />
                      </Match>
                    </Switch>
                    <span class="grid min-w-0">
                      <span class={cn("truncate", f.paso !== "skip" && "text-neutral-950")}>{f.label}</span>
                      <span class="truncate text-[11px] text-neutral-500">{f.descripcion}</span>
                    </span>
                  </label>
                  <Switch>
                    <Match when={f.paso === "run"}>
                      <span class="truncate text-right text-[11px] text-neutral-500">{t("setup.optional.installing")}</span>
                      <CancelButton
                        label={t("setup.optional.cancel", { name: f.label })}
                        onClick={() => props.onCancelar(f.name)}
                      />
                    </Match>
                    <Match when={f.paso === "bye"}>
                      <span class="truncate text-right text-[11px] text-neutral-500">{t("setup.optional.uninstalling")}</span>
                    </Match>
                    <Match when={f.paso === "ok"}>
                      <span class="truncate text-right text-[11px] text-neutral-500">{f.version}</span>
                      <Show when={f.removable !== false}>
                        <RemoveButton
                          icon="trash"
                          label={t("setup.optional.uninstall", { name: f.label })}
                          onClick={() => props.onDesinstalar(f.name)}
                        />
                      </Show>
                    </Match>
                    <Match when={f.paso === "fail"}>
                      <span class="truncate text-right text-[11px] text-warning-strong">{t("setup.optional.not_installed")}</span>
                    </Match>
                    <Match when={f.paso === "skip"}>
                      <span class="truncate text-right text-[11px] text-neutral-500">
                        {props.i.terminado ? t("setup.optional.check_to_install") : t("setup.optional.skipped")}
                      </span>
                    </Match>
                  </Switch>
                </li>
              )}
            </For>
          </ol>
        </div>
      </Show>
      <p class="m-0 mt-auto text-xs text-neutral-500">{t("setup.terminal.reuse")}</p>
    </div>
  );
}

function estadoEnTerminal(i: Instalacion, f: FilaDeEtapa) {
  switch (f.paso) {
    case "wait":
      return f.quiere ? t("setup.optional.t.at_end") : t("setup.optional.t.skip");
    case "bye":
      return t("setup.optional.t.uninstalling");
    case "ok":
      return t("setup.optional.t.installed", { version: f.version });
    case "skip":
      return i.terminado ? t("setup.optional.t.skipped_end") : t("setup.optional.t.skipped");
    case "fail":
      return t("setup.optional.t.failed");
    default:
      return t("setup.optional.t.installing");
  }
}

const BOTON_DE_TERMINAL =
  "cursor-pointer border-0 bg-transparent p-0 font-mono outline-none focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-terminal-accent";

/** La misma corrida contada como terminal: cada línea con `~`, el inicio y fin de cada etapa y la descarga en vivo. */
export function VistaTerminal(props: { i: Instalacion; ref?: (el: HTMLPreElement) => void } & AccionesDeOpcional) {
  return (
    <section
      class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg bg-terminal text-terminal-text"
      aria-label={t("setup.terminal.title")}
    >
      <header class={cn(BARRA_DE_TERMINAL, "h-10 px-4")}>
        <strong class={NOMBRE_DE_TERMINAL}>{t("setup.terminal.title")}</strong>
        <span class="flex-1" />
        <Show when={props.i.total > 0}>
          <span class="tabular-nums">
            {props.i.hechas}/{props.i.total}
          </span>
        </Show>
      </header>
      <pre ref={props.ref} role="log" tabindex="0" class={cn(CUERPO_DE_TERMINAL, "flex-1 px-[18px] py-3.5 leading-[1.65]")}>
        <For each={props.i.lineas}>
          {(linea) => (
            <div class={COLOR[linea.tono]}>
              <span class="text-terminal-muted/70" aria-hidden="true">
                ~{" "}
              </span>
              <span aria-hidden="true">{MARCA[linea.tono]} </span>
              {linea.texto}
            </div>
          )}
        </For>
        <Show when={props.i.descarga}>
          {(d) => <div class={COLOR.etapa}>↓ {d()}</div>}
        </Show>
        <Show when={props.i.corriendo}>
          <TerminalCursor />
        </Show>
      </pre>
      <Show when={props.i.opcionales.length > 0}>
        <div class="border-t border-terminal-line px-[18px] pt-2.5 pb-3 font-mono text-xs leading-[1.7]">
          <div class="mb-0.5 text-terminal-warn">{t("setup.optional.terminal_title")}</div>
          <For each={props.i.opcionales}>
            {(f) => (
              <div>
                <button
                  type="button"
                  class={cn(
                    BOTON_DE_TERMINAL,
                    "text-terminal-accent hover:text-terminal-text disabled:cursor-default disabled:hover:text-terminal-accent",
                    f.paso === "ok" && "text-terminal-ok disabled:hover:text-terminal-ok",
                  )}
                  disabled={fija(props.i, f)}
                  aria-pressed={marcado(f)}
                  aria-label={t("setup.optional.install", { name: f.label })}
                  onClick={() => props.onMarcar(f.name, !marcado(f))}
                >
                  {f.paso === "run" || f.paso === "bye" ? "[…]" : marcado(f) ? "[✓]" : "[ ]"}
                </button>{" "}
                <strong class="font-semibold">{f.label}</strong>{" "}
                <span class="text-terminal-muted">{f.descripcion}</span>{" "}
                <span
                  class={cn(
                    f.paso === "ok" ? "text-terminal-ok" : f.paso === "fail" ? "text-terminal-warn" : "text-terminal-muted",
                  )}
                >
                  · {estadoEnTerminal(props.i, f)}
                </span>
                <Show when={f.paso === "run"}>
                  {" "}
                  <button
                    type="button"
                    class={cn(BOTON_DE_TERMINAL, "text-terminal-muted underline underline-offset-2 hover:text-terminal-error")}
                    onClick={() => props.onCancelar(f.name)}
                  >
                    {t("setup.optional.t.cancel")}
                  </button>
                </Show>
                <Show when={f.paso === "ok" && f.removable !== false}>
                  {" "}
                  <span class="text-terminal-muted">·</span>{" "}
                  <button
                    type="button"
                    class={cn(BOTON_DE_TERMINAL, "text-terminal-error underline underline-offset-2 hover:text-terminal-text")}
                    onClick={() => props.onDesinstalar(f.name)}
                  >
                    {t("setup.optional.t.uninstall")}
                  </button>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
      <footer class="grid gap-2 border-t border-terminal-line px-4 py-3 text-xs text-terminal-muted">
        <span role="status">{props.i.estado}</span>
        <div class="h-1.5 overflow-hidden rounded-full bg-terminal-line">
          <div class="h-full bg-terminal-accent transition-[width] duration-300" style={{ width: `${props.i.porcentaje}%` }} />
        </div>
        <span>{t("setup.terminal.reuse")}</span>
      </footer>
    </section>
  );
}
