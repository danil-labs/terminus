import Check from "lucide-solid/icons/check";
import Copy from "lucide-solid/icons/copy";
import { Show, createSignal } from "solid-js";
import { copyText } from "../../lib/clipboard";
import { mb } from "../../lib/format";
import { t } from "../../lib/i18n";
import { CancelButton } from "../../ui/IconAction";

/**
 * Lo que baja, igual en proveedores de IA, herramientas y plugins: a la derecha su peso y la ×
 * para cortarlo; el avance lo dice la barra del borde inferior de la tarjeta (`BarraDeCarga`).
 */
export function AvanceDeDescarga(props: { total: number | null; cancelar: string; onCancelar?: () => void }) {
  return (
    <>
      <Peso bytes={props.total} />
      <Show when={props.onCancelar}>{(f) => <CancelButton label={props.cancelar} onClick={() => f()()} />}</Show>
    </>
  );
}

/** La barra del borde inferior de una tarjeta que descarga. Va dentro de un contenedor `relative overflow-hidden`; sin tamaño, barre. */
export function BarraDeCarga(props: { hecho: number; total: number | null }) {
  const conTotal = () => (props.total ?? 0) > 0;
  return (
    <span class="absolute inset-x-0 bottom-0 h-[3px] overflow-hidden bg-primary/15" aria-hidden="true">
      <Show when={conTotal()} fallback={<span class="block h-full w-1/3 animate-barrido bg-primary" />}>
        <span
          class="block h-full bg-primary transition-[width] duration-150"
          style={{ width: `${Math.min(100, (props.hecho / props.total!) * 100)}%` }}
        />
      </Show>
    </span>
  );
}

/** El peso de lo que se va a instalar, junto a su botón, cuando se sabe. */
export function Peso(props: { bytes: number | null | undefined }) {
  return (
    <Show when={(props.bytes ?? 0) > 0}>
      <span class="text-[11px] whitespace-nowrap text-neutral-500 tabular-nums">{mb(props.bytes!)}</span>
    </Show>
  );
}

/** El código que el navegador pide confirmar: grande, legible y con un botón para copiarlo. */
export function CodigoParaConfirmar(props: { codigo: string }) {
  const [copiado, setCopiado] = createSignal(false);
  const copiar = () =>
    void copyText(props.codigo)
      .then(() => {
        setCopiado(true);
        setTimeout(() => setCopiado(false), 1400);
      })
      .catch(() => {});
  return (
    <>
      <strong class="select-all rounded-sm bg-surface-muted px-2 py-0.5 font-mono text-base font-semibold tracking-[0.08em] text-neutral-950">
        {props.codigo}
      </strong>
      <button
        type="button"
        class="grid size-[22px] shrink-0 cursor-pointer place-items-center rounded-full border border-border bg-surface-raised p-0 text-neutral-500 hover:text-neutral-950"
        aria-label={copiado() ? t("onboarding.code.copied") : t("onboarding.code.copy")}
        title={copiado() ? t("onboarding.code.copied") : t("onboarding.code.copy")}
        onClick={copiar}
      >
        <Show when={copiado()} fallback={<Copy size={12} aria-hidden="true" />}>
          <Check size={12} aria-hidden="true" />
        </Show>
      </button>
    </>
  );
}
