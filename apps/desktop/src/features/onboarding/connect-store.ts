/**
 * Las IA que se conectan en el alta: qué hay en esta computadora, qué está
 * conectado en el workspace activo y en qué paso va cada conexión. El mapa y el
 * panel leen el mismo estado; las cuentas cuelgan del workspace activo.
 */
import { listen } from "@tauri-apps/api/event";
import { batch, createSignal, onCleanup } from "solid-js";
import { createStore } from "solid-js/store";
import { t } from "../../lib/i18n";
import { invoke } from "../../lib/invoke.ts";
import type { Superficie } from "../../lib/surfaces.ts";
import { prosaDe } from "../../ui/Failure";
import { accountPresentation } from "../settings/AccountCard";
import type { Consentimiento } from "../settings/Accounts";
import type { AccountList, AccountStatus, AgentOpt, LoginEvent } from "../settings/accounts-store";
import { ORIGEN_SISTEMA } from "../settings/environment-store";
import type { Frase } from "../../lib/prose";

type Agente = AgentOpt & { source: string | null; system_broken: boolean };
type Avance = { id: string; done: number; bytes: number };

/** Cómo se conecta: iniciando sesión con su CLI, pegando una clave, aceptando el aviso o en la máquina. */
export type Modo = "sesion" | "clave" | "consentimiento" | "local";

export type Fila = {
  id: string;
  agente: string;
  label: string;
  modo: Modo;
  /** El binario ya estaba en el sistema al abrir la pantalla; no cambia al conectarse. */
  detectada: boolean;
  /** Lo que baja si falta; `null` cuando ya está o no se sabe. */
  bytes: number | null;
  /** Dónde se consigue la clave, para el modo `clave`. */
  urlDeClave: string | null;
};

export type Paso =
  | { k: "falta" }
  | { k: "instalada" }
  | { k: "descargando"; hecho: number; total: number }
  | { k: "entrando"; cuenta: string; codigo?: string; pideCodigo?: boolean }
  | { k: "clave" }
  | { k: "comprobando" }
  | { k: "conectada"; cuenta: string; id: string | null }
  | { k: "saliendo" };

const EN_CURSO = new Set<Paso["k"]>(["descargando", "entrando", "clave", "comprobando", "saliendo"]);
const ORDEN = ["claude", "codex", "antigravity", "grok", "opencode-zen", "opencode-local"];
const posicion = (id: string) => {
  const i = ORDEN.indexOf(id);
  return i < 0 ? ORDEN.length : i;
};

export function crearConexiones() {
  const [filas, setFilas] = createSignal<Fila[]>([]);
  const [pasos, setPasos] = createStore<Record<string, Paso>>({});
  const [errores, setErrores] = createStore<Record<string, string | null>>({});
  const [falloDeCarga, setFalloDeCarga] = createSignal<string | null>(null);
  const [pregunta, setPregunta] = createSignal<{ fila: string; texto: Consentimiento } | null>(null);
  const [guardando, setGuardando] = createSignal(false);
  const [cargada, setCargada] = createSignal(false);
  let agentes: Agente[] = [];
  let detectadas: Set<string> | null = null;
  let entrada: { fila: string; agente: string; cuenta: string } | null = null;
  // En serie: las filas de OpenCode comparten carpeta, y la segunda la encuentra ya instalada.
  let descargas: Promise<unknown> = Promise.resolve();
  let cerrada = false;

  const agente = (id: string) => agentes.find((a) => a.id === id);
  const fila = (id: string) => filas().find((f) => f.id === id);
  const enCurso = (id: string) => EN_CURSO.has(pasos[id]?.k ?? "falta");

  function poner(id: string, paso: Paso) {
    if (!cerrada) setPasos(id, paso);
  }

  async function cuentaConectada(agent: string): Promise<{ cuenta: string; id: string } | null> {
    const lista = await invoke<AccountList>("list_accounts", { provider: agent });
    const vivas = lista.accounts.filter((a) => a.authenticated_at !== null);
    const activa = vivas.find((a) => a.id === lista.active) ?? vivas[0];
    if (!activa) return null;
    const { name, plan } = accountPresentation(activa);
    return { cuenta: plan ? `${name} · ${plan}` : name, id: activa.id };
  }

  async function consentida(agent: string) {
    const [, version] = await invoke<[Frase[], number]>("consent_text");
    const s = await invoke<{ active: string | null; workspaces: { id: string; consents?: { provider: string; version: number }[] }[] }>(
      "workspaces_startup",
    );
    const activo = s.workspaces.find((w) => w.id === s.active);
    return activo?.consents?.some((c) => c.provider === agent && c.version === version) ?? false;
  }

  async function pasoGuardado(f: Fila, superficies: Superficie[]): Promise<Paso> {
    const a = agente(f.agente);
    const base: Paso = a?.available ? { k: "instalada" } : { k: "falta" };
    try {
      if (f.modo === "consentimiento") {
        return a?.available && (await consentida(f.agente))
          ? { k: "conectada", cuenta: t("settings.accounts.free.warning_short"), id: null }
          : base;
      }
      if (f.modo === "local") {
        const lista = superficies.find((s) => s.provider === f.agente);
        const motor = await invoke<{ source?: string }>("local_runtime");
        return a?.available && (lista?.usable || (motor.source && motor.source !== "missing"))
          ? { k: "conectada", cuenta: t("onboarding.ai.local.ready"), id: null }
          : base;
      }
      const conectada = await cuentaConectada(f.agente);
      return conectada ? { k: "conectada", ...conectada } : base;
    } catch {
      return base;
    }
  }

  async function cargar() {
    let superficies: Superficie[] = [];
    try {
      [agentes, superficies] = await Promise.all([
        invoke<Agente[]>("list_providers"),
        invoke<Superficie[]>("list_surfaces").catch(() => [] as Superficie[]),
      ]);
    } catch (e) {
      setFalloDeCarga(prosaDe(e));
      return;
    }
    if (cerrada) return;
    setFalloDeCarga(null);
    detectadas ??= new Set(
      agentes.filter((a) => a.available && a.source === ORIGEN_SISTEMA && !a.system_broken).map((a) => a.id),
    );
    const nuevas: Fila[] = [];
    for (const a of [...agentes].sort((x, y) => posicion(x.id) - posicion(y.id))) {
      // Con superficie gratuita aparte, la fila del agente es la de pago: se conecta con su cuenta.
      const gratuitas = superficies.filter((x) => x.provider === a.id && x.catalogo === "gratuitos");
      const modo: Modo =
        a.inferencia === "en_la_maquina"
          ? "local"
          : a.inferencia === "sin_pedir_nada" && gratuitas.length === 0
            ? "consentimiento"
            : a.api_key
              ? "clave"
              : "sesion";
      const previa = filas().find((f) => f.id === a.id);
      nuevas.push({
        id: a.id,
        agente: a.id,
        label: a.label,
        modo,
        detectada: detectadas.has(a.id),
        bytes: previa?.bytes ?? null,
        urlDeClave: a.api_key ?? null,
      });
      for (const s of gratuitas) {
        nuevas.push({
          id: s.id,
          agente: a.id,
          label: t("surfaces.label.free"),
          modo: "consentimiento",
          detectada: false,
          bytes: previa?.bytes ?? null,
          urlDeClave: null,
        });
      }
    }
    setFilas(nuevas);
    const estados = await Promise.all(nuevas.map((f) => pasoGuardado(f, superficies)));
    batch(() => {
      nuevas.forEach((f, i) => {
        if (!enCurso(f.id)) poner(f.id, estados[i]);
      });
      setCargada(true);
    });
    for (const f of nuevas) {
      const a = agente(f.agente);
      if (!a || a.available || a.external_install_url || f.bytes !== null) continue;
      invoke<number>("provider_download_size", { provider: a.id })
        .then((b) => setFilas((fs) => fs.map((x) => (x.agente === a.id ? { ...x, bytes: b } : x))))
        .catch(() => {});
    }
  }

  async function descargar(f: Fila): Promise<boolean> {
    const total = f.bytes ?? 0;
    for (const x of filas().filter((x) => x.agente === f.agente && !enCurso(x.id))) {
      poner(x.id, { k: "descargando", hecho: 0, total });
    }
    const vuelta = descargas.then(async () => {
      if (agente(f.agente)?.available) return true;
      await invoke("install_provider", { provider: f.agente });
      return true;
    });
    descargas = vuelta.catch(() => {});
    try {
      await vuelta;
      agentes = agentes.map((a) => (a.id === f.agente ? { ...a, available: true } : a));
      for (const x of filas().filter((x) => x.agente === f.agente && pasos[x.id]?.k === "descargando")) {
        poner(x.id, { k: "instalada" });
      }
      return true;
    } catch (e) {
      setErrores(f.id, prosaDe(e));
      for (const x of filas().filter((x) => x.agente === f.agente && pasos[x.id]?.k === "descargando")) {
        poner(x.id, { k: "falta" });
      }
      return false;
    }
  }

  async function conectar(id: string) {
    const f = fila(id);
    const a = f && agente(f.agente);
    if (!f || !a || enCurso(id)) return;
    setErrores(id, null);
    if (f.modo === "consentimiento") return void preguntar(id);
    if (!a.available) {
      if (a.external_install_url) {
        setErrores(id, t("onboarding.ai.external", { agent: a.label }));
        invoke("open_external", { target: a.external_install_url }).catch(() => {});
        return;
      }
      if (!(await descargar(f))) return;
    }
    if (f.modo === "local") return void activarLocal(id);
    if (f.modo === "clave") return poner(id, { k: "clave" });
    await entrar(id);
  }

  async function entrar(id: string) {
    const f = fila(id);
    if (!f) return;
    let cuenta: string | null = null;
    try {
      cuenta = (await invoke<{ id: string }>("add_account", { provider: f.agente, label: "" })).id;
      entrada = { fila: id, agente: f.agente, cuenta };
      poner(id, { k: "entrando", cuenta });
      await invoke("login_account", { provider: f.agente, id: cuenta, mode: "tuberia" });
    } catch (e) {
      entrada = null;
      if (cuenta) await invoke("discard_account", { provider: f.agente, id: cuenta }).catch(() => {});
      setErrores(id, prosaDe(e));
      poner(id, { k: "instalada" });
    }
  }

  async function terminarEntrada(motivo: string) {
    const e = entrada;
    if (!e) return;
    entrada = null;
    try {
      const estado = await invoke<AccountStatus>("account_status", { provider: e.agente, id: e.cuenta });
      if (!motivo && estado.authenticated) {
        await invoke("set_active_account", { provider: e.agente, id: e.cuenta }).catch(() => {});
        const conectada = await cuentaConectada(e.agente);
        poner(e.fila, { k: "conectada", cuenta: conectada?.cuenta ?? "", id: e.cuenta });
        return;
      }
    } catch {
      // Sin estado legible se trata como un intento que no llegó: la cuenta vacía se descarta.
    }
    await invoke("discard_account", { provider: e.agente, id: e.cuenta }).catch(() => {});
    setErrores(e.fila, motivo || t("onboarding.ai.login_failed"));
    poner(e.fila, { k: "instalada" });
  }

  async function enviarCodigo(id: string, codigo: string) {
    const p = pasos[id];
    if (p?.k !== "entrando" || !codigo.trim()) return;
    setErrores(id, null);
    poner(id, { ...p, pideCodigo: false });
    try {
      await invoke("submit_login_code", { id: p.cuenta, code: codigo.trim() });
    } catch (e) {
      setErrores(id, prosaDe(e));
      poner(id, { ...p, pideCodigo: true });
    }
  }

  async function guardarClave(id: string, clave: string) {
    const f = fila(id);
    if (!f || !clave.trim()) return;
    setErrores(id, null);
    poner(id, { k: "comprobando" });
    let cuenta: string | null = null;
    try {
      cuenta = (await invoke<{ id: string }>("add_account", { provider: f.agente, label: "" })).id;
      await invoke("set_api_key", { provider: f.agente, id: cuenta, key: clave.trim() });
      const estado = await invoke<AccountStatus>("account_status", { provider: f.agente, id: cuenta });
      if (!estado.authenticated) throw new Error(t("onboarding.ai.key_invalid"));
      await invoke("set_active_account", { provider: f.agente, id: cuenta }).catch(() => {});
      const conectada = await cuentaConectada(f.agente);
      poner(id, { k: "conectada", cuenta: conectada?.cuenta ?? t("onboarding.ai.key_saved"), id: cuenta });
    } catch (e) {
      if (cuenta) await invoke("discard_account", { provider: f.agente, id: cuenta }).catch(() => {});
      setErrores(id, prosaDe(e));
      poner(id, { k: "clave" });
    }
  }

  async function cancelar(id: string) {
    const p = pasos[id];
    setErrores(id, null);
    if (p?.k === "entrando") {
      const e = entrada;
      entrada = null;
      await invoke("cancel_login", { id: p.cuenta }).catch(() => {});
      if (e) await invoke("discard_account", { provider: e.agente, id: e.cuenta }).catch(() => {});
    }
    poner(id, agente(fila(id)?.agente ?? "")?.available ? { k: "instalada" } : { k: "falta" });
  }

  async function preguntar(id: string) {
    try {
      const [lineas, version] = await invoke<[Frase[], number]>("consent_text");
      setPregunta({ fila: id, texto: { lineas, version } });
    } catch (e) {
      setErrores(id, prosaDe(e));
    }
  }

  async function responder(acepta: boolean) {
    const q = pregunta();
    const f = q && fila(q.fila);
    if (!q || !f) return;
    if (!acepta) return void setPregunta(null);
    setGuardando(true);
    try {
      await invoke("set_provider_consent", { provider: f.agente, accepted: true });
      setPregunta(null);
      if (!agente(f.agente)?.available && !(await descargar(f))) return;
      window.dispatchEvent(new CustomEvent("harness:consentimiento"));
      poner(f.id, { k: "conectada", cuenta: t("settings.accounts.free.warning_short"), id: null });
    } catch (e) {
      setErrores(f.id, prosaDe(e));
    } finally {
      setGuardando(false);
    }
  }

  async function activarLocal(id: string) {
    poner(id, { k: "comprobando" });
    try {
      await invoke("install_local_runtime");
      poner(id, { k: "conectada", cuenta: t("onboarding.ai.local.ready"), id: null });
    } catch (e) {
      setErrores(id, prosaDe(e));
      poner(id, { k: "instalada" });
    }
  }

  async function desconectar(id: string) {
    const f = fila(id);
    const p = pasos[id];
    if (!f || p?.k !== "conectada") return;
    setErrores(id, null);
    poner(id, { k: "saliendo" });
    try {
      if (f.modo === "consentimiento") {
        await invoke("set_provider_consent", { provider: f.agente, accepted: false });
        window.dispatchEvent(new CustomEvent("harness:consentimiento"));
      } else if (f.modo === "local") {
        await invoke("remove_local_runtime");
      } else {
        const lista = await invoke<AccountList>("list_accounts", { provider: f.agente });
        for (const c of lista.accounts.filter((c) => c.authenticated_at !== null)) {
          await invoke("remove_account", { provider: f.agente, id: c.id });
        }
      }
      poner(id, agente(f.agente)?.available ? { k: "instalada" } : { k: "falta" });
    } catch (e) {
      setErrores(id, prosaDe(e));
      poner(id, p);
    }
  }

  const alCuenta = listen<LoginEvent>("account", (ev) => {
    const e = entrada;
    const p = e ? pasos[e.fila] : undefined;
    if (!e || ev.payload.account !== e.cuenta || p?.k !== "entrando") return;
    const { kind, text } = ev.payload;
    if (kind === "url") invoke("open_external", { target: text }).catch(() => {});
    else if (kind === "confirm") poner(e.fila, { ...p, codigo: text });
    else if (kind === "code") poner(e.fila, { ...p, pideCodigo: true });
    else if (kind === "done") void terminarEntrada(text);
  });
  const alAvance = listen<Avance>("toolchain", (ev) => {
    if (ev.payload.bytes <= 0) return;
    for (const f of filas().filter((x) => x.agente === ev.payload.id && pasos[x.id]?.k === "descargando")) {
      poner(f.id, { k: "descargando", hecho: ev.payload.done, total: ev.payload.bytes });
    }
  });
  const alAgentes = listen("providers", () => void cargar());
  onCleanup(() => {
    cerrada = true;
    for (const l of [alCuenta, alAvance, alAgentes]) void l.then((f) => f());
    const e = entrada;
    if (e) {
      void invoke("cancel_login", { id: e.cuenta }).catch(() => {});
      void invoke("discard_account", { provider: e.agente, id: e.cuenta }).catch(() => {});
    }
  });

  const conectadas = () => filas().filter((f) => pasos[f.id]?.k === "conectada");

  return {
    filas,
    pasos,
    errores,
    falloDeCarga,
    pregunta,
    guardando,
    cargada,
    conectadas,
    cargar,
    conectar,
    cancelar,
    enviarCodigo,
    guardarClave,
    responder,
    desconectar,
  };
}

export type Conexiones = ReturnType<typeof crearConexiones>;
