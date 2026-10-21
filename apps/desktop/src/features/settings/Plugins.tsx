// Dos clases de plugin en una pestaña, con mecanismos que no se tocan: los
// binarios opcionales de `Integrations` y los paquetes de lengua de
// `LanguagePacks`. El modelo de plugins está en `plugins/README.md`.
import Integrations from "./Integrations";
import { PaquetesDeLengua } from "./LanguagePacks";
import { SettingsPanel } from "./layout";
export default function Plugins() {
  return (
    <SettingsPanel>
      <Integrations />
      <PaquetesDeLengua />
    </SettingsPanel>
  );
}
