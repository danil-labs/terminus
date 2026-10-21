import CircleCheck from "lucide-solid/icons/circle-check";
import Circle from "lucide-solid/icons/circle";
import ListChecks from "lucide-solid/icons/list-checks";
import SquareTerminal from "lucide-solid/icons/square-terminal";
import TriangleAlert from "lucide-solid/icons/triangle-alert";
import { For, Match, Show, Switch } from "solid-js";
import { t } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { BARRA_DE_TERMINAL, CUERPO_DE_TERMINAL, NOMBRE_DE_TERMINAL, TerminalCursor } from "../../ui/Terminal";
import { Spinner } from "../../ui/Spinner";

export type EstadoDeEtapa = "waiting" | "running" | "succeeded" | "failed";
export type Vista = "sencilla" | "terminal";
export type Tono = "ok" | "info" | "warn" | "error" | "out" | "err" | "etapa";
export type Linea = { tono: Tono; texto: string };

export type FilaDeEtapa = {
  name: string;
  label: string;
  essential: boolean;
  estado: EstadoDeEtapa;
  detalle: string;
  descripcion: string;
  /** Instalarla otra vez a mano, cuando la corrida ya terminó: en curso o el error. */
  reintento?: { enCurso: boolean; error?: string };
};

export type Instalacion = {
  titulo: string;
  subtitulo: string;
  estado: string;
  porcentaje: number;
  terminado: boolean;
  /** La corrida acabó, bien o con un esencial roto: lo opcional ya se puede elegir. */
  cerrada: boolean;
  corriendo: boolean;
  hechas: number;
  total: number;
  esenciales: FilaDeEtapa[];
  opcionales: FilaDeEtapa[];
  lineas: Linea[];
  descarga: string | null;
};

const MARCA: Record<Tono, string> = { ok: "✓", info: "→", warn: "⚠", error: "✗", out: " ", err: " ", etapa: "▸" };
const COLOR: Record<Tono, string> = {
  ok: "text-terminal-ok",
  info: "text-terminal-text",
  warn: "text-terminal-warn",
  error: "text-terminal-error",
  out: "text-terminal-muted",
  err: "text-terminal-muted/70",
  etapa: "text-terminal-accent",
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

function IconoDeEtapa(props: { f: FilaDeEtapa }) {
  return (
    <Switch fallback={<Circle size={16} class="shrink-0 text-border-strong" aria-hidden="true" />}>
      <Match when={props.f.estado === "running" || props.f.reintento?.enCurso}>
        <Spinner class="text-primary" />
      </Match>
      <Match when={props.f.estado === "succeeded"}>
        <CircleCheck size={16} class="shrink-0 text-success-strong" aria-hidden="true" />
      </Match>
      <Match when={props.f.estado === "failed"}>
        <TriangleAlert size={16} class="shrink-0 text-warning-strong" aria-hidden="true" />
      </Match>
    </Switch>
  );
}

/** Lo opcional que falló se puede volver a pedir cuando la corrida terminó; mientras corre, se instala con lo demás. */
const elegible = (i: Instalacion, f: FilaDeEtapa) => i.cerrada && f.estado === "failed" && !f.reintento?.enCurso;

function detalleOpcional(i: Instalacion, f: FilaDeEtapa) {
  if (f.reintento?.enCurso) return t("setup.optional.installing");
  if (f.reintento?.error) return f.reintento.error;
  if (f.estado === "waiting") return t("setup.optional.with_rest");
  if (f.estado === "running") return t("setup.optional.installing");
  if (f.estado === "failed") return i.cerrada ? t("setup.optional.check_to_install") : t("setup.optional.not_installed");
  return f.detalle;
}

/** Un loader, el paso que va, un solo progreso que nunca retrocede y las filas con su estado. */
export function VistaSencilla(props: { i: Instalacion; onInstalar: (name: string) => void }) {
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
            <li class={cn("flex min-h-[30px] items-center gap-2.5 px-0.5 text-[13px]", f.estado === "waiting" && "text-neutral-500")}>
              <IconoDeEtapa f={f} />
              <span class={cn("text-neutral-950", f.estado === "running" && "font-semibold")}>{f.label}</span>
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
                <li class="flex min-h-[38px] items-center gap-2.5 px-0.5 text-[13px]">
                  <label class={cn("flex min-w-0 flex-1 items-center gap-2.5", elegible(props.i, f) && "cursor-pointer")}>
                    <Show
                      when={f.estado === "waiting" || elegible(props.i, f)}
                      fallback={<IconoDeEtapa f={f} />}
                    >
                      <input
                        type="checkbox"
                        class="m-0 size-4 shrink-0 cursor-pointer accent-primary disabled:cursor-default disabled:opacity-50"
                        checked={f.estado === "waiting"}
                        disabled={!elegible(props.i, f)}
                        aria-label={t("setup.optional.install", { name: f.label })}
                        onChange={(e) => {
                          if (e.currentTarget.checked) props.onInstalar(f.name);
                        }}
                      />
                    </Show>
                    <span class="grid min-w-0">
                      <span class="truncate text-neutral-950">{f.label}</span>
                      <Show when={f.descripcion}>
                        <span class="truncate text-[11px] text-neutral-500">{f.descripcion}</span>
                      </Show>
                    </span>
                  </label>
                  <span
                    class={cn(
                      "max-w-[50%] truncate text-right text-[11px]",
                      f.reintento?.error || (f.estado === "failed" && !props.i.cerrada) ? "text-warning-strong" : "text-neutral-500",
                    )}
                    title={detalleOpcional(props.i, f)}
                  >
                    {detalleOpcional(props.i, f)}
                  </span>
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

/** La misma corrida contada como terminal: cada línea con `~`, el inicio y fin de cada etapa y la descarga en vivo. */
export function VistaTerminal(props: { i: Instalacion; onInstalar: (name: string) => void; ref?: (el: HTMLPreElement) => void }) {
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
          {(d) => (
            <div class={COLOR.etapa}>
              <span class="text-terminal-muted/70" aria-hidden="true">
                ~{" "}
              </span>
              ↓ {d()}
            </div>
          )}
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
                    "cursor-pointer border-0 bg-transparent p-0 font-mono text-terminal-accent outline-none hover:text-terminal-text focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-terminal-accent disabled:cursor-default disabled:hover:text-terminal-accent",
                    f.estado === "succeeded" && "text-terminal-ok disabled:hover:text-terminal-ok",
                  )}
                  disabled={!elegible(props.i, f)}
                  aria-pressed={f.estado !== "failed"}
                  aria-label={t("setup.optional.install", { name: f.label })}
                  onClick={() => props.onInstalar(f.name)}
                >
                  {f.estado === "running" || f.reintento?.enCurso ? "[…]" : f.estado === "failed" ? "[ ]" : "[✓]"}
                </button>{" "}
                <strong class="font-semibold">{f.label}</strong>{" "}
                <Show when={f.descripcion}>
                  <span class="text-terminal-muted">{f.descripcion} </span>
                </Show>
                <span
                  class={cn(
                    f.estado === "succeeded" ? "text-terminal-ok" : f.estado === "failed" ? "text-terminal-warn" : "text-terminal-muted",
                  )}
                >
                  · {detalleOpcional(props.i, f)}
                </span>
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
