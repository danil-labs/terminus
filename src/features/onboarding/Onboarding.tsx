import { Match, Show, Switch } from "solid-js";
import { t } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import {
  createFullscreen,
  HEADER_HEIGHT,
  isWindows,
  needsTrafficLightPadding,
  TRAFFIC_LIGHT_PADDING,
  toggleMaximizeFromHeader,
} from "../../lib/window";
import ControlesDeVentana from "../shell/WindowControls";
import { crearAlta, crearWorkspace } from "./onboarding-store";
import { Fases } from "./Phases";
import { SaltarAlta } from "./Screen";
import Cuentas from "./steps/Accounts";
import Proveedores from "./steps/Agents";
import Contexto from "./steps/Context";
import Repositorios from "./steps/Sources";
import CarpetaDeTrabajo from "./steps/WorkFolder";
import Espacio from "./steps/Workspace";

/**
 * El alta, en el orden de la propuesta de `design/onboarding-review`: proveedores
 * (globales), workspace, sus cuentas, sus repositorios, el contexto principal y la
 * primera carpeta de trabajo. La preparación la hace `Setup.tsx` antes de montar
 * la app. Agregar otro workspace empieza en el paso 3.
 */
export default function Onboarding(props: {
  nuevo?: boolean;
  onListo: () => void;
  onCancelar?: () => void;
}) {
  const alta = crearAlta(Boolean(props.nuevo));
  const apartarSemaforo = needsTrafficLightPadding(() => true, createFullscreen());

  // Sin workspace la app no tiene dónde guardar nada: saltar antes del paso 3 crea uno por omisión.
  async function configurarAMano() {
    if (!alta.estado.workspace) await crearWorkspace(t("onboarding.manual.default_name"));
    props.onListo();
  }

  return (
    <div class="flex min-h-0 flex-1 flex-col overflow-hidden bg-bg">
      <header
        class={cn(
          "flex shrink-0 items-center gap-5 border-b border-border px-7 text-xs",
          HEADER_HEIGHT,
          apartarSemaforo() && TRAFFIC_LIGHT_PADDING,
        )}
        data-tauri-drag-region=""
        onDblClick={toggleMaximizeFromHeader}
      >
        <Fases actual={alta.estado.paso === "agents" ? 1 : 2} />
        <span class="flex-1 self-stretch" data-tauri-drag-region="" />
        <Show when={isWindows()}>
          <ControlesDeVentana />
        </Show>
      </header>

      <SaltarAlta.Provider value={props.nuevo ? undefined : configurarAMano}>
      <Switch>
        <Match when={alta.estado.paso === "agents"}>
          <Proveedores alta={alta} />
        </Match>
        <Match when={alta.estado.paso === "workspace"}>
          <Espacio alta={alta} nueva={Boolean(props.nuevo)} onCancelar={props.onCancelar} />
        </Match>
        <Match when={alta.estado.paso === "accounts"}>
          <Cuentas alta={alta} nueva={Boolean(props.nuevo)} />
        </Match>
        <Match when={alta.estado.paso === "sources"}>
          <Repositorios alta={alta} />
        </Match>
        <Match when={alta.estado.paso === "context"}>
          <Contexto alta={alta} />
        </Match>
        <Match when={alta.estado.paso === "workdir"}>
          <CarpetaDeTrabajo alta={alta} onListo={props.onListo} />
        </Match>
      </Switch>
      </SaltarAlta.Provider>
    </div>
  );
}
