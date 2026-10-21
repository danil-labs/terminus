import { listen } from "@tauri-apps/api/event";
import ArrowRight from "lucide-solid/icons/arrow-right";
import Check from "lucide-solid/icons/check";
import ExternalLink from "lucide-solid/icons/external-link";
import { createSignal, For, type JSX, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import { createStore } from "solid-js/store";
import { mb } from "../../lib/format";
import { t } from "../../lib/i18n";
import { invoke } from "../../lib/invoke.ts";
import { prosa, type Frase } from "../../lib/prose";
import { cn } from "../../lib/utils";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { prosaDe } from "../../ui/Failure";
import { CancelButton, RemoveButton } from "../../ui/IconAction";
import { Input } from "../../ui/Input";
import { MarcaProveedor } from "../../ui/icons";
import { GoogleDriveMark, MarcaPlugin } from "../../ui/toolMarks";
import { Spinner } from "../../ui/Spinner";
import { ErrorDeTarjeta } from "./ConnectAI";
import { explicar } from "./connect-store";

type Wait = { code: string; url: string };
type Campo = { id: string; label: Frase; help: Frase; required: boolean };
type Proveedor = {
  id: string;
  name: string;
  browser_login: boolean;
  fields: Campo[];
  token_label: Frase;
  token_help: Frase;
  token_url: string;
  setup_url: string | null;
  connected: { identity: { user: string; name: string }; workspace?: string } | null;
};
type Conocido = { id: string; grupo: string; pide_sesion: boolean; conectado: boolean; sesiones?: string[] };
type AgenteMcp = { id: string; label: string; recibe: boolean; instalado: boolean; login?: boolean };
type Plugin = { id: string; installed: boolean; installing: boolean; supported: boolean };
type Avance = { id: string; done: number; bytes: number };

/** Cómo se conecta cada integración: el motor de servicios de código o un servicio MCP conocido. */
type Integracion = {
  id: string;
  nombre: string;
  comun: boolean;
  via: "proveedor" | "mcp" | "incluido";
  /** Su id en `list_known_mcp`, cuando no es el mismo de la tarjeta. */
  mcp?: string;
};
type EstadoDeIntegracion =
  | { k: "libre" }
  | { k: "formulario" }
  | { k: "descargando"; hecho: number; total: number }
  | { k: "conectando"; codigo?: string }
  | { k: "conectada"; detalle: string }
  | { k: "saliendo" };
type Borrador = { data: Record<string, string>; token: string };

const INTEGRACIONES = (): Integracion[] => [
  { id: "github", nombre: "GitHub", comun: true, via: "proveedor" },
  { id: "drive", nombre: t("onboarding.tools.drive"), comun: true, via: "mcp", mcp: "google-drive" },
  { id: "figma", nombre: "Figma", comun: true, via: "mcp" },
  { id: "atlassian", nombre: t("onboarding.tools.atlassian"), comun: true, via: "mcp" },
  { id: "gitlab", nombre: "GitLab", comun: false, via: "proveedor" },
  { id: "bitbucket", nombre: "Bitbucket", comun: false, via: "proveedor" },
  { id: "excalidraw", nombre: "Excalidraw", comun: false, via: "incluido" },
];
const RECOMENDADOS = ["drawio", "typst"];
const ORDEN_PLUGINS = ["drawio", "typst", "libreoffice", "agentsview", "computer-use"];
const CON_PESO = new Set(["drawio", "typst", "libreoffice", "computer-use"]);
const descripcion = (id: string) => t(`onboarding.tools.about.${id}`);
const idMcp = (i: Integracion) => i.mcp ?? i.id;
const SIN_BORRADOR: Borrador = { data: {}, token: "" };

/** Drive no es un servicio de código ni un MCP conocido: su marca vive con las de los plugins. */
function MarcaIntegracion(props: { id: string; size?: number }) {
  return props.id === "drive" ? <GoogleDriveMark size={props.size} /> : <MarcaProveedor id={props.id} size={props.size} />;
}

/** «Ver más»: texto al aire, los íconos de lo escondido encimados en diagonal y la flecha. */
export function VerMas(props: { abierto: boolean; resto: { id: string; nombre: string; icono: JSX.Element }[]; onClick: () => void }) {
  return (
    <Show when={props.resto.length > 0 || props.abierto}>
      <button
        type="button"
        class="group inline-flex h-10 cursor-pointer items-start self-start border-0 bg-transparent px-0.5 pt-1.5 text-xs font-medium text-neutral-500 outline-none hover:text-neutral-950 focus-visible:rounded-sm focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
        aria-expanded={props.abierto}
        aria-label={props.abierto ? undefined : t("onboarding.tools.more_label", { names: props.resto.map((r) => r.nombre).join(", ") })}
        onClick={() => props.onClick()}
      >
        <span class="inline-flex items-center">
          <span>{props.abierto ? t("onboarding.tools.less") : t("onboarding.tools.more")}</span>
          <Show when={!props.abierto}>
            <span class="relative z-[1] mr-[-3px] ml-1 inline-flex translate-y-[5px] items-center transition-[transform,margin] duration-300 ease-[cubic-bezier(.3,1.4,.5,1)] group-hover:mx-1.5 group-hover:translate-y-[7px] motion-reduce:transition-none">
              <For each={props.resto.slice(0, 4)}>
                {(r, i) => (
                  <span
                    class="-ml-1.5 grid size-[15px] place-items-center rounded-full border border-border-strong bg-surface-raised shadow-[0_0_0_1.5px_var(--color-bg)] transition-[width,height,margin,transform] duration-300 ease-[cubic-bezier(.3,1.4,.5,1)] first:ml-0 group-hover:ml-1 group-hover:size-[19px] group-hover:translate-y-0 group-hover:first:ml-0 motion-reduce:transition-none [&>svg]:size-[62%]"
                    style={{ transform: `translateY(${-3 * i()}px)` }}
                    title={r.nombre}
                  >
                    {r.icono}
                  </span>
                )}
              </For>
            </span>
          </Show>
          <ArrowRight
            size={14}
            aria-hidden="true"
            class={cn(
              "ml-0.5 transition-transform duration-200 motion-reduce:transition-none",
              props.abierto ? "ml-1.5 -rotate-90" : "group-hover:translate-x-[3px]",
            )}
          />
        </span>
      </button>
    </Show>
  );
}

/** Las integraciones: cada tarjeta mide lo mismo en todos sus estados y se conecta o desconecta en su sitio. */
export function Integraciones(props: { onCambio: (conectadas: number) => void }) {
  const [proveedores, setProveedores] = createSignal<Proveedor[]>([]);
  const [conocidos, setConocidos] = createSignal<Conocido[]>([]);
  const [agentesMcp, setAgentesMcp] = createSignal<AgenteMcp[]>([]);
  const [estados, setEstados] = createStore<Record<string, EstadoDeIntegracion>>({});
  const [errores, setErrores] = createStore<Record<string, string | null>>({});
  const [borradores, setBorradores] = createStore<Record<string, Borrador>>({});
  /** Por qué se abrió el formulario en vez del navegador: el aviso del servicio, entero. */
  const [motivos, setMotivos] = createStore<Record<string, string | null>>({});
  const [verMas, setVerMas] = createSignal(false);
  const [falloDeCarga, setFalloDeCarga] = createSignal<string | null>(null);
  const scope = invoke<{ active: string | null }>("list_workspaces").then((s) => s.active ?? "pending");
  let esperandoMcp: string | null = null;
  let incluidas = false;
  let cerrada = false;

  const agenteDeSesion = () => agentesMcp().find((a) => a.instalado && a.recibe && a.login);
  const proveedor = (id: string) => proveedores().find((p) => p.id === id);
  const conocido = (i: Integracion) => conocidos().find((c) => c.id === idMcp(i));
  const viva = (id: string) => ["formulario", "descargando", "conectando", "saliendo"].includes(estados[id]?.k ?? "libre");
  const borrador = (id: string) => borradores[id] ?? SIN_BORRADOR;

  function guardado(i: Integracion): EstadoDeIntegracion {
    if (i.via === "proveedor") {
      const c = proveedor(i.id)?.connected;
      if (!c) return { k: "libre" };
      const quien = c.identity.name && c.identity.user ? `${c.identity.name} · @${c.identity.user}` : c.identity.user || c.workspace || "";
      return { k: "conectada", detalle: quien };
    }
    const c = conocido(i);
    if (!c?.conectado) return { k: "libre" };
    if (!c.pide_sesion) return { k: "conectada", detalle: descripcion(i.id) };
    const con = agentesMcp().find((a) => c.sesiones?.includes(a.id));
    return {
      k: "conectada",
      detalle: con ? t("onboarding.tools.session_in", { agent: con.label }) : t("onboarding.tools.needs_login"),
    };
  }

  async function cargar() {
    try {
      const [p, c, a] = await Promise.all([
        invoke<Proveedor[]>("list_git_hosts", { scope: await scope }),
        invoke<Conocido[]>("list_known_mcp"),
        invoke<AgenteMcp[]>("list_mcp_providers"),
      ]);
      if (cerrada) return;
      setProveedores(p);
      setConocidos(c);
      setAgentesMcp(a);
      setFalloDeCarga(null);
      for (const i of INTEGRACIONES()) if (!viva(i.id)) setEstados(i.id, guardado(i));
      props.onCambio(INTEGRACIONES().filter((i) => estados[i.id]?.k === "conectada").length);
      void incluir();
    } catch (e) {
      setFalloDeCarga(explicar(e));
    }
  }

  /** Lo incluido no pide nada: se deja puesto en el workspace al abrir la pantalla. */
  async function incluir() {
    if (incluidas) return;
    incluidas = true;
    for (const i of INTEGRACIONES().filter((x) => x.via === "incluido")) {
      const c = conocido(i);
      if (!c || c.conectado) continue;
      try {
        await invoke("connect_known_mcp", { id: idMcp(i) });
      } catch (e) {
        setErrores(i.id, explicar(e));
      }
    }
    if (!cerrada) await cargar();
  }

  onMount(() => void cargar());
  const fin = listen("mcp", () => {
    if (esperandoMcp) setEstados(esperandoMcp, { k: "libre" });
    esperandoMcp = null;
    void cargar();
  });
  const url = listen<string>("mcp-login", (e) => {
    if (esperandoMcp) invoke("open_external", { target: e.payload }).catch(() => {});
  });
  // La CLI de un servicio que se descarga avisa su avance con el id del servicio.
  const avance = listen<Avance>("toolchain", (e) => {
    const i = INTEGRACIONES().find((x) => idMcp(x) === e.payload.id);
    if (!i || e.payload.bytes <= 0 || !["descargando", "conectando"].includes(estados[i.id]?.k ?? "")) return;
    if (e.payload.done >= e.payload.bytes) return void setEstados(i.id, { k: "conectando" });
    setEstados(i.id, { k: "descargando", hecho: e.payload.done, total: e.payload.bytes });
  });
  onCleanup(() => {
    cerrada = true;
    for (const l of [fin, url, avance]) void l.then((f) => f());
    for (const i of INTEGRACIONES()) {
      if (i.via === "proveedor" && estados[i.id]?.k === "conectando") void cancelar(i);
    }
  });

  /** El respaldo de Configuración: pegar un token cuando el navegador no se pudo usar. */
  function abrirFormulario(i: Integracion, motivo: string | null) {
    setMotivos(i.id, motivo);
    setEstados(i.id, { k: "formulario" });
  }

  async function conectar(i: Integracion) {
    setErrores(i.id, null);
    setMotivos(i.id, null);
    if (i.via === "proveedor") {
      const p = proveedor(i.id);
      if (!p) return void setErrores(i.id, t("onboarding.tools.unavailable"));
      if (!p.browser_login) return abrirFormulario(i, null);
      setEstados(i.id, { k: "conectando" });
      try {
        const espera = await invoke<Wait>("start_browser_login", { id: i.id, scope: await scope });
        if (cerrada) return;
        setEstados(i.id, { k: "conectando", codigo: espera.code });
        invoke("open_external", { target: espera.url }).catch(() => {});
      } catch (e) {
        if (estados[i.id]?.k !== "conectando") return;
        return abrirFormulario(i, explicar(e));
      }
      try {
        const fresco = await invoke<Proveedor>("finish_browser_login", { id: i.id, scope: await scope });
        if (fresco.setup_url) invoke("open_external", { target: fresco.setup_url }).catch(() => {});
      } catch (e) {
        if (estados[i.id]?.k !== "conectando") return;
        setErrores(i.id, explicar(e));
      }
      setEstados(i.id, { k: "libre" });
      return void cargar();
    }
    const c = conocido(i);
    if (!c) return void setErrores(i.id, i.id === "drive" ? t("onboarding.tools.drive_engine") : t("onboarding.tools.unavailable"));
    esperandoMcp = i.id;
    setEstados(i.id, { k: "conectando" });
    try {
      await invoke("connect_known_mcp", { id: idMcp(i) });
      const agente = agenteDeSesion();
      if (c.pide_sesion && agente) {
        await invoke("mcp_login", { provider: agente.id, id: idMcp(i) });
        return;
      }
    } catch (e) {
      if (esperandoMcp !== i.id) return;
      esperandoMcp = null;
      setErrores(i.id, explicar(e));
      setEstados(i.id, { k: "libre" });
      return;
    }
    esperandoMcp = null;
    setEstados(i.id, { k: "libre" });
    await cargar();
  }

  async function conectarConToken(i: Integracion) {
    const p = proveedor(i.id);
    const b = borrador(i.id);
    if (!p || !b.token.trim() || p.fields.some((c) => c.required && !b.data[c.id]?.trim())) return;
    setErrores(i.id, null);
    setEstados(i.id, { k: "conectando" });
    try {
      const data = Object.fromEntries(Object.entries(b.data).map(([k, v]) => [k, v.trim()]));
      await invoke("connect_git_host", { scope: await scope, id: i.id, data, token: b.token.trim() });
      setBorradores(i.id, SIN_BORRADOR);
      setMotivos(i.id, null);
      setEstados(i.id, { k: "libre" });
      await cargar();
    } catch (e) {
      setErrores(i.id, explicar(e));
      setEstados(i.id, { k: "formulario" });
    }
  }

  async function cancelar(i: Integracion) {
    setErrores(i.id, null);
    const e = estados[i.id]?.k;
    if (i.via === "proveedor" && e === "conectando" && !borradores[i.id]?.token) {
      invoke("cancel_browser_login", { id: i.id, scope: await scope }).catch(() => {});
    } else if (i.via !== "proveedor" && esperandoMcp === i.id) {
      esperandoMcp = null;
      await invoke("disconnect_known_mcp", { id: idMcp(i) }).catch(() => {});
    }
    setBorradores(i.id, SIN_BORRADOR);
    setMotivos(i.id, null);
    if (!cerrada) setEstados(i.id, { k: "libre" });
  }

  async function desconectar(i: Integracion) {
    setErrores(i.id, null);
    setEstados(i.id, { k: "saliendo" });
    try {
      if (i.via === "proveedor") await invoke("disconnect_git_host", { id: i.id, scope: await scope });
      else await invoke("disconnect_known_mcp", { id: idMcp(i) });
    } catch (e) {
      setErrores(i.id, explicar(e));
    }
    setEstados(i.id, { k: "libre" });
    await cargar();
  }

  const formularioAbierto = (i: Integracion) =>
    i.via === "proveedor" && (estados[i.id]?.k === "formulario" || (estados[i.id]?.k === "conectando" && Boolean(borradores[i.id]?.token)));

  const detalle = (i: Integracion) => {
    const e = estados[i.id];
    switch (e?.k) {
      case "conectada":
        return i.via === "incluido" ? descripcion(i.id) : e.detalle;
      case "formulario":
        return t("onboarding.tools.fill_below");
      case "descargando":
        return t("onboarding.tools.downloading_cli", { done: mb(e.hecho), total: mb(e.total) });
      case "conectando":
        if (formularioAbierto(i)) return t("onboarding.tools.checking_token");
        if (e.codigo) return t("onboarding.ai.confirm_code", { code: e.codigo });
        return t("onboarding.tools.finish_in_browser");
      case "saliendo":
        return t("onboarding.ai.disconnecting");
      default:
        return descripcion(i.id);
    }
  };

  function Tarjeta(p: { i: Integracion }) {
    const e = () => estados[p.i.id];
    const nombre = p.i.nombre;
    const cancelarEsta = () => (
      <CancelButton label={t("onboarding.tools.cancel_connect", { name: nombre })} onClick={() => void cancelar(p.i)} />
    );
    return (
      <div
        class={cn(
          "flex h-[58px] items-center gap-3 rounded-lg border px-3 py-2",
          e()?.k === "conectada" && "border-success-strong/40 bg-success/5",
          ["conectando", "formulario", "descargando"].includes(e()?.k ?? "") && "border-primary bg-primary/5",
          (!e() || e()?.k === "libre" || e()?.k === "saliendo") && "border-border bg-surface-raised",
        )}
      >
        <span class="grid size-[26px] shrink-0 place-items-center rounded-md bg-surface-muted text-neutral-950">
          <MarcaIntegracion id={p.i.id} size={15} />
        </span>
        <span class="grid min-w-0 flex-1 gap-px">
          <strong class="truncate text-[13px] font-semibold text-neutral-950">{nombre}</strong>
          <span class="truncate text-[11px] text-neutral-500" title={detalle(p.i)}>
            {detalle(p.i)}
          </span>
        </span>
        <span class="flex w-[124px] shrink-0 items-center justify-end gap-1.5">
          <Switch
            fallback={
              <Button size="compact" variant="secondary" onClick={() => void conectar(p.i)}>
                {t("onboarding.ai.connect")}
              </Button>
            }
          >
            <Match when={p.i.via === "incluido" && e()?.k === "conectada"}>
              <Badge tone="success" class="gap-1">
                <Check size={11} stroke-width={3} aria-hidden="true" />
                {t("onboarding.tools.included")}
              </Badge>
            </Match>
            <Match when={e()?.k === "conectada"}>
              <Badge tone="success" class="gap-1">
                <Check size={11} stroke-width={3} aria-hidden="true" />
                {t("onboarding.tools.connected")}
              </Badge>
              <RemoveButton
                icon="unlink"
                label={t("onboarding.ai.disconnect", { name: nombre })}
                onClick={() => void desconectar(p.i)}
              />
            </Match>
            <Match when={e()?.k === "descargando" && e()}>
              {(d) => {
                const v = () => {
                  const x = d() as { hecho: number; total: number };
                  return x.total > 0 ? Math.min(100, (x.hecho / x.total) * 100) : 0;
                };
                return (
                  <>
                    <span class="h-[5px] w-[70px] overflow-hidden rounded-full bg-surface-muted">
                      <span class="block h-full bg-primary transition-[width] duration-150" style={{ width: `${v()}%` }} />
                    </span>
                    {cancelarEsta()}
                  </>
                );
              }}
            </Match>
            <Match when={e()?.k === "conectando"}>
              <Spinner size={18} class="text-primary" />
              <Show when={!formularioAbierto(p.i)}>{cancelarEsta()}</Show>
            </Match>
            <Match when={e()?.k === "formulario"}>{cancelarEsta()}</Match>
            <Match when={e()?.k === "saliendo"}>
              <Spinner class="text-neutral-500" />
            </Match>
          </Switch>
        </span>
      </div>
    );
  }

  /** Datos y token del servicio, con los textos que da el motor; Bitbucket con los del diseño. */
  function Formulario(q: { i: Integracion }) {
    const p = () => proveedor(q.i.id);
    const ocupado = () => estados[q.i.id]?.k === "conectando";
    const error = () => errores[q.i.id];
    const bitbucket = q.i.id === "bitbucket";
    const poner = (campo: string, valor: string) =>
      setBorradores(q.i.id, (b) => ({ ...(b ?? SIN_BORRADOR), data: { ...(b?.data ?? {}), [campo]: valor } }));
    const listo = () =>
      Boolean(p()) && borrador(q.i.id).token.trim() !== "" && !p()!.fields.some((c) => c.required && !borrador(q.i.id).data[c.id]?.trim());
    const alEnter = (e: KeyboardEvent) => {
      if (e.key === "Enter" && listo() && !ocupado()) void conectarConToken(q.i);
    };
    return (
      <Show when={p()}>
        {(prov) => (
          <div class="grid gap-2 rounded-lg border border-primary bg-surface-raised px-4 py-3.5 motion-safe:animate-entrar">
            <p class="m-0 flex items-center gap-2 text-[13px]">
              <MarcaIntegracion id={q.i.id} size={16} />
              <strong class="font-semibold">{t("onboarding.tools.credential.title", { name: q.i.nombre })}</strong>
            </p>
            <Show when={motivos[q.i.id]}>
              {(m) => (
                <p class="m-0 text-xs break-words text-error-strong" role="alert">
                  {m()}
                </p>
              )}
            </Show>
            <div class="grid gap-3 md:grid-cols-2">
              <For each={prov().fields}>
                {(c, n) => (
                  <label class="grid gap-1.5">
                    <span class="text-[13px] font-semibold">
                      {bitbucket ? t("onboarding.tools.bitbucket.space") : prosa(c.label)}
                    </span>
                    <Input
                      spellcheck={false}
                      value={borrador(q.i.id).data[c.id] ?? ""}
                      disabled={ocupado()}
                      ref={(el) => n() === 0 && queueMicrotask(() => el.focus())}
                      onInput={(e) => poner(c.id, e.currentTarget.value)}
                      onKeyDown={alEnter}
                    />
                    <span class="text-xs text-neutral-500">
                      {bitbucket ? t("onboarding.tools.bitbucket.space_hint") : prosa(c.help)}
                    </span>
                  </label>
                )}
              </For>
              <label class="grid gap-1.5">
                <span class="text-[13px] font-semibold">
                  {bitbucket ? t("onboarding.tools.bitbucket.token") : prosa(prov().token_label)}
                </span>
                <Input
                  type="password"
                  class={cn("font-mono tracking-[0.02em]", error() && "border-error-strong")}
                  autocomplete="off"
                  spellcheck={false}
                  value={borrador(q.i.id).token}
                  disabled={ocupado()}
                  aria-invalid={error() ? true : undefined}
                  ref={(el) => prov().fields.length === 0 && queueMicrotask(() => el.focus())}
                  onInput={(e) => {
                    setErrores(q.i.id, null);
                    setBorradores(q.i.id, (b) => ({ ...(b ?? SIN_BORRADOR), token: e.currentTarget.value }));
                  }}
                  onKeyDown={alEnter}
                />
                <Show
                  when={error()}
                  fallback={
                    <span class="text-xs text-neutral-500">
                      {bitbucket ? t("onboarding.tools.bitbucket.token_hint") : prosa(prov().token_help)}{" "}
                      <button
                        type="button"
                        class="inline-flex cursor-pointer items-center gap-0.5 border-0 bg-transparent p-0 text-primary hover:underline"
                        onClick={() => void invoke("open_external", { target: prov().token_url }).catch(() => {})}
                      >
                        {t("onboarding.tools.credential.create_token")}
                        <ExternalLink size={11} aria-hidden="true" />
                      </button>
                    </span>
                  }
                >
                  {(e) => (
                    <span class="text-xs break-words text-error-strong" role="alert">
                      {e()}
                    </span>
                  )}
                </Show>
              </label>
            </div>
            <div class="mt-0.5 flex flex-wrap items-center gap-2">
              <span class="text-xs text-neutral-500">{t("onboarding.tools.credential.stored")}</span>
              <span class="flex-1" />
              <Button size="sm" variant="ghost" disabled={ocupado()} onClick={() => void cancelar(q.i)}>
                {t("onboarding.cancel")}
              </Button>
              <Button size="sm" disabled={ocupado() || !listo()} onClick={() => void conectarConToken(q.i)}>
                {ocupado() ? t("onboarding.ai.checking") : t("onboarding.ai.connect")}
              </Button>
            </div>
          </div>
        )}
      </Show>
    );
  }

  const visibles = () =>
    INTEGRACIONES().filter(
      (i) => i.comun || verMas() || ["formulario", "descargando", "conectando", "conectada"].includes(estados[i.id]?.k ?? ""),
    );
  // Como el diseño: la pila de «Ver más» enseña todo lo que no es común, aunque ya esté a la vista.
  const escondidas = () => INTEGRACIONES().filter((i) => !i.comun);
  const fallidas = () => INTEGRACIONES().filter((i) => errores[i.id] && !formularioAbierto(i));

  return (
    <>
      <div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <For each={visibles()}>{(i) => <Tarjeta i={i} />}</For>
      </div>
      <Show when={falloDeCarga()}>{(e) => <ErrorDeTarjeta class="rounded-md border-t" texto={e()} />}</Show>
      <For each={fallidas()}>
        {(i) => <ErrorDeTarjeta class="rounded-md border-t" texto={t("onboarding.tools.failed", { name: i.nombre, reason: errores[i.id] ?? "" })} />}
      </For>
      <For each={INTEGRACIONES().filter(formularioAbierto)}>{(i) => <Formulario i={i} />}</For>
      <VerMas
        abierto={verMas()}
        resto={escondidas().map((i) => ({ id: i.id, nombre: i.nombre, icono: <MarcaIntegracion id={i.id} size={12} /> }))}
        onClick={() => setVerMas((v) => !v)}
      />
    </>
  );
}

/** Los plugins se instalan dentro de su tarjeta; instalar sigue en segundo plano si se avanza. */
export function Plugins(props: { onCambio: (estado: { instalados: number; instalando: number }) => void }) {
  const [catalogo, setCatalogo] = createSignal<{ workspace: string; plugins: Plugin[] } | null>(null);
  const [falloDeCarga, setFalloDeCarga] = createSignal<string | null>(null);
  const [ocupados, setOcupados] = createStore<Record<string, "instalando" | "desinstalando" | undefined>>({});
  const [errores, setErrores] = createStore<Record<string, string | null>>({});
  const [verMas, setVerMas] = createSignal(false);
  let cerrada = false;

  const plugins = () =>
    [...(catalogo()?.plugins ?? [])]
      .filter((p) => ORDEN_PLUGINS.includes(p.id))
      .sort((a, b) => ORDEN_PLUGINS.indexOf(a.id) - ORDEN_PLUGINS.indexOf(b.id));
  const instalando = (p: Plugin) => ocupados[p.id] === "instalando" || (p.installing && !ocupados[p.id]);

  function avisar() {
    props.onCambio({
      instalados: plugins().filter((p) => p.installed && !ocupados[p.id]).length,
      instalando: plugins().filter(instalando).length,
    });
  }

  async function cargar() {
    try {
      const c = await invoke<{ workspace: string; plugins: Plugin[] }>("list_integrations");
      if (cerrada) return;
      setCatalogo(c);
      avisar();
    } catch (e) {
      setFalloDeCarga(prosaDe(e));
    }
  }
  onMount(() => void cargar());
  const cambios = listen("integrations-changed", () => void cargar());
  onCleanup(() => {
    cerrada = true;
    void cambios.then((f) => f());
  });

  async function instalar(p: Plugin) {
    const workspace = catalogo()?.workspace;
    if (!workspace) return;
    setErrores(p.id, null);
    setOcupados(p.id, "instalando");
    avisar();
    try {
      await invoke("install_integration", { id: p.id });
      await invoke("set_integration_enabled", { id: p.id, workspace, enabled: true });
    } catch (e) {
      if (!cerrada) setErrores(p.id, prosaDe(e));
    }
    if (cerrada) return;
    setOcupados(p.id, undefined);
    await cargar();
  }

  async function desinstalar(p: Plugin) {
    setErrores(p.id, null);
    setOcupados(p.id, "desinstalando");
    avisar();
    try {
      // Un Tinymist vivo bloquea en Windows la carpeta que desinstalar borra.
      if (p.id === "typst") await invoke("typst_live_stop", { key: null, session: null }).catch(() => {});
      await invoke("uninstall_integration", { id: p.id });
    } catch (e) {
      setErrores(p.id, prosaDe(e));
    }
    setOcupados(p.id, undefined);
    await cargar();
  }

  function Tarjeta(q: { p: Plugin }) {
    const nombre = () => t(`onboarding.tools.plugin.${q.p.id}`);
    const sub = () => errores[q.p.id] ?? (!q.p.supported && !q.p.installed ? t("onboarding.tools.unsupported") : descripcion(q.p.id));
    return (
      <div
        class={cn(
          "relative flex h-16 items-center gap-3 overflow-hidden rounded-lg border px-3.5",
          instalando(q.p)
            ? "border-primary bg-primary/5"
            : q.p.installed && !ocupados[q.p.id]
              ? "border-success-strong/40 bg-success/5"
              : "border-border bg-surface-raised",
        )}
      >
        <span class="grid size-[26px] shrink-0 place-items-center rounded-md bg-surface-muted text-neutral-950">
          <MarcaPlugin id={q.p.id} size={15} />
        </span>
        <span class="grid min-w-0 flex-1 gap-1">
          <strong class="flex min-w-0 items-center gap-1 text-[13px] leading-tight font-semibold text-neutral-950">
            <span class="truncate">{nombre()}</span>
            <Show when={RECOMENDADOS.includes(q.p.id)}>
              <span class="shrink-0 rounded-full bg-primary/10 px-1.5 py-px text-[10px] font-medium text-primary">
                {t("onboarding.tools.recommended")}
              </span>
            </Show>
          </strong>
          <span class={cn("truncate text-[11px]", errores[q.p.id] ? "text-error-strong" : "text-neutral-500")} title={sub()}>
            {sub()}
          </span>
        </span>
        <span class="flex w-[176px] shrink-0 items-center justify-end gap-1.5">
          <Switch
            fallback={
              <>
                <Show when={CON_PESO.has(q.p.id)}>
                  <span class="text-[11px] whitespace-nowrap text-neutral-500">{t(`onboarding.tools.size.${q.p.id}`)}</span>
                </Show>
                <Button
                  size="compact"
                  variant="secondary"
                  class="ml-1"
                  disabled={!q.p.supported}
                  onClick={() => void instalar(q.p)}
                >
                  {t("onboarding.tools.install")}
                </Button>
              </>
            }
          >
            <Match when={instalando(q.p)}>
              <span class="text-[11px] whitespace-nowrap text-neutral-500">{t("onboarding.tools.installing")}</span>
              <Spinner class="text-primary" />
            </Match>
            <Match when={ocupados[q.p.id] === "desinstalando"}>
              <span class="text-[11px] whitespace-nowrap text-neutral-500">{t("onboarding.tools.uninstalling")}</span>
              <Spinner class="text-neutral-500" />
            </Match>
            <Match when={q.p.installed}>
              <Badge tone="success" class="gap-1">
                <Check size={11} stroke-width={3} aria-hidden="true" />
                {t("onboarding.tools.installed")}
              </Badge>
              <RemoveButton
                icon="trash"
                label={t("onboarding.tools.uninstall", { name: nombre() })}
                onClick={() => void desinstalar(q.p)}
              />
            </Match>
          </Switch>
        </span>
        <Show when={instalando(q.p)}>
          {/* El motor no informa cuánto lleva: la línea barre en vez de llenarse. */}
          <span class="absolute inset-x-0 bottom-0 h-[3px] overflow-hidden bg-primary/15" aria-hidden="true">
            <span class="block h-full w-1/4 animate-barrido bg-primary motion-reduce:animate-none" />
          </span>
        </Show>
      </div>
    );
  }

  const visibles = () => plugins().filter((p) => RECOMENDADOS.includes(p.id) || verMas() || p.installed || instalando(p));
  const escondidos = () => plugins().filter((p) => !visibles().includes(p));

  return (
    <>
      <div class="grid gap-2">
        <For each={visibles()}>{(p) => <Tarjeta p={p} />}</For>
      </div>
      <Show when={falloDeCarga()}>{(e) => <p class="m-0 text-xs text-error-strong">{e()}</p>}</Show>
      <VerMas
        abierto={verMas()}
        resto={escondidos().map((p) => ({ id: p.id, nombre: t(`onboarding.tools.plugin.${p.id}`), icono: <MarcaPlugin id={p.id} size={12} /> }))}
        onClick={() => setVerMas((v) => !v)}
      />
    </>
  );
}
