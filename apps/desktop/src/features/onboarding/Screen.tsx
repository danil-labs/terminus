import { Show, createContext, createSignal, onMount, useContext, type JSX } from "solid-js";
import { Button } from "../../ui/Button";
import { FailureNote, asFailure } from "../../ui/Failure";
import { t } from "../../lib/i18n";
import { cn } from "../../lib/utils";

/** Saltar el resto del alta y entrar a la app; solo lo provee el primer arranque. */
export const SaltarAlta = createContext<(() => Promise<void>) | undefined>();

/** Una pantalla del alta: título, contenido desplazable y el pie con Atrás y la acción. */
export function Pantalla(props: {
  titulo: string;
  lede: string;
  amplia?: boolean;
  children: JSX.Element;
  pie: string;
  atras?: () => void;
  atrasRotulo?: string;
  primario: { rotulo: string; onClick: () => void; disabled?: boolean };
  error?: unknown;
}) {
  const saltar = useContext(SaltarAlta);
  const [saltando, setSaltando] = createSignal(false);
  const [falloAlSaltar, setFalloAlSaltar] = createSignal<unknown>(null);
  let titulo: HTMLHeadingElement | undefined;

  async function alSaltar(s: () => Promise<void>) {
    setSaltando(true);
    setFalloAlSaltar(null);
    try {
      await s();
    } catch (e) {
      setFalloAlSaltar(e);
      setSaltando(false);
    }
  }
  // Cambiar de paso deja el foco en el título, para que el lector de pantalla anuncie dónde está.
  onMount(() => titulo?.focus({ preventScroll: true }));

  return (
    <>
      <div class="min-h-0 flex-1 overflow-y-auto">
        <section class={cn("mx-auto w-full px-8 py-12", props.amplia ? "max-w-[920px]" : "max-w-[580px]")}>
          <h1
            ref={titulo}
            tabindex="-1"
            class="m-0 text-3xl leading-tight font-display font-bold tracking-[-0.03em] text-neutral-950 outline-none"
          >
            {props.titulo}
          </h1>
          <p class="m-0 mt-3 mb-8 max-w-[52ch] text-sm text-neutral-500">{props.lede}</p>
          {props.children}
          <Show when={props.error ?? falloAlSaltar()}>
            {(e) => (
              <div class="mt-5">
                <FailureNote f={asFailure(e())} />
              </div>
            )}
          </Show>
        </section>
      </div>
      <footer class="flex flex-wrap items-center gap-3 border-t border-border px-7 py-5">
        <Show when={props.atras}>
          {(atras) => (
            <Button size="sm" variant="ghost" onClick={atras()}>
              {props.atrasRotulo ?? t("onboarding.back")}
            </Button>
          )}
        </Show>
        <p class="m-0 text-xs text-neutral-500">{props.pie}</p>
        <span class="flex-1" />
        <Show when={saltar}>
          {(s) => (
            <Button size="sm" variant="ghost" disabled={saltando()} onClick={() => void alSaltar(s())}>
              {t("onboarding.manual.skip")}
            </Button>
          )}
        </Show>
        <Button size="sm" disabled={props.primario.disabled} onClick={() => props.primario.onClick()}>
          {props.primario.rotulo}
        </Button>
      </footer>
    </>
  );
}

/** Una de varias maneras excluyentes de traer algo: una carpeta, un clon, una nueva. */
export function Opcion(props: { activa: boolean; onClick: () => void; children: JSX.Element }) {
  return (
    <button
      type="button"
      aria-pressed={props.activa}
      onClick={() => props.onClick()}
      class={cn(
        "min-h-9 cursor-pointer rounded-md border px-3 text-[13px] font-medium transition-colors",
        props.activa
          ? "border-primary bg-primary/5 text-neutral-950"
          : "border-border bg-surface-raised text-neutral-500 hover:border-border-strong",
      )}
    >
      {props.children}
    </button>
  );
}
