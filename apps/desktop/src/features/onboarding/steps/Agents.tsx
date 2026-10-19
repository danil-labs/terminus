import { For, Show, createEffect, createSignal, on, onCleanup, onMount } from "solid-js";
import { invoke } from "../../../lib/invoke.ts";
import { listen } from "../../../lib/serviceEvents";
import { t } from "../../../lib/i18n";
import { mb } from "../../../lib/format";
import { cn } from "../../../lib/utils";
import { Button } from "../../../ui/Button";
import { MarcaAgente } from "../../../ui/icons";
import { ORIGEN_SISTEMA } from "../../settings/environment-store";
import { Pantalla } from "../Screen";
import { nombreDeAgente, type Alta } from "../onboarding-store";

type Agente = {
  id: string;
  label: string;
  available: boolean;
  source: string | null;
  system_broken: boolean;
  external_install_url?: string | null;
};

/** Paso 2: qué proveedores se instalan en esta computadora, antes de que exista un workspace. */
export default function Proveedores(props: { alta: Alta }) {
  const [agentes, setAgentes] = createSignal<Agente[]>([]);
  const [pesos, setPesos] = createSignal<Record<string, number>>({});
  const [comprobando, setComprobando] = createSignal(false);
  const [error, setError] = createSignal(false);
  const elegidos = () => props.alta.estado.elegidos;

  const cargar = () =>
    invoke<Agente[]>("list_agents")
      .then((as) => { setAgentes(as); setError(false); })
      .catch(() => setError(true));

  async function comprobar() {
    setComprobando(true);
    setError(false);
    try {
      await invoke("check_environment", { force: true });
      await cargar();
    } catch {
      setError(true);
    } finally {
      setComprobando(false);
    }
  }

  async function abrir(url: string) {
    try {
      await invoke("open_external", { target: url });
    } catch {
      setError(true);
    }
  }

  onMount(() => {
    void cargar();
    const cambios = listen("agents", () => void cargar());
    onCleanup(() => void cambios.then((f) => f()));
  });

  // Solo de los que faltan: de lo que ya está en la máquina no se ofrece descarga.
  createEffect(
    on(agentes, (as) => {
      for (const a of as.filter((x) => !x.available && !x.external_install_url && pesos()[x.id] === undefined)) {
        invoke<number>("agent_download_size", { agent: a.id })
          .then((b) => setPesos((ps) => ({ ...ps, [a.id]: b })))
          .catch(() => {});
      }
    }),
  );

  const alternar = (id: string) =>
    props.alta.set("elegidos", (xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));

  const meta = (a: Agente) => {
    if (a.available) {
      return a.source === ORIGEN_SISTEMA ? t("onboarding.agent.from_system") : t("onboarding.agent.installed");
    }
    if (a.external_install_url) return t("onboarding.agent.external_required", { agent: a.label });
    const bytes = pesos()[a.id];
    if (!bytes) return "";
    // Sin esto, a quien tiene la app del proveedor le aparece «no instalado»
    // contradiciendo lo que ve en su máquina, y vuelve a saltarse la descarga.
    return a.system_broken
      ? t("onboarding.agent.system_broken", { size: mb(bytes) })
      : t("onboarding.agent.size", { size: mb(bytes) });
  };

  function seguir() {
    props.alta.instalar(elegidos().filter((id) => {
      const a = agentes().find((a) => a.id === id);
      return a && !a.available && !a.external_install_url;
    }));
    props.alta.set("paso", "workspace");
  }

  return (
    <Pantalla
      amplia
      titulo={t("onboarding.agents.title")}
      lede={t("onboarding.agents.lede")}
      pie={t("onboarding.agents.selected", { count: elegidos().length })}
      primario={{ rotulo: t("onboarding.agents.install"), onClick: seguir, disabled: elegidos().length === 0 }}
    >
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <For each={agentes()}>
          {(a) => (
            <div
              class={cn(
                "grid gap-2 rounded-md border px-4 py-3.5 transition-colors",
                elegidos().includes(a.id)
                  ? "border-primary bg-primary/5"
                  : "border-border bg-surface-raised hover:border-border-strong",
              )}
            >
              <label class="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  class="mt-0.5 size-4 accent-primary"
                  checked={elegidos().includes(a.id)}
                  disabled={!a.available && Boolean(a.external_install_url) && !elegidos().includes(a.id)}
                  onChange={() => alternar(a.id)}
                />
                <span class="grid gap-1">
                  <strong class="flex items-center gap-2 text-sm font-semibold text-neutral-950">
                    <MarcaAgente id={a.id} size={18} />
                    {nombreDeAgente(a)}
                  </strong>
                  <span class="text-xs text-neutral-500">{meta(a)}</span>
                </span>
              </label>
              <Show when={!a.available && a.external_install_url}>
                <Button variant="ghost" size="compact" onClick={() => void abrir(a.external_install_url!)}>
                  {t("onboarding.agent.official_download")}
                </Button>
              </Show>
            </div>
          )}
        </For>
      </div>
      <Show when={error() || agentes().some((a) => !a.available && a.external_install_url)}>
        <Button variant="secondary" size="sm" disabled={comprobando()} onClick={() => void comprobar()}>
          {t("onboarding.agent.check_installed")}
        </Button>
      </Show>
      <Show when={error()}><p class="text-xs text-error-strong">{t("onboarding.agent.external_error")}</p></Show>
    </Pantalla>
  );
}
