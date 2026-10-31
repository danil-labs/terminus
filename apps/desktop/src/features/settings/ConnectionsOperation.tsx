import { Show, Suspense } from "solid-js";
import { t } from "../../lib/i18n";
import { capabilities } from "../../lib/platform";
import Connections from "./Connections";
import Integrations from "./Integrations";
import { PaquetesDeLengua } from "./LanguagePacks";
import { SettingsPanel, SettingsSection } from "./layout";
import ProveedorDeMemoria from "./MemoryProvider";
import Radiant from "./Radiant";
import Herramientas from "./Tools";

/** Conexiones › Operación y código: lo que usan los agentes que trabajan en tus proyectos. */
export default function ConnectionsOperation(props: { workspace: string | null }) {
  return (
    <SettingsPanel>
      <SettingsSection title={t("settings.skills.tab_mcp")} description={t("settings.connections.mcp_hint")}>
        <div class="grid min-w-0 gap-5 pt-2">
          <Herramientas />
          <ProveedorDeMemoria />
        </div>
      </SettingsSection>
      <Integrations />
      <PaquetesDeLengua />
      <Show when={capabilities().danilAccount || capabilities().accountProfile}>
        <Suspense fallback={null}>
          <Connections workspace={props.workspace} />
        </Suspense>
      </Show>
      <Show when={capabilities().radiant}>
        <Radiant />
      </Show>
    </SettingsPanel>
  );
}
