import RefreshCw from "lucide-solid/icons/refresh-cw";
import AlertTriangle from "lucide-solid/icons/triangle-alert";
import { createSignal, For, onCleanup, Show } from "solid-js";
import { t } from "../../lib/i18n";
import { left, legible, tono } from "../../lib/limits";
import { sharedLazy } from "../../lib/sharedLazy";
import { cn } from "../../lib/utils";
import { Button } from "../../ui/Button";
import { MarcaAgente } from "../../ui/icons";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/Popover";
import { ProgressBar } from "../../ui/ProgressBar";
import { type Usage, usageKey } from "./usage";

const AccountCard = sharedLazy(() => import("../settings/AccountCard"));

// El detalle sale al pasar el puntero; la pausa evita abrirlo al cruzar la cabecera.
const OPEN_DELAY = 250;
const CLOSE_DELAY = 150;

/** El consumo de la cuenta del agente de esta ventana; el panel enseña todas las cuentas activas. */
export default function UsageTool(props: {
  usage: Usage;
  agent: string;
  onGestionarCuentas: () => void;
}) {
  const [open, setOpen] = createSignal(false);
  let abrir: ReturnType<typeof setTimeout> | undefined;
  let cerrar: ReturnType<typeof setTimeout> | undefined;
  const entrar = () => {
    clearTimeout(cerrar);
    if (open()) return;
    clearTimeout(abrir);
    abrir = setTimeout(() => setOpen(true), OPEN_DELAY);
  };
  const salir = () => {
    clearTimeout(abrir);
    clearTimeout(cerrar);
    cerrar = setTimeout(() => setOpen(false), CLOSE_DELAY);
  };
  onCleanup(() => {
    clearTimeout(abrir);
    clearTimeout(cerrar);
  });
  const card = () => props.usage.activeCards().find((c) => c.agent === props.agent);
  const read = () => {
    const c = card();
    if (!c) return null;
    const k = usageKey(c.agent, c.cuenta.id);
    const fresh = legible(props.usage.reads()[k]);
    if (fresh) return { read: fresh, stale: false };
    const old = props.usage.lastGoodReads()[k];
    return old ? { read: old, stale: true } : null;
  };
  // La ventana más justa es la que corta primero el trabajo.
  const tightest = () => {
    const windows = read()?.read.windows ?? [];
    return windows.length ? Math.min(...windows.map(left)) : null;
  };
  const failed = () => {
    const c = card();
    if (!c || read()) return false;
    const mode = props.usage.reads()[usageKey(c.agent, c.cuenta.id)]?.mode;
    return mode === "failed" || mode === "revoked" || mode === "waiting";
  };
  const cards = () => {
    const all = props.usage.activeCards();
    return [...all.filter((c) => c.agent === props.agent), ...all.filter((c) => c.agent !== props.agent)];
  };
  const title = () => {
    const c = card();
    const value = tightest();
    return c && value !== null
      ? t("usage.tool.title", { agent: c.label, left: value })
      : t("usage.bar.aria");
  };

  return (
    <Show when={props.usage.activeCards().length > 0}>
      <Popover open={open()} onOpenChange={setOpen} placement="bottom-end" gutter={6}>
        <PopoverTrigger
          as={(p: object) => (
            <Button
              {...p}
              variant="chrome"
              size="iconCompact"
              class="size-auto h-7 shrink-0 gap-1.5 px-1.5 text-neutral-500 focus-visible:outline-none"
              aria-label={title()}
              onPointerEnter={entrar}
              onPointerLeave={salir}
            >
              <Show when={card()}>
                {(c) => (
                  <>
                    <span class="flex size-4 shrink-0 items-center justify-center text-neutral-950">
                      <MarcaAgente id={c().agent} size={13} />
                    </span>
                    <Show when={tightest() !== null}>
                      {/* Sin número: el porcentaje y cuándo vuelve van en el detalle. */}
                      <ProgressBar
                        class={cn("h-1 w-6 shrink-0 bg-neutral-200", read()?.stale && "opacity-60")}
                        value={tightest() ?? 0}
                        max={100}
                        barClass={tono(tightest() ?? 0)}
                        label={title()}
                      />
                    </Show>
                    <Show when={failed()}>
                      <AlertTriangle size={12} class="shrink-0 text-warning-strong" aria-hidden />
                    </Show>
                  </>
                )}
              </Show>
            </Button>
          )}
        />
        <PopoverContent
          // Un alto fijo puede recortar cuentas aunque haya espacio disponible en la ventana.
          class="flex max-h-[var(--kb-popper-content-available-height)] w-[380px] flex-col p-0"
          // Enfocar el primer control al abrir movería el foco a Gestionar cuentas al consultar consumo.
          onOpenAutoFocus={(e: Event) => e.preventDefault()}
          // Abierto con el puntero, devolver el foco al cerrar dejaría el botón marcado como si se llegara con el teclado.
          onCloseAutoFocus={(e: Event) => e.preventDefault()}
          onPointerEnter={entrar}
          onPointerLeave={salir}
        >
          {/* Sin min-h-0 el hijo flex no encoge y el pie puede quedar fuera del panel. */}
          <div class="min-h-0 flex-1 overflow-y-auto">
            <For each={cards()}>
              {(p) => (
                <section class="border-b border-border last:border-b-0">
                  <h3 class="m-0 flex items-center gap-1.5 px-3 pt-2.5 pb-1 text-xs font-semibold text-neutral-500">
                    <MarcaAgente id={p.agent} size={14} />
                    {p.label}
                  </h3>
                  <ul class="m-0 list-none px-3 pb-2.5 pt-1">
                    <AccountCard
                      account={p.cuenta}
                      active
                      status={props.usage.statuses()[usageKey(p.agent, p.cuenta.id)]}
                      limits={props.usage.reads()[usageKey(p.agent, p.cuenta.id)]}
                      lastGood={props.usage.lastGoodReads()[usageKey(p.agent, p.cuenta.id)]}
                      loadingLimits={props.usage.inProgress()[usageKey(p.agent, p.cuenta.id)]}
                      refreshingLimits={props.usage.inProgress()[usageKey(p.agent, p.cuenta.id)]}
                      onRefreshLimits={() => props.usage.refresh(p.agent, p.cuenta.id)}
                    />
                  </ul>
                </section>
              )}
            </For>
          </div>

          <div class="flex shrink-0 items-center justify-between gap-2 border-t border-border px-3 py-2">
            <Button
              variant="ghost"
              size="compact"
              class="gap-1.5"
              title={t("usage.refresh")}
              disabled={props.usage.updating()}
              onClick={props.usage.refreshAll}
            >
              <RefreshCw size={12} class={cn(props.usage.updating() && "animate-spin")} />
              {t("usage.refresh_all")}
            </Button>
            <Button
              variant="ghost"
              size="compact"
              class="font-semibold hover:text-neutral-950"
              onClick={() => {
                setOpen(false);
                props.onGestionarCuentas();
              }}
            >
              {t("usage.manage_accounts")}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </Show>
  );
}
