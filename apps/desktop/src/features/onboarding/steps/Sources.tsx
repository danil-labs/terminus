import { For, Show, createSignal, onMount } from "solid-js";
import ChevronDown from "lucide-solid/icons/chevron-down";
import { t } from "../../../lib/i18n";
import { cn } from "../../../lib/utils";
import { MarcaGitHost } from "../../../ui/icons";
import { FailureNote, asFailure, type Failure } from "../../../ui/Failure";
import { Skeleton } from "../../../ui/Skeleton";
import { listGitHosts, type GitHost } from "../../../lib/gitHosts.ts";
import { prosa } from "../../../lib/prose";
import Providers from "../../settings/Providers";
import { Pantalla } from "../Screen";
import type { Alta } from "../onboarding-store";

/** Paso 5, opcional: los servicios que declara el motor, lado a lado; la tarjeta elegida despliega su conexión. */
export default function Repositorios(props: { alta: Alta }) {
  const [abierto, setAbierto] = createSignal<string | null>(null);
  const [fuentes, setFuentes] = createSignal<GitHost[] | null>(null);
  const [fallo, setFallo] = createSignal<Failure | null>(null);
  onMount(() => {
    listGitHosts().then(setFuentes, (e) => { setFuentes([]); setFallo(asFailure(e)); });
  });

  return (
    <Pantalla
      titulo={t("onboarding.sources.title")}
      lede={t("onboarding.sources.lede")}
      pie={t("onboarding.sources.footer")}
      atras={() => props.alta.set("paso", "accounts")}
      primario={{ rotulo: t("onboarding.continue"), onClick: () => props.alta.set("paso", "context") }}
    >
      <Show when={fuentes() !== null} fallback={<Skeleton class="h-16 w-full" />}>
      <Show when={fallo()}>{(f) => <FailureNote f={f()} />}</Show>
      <div class="grid gap-3 sm:grid-cols-[repeat(auto-fit,minmax(12rem,1fr))]">
        <For each={fuentes() ?? []}>
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
              <MarcaGitHost id={f.id} size={20} />
              <span class="grid min-w-0 flex-1 gap-0.5">
                <strong class="text-sm font-semibold text-neutral-950">{f.name}</strong>
                <span class="text-xs text-neutral-500">{prosa(f.summary)}</span>
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
      </Show>
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
