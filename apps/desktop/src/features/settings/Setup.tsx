import { listen } from "../../lib/serviceEvents";
import {
  createEffect,
  createSignal,
  For,
  getOwner,
  type JSX,
  lazy,
  Match,
  on,
  onCleanup,
  onMount,
  runWithOwner,
  Show,
  Suspense,
  Switch,
} from "solid-js";
import { connected } from "../../lib/engineConnection";
import { elapsed, peso } from "../../lib/format";
import { t } from "../../lib/i18n";
import { invoke } from "../../lib/invoke.ts";
import { capabilities } from "../../lib/platform";
import { hasShellCache } from "../../lib/shellCache";
import { cn } from "../../lib/utils";
import { Button } from "../../ui/Button";
import { asFailure, FailureNote, prosaDe } from "../../ui/Failure";
import { Toast, ToastPortal } from "../../ui/Toast";
import type { Conexiones } from "../onboarding/connect-store";
import { crearWorkspace } from "../onboarding/onboarding-store";
import { CabeceraDelAlta } from "../onboarding/Phases";
import type { EstadoDeEtapa, FilaDeEtapa, Instalacion, Linea, Paso as PasoDeFila, Vista } from "../onboarding/Prepare";
import { Escenario, QUIETO, TituloCambiante } from "../onboarding/Stage";
import { type EnvReport, ORIGEN_APP, ORIGEN_BUNDLE, ORIGEN_SISTEMA } from "./environment-store";

/**
 * La preparación del runtime, por etapas y a la vista, y en la primera vez el
 * alta entera: preparar, conectar la IA en la misma pantalla y personalizar.
 * Lo que falte con la app abierta se repara detrás con un aviso.
 */

type Etapa = { name: string; essential: boolean; state: EstadoDeEtapa; failure?: string };
/** Lo que contesta `prepare_runtime`: el estado de la corrida, la suya o la que ya estaba en curso. */
type Preparacion = { stages: Etapa[]; running: boolean };
type Nota = { type: "note"; stage: string; kind: string; value?: string; extra?: string };
type Evento =
  | { type: "manifest"; stages: { name: string; essential: boolean }[] }
  | { type: "stage"; name: string; state: Exclude<EstadoDeEtapa, "waiting">; durationMs?: number }
  | Nota
  | { type: "output"; stage: string; line: string; stream: "stdout" | "stderr" }
  | { type: "download"; stage: string; done: number; total?: number };
type Avance = { id: string; done: number; bytes: number };
/** El evento `install` del motor: el avance de todo lo que se descarga y se puede cancelar. */
type AvanceDeInstalacion = { operation: string; kind: string; done: number; bytes: number };
/** Lo que las notas dicen de cada etapa, para el detalle de su fila. */
type Dato = { version?: string; origen?: string; libre?: string; plataforma?: string; instala?: boolean };
type Paso = "preparar" | "ia" | "personalizar";

const LINEAS_MAX = 400;
const RANGO: Record<EstadoDeEtapa, number> = { waiting: 0, running: 1, succeeded: 2, failed: 2, skipped: 2 };
const RITMO_CONSEJOS = 5000;
const RITMO_FOTO = 5000;
const CON_DESCRIPCION = new Set(["pnpm", "bun", "agent-browser", "uv", "python"]);

// Una computadora gestionada llega preparada: en el navegador solo se ve su estado.
const PreparacionGestionada = lazy(() => import("../../web/ManagedSetup"));
// Conectar la IA y personalizar solo se cargan en el primer arranque: la carga inicial está en su techo.
const MapaDeConexiones = lazy(() => import("../onboarding/ConnectAI").then((m) => ({ default: m.MapaDeConexiones })));
const PanelDeIA = lazy(() => import("../onboarding/ConnectAI").then((m) => ({ default: m.PanelDeIA })));
const Comprobacion = lazy(() => import("../onboarding/ConnectAI").then((m) => ({ default: m.Comprobacion })));
const Personalizar = lazy(() => import("../onboarding/Personalize"));
const SelectorDeVista = lazy(() => import("../onboarding/Prepare").then((m) => ({ default: m.SelectorDeVista })));
const VistaSencilla = lazy(() => import("../onboarding/Prepare").then((m) => ({ default: m.VistaSencilla })));
const VistaTerminal = lazy(() => import("../onboarding/Prepare").then((m) => ({ default: m.VistaTerminal })));

export default function Setup(props: { children: JSX.Element }) {
  if (!capabilities().localSetup) return <PreparacionGestionada>{props.children}</PreparacionGestionada>;
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
  const [datos, setDatos] = createSignal<Record<string, Dato>>({});
  const [descarga, setDescarga] = createSignal<{ stage: string; file: string; done: number; total: number } | null>(null);
  const [quiere, setQuiere] = createSignal<Record<string, boolean>>({});
  // Lo que se hace con un opcional fuera de la corrida (instalarlo solo, desinstalarlo) manda sobre su etapa.
  const [sueltos, setSueltos] = createSignal<Record<string, PasoDeFila>>({});
  const [cancelados, setCancelados] = createSignal<Set<string>>(new Set());
  // Los que se cortaron con la ×: su línea es «descarga cancelada», no «omitido».
  const conLaX = new Set<string>();
  const [consejo, setConsejo] = createSignal(0);
  const [sinSoporte, setSinSoporte] = createSignal(false);
  const [bloqueado, setBloqueado] = createSignal(false);
  const [vista, setVista] = createSignal<Vista>("sencilla");
  const [paso, setPaso] = createSignal<Paso>("preparar");
  const [entrando, setEntrando] = createSignal(false);
  const [workspace, setWorkspace] = createSignal<{ id: string; nombre: string } | null>(null);
  let log: HTMLPreElement | undefined;
  let tope = { total: -1, valor: 0 };

  const [conexiones, setConexiones] = createSignal<Conexiones | null>(null);
  const dueño = getOwner();

  const consejos = () => [
    [t("setup.tips.agents.title"), t("setup.tips.agents.body")],
    [t("setup.tips.context.title"), t("setup.tips.context.body")],
    [t("setup.tips.workspaces.title"), t("setup.tips.workspaces.body")],
    [t("setup.tips.memory.title"), t("setup.tips.memory.body")],
  ];
  const quiereEsta = (name: string) => quiere()[name] !== false;
  const ponerSuelto = (name: string, paso: PasoDeFila | null) =>
    setSueltos((x) => {
      const y = { ...x };
      if (paso) y[name] = paso;
      else delete y[name];
      return y;
    });

  function nombre(stage: string) {
    if (stage === "platform") return t("setup.stage.platform");
    if (stage === "python") return "Python";
    return reporte()?.items.find((r) => r.id === stage)?.label ?? stage;
  }

  function origen(source?: string) {
    if (source === ORIGEN_SISTEMA) return t("settings.environment.origin.system");
    if (source === ORIGEN_APP) return t("settings.environment.origin.app");
    if (source === ORIGEN_BUNDLE) return t("settings.environment.origin.bundle");
    return t("settings.environment.origin.missing");
  }

  const anotar = (stage: string, d: Dato) => setDatos((x) => ({ ...x, [stage]: { ...x[stage], ...d } }));

  function traducir(e: Nota): Linea[] {
    const name = nombre(e.stage);
    const valor = e.value ?? "";
    switch (e.kind) {
      case "platform":
        anotar(e.stage, { plataforma: valor, libre: e.extra ? peso(Number(e.extra)) : undefined });
        return [
          {
            tono: "ok",
            texto: e.extra
              ? t("setup.log.platform_space", { platform: valor, free: peso(Number(e.extra)) })
              : t("setup.log.platform", { platform: valor }),
          },
        ];
      case "found":
        anotar(e.stage, { version: valor, origen: e.extra });
        return [
          {
            tono: "ok",
            texto:
              e.extra === ORIGEN_SISTEMA
                ? t("setup.log.found_system", { name, version: valor })
                : t("setup.log.found", { name, version: valor, source: origen(e.extra) }),
          },
        ];
      case "installing":
        anotar(e.stage, { version: valor, instala: true });
        return [{ tono: "info", texto: t("setup.log.installing", { name, version: valor }) }];
      case "download":
        anotar(e.stage, { instala: true });
        setDescarga({ stage: e.stage, file: valor, done: 0, total: Number(e.extra ?? 0) });
        return [
          {
            tono: "info",
            texto: e.extra
              ? t("setup.log.download_size", { file: valor, size: peso(Number(e.extra)) })
              : t("setup.log.download", { file: valor }),
          },
        ];
      case "installed":
        anotar(e.stage, { version: valor, origen: ORIGEN_APP });
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
        if (cancelados().has(e.stage)) return [];
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
  const vistas = new Map<string, EstadoDeEtapa>();
  const masAvanzado = (a: EstadoDeEtapa, b?: EstadoDeEtapa) => (b && RANGO[b] > RANGO[a] ? b : a);

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
        setDatos({});
        setDescarga(null);
        setEtapas(e.stages.map((s) => ({ ...s, state: "waiting" })));
        return;
      case "stage": {
        vistas.set(e.name, masAvanzado(e.state, vistas.get(e.name)));
        const etapa = etapas().find((s) => s.name === e.name);
        setEtapas((antes) => antes.map((s) => (s.name === e.name ? { ...s, state: e.state } : s)));
        if (e.state === "running" && etapa && !etapa.essential && !quiereEsta(e.name)) {
          // Se desmarcó mientras esperaba: el motor ya la arrancó, se corta en cuanto empieza.
          setCancelados((c) => new Set(c).add(e.name));
          void invoke("cancel_install", { operation: `tool:${e.name}` }).catch(() => {});
        }
        const cortada = e.state === "failed" && cancelados().has(e.name);
        if ((e.state === "skipped" || cortada) && !conLaX.has(e.name)) {
          agregar([{ tono: "omite", texto: t("setup.log.skipped", { name: nombre(e.name) }) }]);
        }
        if (e.state === "running") {
          setActiva(e.name);
          setParcial(0);
          agregar([
            {
              tono: "etapa",
              texto: t("setup.log.stage_start", {
                name: nombre(e.name),
                kind: etapa?.essential === false ? t("setup.log.optional") : t("setup.log.essential"),
              }),
            },
          ]);
        } else {
          if (descarga()?.stage === e.name) setDescarga(null);
          if (e.state === "succeeded" && e.durationMs !== undefined) {
            const s = Math.max(1, Math.round(e.durationMs / 1000));
            agregar([{ tono: "ok", texto: t("setup.log.stage_done", { name: nombre(e.name), duration: elapsed(s) }) }]);
          }
        }
        return;
      }
      case "note":
        agregar(traducir(e));
        return;
      case "output":
        agregar([{ tono: e.stream === "stderr" ? "err" : "out", texto: e.line }]);
        return;
      case "download":
        if (e.total) {
          setParcial(e.done / e.total);
          setDescarga((d) => (d && d.stage === e.stage ? { ...d, done: e.done, total: e.total ?? d.total } : d));
        }
        return;
    }
  }

  const escuchaEtapas = listen<Evento>("bootstrap-run", (e) => recibir(e.payload));
  // Un opcional que se instala solo, después de la corrida, cuenta su descarga por aquí.
  const escuchaInstalaciones = listen<AvanceDeInstalacion>("install", (e) => {
    const name = e.payload.operation.startsWith("tool:") ? e.payload.operation.slice(5) : null;
    if (!name || sueltos()[name] !== "run" || e.payload.bytes <= 0) return;
    setParcial(e.payload.done / e.payload.bytes);
    setDescarga({ stage: name, file: nombre(name), done: e.payload.done, total: e.payload.bytes });
  });
  // pnpm y Bun bajan por `toolchain::install_tool`, que ya reporta su avance por aquí.
  const escuchaHerramientas = listen<Avance>("toolchain", (e) => {
    if (e.payload.id !== activa() || e.payload.bytes <= 0) return;
    setParcial(e.payload.done / e.payload.bytes);
    setDescarga((d) => (d && d.stage === e.payload.id ? { ...d, done: e.payload.done, total: e.payload.bytes } : d));
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
  const streamReady = Promise.all([escuchaEtapas, escuchaHerramientas, escuchaInstalaciones]).then(readSetupEvents);
  onCleanup(() => {
    streamClosed = true;
    if (streamTimer) clearTimeout(streamTimer);
    void escuchaEtapas.then((f) => f());
    void escuchaHerramientas.then((f) => f());
    void escuchaInstalaciones.then((f) => f());
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
      const skip = Object.entries(quiere())
        .filter(([, si]) => !si)
        .map(([name]) => name);
      corrida = await invoke<Preparacion | null>("prepare_runtime", skip.length ? { joinOnly, skip } : { joinOnly });
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
    invoke<{ workspaces: { id: string; name: string }[]; active: string | null }>("list_workspaces")
      .then((s) => {
        setHayEspacio(s.workspaces.length > 0);
        const activo = s.workspaces.find((w) => w.id === s.active);
        if (activo) setWorkspace({ id: activo.id, nombre: activo.name });
      })
      .catch(() => setHayEspacio(null));
  }

  /**
   * Decide el primer pintado con un `stat`, y deja el reporte para después.
   *
   * Este componente es la compuerta de la app entera: mientras `mostrar()` es
   * `null` la ventana pinta un div vacío. Todo lo que se espere aquí es tiempo
   * en blanco.
   */
  async function empezar() {
    setFallo(null);
    // Con la foto del sidebar de la vez anterior la preparación ya se hizo: la app
    // monta sin esperar al motor y esta pantalla vuelve solo si el motor dice que falta.
    const optimista = mostrar() === null && !connected() && hasShellCache();
    if (optimista) setMostrar(false);
    // A la vez: el reporte no depende de si hace falta la preparación.
    const reporteEnCurso = invoke<EnvReport>("check_environment", { force: false });
    reporteEnCurso.catch(() => {});
    let primera = false;
    try {
      primera = await invoke<boolean>("setup_required");
    } catch (e) {
      setFallo(prosaDe(e));
      if (!optimista) setMostrar(true);
      return;
    }
    if (mostrar() === null || (optimista && primera)) setMostrar(primera);
    if (mostrar()) contarEspacios();

    let r: EnvReport;
    try {
      r = await reporteEnCurso;
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
    if (!QUIETO() && !seguir() && paso() === "preparar") setConsejo((c) => (c + 1) % consejos().length);
  }, RITMO_CONSEJOS);
  onCleanup(() => clearInterval(temporizador));

  createEffect(
    on(
      () => [lineas().length, vista()],
      () => {
        if (log) log.scrollTop = log.scrollHeight;
      },
    ),
  );

  /** El estado de cada fila como lo cuenta el diseño. */
  function pasoDe(s: Etapa): PasoDeFila {
    const suelto = sueltos()[s.name];
    if (suelto) return suelto;
    switch (s.state) {
      case "running":
        return "run";
      case "succeeded":
        return "ok";
      case "failed":
        return cancelados().has(s.name) ? "skip" : "fail";
      case "skipped":
        return "skip";
      default:
        return "wait";
    }
  }
  const corridaHecha = () =>
    etapas().length > 0 && etapas().every((s) => s.state === "succeeded" || s.state === "failed" || s.state === "skipped");
  const falloEsencial = () => etapas().some((s) => s.essential && s.state === "failed");
  const cerrada = () => corridaHecha() || falloEsencial();
  createEffect(() => {
    if (cerrada()) setCorriendo(false);
  });
  const terminado = () => corridaHecha();
  const solo = () => Object.values(sueltos()).includes("run");
  /** Terminada y sin nada suelto en curso: lo omitido ya se puede marcar para instalarlo. */
  const fin = () => terminado() && !solo();
  // Lo que cuenta para el avance: lo esencial, lo opcional que se quiere y lo que ya quedó.
  const elegidas = () =>
    etapas().filter((s) => s.essential || pasoDe(s) === "ok" || (quiereEsta(s.name) && pasoDe(s) !== "skip"));
  const hechas = () => elegidas().filter((s) => ["ok", "fail"].includes(pasoDe(s))).length;
  const omitidas = () => etapas().filter((s) => ["skip", "bye"].includes(pasoDe(s))).length;
  const falloOpcional = () => etapas().some((s) => pasoDe(s) === "fail");
  // Un solo avance para toda la instalación: solo baja si se agrega o se quita un opcional.
  const porcentaje = () => {
    if (!etapas().length) return 0;
    if (fin()) return 100;
    const total = Math.max(1, elegidas().length);
    const enCurso = corriendo() || solo() ? Math.min(parcial(), 0.99) : 0;
    const valor = Math.round(((hechas() + enCurso) / total) * 100);
    if (tope.total !== total) tope = { total, valor };
    tope.valor = Math.max(tope.valor, valor);
    return tope.valor;
  };

  const reparando = () => {
    const fallida = etapas().find((s) => s.essential && s.state === "failed");
    if (fallida) return nombre(fallida.name);
    const esencial = (reporte()?.bootstrap ?? []).find((id) => reporte()?.essential?.includes(id));
    return esencial ? nombre(esencial) : "";
  };
  // Cerrar el aviso solo descarta lo que dice ahora: si la instalación pasa a
  // fallar, el aviso de error vuelve a salir.
  const claveDelAviso = () => `${falloEsencial() ? "failed" : "running"}:${reparando()}`;
  const [descartado, setDescartado] = createSignal<string | null>(null);
  const aviso = () =>
    mostrar() === false && bloqueado() && (corriendo() || falloEsencial()) && descartado() !== claveDelAviso();

  function abrirEntorno() {
    window.dispatchEvent(new CustomEvent("harness:open-settings", { detail: "entorno" }));
  }

  const estado = () => {
    if (!etapas().length) return t("setup.status.checking");
    if (sinSoporte()) return t("setup.status.unsupported");
    if (falloEsencial()) return t("setup.status.failed");
    if (fin()) return falloOpcional() ? t("setup.status.partial") : t("setup.status.done");
    return t("setup.status.running", { percent: porcentaje() });
  };

  function detalle(s: Etapa): string {
    const d = datos()[s.name] ?? {};
    const paso = pasoDe(s);
    if (paso === "run") return t("setup.row.installing");
    if (paso === "fail") return t("setup.row.failed");
    if (paso !== "ok") return "";
    if (s.name === "platform") return d.libre ? t("setup.row.free", { free: d.libre }) : (d.plataforma ?? "");
    if (!d.version) return t("setup.row.ready");
    return d.origen === ORIGEN_SISTEMA
      ? t("setup.row.system", { version: d.version })
      : t("setup.row.installed", { version: d.version });
  }

  const version = (name: string) =>
    datos()[name]?.version ?? reporte()?.items.find((r) => r.id === name)?.detail ?? "";

  const fila = (s: Etapa): FilaDeEtapa => ({
    name: s.name,
    label: nombre(s.name),
    essential: s.essential,
    paso: pasoDe(s),
    quiere: quiereEsta(s.name),
    detalle: detalle(s),
    version: version(s.name),
    descripcion: CON_DESCRIPCION.has(s.name) ? t(`setup.optional.about.${s.name}`) : "",
  });

  const instalacion = (): Instalacion => {
    const corre = etapas().find((s) => pasoDe(s) === "run");
    const titulo = () => {
      if (!etapas().length) return t("setup.status.checking");
      if (sinSoporte()) return t("setup.status.unsupported");
      if (falloEsencial()) return t("setup.status.failed");
      if (fin()) return falloOpcional() ? t("setup.simple.essentials_ready") : t("setup.simple.done");
      if (!corre) return t("setup.status.checking");
      return t("setup.simple.installing", { name: nombre(corre.name) });
    };
    const subtitulo = () => {
      if (!etapas().length) return "";
      if (fin()) {
        return omitidas()
          ? t("setup.simple.summary_skipped", { tools: hechas(), count: omitidas() })
          : t("setup.simple.summary", { count: hechas() });
      }
      return t("setup.simple.step", { step: Math.min(hechas() + 1, elegidas().length), total: elegidas().length });
    };
    const d = descarga();
    return {
      titulo: titulo(),
      subtitulo: subtitulo(),
      estado: estado(),
      porcentaje: porcentaje(),
      terminado: fin() && !falloEsencial(),
      corriendo: corriendo() || solo(),
      hechas: hechas(),
      total: elegidas().length,
      esenciales: etapas().filter((s) => s.essential).map(fila),
      opcionales: etapas().filter((s) => !s.essential).map(fila),
      lineas: lineas(),
      descarga:
        d && d.total > 0
          ? t("setup.log.download_live", {
              file: d.file,
              done: `${(d.done / 1_048_576).toFixed(1)} MB`,
              total: `${(d.total / 1_048_576).toFixed(1)} MB`,
              percent: Math.round((d.done / d.total) * 100),
            })
          : null,
    };
  };

  async function refrescarReporte() {
    const r = await invoke<EnvReport>("check_environment", { force: false }).catch(() => null);
    if (r) setReporte(r);
  }

  /** Lo omitido o fallido se instala solo, ya con la corrida terminada, por la misma etapa. */
  async function instalarSuelto(name: string) {
    if (sueltos()[name] === "run") return;
    setQuiere((q) => ({ ...q, [name]: true }));
    ponerSuelto(name, "run");
    setParcial(0);
    const inicio = Date.now();
    agregar([{ tono: "etapa", texto: t("setup.log.stage_start", { name: nombre(name), kind: t("setup.log.optional") }) }]);
    try {
      await invoke<string>("install_base_tool", { tool: name });
      await refrescarReporte();
      anotar(name, { version: version(name), origen: ORIGEN_APP });
      ponerSuelto(name, "ok");
      agregar([
        { tono: "ok", texto: t("setup.log.installed", { name: nombre(name), version: version(name) }) },
        { tono: "ok", texto: t("setup.log.stage_done", { name: nombre(name), duration: elapsed(Math.max(1, Math.round((Date.now() - inicio) / 1000))) }) },
      ]);
    } catch (e) {
      if (prosaDe(e).includes("install.cancelled") || cancelados().has(name)) {
        ponerSuelto(name, "skip");
      } else {
        ponerSuelto(name, "fail");
        agregar([
          { tono: "warn", texto: t("setup.log.optional_failed", { name: nombre(name) }) },
          { tono: "err", texto: prosaDe(e) },
        ]);
      }
    } finally {
      setDescarga((d) => (d?.stage === name ? null : d));
    }
  }

  /** La casilla: antes de que corra, decide si se instala; al terminar, marcar lo omitido lo instala solo. */
  function marcar(name: string, marcado: boolean) {
    const s = etapas().find((x) => x.name === name);
    const paso = s ? pasoDe(s) : "wait";
    if (fin() && (paso === "skip" || paso === "fail") && marcado) return void instalarSuelto(name);
    setQuiere((q) => ({ ...q, [name]: marcado }));
  }

  /** La × corta la descarga de un opcional; queda omitido y se puede instalar después. */
  function cancelarOpcional(name: string) {
    setQuiere((q) => ({ ...q, [name]: false }));
    setCancelados((c) => new Set(c).add(name));
    conLaX.add(name);
    if (sueltos()[name] === "run") ponerSuelto(name, "skip");
    agregar([{ tono: "aviso", texto: t("setup.log.cancelled", { name: nombre(name) }) }]);
    void invoke("cancel_install", { operation: `tool:${name}` }).catch(() => {});
  }

  /** La basura quita la copia que instaló Terminus; la del sistema no se toca. */
  async function desinstalar(name: string) {
    ponerSuelto(name, "bye");
    try {
      await invoke("remove_tool", { tool: name });
      setQuiere((q) => ({ ...q, [name]: false }));
      ponerSuelto(name, "skip");
      agregar([{ tono: "omite", texto: t("setup.log.removed", { name: nombre(name) }) }]);
      await refrescarReporte();
    } catch (e) {
      ponerSuelto(name, "ok");
      agregar([{ tono: "warn", texto: prosaDe(e) }]);
    }
  }

  const acciones = { onMarcar: marcar, onCancelar: cancelarOpcional, onDesinstalar: (n: string) => void desinstalar(n) };

  /** «Siguiente»: el workspace «Personal» nace aquí, que es de quien cuelgan las cuentas de la IA. */
  async function aConectar() {
    if (entrando()) return;
    setEntrando(true);
    setFallo(null);
    try {
      if (!workspace()) {
        const w = await crearWorkspace(t("onboarding.workspace.default"));
        setWorkspace({ id: w.id, nombre: t("onboarding.workspace.default") });
      }
      if (!conexiones()) {
        const { crearConexiones } = await import("../onboarding/connect-store");
        runWithOwner(dueño, () => setConexiones(crearConexiones()));
      }
      setPaso("ia");
      void conexiones()?.cargar();
    } catch (e) {
      setFallo(prosaDe(e));
    } finally {
      setEntrando(false);
    }
  }

  const alta = () => hayEspacio() === false;
  const ia = () => paso() === "ia";
  const conectadas = () => conexiones()?.conectadas() ?? [];
  const nombres = () => conectadas().map((f) => conexiones()?.nombre(f) ?? f.label);

  const titulo = () => {
    if (ia()) return t("onboarding.ai.title");
    if ((terminado() || solo()) && !falloEsencial()) return t("setup.done_title");
    return t("setup.title");
  };
  const lede = () => {
    if (ia()) return t("onboarding.ai.lede");
    if ((terminado() || solo()) && !falloEsencial()) return alta() ? t("setup.done_lede") : t("setup.done_lede_app");
    return t("setup.description");
  };

  const izquierda = () => (
    <>
      <TituloCambiante titulo={titulo()} lede={lede()} />
      <Show when={fallo() ?? falloDelServicio()}>
        {(f) => (
          <div class="mt-6 w-full">
            <FailureNote f={asFailure(f())} />
          </div>
        )}
      </Show>
      <div class="mt-auto w-full">
        <Show
          when={ia()}
          fallback={
            <div class="border-t border-border pt-5">
              <p class="m-0 text-xs text-neutral-500">{t("setup.tips.eyebrow")}</p>
              <h2 class="m-0 mt-2 mb-1.5 text-base font-display font-bold tracking-[-0.01em] text-neutral-950">
                {consejos()[consejo()][0]}
              </h2>
              <p class="m-0 min-h-[58px] max-w-[42ch] text-[13px] text-neutral-500">{consejos()[consejo()][1]}</p>
              <div class="mt-2.5 flex gap-1.5">
                <For each={consejos()}>
                  {(_, i) => (
                    <button
                      type="button"
                      class={cn(
                        "size-[9px] cursor-pointer rounded-full outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                        i() === consejo() ? "bg-primary" : "bg-border-strong",
                      )}
                      aria-label={t("setup.tips.go", { number: i() + 1 })}
                      aria-pressed={i() === consejo()}
                      onClick={() => setConsejo(i())}
                    />
                  )}
                </For>
              </div>
            </div>
          }
        >
          <Suspense>
          <Show when={conexiones()}>{(c) => <MapaDeConexiones c={c()} />}</Show>
          <div class="mt-4 border-t border-border pt-4">
            <Comprobacion
              filas={[
                { hecho: true, texto: t("onboarding.check.environment") },
                {
                  hecho: conectadas().length > 0,
                  texto: conectadas().length
                    ? t("onboarding.check.ai_connected", {
                        count: conectadas().length,
                        names: nombres().join(", "),
                      })
                    : t("onboarding.check.ai_pending"),
                },
                { hecho: false, texto: t("onboarding.check.personalize") },
              ]}
            />
          </div>
          </Suspense>
        </Show>
      </div>
    </>
  );

  const CAPA =
    "absolute inset-0 flex flex-col gap-2.5 transition-[transform,opacity] duration-[420ms] ease-[cubic-bezier(.2,.7,.2,1)] motion-reduce:transition-none";

  const derecha = () => (
    <div class="relative min-h-0 flex-1">
      <div class={cn(CAPA, ia() && "pointer-events-none -translate-x-[90px] opacity-0")} inert={ia() || undefined}>
        <Suspense>
        <SelectorDeVista class="self-end" vista={vista()} onCambiar={setVista} />
        {/* Las dos vistas siguen montadas: cambiar de una a otra no pierde el desplazamiento ni la corrida. */}
        <div class={cn("min-h-0 flex-1 flex-col", vista() === "sencilla" ? "flex" : "hidden")}>
          <VistaSencilla i={instalacion()} {...acciones} />
        </div>
        <div class={cn("min-h-0 flex-1 flex-col", vista() === "terminal" ? "flex" : "hidden")}>
          <VistaTerminal i={instalacion()} {...acciones} ref={(el) => (log = el)} />
        </div>
        </Suspense>
      </div>
      <Show when={alta()}>
        <div class={cn(CAPA, !ia() && "pointer-events-none translate-x-[70px] opacity-0")} inert={!ia() || undefined}>
          <Suspense>
            <Show when={conexiones()}>{(c) => <PanelDeIA c={c()} />}</Show>
          </Suspense>
        </div>
      </Show>
    </div>
  );

  const pie = () => (
    <footer class="flex flex-wrap items-center gap-2.5 border-t border-border px-5 py-3.5">
      <Show
        when={ia()}
        fallback={
          <>
            <p class="m-0 text-xs text-neutral-500">{t("setup.footer")}</p>
            <span class="flex-1" />
            {/* Solo lo esencial se reintenta aquí: lo opcional se marca en su fila. */}
            <Show when={!sinSoporte() && (falloDelServicio() || (!corriendo() && (fallo() || falloEsencial())))}>
              <Button size="sm" variant="secondary" onClick={() => void empezar()}>
                {t("setup.retry")}
              </Button>
            </Show>
            <Show when={!falloEsencial() && !sinSoporte()}>
              <Show when={terminado() && alta() && workspace() && conectadas().length > 0}>
                <Button size="sm" variant="ghost" onClick={() => setPaso("ia")}>
                  {t("setup.back_to_ai")}
                </Button>
              </Show>
              <Button
                size="sm"
                disabled={!(terminado() || solo()) || entrando()}
                onClick={() => (alta() ? void aConectar() : setSeguir(true))}
              >
                {alta() ? t("setup.next.ai") : t("setup.next.app")}
              </Button>
            </Show>
          </>
        }
      >
        <button
          type="button"
          class="cursor-pointer border-0 bg-transparent p-0 text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-950"
          onClick={() => {
            setVista("terminal");
            setPaso("preparar");
          }}
        >
          {t("setup.see_log")}
        </button>
        <p class="m-0 text-xs text-neutral-500">{t("onboarding.ai.footer")}</p>
        <span class="flex-1" />
        <Button size="sm" disabled={conectadas().length === 0} onClick={() => setPaso("personalizar")}>
          {t("onboarding.continue")}
        </Button>
      </Show>
    </footer>
  );

  return (
    <Switch
      fallback={
        <>
          {props.children}
          <Show when={aviso()}>
            <ToastPortal>
              <Toast
                tone={falloEsencial() ? "error" : "status"}
                data-setup-repair=""
                onDismiss={() => setDescartado(claveDelAviso())}
              >
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
        <div class="flex h-full items-center justify-center bg-bg">
          <Show when={!connected()}>
            <p role="status" class="m-0 text-sm text-neutral-500">{t("shell.engine.connecting")}</p>
          </Show>
        </div>
      </Match>
      <Match when={mostrar() && !seguir()}>
        <main class="flex h-full flex-col overflow-hidden bg-bg">
          <CabeceraDelAlta fase={alta() ? (paso() === "personalizar" ? 1 : 0) : undefined} />
          <Show
            when={paso() === "personalizar"}
            fallback={
              <>
                <Escenario izquierda={izquierda()} derecha={derecha()} />
                {pie()}
              </>
            }
          >
            <Suspense>
              <Personalizar
                workspace={workspace()}
                ia={nombres()}
                onAtras={() => setPaso("ia")}
                onListo={() => setSeguir(true)}
              />
            </Suspense>
          </Show>
        </main>
      </Match>
    </Switch>
  );
}
