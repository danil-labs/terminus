import { For, Show, createSignal } from "solid-js";
import ChevronDown from "lucide-solid/icons/chevron-down";
import { t } from "../../../lib/i18n";
import { cn } from "../../../lib/utils";
import { MarcaProveedor } from "../../../ui/icons";
import Providers from "../../settings/Providers";
import { Pantalla } from "../Screen";
import type { Alta } from "../onboarding-store";

/** Paso 5, opcional: GitHub y Bitbucket lado a lado; la tarjeta elegida despliega su conexión. */
export default function Repositorios(props: { alta: Alta }) {
  const [abierto, setAbierto] = createSignal<string | null>(null);
  const fuentes = () => [
    { id: "github", nombre: "GitHub", como: t("onboarding.sources.github_how") },
    { id: "bitbucket", nombre: "Bitbucket", como: t("onboarding.sources.bitbucket_how") },
  ];

  return (
    <Pantalla
      titulo={t("onboarding.sources.title")}
      lede={t("onboarding.sources.lede")}
      pie={t("onboarding.sources.footer")}
      atras={() => props.alta.set("paso", "accounts")}
      primario={{ rotulo: t("onboarding.continue"), onClick: () => props.alta.set("paso", "context") }}
    >
      <div class="grid gap-3 sm:grid-cols-2">
        <For each={fuentes()}>
          {(f) => (
            <button
              type="button"
              aria-expanded={abierto() === f.id}
              class={cn(
                "flex cursor-pointer items-center gap-3 rounded-md border px-4 py-3.5 text-left transition-colors",
                abierto() === f.id
                  ? "border-primary bg-primary/5"
                  : "border-border bg-surface-raised hover:border-border-strong",
              )}
              onClick={() => setAbierto((x) => (x === f.id ? null : f.id))}
            >
              <MarcaProveedor id={f.id} size={20} />
              <span class="grid min-w-0 flex-1 gap-0.5">
                <strong class="text-sm font-semibold text-neutral-950">{f.nombre}</strong>
                <span class="text-xs text-neutral-500">{f.como}</span>
              </span>
              <ChevronDown
                size={16}
                aria-hidden="true"
                class={cn("shrink-0 text-neutral-500 transition-transform", abierto() === f.id && "rotate-180")}
              />
            </button>
          )}
        </For>
      </div>
      <Show when={abierto()} keyed>
        {(id) => (
          <div class="mt-4">
            <Providers solo={id} />
          </div>
        )}
      </Show>
    </Pantalla>
  );
}
