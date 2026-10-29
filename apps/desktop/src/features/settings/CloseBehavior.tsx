import { t } from "../../lib/i18n";
import { SettingsRow } from "./layout";

export function CloseBehavior() {
  return (
    <SettingsRow
      data-setting="close-behavior"
      label={t("settings.general.close.title")}
      description={t("settings.general.close.hint")}
    />
  );
}
