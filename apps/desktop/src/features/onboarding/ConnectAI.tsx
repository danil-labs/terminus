import Check from "lucide-solid/icons/check";
import CircleCheck from "lucide-solid/icons/circle-check";
import Circle from "lucide-solid/icons/circle";
import ExternalLink from "lucide-solid/icons/external-link";
import Sparkles from "lucide-solid/icons/sparkles";
import TriangleAlert from "lucide-solid/icons/triangle-alert";
import { createSignal, For, Match, Show, Switch, type JSX } from "solid-js";
import { lista, mb } from "../../lib/format";
import { t } from "../../lib/i18n";
import { invoke } from "../../lib/invoke.ts";
import { cn } from "../../lib/utils";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { RemoveButton } from "../../ui/IconAction";
import { Input } from "../../ui/Input";
import { MarcaAgente } from "../../ui/icons";
import { TerminusMark } from "../../ui/toolMarks";
import { Spinner } from "../../ui/Spinner";
import { LoginCodeForm } from "../settings/LoginCodeForm";
import { Consentir } from "../settings/Accounts";
import { type Conexiones, type Fila, nombreDeFila, type Paso } from "./connect-store";

type Nodo = "off" | "det" | "vivo" | "on";

function nodo(p: Paso | undefined): Nodo {
  if (p?.k === "conectada") return "on";
  if (p && ["descargando", "entrando", "clave", "comprobando", "saliendo"].includes(p.k)) return "vivo";
  return p?.k === "instalada" ? "det" : "off";
}

function nombreCorto(f: Fila) {
  if (f.modo === "local") return t("onboarding.ai.local.short");
  if (f.modo === "consentimiento") return t("surfaces.label.free_short");
  if (f.agente === "antigravity") return "Gemini";
  return nombreDeFila(f);
}

const LINEA: Record<Nodo, string> = {
  off: "stroke-border-strong [stroke-dasharray:3_5]",
  det: "stroke-primary/45 [stroke-dasharray:3_5]",
  vivo: "stroke-primary [stroke-dasharray:6_6] animate-flujo motion-reduce:animate-none",
  on: "stroke-primary [stroke-width:2]",
};
const AZULEJO: Record<Nodo, string> = {
  off: "opacity-35 grayscale",
  det: "ring-1 ring-primary/45",
  vivo: "ring-2 ring-primary",
  on: "ring-2 ring-success-strong",
};

/** Terminus al centro y cada IA alrededor, con su estado en el trazo y en el aro de su logo. */
export function MapaDeConexiones(props: { c: Conexiones }) {
  const filas = () => props.c.filas();
  const lugar = (i: number) => {
    const angulo = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(1, filas().length);
    return [50 + 37 * Math.cos(angulo), 48 + 40 * Math.sin(angulo)] as const;
  };
  const resumen = () => {
    const vivo = filas().find((f) => nodo(props.c.pasos[f.id]) === "vivo");
    if (vivo) return t("onboarding.ai.map.connecting", { name: nombreDeFila(vivo) });
    const on = props.c.conectadas();
    if (on.length) return t("onboarding.ai.map.ready", { count: on.length, names: lista(on.map(nombreDeFila)) });
    const det = filas().filter((f) => f.detectada);
    if (det.length) return t("onboarding.ai.map.found", { names: lista(det.map(nombreDeFila)) });
    return t("onboarding.ai.map.none");
  };
  return (
    <div>
      <div class="relative my-5 h-[250px]" aria-hidden="true">
        <svg class="absolute inset-0 size-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
          <For each={filas()}>
            {(f, i) => (
              <line
                x1="50"
                y1="50"
                x2={lugar(i())[0]}
                y2={lugar(i())[1]}
                vector-effect="non-scaling-stroke"
                class={cn("[stroke-width:1.5] transition-[stroke] duration-300", LINEA[nodo(props.c.pasos[f.id])])}
              />
            )}
          </For>
        </svg>
        <span class="absolute top-1/2 left-1/2 grid size-[58px] -translate-1/2 place-items-center rounded-2xl bg-primary text-[var(--action-text)] shadow-lg ring-6 ring-bg">
          <TerminusMark size={30} />
        </span>
        <For each={filas()}>
          {(f, i) => {
            const estado = () => nodo(props.c.pasos[f.id]);
            return (
              <span
                class={cn(
                  "absolute grid w-[92px] -translate-1/2 justify-items-center gap-1.5 text-center text-[11px] transition-opacity",
                  estado() === "on" ? "font-semibold text-neutral-950" : "text-neutral-500",
                )}
                style={{ left: `${lugar(i())[0]}%`, top: `${lugar(i())[1]}%` }}
              >
                <span
                  class={cn(
                    "relative grid size-10 place-items-center rounded-[11px] border border-border bg-surface-raised ring-offset-4 ring-offset-bg transition-[filter,opacity,box-shadow] duration-300",
                    AZULEJO[estado()],
                  )}
                >
                  <MarcaAgente id={f.agente} size={22} />
                  <Show when={estado() === "on"}>
                    <span class="absolute -top-1.5 -right-1.5 grid size-4 place-items-center rounded-full bg-success-strong text-bg ring-2 ring-bg">
                      <Check size={10} stroke-width={3} />
                    </span>
                  </Show>
                </span>
                <span class="truncate">{nombreCorto(f)}</span>
              </span>
            );
          }}
        </For>
      </div>
      <p class="m-0 min-h-[18px] text-center text-[13px] text-neutral-500" role="status">
        {resumen()}
      </p>
    </div>
  );
}

/** Lo hecho y lo que falta del alta, debajo del mapa y en el resumen de «Personaliza». */
export function Comprobacion(props: { filas: { hecho: boolean; texto: string; enCurso?: boolean }[] }) {
  return (
    <ul class="m-0 grid list-none gap-2.5 p-0 text-sm">
      <For each={props.filas}>
        {(f) => (
          <li class={cn("flex items-center gap-2.5", f.hecho ? "text-success-strong" : "text-neutral-500")}>
            <Switch fallback={<Circle size={16} aria-hidden="true" />}>
              <Match when={f.hecho}>
                <CircleCheck size={16} aria-hidden="true" />
              </Match>
              <Match when={f.enCurso}>
                <Spinner class="text-primary" />
              </Match>
            </Switch>
            <span class="min-w-0 truncate">{f.texto}</span>
          </li>
        )}
      </For>
    </ul>
  );
}

const avance = (p: Paso | undefined) =>
  p?.k === "descargando" && p.total > 0 ? Math.min(100, (p.hecho / p.total) * 100) : 0;

function detalle(c: Conexiones, f: Fila): string {
  const p = c.pasos[f.id];
  const base =
    f.modo === "consentimiento"
      ? t("settings.ai_providers.free_detail")
      : f.modo === "local"
        ? t("onboarding.ai.local.detail")
        : f.agente.startsWith("opencode")
          ? t("onboarding.ai.zen_detail")
          : "";
  const peso = f.bytes ? mb(f.bytes) : "";
  switch (p?.k) {
    case "instalada":
      if (base) return base;
      return f.detectada ? t("onboarding.ai.system_no_session") : t("onboarding.ai.installed_no_session");
    case "descargando":
      return p.total > 0
        ? t("onboarding.ai.downloading_of", { done: mb(p.hecho), total: mb(p.total) })
        : t("onboarding.ai.downloading");
    case "entrando":
      if (p.codigo) return t("onboarding.ai.confirm_code", { code: p.codigo });
      return p.pideCodigo ? t("onboarding.ai.paste_code") : t("onboarding.ai.finish_in_browser");
    case "clave":
      return t("onboarding.ai.paste_key");
    case "comprobando":
      return f.modo === "clave" ? t("onboarding.ai.checking_key") : t("onboarding.ai.preparing");
    case "conectada":
      return p.cuenta;
    case "saliendo":
      return t("onboarding.ai.disconnecting");
    default:
      if (base) return peso ? `${base} · ${peso}` : base;
      return peso ? t("onboarding.ai.download_size", { size: peso }) : "";
  }
}

/** Una tarjeta de tamaño fijo: logo, nombre en una línea, detalle y una columna de acciones de ancho fijo. */
function Tarjeta(props: { c: Conexiones; f: Fila; abajo?: JSX.Element; resaltada?: boolean }) {
  const p = () => props.c.pasos[props.f.id];
  const error = () => props.c.errores[props.f.id];
  const nombre = () => nombreDeFila(props.f);
  const gratuitos = () => props.f.modo === "consentimiento";
  return (
    <div class="grid shrink-0">
      <div
        class={cn(
          "flex h-[62px] items-center gap-3 rounded-md border px-3.5",
          props.resaltada ? "border-primary bg-primary/5" : "border-border bg-surface-raised",
          props.abajo && "rounded-b-none",
        )}
      >
        <span class="grid size-6 shrink-0 place-items-center">
          <MarcaAgente id={props.f.agente} size={20} />
        </span>
        <span class="grid min-w-0 flex-1 gap-0.5">
          <strong class="truncate text-sm font-semibold text-neutral-950">{nombre()}</strong>
          <span
            class={cn("truncate text-xs", error() ? "text-error-strong" : "text-neutral-500")}
            title={error() ?? detalle(props.c, props.f)}
          >
            {error() ?? detalle(props.c, props.f)}
          </span>
        </span>
        <span class="flex w-[196px] shrink-0 items-center justify-end gap-1.5">
          <Switch
            fallback={
              <Button size="sm" variant="secondary" onClick={() => void props.c.conectar(props.f.id)}>
                {gratuitos() ? t("onboarding.ai.activate") : t("onboarding.ai.connect")}
              </Button>
            }
          >
            <Match when={p()?.k === "descargando"}>
              <Show when={avance(p())} fallback={<Spinner class="text-primary" />}>
                {(v) => (
                  <span class="h-[5px] w-[90px] overflow-hidden rounded-full bg-surface-muted">
                    <span class="block h-full bg-primary transition-[width] duration-150" style={{ width: `${v()}%` }} />
                  </span>
                )}
              </Show>
            </Match>
            <Match when={p()?.k === "entrando"}>
              <Spinner class="text-primary" />
              <Button size="sm" variant="ghost" onClick={() => void props.c.cancelar(props.f.id)}>
                {t("onboarding.cancel")}
              </Button>
            </Match>
            <Match when={p()?.k === "clave"}>
              <Button size="sm" variant="ghost" onClick={() => void props.c.cancelar(props.f.id)}>
                {t("onboarding.cancel")}
              </Button>
            </Match>
            <Match when={p()?.k === "comprobando" || p()?.k === "saliendo"}>
              <Spinner class={p()?.k === "saliendo" ? "text-neutral-500" : "text-primary"} />
            </Match>
            <Match when={p()?.k === "conectada"}>
              <Badge tone="success" class="gap-1">
                <Check size={11} stroke-width={3} aria-hidden="true" />
                {gratuitos() ? t("onboarding.ai.activated") : t("onboarding.ai.connected")}
              </Badge>
              <RemoveButton
                icon="unlink"
                label={
                  gratuitos()
                    ? t("onboarding.ai.deactivate", { name: nombre() })
                    : t("onboarding.ai.disconnect", { name: nombre() })
                }
                onClick={() => void props.c.desconectar(props.f.id)}
              />
            </Match>
          </Switch>
        </span>
      </div>
      {props.abajo}
    </div>
  );
}

const PANEL = "grid gap-2 rounded-b-lg border border-t-0 border-primary bg-surface-raised px-4 py-3.5 motion-safe:animate-entrar";

function PanelDeClave(props: { c: Conexiones; f: Fila }) {
  const [valor, setValor] = createSignal("");
  const ocupado = () => props.c.pasos[props.f.id]?.k === "comprobando";
  const id = `clave-${props.f.id}`;
  const enviar = () => {
    if (valor().trim() && !ocupado()) void props.c.guardarClave(props.f.id, valor()).then(() => setValor(""));
  };
  return (
    <div class={PANEL}>
      <label class="text-[13px] font-semibold" for={id}>
        {t("onboarding.ai.key.label", { name: nombreDeFila(props.f) })}
      </label>
      <Input
        id={id}
        type="password"
        class="font-mono"
        autocomplete="off"
        spellcheck={false}
        value={valor()}
        disabled={ocupado()}
        ref={(el) => queueMicrotask(() => el.focus())}
        onInput={(e) => setValor(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") enviar();
        }}
      />
      <Show when={props.f.urlDeClave}>
        {(url) => (
          <span class="text-xs text-neutral-500">
            {t("onboarding.ai.key.help")}{" "}
            <button
              type="button"
              class="inline-flex cursor-pointer items-center gap-0.5 text-primary hover:underline"
              onClick={() => void invoke("open_external", { target: url() }).catch(() => {})}
            >
              {url().replace(/^https?:\/\//, "")}
              <ExternalLink size={11} aria-hidden="true" />
            </button>
          </span>
        )}
      </Show>
      <div class="mt-0.5 flex flex-wrap items-center justify-end gap-2">
        <Button size="sm" variant="ghost" disabled={ocupado()} onClick={() => void props.c.cancelar(props.f.id)}>
          {t("onboarding.cancel")}
        </Button>
        <Button size="sm" disabled={ocupado() || !valor().trim()} onClick={enviar}>
          {ocupado() ? t("onboarding.ai.checking") : t("onboarding.ai.connect")}
        </Button>
      </div>
    </div>
  );
}

function PanelDeCodigo(props: { c: Conexiones; f: Fila }) {
  const [valor, setValor] = createSignal("");
  return (
    <div class={PANEL}>
      <LoginCodeForm value={valor()} onInput={setValor} onSubmit={() => void props.c.enviarCodigo(props.f.id, valor())} />
    </div>
  );
}

function AvisoDeGratuitos() {
  return (
    <div class="flex items-start gap-2 rounded-b-md border border-t-0 border-border bg-warning/10 px-3.5 py-2 text-[11px] leading-[1.4] text-warning-strong">
      <TriangleAlert size={13} class="mt-px shrink-0" aria-hidden="true" />
      <span>{t("settings.accounts.free.warning")}</span>
    </div>
  );
}

function FilaDeIA(props: { c: Conexiones; f: Fila }) {
  const p = () => props.c.pasos[props.f.id];
  const abajo = () => {
    const paso = p();
    if (paso?.k === "clave" || paso?.k === "comprobando" && props.f.modo === "clave")
      return <PanelDeClave c={props.c} f={props.f} />;
    if (paso?.k === "entrando" && paso.pideCodigo) return <PanelDeCodigo c={props.c} f={props.f} />;
    if (props.f.modo === "consentimiento" && paso?.k !== "conectada") return <AvisoDeGratuitos />;
    return undefined;
  };
  const resaltada = () => ["entrando", "clave", "comprobando"].includes(p()?.k ?? "");
  return <Tarjeta c={props.c} f={props.f} abajo={abajo()} resaltada={resaltada()} />;
}

/** El panel de la derecha: lo encontrado en esta computadora primero, luego los demás proveedores. */
export function PanelDeIA(props: { c: Conexiones }) {
  const detectadas = () => props.c.filas().filter((f) => f.detectada);
  const otras = () => props.c.filas().filter((f) => !f.detectada);
  return (
    <div class="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto rounded-lg border border-border bg-surface-raised p-5">
      <Show
        when={detectadas().length > 0}
        fallback={<h2 class="m-0 text-xs font-semibold text-neutral-500">{t("onboarding.ai.choose")}</h2>}
      >
        <h2 class="m-0 flex items-center gap-1.5 text-xs font-semibold text-primary">
          <Sparkles size={13} aria-hidden="true" />
          {t("onboarding.ai.found")}
        </h2>
        <For each={detectadas()}>{(f) => <FilaDeIA c={props.c} f={f} />}</For>
        <h2 class="m-0 mt-1.5 text-xs font-semibold text-neutral-500">{t("onboarding.ai.others")}</h2>
      </Show>
      <For each={otras()}>{(f) => <FilaDeIA c={props.c} f={f} />}</For>
      <Show when={!props.c.cargada() && !props.c.falloDeCarga()}>
        <div class="grid h-[62px] place-items-center text-neutral-500">
          <Spinner />
        </div>
      </Show>
      <Show when={props.c.falloDeCarga()}>
        {(e) => <p class="m-0 text-xs text-error-strong">{e()}</p>}
      </Show>
      <Show when={props.c.pregunta()}>
        {(q) => (
          <Consentir
            texto={q().texto}
            guardando={props.c.guardando()}
            onAceptar={() => void props.c.responder(true)}
            onCancelar={() => void props.c.responder(false)}
          />
        )}
      </Show>
    </div>
  );
}
