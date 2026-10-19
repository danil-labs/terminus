import { listen } from "@tauri-apps/api/event";
import Bug from "lucide-solid/icons/bug";
import ChartNoAxesCombined from "lucide-solid/icons/chart-no-axes-combined";
import RefreshCw from "lucide-solid/icons/refresh-cw";
import AlertTriangle from "lucide-solid/icons/triangle-alert";
import { createEffect, createSignal, For, Match, on, onCleanup, Show, Switch } from "solid-js";
import { t } from "../../lib/i18n";
import { invoke } from "../../lib/invoke.ts";
import {
  cuandoVuelve,
  faltaCorto,
  haceCuanto,
  left,
  legible,
  type Query,
  type Read,
  tono,
  type Window,
} from "../../lib/limits";
import { enLaFranja, rotuloDeAlcance, type StripStage, stripStage } from "../../lib/limitsBar";
import { cn } from "../../lib/utils";
import { escala } from "../../lib/zoom";
import { Button } from "../../ui/Button";
import { detalleDe } from "../../ui/Failure";
import { MarcaAgente } from "../../ui/icons";
import {
  ITEM_DE_MENU,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "../../ui/Popover";
import { ProgressBar } from "../../ui/ProgressBar";
import AccountCard from "../settings/AccountCard";
import type { Account, AccountList, AccountStatus } from "../settings/accounts-store";
import KeepAwake from "./KeepAwake";
import PuertosAbiertos from "./OpenPorts";
import Almacenamiento from "./Storage";
import BotonDeTema from "./ThemeButton";
import PieVersion from "./VersionFooter";

// Consumo de las cuentas activas; las lecturas fallidas conservan el último dato marcado como antiguo.
// El refresco automático debe respetar el caché y evitar cuentas sin consumo disponible.

type AgentOpt = {
  id: string;
  label: string;
  limits: boolean;
};

type AgentsViewStatus = { installed: boolean; enabled: boolean };

type AccountsByAgent = {
  agent: string;
  label: string;
  active: string | null;
  accounts: Account[];
};

const key = (agent: string, id: string) => `${agent}\u0000${id}`;

// Forzar una consulta por cada turno corto puede agotar el límite del proveedor.
const AUTO_REFRESH_MIN_MS = 60_000;

// El reloj consulta el caché; forzarlo cada cinco minutos provoca límites del proveedor.
const REFRESH_INTERVAL_MS = 5 * 60_000;

const BUG_REPORT_URL = "https://github.com/danil-labs/terminus/issues/new?template=bug_report.yml";

const REFRESH_REM = 1.75;

function windowParts(agent: string, w: Window) {
  const name = rotuloDeAlcance(agent, w);
  const showReset = !name || (agent === "opencode-zen" && name === "Go");
  return {
    remaining: left(w),
    name: name,
    resetIn: showReset ? faltaCorto(w.resets_at) || null : null,
  };
}

function windowLabelLength(agent: string, w: Window): number {
  const p = windowParts(agent, w);
  return (
    `${p.remaining}%`.length +
    (p.name ? p.name.length + 1 : 0) +
    (p.resetIn ? p.resetIn.length + 1 : 0)
  );
}

function queryNotice(q: Query | undefined): string {
  if (!q) return "—";
  if (q.mode === "no_account") return t("usage.not_connected");
  if (q.mode === "in_use") return t("usage.in_use");
  if (q.mode === "revoked") return t("usage.reconnect_needed");
  if (q.mode !== "read") return t("usage.read_failed");
  return "";
}

export default function UsageBar(props: {
  agents: AgentOpt[];
  agent: string;
  busy: boolean;
  // Conectar una cuenta desde Configuración debe invalidar la lista visible.
  reload: number;
  onGestionarCuentas: () => void;
  onAbrirSitio: (url: string, project: string, session: string) => void;
  onObservability: () => void;
  onReportarBug: () => void;
  /** Para el panel de archivos: tareas con turno vivo y con pestaña. */
  trabajando: string[];
  conPestana: string[];
  onAbrirTarea: (project: string, session: string) => void;
}) {
  const [accountsByAgent, setAccountsByAgent] = createSignal<AccountsByAgent[]>([]);
  const [reads, setReads] = createSignal<Record<string, Query>>({});
  // Un fallo de lectura no invalida la última lectura buena.
  const [lastGoodReads, setLastGoodReads] = createSignal<Record<string, Read>>({});
  const [statuses, setStatuses] = createSignal<Record<string, AccountStatus>>({});
  const [inProgress, setInProgress] = createSignal<Record<string, boolean>>({});
  const [open, setOpen] = createSignal(false);
  const [observability, setObservability] = createSignal(false);

  let observabilityRequest = 0;
  const refreshObservability = () => {
    const request = ++observabilityRequest;
    setObservability(false);
    void invoke<AgentsViewStatus>("agentsview_status")
      .then((status) => {
        if (request === observabilityRequest) setObservability(status.installed && status.enabled);
      })
      .catch(() => {});
  };
  refreshObservability();
  window.addEventListener("harness:workspace", refreshObservability);
  const agentsview = listen<boolean>("agentsview-changed", refreshObservability);
  onCleanup(() => {
    observabilityRequest++;
    window.removeEventListener("harness:workspace", refreshObservability);
    void agentsview.then((unlisten) => unlisten());
  });

  const lastForcedRefresh: Record<string, number> = {};
  let running = props.busy;

  const accountLabel = (id: string) =>
    props.agents.find((a) => a.id === id)?.label ?? id;

  async function queryAccount(agent: string, id: string, force: boolean) {
    const k = key(agent, id);
    setInProgress((p) => ({ ...p, [k]: true }));
    try {
      const r = await invoke<Query>("account_limits", {
        agent,
        id,
        // force es el nombre del parámetro del puente; otro nombre no forzaría la consulta.
        force: force,
      });
      setReads((p) => ({ ...p, [k]: r }));
      const lastGood = legible(r);
      if (lastGood) setLastGoodReads((p) => ({ ...p, [k]: lastGood }));
    } catch (e) {
      // Un fallo del comando no significa consumo cero.
      setReads((p) => ({
        ...p,
        [k]: {
          mode: "failed",
          what: t("usage.query.failed", { agent: accountLabel(agent) }),
          detail: detalleDe(e),
        },
      }));
    } finally {
      setInProgress((p) => ({ ...p, [k]: false }));
    }
  }

  // Consultar las cuentas a la vez puede hacer que el proveedor limite todas las solicitudes.
  async function querySequentially(pairs: [string, string][], force: boolean) {
    for (const [a, id] of pairs) {
      if (force) lastForcedRefresh[key(a, id)] = Date.now();
      await queryAccount(a, id, force);
    }
  }

  // Solo los agentes con consumo publicado tienen un dato que consultar.
  const agentIds = () =>
    props.agents
      .filter((a) => a.limits)
      .map((a) => a.id)
      .join(",");

  createEffect(
    on([agentIds, () => props.reload], ([ids]) => {
      if (!ids) return;
      let alive = true;
      onCleanup(() => {
        alive = false;
      });
      void (async () => {
        const rowCount = await Promise.all(
          ids.split(",").map(async (id): Promise<AccountsByAgent | null> => {
            try {
              const l = await invoke<AccountList>("list_accounts", { agent: id });
              return {
                agent: id,
                label: accountLabel(id),
                active: l.active,
                accounts: l.accounts,
              };
            } catch {
              return null;
            }
          }),
        );
        if (alive) setAccountsByAgent(rowCount.filter((f): f is AccountsByAgent => f !== null));
      })();
    }),
  );

  const activeAccounts = (): [string, string][] =>
    accountsByAgent()
      .filter((p) => p.active)
      .map((p) => [p.agent, p.active as string]);

  const activeCards = () =>
    accountsByAgent().flatMap((p) => {
      const account = p.accounts.find((c) => c.id === p.active);
      return account ? [{ ...p, cuenta: account }] : [];
    });

  createEffect(
    on(activeAccounts, (list) => {
      const pending = list.filter(
        ([a, id]) => !(key(a, id) in reads()),
      );
      if (pending.length) void querySequentially(pending, false);
    }),
  );

  // detail cubre el intervalo entre descubrir el correo y releer meta.json.
  createEffect(
    on(activeCards, (cards) => {
      let alive = true;
      onCleanup(() => {
        alive = false;
      });
      void Promise.all(
        cards.map(async (p) => {
          try {
            const status = await invoke<AccountStatus>("account_status", {
              agent: p.agent,
              id: p.cuenta.id,
            });
            if (!alive) return;
            setStatuses((previous) => ({
              ...previous,
              [key(p.agent, p.cuenta.id)]: status,
            }));
          } catch {
          }
        }),
      );
    }),
  );

  createEffect(
    on(
      () => props.busy,
      (busy) => {
        const justFinished = running && !busy;
        running = busy;
        if (!justFinished) return;
        const id = accountsByAgent().find((p) => p.agent === props.agent)?.active;
        if (!id) return;
        // Claude publica el consumo durante el turno; forzar aquí gastaría una consulta sin dato nuevo.
        if (props.agent === "claude") {
          void querySequentially([[props.agent, id]], false);
          return;
        }
        const from = lastForcedRefresh[key(props.agent, id)] ?? 0;
        if (Date.now() - from < AUTO_REFRESH_MIN_MS) return;
        void querySequentially([[props.agent, id]], true);
      },
    ),
  );

  // El temporizador debe consultar busy y la lista al dispararse para no usar estado antiguo.
  createEffect(
    on(
      () => activeAccounts().length,
      (accountCount) => {
        if (!accountCount) return;
        // Un temporizador llamado t ocultaría la función del catálogo.
        const timer = setInterval(() => {
          if (document.visibilityState !== "visible") return;
          if (props.busy) return;
          void querySequentially(activeAccounts(), false);
        }, REFRESH_INTERVAL_MS);
        onCleanup(() => clearInterval(timer));
      },
    ),
  );

  const updating = () => activeAccounts().some(([a, id]) => inProgress()[key(a, id)]);

  // La medida debe salir del espacio restante, sin depender del contenido que intenta caber.
  let area: HTMLDivElement | undefined;
  const [availableRem, setAvailableRem] = createSignal(Number.POSITIVE_INFINITY);
  const measureSpace = () => {
    const width = area?.clientWidth ?? 0;
    if (!width) return;
    const root = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    setAvailableRem(width / root - REFRESH_REM);
  };
  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measureSpace);
  onCleanup(() => observer?.disconnect());
  const mountArea = (element: HTMLDivElement) => {
    area = element;
    observer?.observe(element);
    queueMicrotask(measureSpace);
  };
  // Cambiar la escala modifica el rem sin cambiar los píxeles; ResizeObserver no lo detecta.
  createEffect(on(escala, measureSpace, { defer: true }));

  const labelLengths = (): number[][] =>
    activeAccounts().map(([a, id]) => {
      const k = key(a, id);
      const q = reads()[k];
      const hasRead = q?.mode === "read" ? q : lastGoodReads()[k];
      if (!hasRead) return [queryNotice(q).length];
      const windows = enLaFranja(hasRead.windows, a).map((w) => windowLabelLength(a, w));
      return windows.length ? windows : [1];
    });

  const stage = (): StripStage => stripStage(availableRem(), labelLengths(), t("usage.legend").length);

  const scroll = (e: WheelEvent) => {
    const strip = e.currentTarget as HTMLElement;
    const limit = strip.scrollWidth - strip.clientWidth;
    if (limit <= 0 || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    const before = strip.scrollLeft;
    strip.scrollLeft = Math.min(limit, Math.max(0, before + e.deltaY));
    if (strip.scrollLeft !== before) e.preventDefault();
  };

  return (
    // La versión identifica el build incluso sin cuentas conectadas.
    <footer class="flex h-7 min-w-0 shrink-0 items-center gap-2 border-t border-border bg-surface px-2 text-xs">
      <Show when={activeAccounts().length > 0}>
        <div
          ref={mountArea}
          class="flex min-w-0 flex-1 items-center gap-2"
        >
        <Popover
          open={open()}
          onOpenChange={setOpen}
          placement="top-start"
          gutter={6}
        >
          <PopoverTrigger
            as={(p: object) => (
              <button
                {...p}
                class={cn(
                  "flex min-w-0 shrink items-center rounded-sm px-1.5 py-0.5 text-left outline-none transition-colors hover:bg-surface-muted focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary data-[expanded]:bg-surface-muted",
                  stage() === "compact" ? "gap-0" : "gap-3",
                )}
                aria-label={t("usage.bar.aria")}
              >
                {/* Anclar al disparador completo puede separar el panel de la leyenda que lo abre. */}
                <PopoverAnchor as="span" class="shrink-0 text-neutral-500">
                  <Show when={stage() !== "compact"}>{t("usage.legend")}</Show>
                </PopoverAnchor>
                {/* La barra de scroll no cabe en el alto de la franja. */}
                <span
                  onWheel={scroll}
                  class="flex min-w-0 shrink items-center gap-4 overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                >
                  <For each={activeAccounts()}>
                    {([a, id]) => (
                      <UsageSummary
                        agent={a}
                        agentLabel={accountsByAgent().find((x) => x.agent === a)?.label ?? a}
                        query={reads()[key(a, id)]}
                        lastGood={lastGoodReads()[key(a, id)]}
                        loading={inProgress()[key(a, id)]}
                        stage={stage()}
                      />
                    )}
                  </For>
                </span>
              </button>
            )}
          />

          <PopoverContent
            // Un alto fijo puede recortar cuentas aunque haya espacio disponible en la ventana.
            class="flex max-h-[var(--kb-popper-content-available-height)] w-[380px] flex-col p-0"
            // Enfocar el primer control al abrir movería el foco a Gestionar cuentas al consultar consumo.
            onOpenAutoFocus={(e: Event) => e.preventDefault()}
          >
            {/* Sin min-h-0 el hijo flex no encoge y el pie puede quedar fuera del panel. */}
            <div class="min-h-0 flex-1 overflow-y-auto">
              <For each={activeCards()}>
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
                        status={statuses()[key(p.agent, p.cuenta.id)]}
                        limits={reads()[key(p.agent, p.cuenta.id)]}
                        lastGood={lastGoodReads()[key(p.agent, p.cuenta.id)]}
                        loadingLimits={inProgress()[key(p.agent, p.cuenta.id)]}
                        refreshingLimits={inProgress()[key(p.agent, p.cuenta.id)]}
                        onRefreshLimits={() =>
                          void querySequentially([[p.agent, p.cuenta.id]], true)
                        }
                      />
                    </ul>
                  </section>
                )}
              </For>
            </div>

            {/* Cada cuenta tiene su fecha de consulta; una fecha común atribuiría frescura incorrecta. */}
            <div class="flex shrink-0 items-center justify-end border-t border-border px-3 py-2">
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

        {/* Actualizar queda fuera del disparador para no abrir el popover al refrescar. Solo PieVersion debe crecer: estirar el consumo separaría su botón de refresco. */}
        <button
          class="flex size-5 shrink-0 items-center justify-center rounded-sm text-neutral-500 outline-none hover:bg-surface-muted hover:text-neutral-950 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:opacity-60"
          disabled={updating()}
          aria-label={t("usage.refresh")}
          onClick={() => void querySequentially(activeAccounts(), true)}
        >
          <RefreshCw size={12} class={cn(updating() && "animate-spin")} />
        </button>
        </div>
      </Show>

      {/* El grupo de controles debe ceder ancho junto con la versión para no tapar los consumos. */}
      <div class="ml-auto flex min-w-0 max-w-[60%] shrink-0 items-center gap-1">
        <Show when={observability()}>
          <button
            class="flex size-5 shrink-0 items-center justify-center rounded-sm text-neutral-500 outline-none hover:bg-surface-muted hover:text-neutral-950 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
            aria-label={t("observability.tab")}
            title={t("observability.tab")}
            onClick={props.onObservability}
          >
            <ChartNoAxesCombined size={13} />
          </button>
        </Show>
        <Popover placement="top-start" gutter={6}>
          <PopoverTrigger
            as={(p: object) => (
              <button
                {...p}
                type="button"
                class="grid size-5 shrink-0 place-items-center rounded-sm text-error-strong outline-none hover:bg-surface-muted focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                aria-label={t("usage.bug_report")}
                title={t("usage.bug_report")}
              >
                <Bug size={13} />
              </button>
            )}
          />
          <PopoverContent class="w-max min-w-0 p-1">
            <div class="flex flex-col">
              <button
                type="button"
                class={ITEM_DE_MENU}
                onClick={props.onReportarBug}
              >
                {t("usage.bug_report.ask_agent")}
              </button>
              <button
                type="button"
                class={ITEM_DE_MENU}
                onClick={() =>
                  void invoke("site_open_external", { url: BUG_REPORT_URL }).catch(() => {})
                }
              >
                {t("usage.bug_report.open_web")}
              </button>
            </div>
          </PopoverContent>
        </Popover>
        <Almacenamiento
          trabajando={props.trabajando}
          conPestana={props.conPestana}
          onAbrirTarea={props.onAbrirTarea}
        />
        <PuertosAbiertos busy={props.busy} onAbrirSitio={props.onAbrirSitio} />
        <KeepAwake />
        <BotonDeTema />
        <PieVersion />
      </div>
    </footer>
  );
}

function UsageSummary(props: {
  agent: string;
  agentLabel: string;
  query?: Query;
  lastGood?: Read;
  loading?: boolean;
  stage: StripStage;
}) {
  const noAccount = () =>
    props.query?.mode === "no_account" ? props.query : null;
  const inUse = () => props.query?.mode === "in_use";
  // Una espera con lectura anterior conserva el dato; un límite de consultas no lo invalida.
  const read = () => legible(props.query) ?? null;
  const failed = () =>
    !read() &&
    (props.query?.mode === "failed" || props.query?.mode === "revoked" || props.query?.mode === "waiting")
      ? props.query
      : null;

  return (
    <span class="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
      <span
        class="flex size-4 shrink-0 items-center justify-center"
        title={props.agentLabel}
      >
        <MarcaAgente id={props.agent} size={14} />
      </span>

      <Switch>
        <Match when={!props.query}>
          <span class="flex items-center text-neutral-500">
            <Show when={props.loading} fallback={<span>—</span>}>
              <RefreshCw size={11} class="animate-spin" aria-label={t("usage.asking")} />
            </Show>
          </span>
        </Match>

        <Match when={noAccount()}>
          {(q) => (
            <span class="text-neutral-500" title={q().what}>
              {props.agent === "opencode-zen" ? t("usage.go_key_required") : t("usage.not_connected")}
            </span>
          )}
        </Match>

        <Match when={inUse()}>
          <span class="text-neutral-500">{t("usage.in_use")}</span>
        </Match>

        <Match when={failed()}>
          {(q) => {
            // Un dato antiguo conserva información; un fallo no autoriza a reemplazarlo por cero.
            const detail = () => {
              const value = q();
              return value.mode === "waiting"
                ? `${t("settings.account_card.retry_wait", { count: Math.max(0, Math.ceil((value.retry_at - Date.now()) / 60_000)) })} ${value.detail}`
                : `${value.what} ${value.detail}`;
            };
            // Una credencial vencida requiere reconectar; resumirla como fallo de lectura ocultaría la acción.
            const summary = () =>
              q().mode === "revoked"
                ? t("usage.reconnect_needed")
                : t("usage.read_failed");

            return (
              <Show
                when={props.lastGood}
                fallback={
                  <span
                    class="flex items-center gap-1 text-warning-strong"
                    title={detail()}
                  >
                    <AlertTriangle size={11} aria-hidden />
                    {summary()}
                  </span>
                }
              >
                {(hasRead) => (
                  <span
                    class="flex items-center gap-1.5"
                    title={t("usage.stale_title", {
                      detail: detail(),
                      when: haceCuanto(hasRead().fetched_at),
                    })}
                  >
                    <AlertTriangle
                      size={11}
                      class="shrink-0 text-warning-strong"
                      aria-hidden
                    />
                    <span class="flex items-center gap-1.5 opacity-60">
                      <UsageWindow
                        query={hasRead()}
                        agent={props.agent}
                        agentLabel={props.agentLabel}
                        stage={props.stage}
                      />
                    </span>
                  </span>
                )}
              </Show>
            );
          }}
        </Match>

        <Match when={read()}>
          {(q) => (
            <UsageWindow
              query={q()}
              agent={props.agent}
              agentLabel={props.agentLabel}
              stage={props.stage}
            />
          )}
        </Match>
      </Switch>
    </span>
  );
}

function UsageWindow(props: { query: Read; agent: string; agentLabel: string; stage: StripStage }) {
  const windows = () => enLaFranja(props.query.windows, props.agent);

  return (
    <Show
      when={windows().length}
      fallback={<span class="text-neutral-500">—</span>}
    >
      <For each={windows()}>
        {(w, i) => {
          const p = () => windowParts(props.agent, w);
          const remaining = () => p().remaining;
          return (
            <>
              <Show when={i() > 0}>
                <span class="shrink-0 px-0.5 text-neutral-500" aria-hidden>
                  ·
                </span>
              </Show>
              <Show when={i() === 0 && props.stage === "full"}>
                {/* El medidor muestra lo disponible; invertir used_pct lo haría contradecir al porcentaje. */}
                <ProgressBar
                  class="h-1 w-9 shrink-0"
                  value={remaining()}
                  max={100}
                  barClass={tono(remaining())}
                  label={t("usage.window_label", {
                    agent: props.agentLabel,
                    left: remaining(),
                    window: w.label,
                  })}
                />
              </Show>
              <span
                class="shrink-0 whitespace-nowrap text-neutral-500"
                title={`${w.label} · ${cuandoVuelve(w.resets_at, w.used_pct)}`}
              >
                <span class="font-mono tabular-nums text-neutral-950">
                  {remaining()}%
                </span>
                <Show when={p().name}>
                  {(n) => <span> {n()}</span>}
                </Show>
                <Show when={p().resetIn}>
                  {(f) => (
                    <span class="font-mono"> {f()}</span>
                  )}
                </Show>
              </span>
            </>
          );
        }}
      </For>
    </Show>
  );
}
