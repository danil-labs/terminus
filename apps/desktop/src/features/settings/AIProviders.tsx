import { createMemo, Index, Show } from "solid-js";
import { t } from "../../lib/i18n";
import { prosa } from "../../lib/prose";
import type { Superficie } from "../../lib/surfaces";
import { rotuloDeSuperficie } from "../../lib/surfaces";
import { Badge } from "../../ui/Badge";
import { rotuloDeMarca } from "../chat/marks";
import Accounts from "./Accounts";
import { GovernedNotice } from "./Governed";
import { SettingsPanel } from "./layout";

/**
 * Las superficies del mismo agente comparten sección. Cada una conserva su
 * cuenta o consentimiento y su estado dentro de esa sección.
 */
export default function AIProviders(props: { superficies: Superficie[]; agentesEnUso: string[] }) {
  const grupos = createMemo(() => {
    const vistos = new Map<string, Superficie[]>();
    for (const superficie of props.superficies) {
      const grupo = vistos.get(superficie.agent);
      if (grupo) grupo.push(superficie);
      else vistos.set(superficie.agent, [superficie]);
    }
    return [...vistos.values()];
  });

  const nombreDe = (superficie: Superficie, enGrupo: boolean) => {
    if (!enGrupo) return undefined;
    return superficie.agent === "opencode-zen" && superficie.catalogo === "de_pago"
      ? t("settings.ai_providers.zen_go")
      : rotuloDeSuperficie(superficie);
  };

  return (
    <SettingsPanel>
      <GovernedNotice section="models" />
      {/* `list_surfaces` devuelve objetos nuevos en cada refresco. `Index`
          conserva el login en curso por posición; el orden
          estable lo fijan `agents::AGENTS` y `surfaces::declaradas`. */}
      <Index each={grupos()}>
        {(grupo) => (
          <Accounts
            agente={grupo()[0].agent}
            soloGratuitos={grupo()[0].catalogo === "gratuitos"}
            titulo={grupo().length > 1 ? grupo()[0].label : rotuloDeSuperficie(grupo()[0])}
            nombre={nombreDe(grupo()[0], grupo().length > 1)}
            marca={<Marca superficie={grupo()[0]} />}
            desplegado={props.agentesEnUso.includes(grupo()[0].agent)}
          >
            <Index each={grupo().slice(1)}>
              {(superficie) => (
                <Accounts
                  agente={superficie().agent}
                  soloGratuitos={superficie().catalogo === "gratuitos"}
                  nombre={nombreDe(superficie(), true)}
                  marca={<Marca superficie={superficie()} />}
                />
              )}
            </Index>
          </Accounts>
        )}
      </Index>
    </SettingsPanel>
  );
}

function Marca(props: { superficie: Superficie }) {
  return (
    <Show when={props.superficie.marca}>
      {(marca) => (
        <Badge
          forma="dato"
          class="shrink-0"
          title={((p) => (p ? prosa(p) : undefined))(props.superficie.porque)}
        >
          {rotuloDeMarca(marca())}
        </Badge>
      )}
    </Show>
  );
}
