/**
 * El estado de los modelos que corren en esta computadora: llama.cpp, el
 * catálogo del motor, sus descargas y cuál usan las tareas. Sin interfaz: el alta
 * lo carga al montar y el panel (`LocalModels.tsx`) llega después.
 */
import { createSignal, onCleanup } from "solid-js";
import { createStore } from "solid-js/store";
import { invoke } from "../../lib/invoke.ts";
import { listen } from "../../lib/serviceEvents";
import { type Failure, detalleDe, prosaDe } from "../../ui/Failure";

export type ModeloLocal = {
  id: string;
  label: string;
  quant: string;
  bytes: number;
  state: "missing" | "partial" | "installed" | "blocked";
  on_disk: number;
  serving: boolean;
  kind: "general" | "code";
  memory: number;
  machine_memory: number;
  fits: boolean;
  recommended: boolean;
  active: boolean;
};
type Progreso = { id: string; kind: string; on_disk: number; bytes: number; failure?: Failure | null };
type Motor = { label: string; path?: string | null; source: "system" | "managed" | "missing" };
type AvanceDeInstalacion = { operation: string; kind: string; done: number; bytes: number };

/** La clave de la descarga de llama.cpp en `install` y `cancel_install`. */
export const OPERACION = "local-runtime";
const EN_CURSO = ["progress", "verifying"];
const cancelada = (e: unknown) => `${prosaDe(e)} ${detalleDe(e)}`.includes("install.cancelled");

export function crearModelosLocales() {
  const [motor, setMotor] = createSignal<Motor | null>(null);
  const [pesoDelMotor, setPesoDelMotor] = createSignal<number | null>(null);
  const [modelos, setModelos] = createSignal<ModeloLocal[]>([]);
  const [progreso, setProgreso] = createStore<Record<string, Progreso | undefined>>({});
  const [bajandoMotor, setBajandoMotor] = createSignal<{ hecho: number; total: number } | null>(null);
  const [ocupado, setOcupado] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [leido, setLeido] = createSignal(false);
  let cerrado = false;
  // Los avisos de una descarga que se canceló siguen llegando un momento.
  let motorEnVuelo = false;

  const leerMotor = () =>
    invoke<Motor>("local_runtime")
      .then((m) => !cerrado && setMotor(m))
      .catch(() => {});
  const leerModelos = () =>
    invoke<ModeloLocal[]>("list_local_models")
      .then((v) => !cerrado && setModelos(v))
      .catch((e) => setError(prosaDe(e)));
  const cargar = () => Promise.all([leerMotor(), leerModelos()]).then(() => setLeido(true));

  void cargar();
  void invoke<number>("install_size", { operation: OPERACION })
    .then(setPesoDelMotor)
    .catch(() => {});
  // El evento solo llega a quien escucha: una descarga que ya iba sigue su barra.
  void invoke<Progreso[]>("local_downloads")
    .then((v) => {
      for (const p of v) setProgreso(p.id, p);
    })
    .catch(() => {});

  const alModelo = listen<Progreso>("local-model", (e) => {
    setProgreso(e.payload.id, e.payload);
    if (e.payload.kind === "error" && e.payload.failure) setError(prosaDe(e.payload.failure));
    if (["done", "cancelled", "error"].includes(e.payload.kind)) void leerModelos();
  });
  const alMotor = listen("local-engine", () => void cargar());
  const alInstalar = listen<AvanceDeInstalacion>("install", (e) => {
    if (e.payload.operation !== OPERACION || !motorEnVuelo) return;
    if (e.payload.kind === "downloading" || e.payload.kind === "installing") {
      setBajandoMotor({ hecho: e.payload.done, total: e.payload.bytes });
    }
  });
  onCleanup(() => {
    cerrado = true;
    for (const l of [alModelo, alMotor, alInstalar]) void l.then((f) => f());
  });

  /** Solo llama.cpp sirve los pesos que baja Terminus; Ollama no cuenta. */
  const motorListo = () => {
    const m = motor();
    return Boolean(m?.path && m.label === "llama.cpp");
  };
  const bajando = (id: string) => EN_CURSO.includes(progreso[id]?.kind ?? "");
  const activo = () => modelos().find((m) => m.active && m.state === "installed") ?? null;

  async function instalarMotor() {
    if (motorEnVuelo || motorListo()) return;
    setError(null);
    motorEnVuelo = true;
    setBajandoMotor({ hecho: 0, total: pesoDelMotor() ?? 0 });
    try {
      await invoke("install_local_runtime");
    } catch (e) {
      if (!cancelada(e)) setError(prosaDe(e));
    } finally {
      motorEnVuelo = false;
      setBajandoMotor(null);
      await leerMotor();
    }
  }

  // La tarjeta vuelve al instante; el motor termina de cortar por detrás.
  function cancelarMotor() {
    motorEnVuelo = false;
    setBajandoMotor(null);
    void invoke("cancel_install", { operation: OPERACION }).catch(() => {});
  }

  async function quitarMotor() {
    setError(null);
    setOcupado(OPERACION);
    try {
      await invoke("remove_local_runtime");
    } catch (e) {
      setError(prosaDe(e));
    } finally {
      setOcupado(null);
      await leerMotor();
    }
  }

  /** Sin llama.cpp los pesos no contestan: bajarlos también lo baja a él. */
  async function descargar(m: ModeloLocal) {
    setError(null);
    if (!motorListo()) void instalarMotor();
    setProgreso(m.id, { id: m.id, kind: "progress", on_disk: m.on_disk, bytes: m.bytes });
    try {
      await invoke("install_local_model", { id: m.id });
    } catch (e) {
      setProgreso(m.id, undefined);
      setError(prosaDe(e));
    }
  }

  function cancelar(m: ModeloLocal) {
    setProgreso(m.id, { id: m.id, kind: "cancelled", on_disk: progreso[m.id]?.on_disk ?? m.on_disk, bytes: m.bytes });
    void invoke("cancel_local_model").catch(() => {});
  }

  async function usar(m: ModeloLocal) {
    setError(null);
    setOcupado(m.id);
    try {
      await invoke("set_active_local_model", { id: m.id });
      await leerModelos();
    } catch (e) {
      setError(prosaDe(e));
    } finally {
      setOcupado(null);
    }
  }

  /** Sin preguntar: quien lo llama ya confirmó. */
  async function borrar(m: ModeloLocal) {
    setError(null);
    setOcupado(m.id);
    try {
      await invoke("remove_local_model", { id: m.id });
      setProgreso(m.id, undefined);
    } catch (e) {
      setError(prosaDe(e));
    } finally {
      setOcupado(null);
      await leerModelos();
    }
  }

  async function apagar() {
    await invoke("stop_local_model").catch((e) => setError(prosaDe(e)));
    await leerModelos();
  }

  return {
    motor,
    pesoDelMotor,
    modelos,
    progreso,
    bajandoMotor,
    ocupado,
    error,
    leido,
    motorListo,
    bajando,
    activo,
    /** Hay con qué contestar: llama.cpp y un modelo bajado. */
    listo: () => motorListo() && activo() !== null,
    instalarMotor,
    cancelarMotor,
    quitarMotor,
    descargar,
    cancelar,
    usar,
    borrar,
    apagar,
    cargar,
  };
}

export type ModelosLocales = ReturnType<typeof crearModelosLocales>;
