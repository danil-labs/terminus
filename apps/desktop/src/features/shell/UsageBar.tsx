import { listen } from "../../lib/serviceEvents";
import Bug from "lucide-solid/icons/bug";
import ChartNoAxesCombined from "lucide-solid/icons/chart-no-axes-combined";
import { createSignal, onCleanup, Show } from "solid-js";
import { t } from "../../lib/i18n";
import { invoke } from "../../lib/invoke.ts";
import { sharedLazy } from "../../lib/sharedLazy";
import {
  ITEM_DE_MENU,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../ui/Popover";
import KeepAwake from "./KeepAwake";
import PuertosAbiertos from "./OpenPorts";
import BotonDeTema from "./ThemeButton";
import PieVersion from "./VersionFooter";

const Almacenamiento = sharedLazy(() => import("./Storage"));

// El consumo vive en las herramientas de cada ventana (`UsageTool`); el pie queda para la app.

type AgentsViewStatus = { installed: boolean; enabled: boolean };

const BUG_REPORT_URL = "https://github.com/danil-labs/terminus/issues/new?template=bug_report.yml";

export default function UsageBar(props: {
  busy: boolean;
  onAbrirSitio: (url: string, project: string, session: string) => void;
  onObservability: () => void;
  onReportarBug: () => void;
  /** Para el panel de archivos: tareas con turno vivo y con pestaña. */
  trabajando: string[];
  conPestana: string[];
  onAbrirTarea: (project: string, session: string) => void;
}) {
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

  return (
    // La versión identifica el build incluso sin cuentas conectadas.
    <footer class="flex h-7 min-w-0 shrink-0 items-center gap-2 glass-panel border-t border-border px-2 text-xs">
      <div class="ml-auto flex min-w-0 shrink-0 items-center gap-1">
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
