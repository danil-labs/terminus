import { t } from "../../lib/i18n";
import { createPref } from "../../lib/prefs";
import { Select } from "../../ui/Select";
import { CLOSE_PREF, type CloseChoice } from "../shell/CloseGuard";
import { SettingsRow } from "./layout";

/** Lo mismo que «Recordar mi elección» del diálogo al cerrar, y donde se deshace. */
export function CloseBehavior() {
  const [choice, setChoice] = createPref<CloseChoice>(CLOSE_PREF, "ask");
  return (
    <SettingsRow
      data-setting="close-behavior"
      label={t("settings.general.close.title")}
      description={t("settings.general.close.hint")}
    >
      <Select
        variant="ghost"
        class="min-h-8 w-auto px-1.5 text-sm focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-primary"
        aria-label={t("settings.general.close.title")}
        value={choice()}
        onChange={(e) => setChoice(e.currentTarget.value as CloseChoice)}
      >
        <option value="ask">{t("settings.general.close.ask")}</option>
        <option value="background">{t("settings.general.close.background")}</option>
        <option value="stop">{t("settings.general.close.stop")}</option>
      </Select>
    </SettingsRow>
  );
}
