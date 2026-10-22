import { t } from "../../lib/i18n";
import { Integraciones, Plugins } from "../onboarding/ToolCards";
import { SettingsPanel, SettingsSection } from "./layout";

/** The same cards as the onboarding, so tools can be connected and plugins installed after it. */
export default function ToolCatalog() {
  return (
    <SettingsPanel>
      <SettingsSection title={t("onboarding.tools.title")} description={t("onboarding.tools.lede")}>
        <div class="mt-3">
          <Integraciones onCambio={() => {}} />
        </div>
      </SettingsSection>
      <SettingsSection title={t("onboarding.plugins.title")} description={t("onboarding.plugins.lede")}>
        <div class="mt-3">
          <Plugins onCambio={() => {}} />
        </div>
      </SettingsSection>
    </SettingsPanel>
  );
}
