import { For, createEffect, createSignal, on, onCleanup, onMount } from "solid-js";
import { invoke } from "../../../lib/invoke.ts";
import { listen } from "@tauri-apps/api/event";
import { t } from "../../../lib/i18n";
import { mb } from "../../../lib/format";
import { cn } from "../../../lib/utils";
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
};

/** Paso 2: qué proveedores se instalan en esta computadora, antes de que exista un workspace. */
export default function Proveedores(props: { alta: Alta }) {
  const [agentes, setAgentes] = createSignal<Agente[]>([]);
  const [pesos, setPesos] = createSignal<Record<string, number>>({});
  const elegidos = () => props.alta.estado.elegidos;

  const cargar = () =>
    invoke<Agente[]>("list_agents")
      .then(setAgentes)
      .catch(() => setAgentes([]));

  onMount(() => {
    void cargar();
    const cambios = listen("agents", () => void cargar());
    onCleanup(() => void cambios.then((f) => f()));
  });

  // Solo de los que faltan: de lo que ya está en la máquina no se ofrece descarga.
  createEffect(
    on(agentes, (as) => {
      for (const a of as.filter((x) => !x.available && pesos()[x.id] === undefined)) {
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
    const bytes = pesos()[a.id];
    if (!bytes) return "";
    // Sin esto, a quien tiene la app del proveedor le aparece «no instalado»
    // contradiciendo lo que ve en su máquina, y vuelve a saltarse la descarga.
    return a.system_broken
      ? t("onboarding.agent.system_broken", { size: mb(bytes) })
      : t("onboarding.agent.size", { size: mb(bytes) });
  };

  function seguir() {
    props.alta.instalar(elegidos().filter((id) => !agentes().find((a) => a.id === id)?.available));
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
            <label
              class={cn(
                "flex cursor-pointer items-start gap-3 rounded-md border px-4 py-3.5 transition-colors",
                elegidos().includes(a.id)
                  ? "border-primary bg-primary/5"
                  : "border-border bg-surface-raised hover:border-border-strong",
              )}
            >
              <input
                type="checkbox"
                class="mt-0.5 size-4 accent-primary"
                checked={elegidos().includes(a.id)}
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
          )}
        </For>
      </div>
    </Pantalla>
  );
}
