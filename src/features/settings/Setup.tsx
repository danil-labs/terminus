import { listen } from "@tauri-apps/api/event";
import { createEffect, createSignal, For, type JSX, Match, on, onCleanup, onMount, Show, Switch } from "solid-js";
import { peso } from "../../lib/format";
import { t } from "../../lib/i18n";
import { invoke } from "../../lib/invoke.ts";
import { cn } from "../../lib/utils";
import {
  createFullscreen,
  HEADER_HEIGHT,
  isWindows,
  needsTrafficLightPadding,
  TRAFFIC_LIGHT_PADDING,
  toggleMaximizeFromHeader,
} from "../../lib/window";
import { Button } from "../../ui/Button";
import { asFailure, FailureNote, prosaDe } from "../../ui/Failure";
import { BARRA_DE_TERMINAL, CUERPO_DE_TERMINAL, NOMBRE_DE_TERMINAL, TerminalCursor } from "../../ui/Terminal";
import { Toast, ToastPortal } from "../../ui/Toast";
import { crearWorkspace } from "../onboarding/onboarding-store";
import { Fases } from "../onboarding/Phases";
import ControlesDeVentana from "../shell/WindowControls";
import { type EnvReport, ORIGEN_APP, ORIGEN_BUNDLE, ORIGEN_SISTEMA } from "./environment-store";

/**
 * La preparación del runtime, por etapas y a la vista: la terminal enseña lo
 * que `bootstrap::prepare_runtime` narra por `bootstrap-run`. Se enseña solo la
 * primera vez; lo que falte con la app abierta se repara detrás con un aviso.
 */

type Estado = "waiting" | "running" | "succeeded" | "failed";
type Etapa = { name: string; essential: boolean; state: Estado; failure?: string };
/** Lo que contesta `prepare_runtime`: el estado de la corrida, la suya o la que ya estaba en curso. */
type Preparacion = { stages: Etapa[]; running: boolean };
type Nota = { type: "note"; stage: string; kind: string; value?: string; extra?: string };
type Evento =
  | { type: "manifest"; stages: { name: string; essential: boolean }[] }
  | { type: "stage"; name: string; state: Exclude<Estado, "waiting"> }
  | Nota
  | { type: "output"; stage: string; line: string; stream: "stdout" | "stderr" }
  | { type: "download"; stage: string; done: number; total?: number };
type Tono = "ok" | "info" | "warn" | "error" | "out" | "err";
type Linea = { tono: Tono; texto: string };
type Avance = { id: string; done: number; bytes: number };

const LINEAS_MAX = 400;
const RANGO: Record<Estado, number> = { waiting: 0, running: 1, succeeded: 2, failed: 2 };
const RITMO_CONSEJOS = 9000;
const RITMO_FOTO = 5000;
const MARCA: Record<Tono, string> = { ok: "✓", info: "→", warn: "⚠", error: "✗", out: " ", err: " " };
const COLOR: Record<Tono, string> = {
  ok: "text-terminal-ok",
  info: "text-terminal-text",
  warn: "text-terminal-warn",
  error: "text-terminal-error",
  out: "text-terminal-muted",
  err: "text-terminal-muted/70",
};

export default function Setup(props: { children: JSX.Element }) {
  const [reporte, setReporte] = createSignal<EnvReport | null>(null);
  const [mostrar, setMostrar] = createSignal<boolean | null>(null);
  const [seguir, setSeguir] = createSignal(false);
  const [hayEspacio, setHayEspacio] = createSignal<boolean | null>(null);
  const [fallo, setFallo] = createSignal<string | null>(null);
  // Aparte de `fallo`: el servicio que no contestó deja de ser verdad en cuanto vuelve.
  const [falloDelServicio, setFalloDelServicio] = createSignal<string | null>(null);
  const [corriendo, setCorriendo] = createSignal(false);
  const [etapas, setEtapas] = createSignal<Etapa[]>([]);
  const [lineas, setLineas] = createSignal<Linea[]>([]);
  const [activa, setActiva] = createSignal<string | null>(null);
  const [parcial, setParcial] = createSignal(0);
  const [consejo, setConsejo] = createSignal(0);
  const [pausa, setPausa] = createSignal(false);
  const [saltando, setSaltando] = createSignal(false);
  const [sinSoporte, setSinSoporte] = createSignal(false);
  const [bloqueado, setBloqueado] = createSignal(false);
  let log: HTMLPreElement | undefined;
  const pantallaCompleta = createFullscreen();
  // Esta pantalla ocupa la ventana entera: su cabecera siempre tiene la esquina del semáforo.
  const apartarSemaforo = needsTrafficLightPadding(() => true, pantallaCompleta);

  const quieto = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  const consejos = () => [
    [t("setup.tips.agents.title"), t("setup.tips.agents.body")],
    [t("setup.tips.context.title"), t("setup.tips.context.body")],
    [t("setup.tips.workspaces.title"), t("setup.tips.workspaces.body")],
    [t("setup.tips.memory.title"), t("setup.tips.memory.body")],
    [t("setup.tips.folders.title"), t("setup.tips.folders.body")],
  ];

  function nombre(stage: string) {
    if (stage === "platform") return t("setup.stage.platform");
    return reporte()?.items.find((r) => r.id === stage)?.label ?? stage;
  }

  function origen(source?: string) {
    if (source === ORIGEN_SISTEMA) return t("settings.environment.origin.system");
    if (source === ORIGEN_APP) return t("settings.environment.origin.app");
    if (source === ORIGEN_BUNDLE) return t("settings.environment.origin.bundle");
    return t("settings.environment.origin.missing");
  }

  function traducir(e: Nota): Linea[] {
    const name = nombre(e.stage);
    const valor = e.value ?? "";
    switch (e.kind) {
      case "platform":
        return [
          {
            tono: "ok",
            texto: e.extra
              ? t("setup.log.platform_space", { platform: valor, free: peso(Number(e.extra)) })
              : t("setup.log.platform", { platform: valor }),
          },
        ];
      case "found":
        return [{ tono: "ok", texto: t("setup.log.found", { name, version: valor, source: origen(e.extra) }) }];
      case "installing":
        return [{ tono: "info", texto: t("setup.log.installing", { name, version: valor }) }];
      case "download":
        return [
          {
            tono: "info",
            texto: e.extra
              ? t("setup.log.download_size", { file: valor, size: peso(Number(e.extra)) })
              : t("setup.log.download", { file: valor }),
          },
        ];
      case "installed":
        return [{ tono: "ok", texto: t("setup.log.installed", { name, version: valor }) }];
      case "timed_out":
        return [{ tono: "warn", texto: t("setup.log.timed_out", { name }) }];
      case "stalled":
        return [{ tono: "warn", texto: t("setup.log.stalled", { name, minutes: valor }) }];
      case "unsupported":
        setSinSoporte(true);
        return [{ tono: "error", texto: t("setup.log.unsupported", { version: valor, minimum: e.extra ?? "" }) }];
      case "failed": {
        if (e.stage === "platform" && sinSoporte()) return [];
        const esencial = etapas().find((s) => s.name === e.stage)?.essential ?? true;
        const cabeza: Linea = esencial
          ? { tono: "error", texto: t("setup.log.failed", { name }) }
          : { tono: "warn", texto: t("setup.log.optional_failed", { name }) };
        const detalle = valor.split("\n").filter((l) => l.trim());
        return [cabeza, ...detalle.map((texto): Linea => ({ tono: "err", texto }))];
      }
    }
    return [];
  }

  function agregar(nuevas: Linea[]) {
    if (nuevas.length) setLineas((antes) => [...antes, ...nuevas].slice(-LINEAS_MAX));
  }

  // Una etapa puede llegar por evento antes que la respuesta que trae el manifiesto.
  const vistas = new Map<string, Estado>();
  const masAvanzado = (a: Estado, b?: Estado) => (b && RANGO[b] > RANGO[a] ? b : a);

  // La foto manda; un evento que ya llegó más lejos no retrocede.
  function adoptar(p: Preparacion) {
    setEtapas(p.stages.map((s) => ({ ...s, state: masAvanzado(s.state, vistas.get(s.name)) })));
  }

  function recibir(e: Evento) {
    switch (e.type) {
      case "manifest":
        // Un manifiesto abre una corrida: la de un servicio anterior ya no cuenta.
        vistas.clear();
        setLineas([]);
        setEtapas(e.stages.map((s) => ({ ...s, state: "waiting" })));
        return;
      case "stage":
        vistas.set(e.name, masAvanzado(e.state, vistas.get(e.name)));
        setEtapas((antes) => antes.map((s) => (s.name === e.name ? { ...s, state: e.state } : s)));
        if (e.state === "running") {
          setActiva(e.name);
          setParcial(0);
        }
        return;
      case "note":
        agregar(traducir(e));
        return;
      case "output":
        agregar([{ tono: e.stream === "stderr" ? "err" : "out", texto: e.line }]);
        return;
      case "download":
        if (e.total) setParcial(e.done / e.total);
        return;
    }
  }

  const escuchaEtapas = listen<Evento>("bootstrap-run", (e) => recibir(e.payload));
  // pnpm y Bun bajan por `toolchain::install_tool`, que ya reporta su avance por aquí.
  const escuchaHerramientas = listen<Avance>("toolchain", (e) => {
    if (e.payload.id === activa() && e.payload.bytes > 0) setParcial(e.payload.done / e.payload.bytes);
  });
  let streamCursor: number | null = null;
  let streamRuntime: string | null = null;
  let streamClosed = false;
  let streamTimer: ReturnType<typeof setTimeout> | undefined;
  async function readSetupEvents() {
    if (streamClosed || seguir() || mostrar() === false) return;
    try {
      const page = await invoke<{ cursor: number | null; runtime: string; reset?: boolean }>("service_poll", {
        cursor: streamCursor, workspace: null, runtime: streamRuntime, replay: false, setup: true,
      });
      streamCursor = page.cursor;
      streamRuntime = page.runtime;
      setFalloDelServicio(null);
      // Un servicio nuevo no sabe de la corrida del anterior: se le pide que la arranque o se una.
      // Su manifiesto queda antes de la lectura desde el final: sin limpiar aquí, se repite la corrida muerta.
      if (page.reset && corriendo()) {
        vistas.clear();
        setLineas([]);
        void consultar();
      }
    } catch {
      if (!streamClosed) setFalloDelServicio(t("setup.error_check"));
    }
    if (!streamClosed) streamTimer = setTimeout(() => void readSetupEvents(), 250);
  }
  const streamReady = Promise.all([escuchaEtapas, escuchaHerramientas]).then(readSetupEvents);
  onCleanup(() => {
    streamClosed = true;
    if (streamTimer) clearTimeout(streamTimer);
    void escuchaEtapas.then((f) => f());
    void escuchaHerramientas.then((f) => f());
  });

  async function preparar() {
    await streamReady;
    setCorriendo(true);
    await consultar(false);
  }

  // `joinOnly` no arranca otra corrida en el servicio que ya tuvo una.
  async function consultar(joinOnly = true) {
    let corrida: Preparacion | null = null;
    try {
      corrida = await invoke<Preparacion | null>("prepare_runtime", { joinOnly });
    } catch (e) {
      // Sin parar de preguntar: un servicio que vuelve retoma la corrida y borra el aviso.
      setFalloDelServicio(prosaDe(e));
      return;
    }
    setFalloDelServicio(null);
    if (corrida?.stages?.length) adoptar(corrida);
    // Un servicio anterior contesta sin estado cuando otra corrida lo tiene.
    else if (!etapas().length && !fallo()) setFallo(t("setup.error_in_flight"));
    const sigue = corrida?.running === true && !cerrada();
    setCorriendo(sigue);
    if (sigue) return;
    try {
      // Instalar ya tiró el reporte (`env::olvidar`), y lo instalado estrena
      // archivo: la huella no acierta y se vuelve a sondear solo eso.
      const r = await invoke<EnvReport>("check_environment", { force: false });
      setReporte(r);
      setBloqueado(r?.blocked === true);
    } catch {
      // El reporte anterior sigue sirviendo para nombrar las etapas.
    }
  }

  createEffect(
    on(corriendo, (sigue) => {
      if (!sigue) return;
      const id = setInterval(() => void consultar(), RITMO_FOTO);
      onCleanup(() => clearInterval(id));
    }),
  );

  function contarEspacios() {
    invoke<{ workspaces: unknown[] }>("list_workspaces")
      .then((s) => setHayEspacio(s.workspaces.length > 0))
      .catch(() => setHayEspacio(null));
  }

  /**
   * Decide el primer pintado con un `stat`, y deja el reporte para después.
   *
   * Este componente es la compuerta de la app entera: mientras `mostrar()` es
   * `null` la ventana pinta un div vacío. Todo lo que se espere aquí es tiempo
   * en blanco, y el sondeo del entorno crece solo cada vez que alguien le añade
   * una herramienta.
   */
  async function empezar() {
    setFallo(null);
    let primera = false;
    try {
      primera = await invoke<boolean>("setup_required");
    } catch (e) {
      setFallo(prosaDe(e));
      setMostrar(true);
      return;
    }
    if (mostrar() === null) setMostrar(primera);
    if (mostrar()) contarEspacios();

    let r: EnvReport;
    try {
      r = await invoke<EnvReport>("check_environment", { force: false });
      if (!r) throw new Error(t("setup.error_check"));
    } catch (e) {
      // Con la app pintada no se cambia de pantalla: Estado del entorno enseña su propio error.
      setFallo(prosaDe(e));
      return;
    }
    setReporte(r);
    setBloqueado(r.blocked === true);
    if (primera || (r.bootstrap ?? []).length > 0) await preparar();
  }

  onMount(() => void empezar());

  const temporizador = setInterval(() => {
    if (!pausa() && !quieto && !seguir()) setConsejo((c) => (c + 1) % consejos().length);
  }, RITMO_CONSEJOS);
  onCleanup(() => clearInterval(temporizador));

  createEffect(
    on(
      () => lineas().length,
      () => {
        if (log) log.scrollTop = log.scrollHeight;
      },
    ),
  );

  const hechas = () => etapas().filter((s) => s.state === "succeeded" || s.state === "failed").length;
  const terminado = () => etapas().length > 0 && hechas() === etapas().length;
  const falloEsencial = () => etapas().some((s) => s.essential && s.state === "failed");
  const cerrada = () => terminado() || falloEsencial();
  createEffect(() => {
    if (cerrada()) setCorriendo(false);
  });
  const falloOpcional = () => etapas().some((s) => !s.essential && s.state === "failed");
  const porcentaje = () => {
    const total = etapas().length;
    if (!total) return 0;
    const enCurso = corriendo() && !terminado() ? Math.min(parcial(), 0.99) : 0;
    return Math.round(((hechas() + enCurso) / total) * 100);
  };
  // Saltar el alta necesita un workspace: sin él la app no tiene dónde guardar nada.
  async function configurarAMano() {
    setSaltando(true);
    try {
      await crearWorkspace(t("onboarding.manual.default_name"));
      setSeguir(true);
    } catch (e) {
      setFallo(prosaDe(e));
      setSaltando(false);
    }
  }

  const reparando = () => {
    const fallida = etapas().find((s) => s.essential && s.state === "failed");
    if (fallida) return nombre(fallida.name);
    const esencial = (reporte()?.bootstrap ?? []).find((id) => reporte()?.essential?.includes(id));
    return esencial ? nombre(esencial) : "";
  };
  const aviso = () => mostrar() === false && bloqueado() && (corriendo() || falloEsencial());

  function abrirEntorno() {
    window.dispatchEvent(new CustomEvent("harness:open-settings", { detail: "entorno" }));
  }

  const estado = () => {
    if (!etapas().length) return t("setup.status.checking");
    if (sinSoporte()) return t("setup.status.unsupported");
    if (falloEsencial()) return t("setup.status.failed");
    if (terminado()) return falloOpcional() ? t("setup.status.partial") : t("setup.status.done");
    return t("setup.status.running", { percent: porcentaje() });
  };

  return (
    <Switch
      fallback={
        <>
          {props.children}
          <Show when={aviso()}>
            <ToastPortal>
              <Toast tone={falloEsencial() ? "error" : "status"} data-setup-repair="">
                <p class="m-0 break-words text-xs text-neutral-950">
                  {falloEsencial()
                    ? t("setup.repair.failed", { name: reparando() })
                    : t("setup.repair.running", { name: reparando() })}
                </p>
                <Show when={falloEsencial()}>
                  <div>
                    <Button variant="outline" size="compact" onClick={abrirEntorno}>
                      {t("setup.repair.open")}
                    </Button>
                  </div>
                </Show>
              </Toast>
            </ToastPortal>
          </Show>
        </>
      }
    >
      <Match when={mostrar() === null}>
        <div class="h-full bg-bg" />
      </Match>
      <Match when={mostrar() && !seguir()}>
        <main class="flex h-full flex-col overflow-hidden bg-bg">
          <header
            class={cn(
              "flex shrink-0 items-center gap-5 border-b border-border px-7 text-xs",
              HEADER_HEIGHT,
              apartarSemaforo() && TRAFFIC_LIGHT_PADDING,
            )}
            data-tauri-drag-region=""
            onDblClick={toggleMaximizeFromHeader}
          >
            <Show when={hayEspacio() === false}>
              <Fases actual={0} />
            </Show>
            <span class="flex-1 self-stretch" data-tauri-drag-region="" />
            <Show when={isWindows()}>
              <ControlesDeVentana />
            </Show>
          </header>

          <div class="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[45%_55%] md:grid-rows-[minmax(0,1fr)]">
            <section class="flex min-h-0 flex-col items-start overflow-y-auto px-10 py-10">
              <h1 class="m-0 mb-5 max-w-[13ch] text-4xl leading-tight font-display font-bold tracking-[-0.03em] text-neutral-950">
                {t("setup.title")}
              </h1>
              <p class="m-0 max-w-[38ch] text-sm text-neutral-500">{t("setup.description")}</p>
              <Show when={fallo() ?? falloDelServicio()}>
                {(f) => (
                  <div class="mt-6 w-full">
                    <FailureNote f={asFailure(f())} />
                  </div>
                )}
              </Show>

              <div class="mt-auto w-full border-t border-border pt-6">
                <p class="m-0 text-xs text-neutral-500">{t("setup.tips.eyebrow")}</p>
                <h2 class="m-0 mt-3 text-lg font-display font-bold tracking-[-0.01em] text-neutral-950">
                  {consejos()[consejo()][0]}
                </h2>
                <p class="m-0 mt-3 min-h-28 max-w-[40ch] text-sm text-neutral-500">{consejos()[consejo()][1]}</p>
                <div class="mt-4 flex items-center gap-2">
                  <div class="flex gap-1.5">
                    <For each={consejos()}>
                      {(_, i) => (
                        <button
                          type="button"
                          class={cn(
                            "size-2.5 rounded-full outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                            i() === consejo() ? "bg-primary" : "bg-border-strong",
                          )}
                          aria-label={t("setup.tips.go", { number: i() + 1 })}
                          aria-pressed={i() === consejo()}
                          onClick={() => setConsejo(i())}
                        />
                      )}
                    </For>
                  </div>
                  <span class="flex-1" />
                  <Button
                    size="compact"
                    variant="ghost"
                    onClick={() => setConsejo((c) => (c + consejos().length - 1) % consejos().length)}
                  >
                    {t("setup.tips.previous")}
                  </Button>
                  <Button size="compact" variant="ghost" onClick={() => setConsejo((c) => (c + 1) % consejos().length)}>
                    {t("setup.tips.next")}
                  </Button>
                  <Button size="compact" variant="ghost" onClick={() => setPausa((p) => !p)}>
                    {pausa() ? t("setup.tips.resume") : t("setup.tips.pause")}
                  </Button>
                </div>
              </div>
            </section>

            <section
              class="mx-6 mb-6 flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg bg-terminal text-terminal-text md:mt-6 md:ml-0"
              aria-label={t("setup.terminal.title")}
            >
              <header class={cn(BARRA_DE_TERMINAL, "px-5 py-3.5")}>
                <strong class={NOMBRE_DE_TERMINAL}>{t("setup.terminal.title")}</strong>
                <span class="flex-1" />
                <Show when={etapas().length > 0}>
                  <span class="tabular-nums">
                    {hechas()}/{etapas().length}
                  </span>
                </Show>
              </header>
              <pre
                ref={log}
                role="log"
                tabindex="0"
                class={cn(CUERPO_DE_TERMINAL, "flex-1 p-6 leading-6")}
              >
                <For each={lineas()}>
                  {(linea) => (
                    <div class={COLOR[linea.tono]}>
                      <span aria-hidden="true">{MARCA[linea.tono]} </span>
                      {linea.texto}
                    </div>
                  )}
                </For>
                <Show when={corriendo()}>
                  <TerminalCursor />
                </Show>
              </pre>
              <footer class="border-t border-terminal-line px-5 py-4 text-xs text-terminal-muted">
                <span role="status">{estado()}</span>
                <div class="my-3 h-1.5 overflow-hidden rounded-full bg-terminal-line">
                  <div
                    class="h-full bg-terminal-accent transition-[width] duration-300"
                    style={{ width: `${porcentaje()}%` }}
                  />
                </div>
                {t("setup.terminal.reuse")}
              </footer>
            </section>
          </div>

          <footer class="flex flex-wrap items-center gap-3 border-t border-border px-7 py-5">
            <p class="m-0 text-xs text-neutral-500">{t("setup.footer")}</p>
            <span class="flex-1" />
            {/* Solo lo esencial se reintenta aquí: lo opcional se reintenta solo en el
                siguiente arranque y a mano en Estado del entorno. */}
            <Show when={!sinSoporte() && (falloDelServicio() || (!corriendo() && (fallo() || falloEsencial())))}>
              <Button size="sm" variant="secondary" onClick={() => void empezar()}>
                {t("setup.retry")}
              </Button>
            </Show>
            <Show when={terminado() && !falloEsencial()}>
              <Show when={hayEspacio() === false}>
                <Button size="sm" variant="ghost" disabled={saltando()} onClick={() => void configurarAMano()}>
                  {t("onboarding.manual.skip")}
                </Button>
              </Show>
              <Button size="sm" disabled={saltando()} onClick={() => setSeguir(true)}>
                {hayEspacio() === false ? t("setup.next.workspace") : t("setup.next.app")}
              </Button>
            </Show>
          </footer>
        </main>
      </Match>
    </Switch>
  );
}
