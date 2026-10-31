/**
 * «Activa Terminus»: lo que ve quien entra sin licencia (`license_required`).
 * El pago vive solo en la web de Danil; el escritorio abre esa página en el navegador.
 */
import "../../locales/danilPhrases";
import { t } from "../../lib/i18n";
import { invoke } from "../../lib/invoke";
import { Button } from "../../ui/Button";

/** Mismo origen que la web de Terminus (`/terminus/`): se navega con ruta. */
export const BILLING_PATH = "/modules/billing?modulo=terminus";
export const BILLING_URL = `https://app.danil.ai${BILLING_PATH}`;

/** El código con que el plano de control (o el motor) dice que la cuenta no tiene Terminus. */
export const LICENSE_REQUIRED = "license_required";

/** En la web, carga completa: la página de cobro es otra app del mismo origen. */
export const startTrialInPage = () => window.location.assign(BILLING_PATH);

/** En el escritorio, el navegador de la persona. */
export const startTrialInBrowser = () => void invoke("open_external", { target: BILLING_URL }).catch(() => {});

export function TerminusLicense(props: { onStart: () => void; onRetry: () => void; busy?: boolean; compact?: boolean }) {
  return (
    <div class="grid max-w-[60ch] gap-2" data-terminus-license="">
      <strong class={props.compact ? "text-ui font-semibold text-neutral-950" : "text-base font-semibold text-neutral-950"}>
        {t("danil.license.title")}
      </strong>
      <p class={props.compact ? "m-0 text-xs text-neutral-500" : "m-0 text-sm text-neutral-500"}>{t("danil.license.body")}</p>
      <div class="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => props.onStart()} data-license-start="">
          {t("danil.license.start")}
        </Button>
        <Button size="sm" variant="ghost" disabled={props.busy} onClick={() => props.onRetry()} data-license-retry="">
          {t("danil.license.retry")}
        </Button>
      </div>
    </div>
  );
}
