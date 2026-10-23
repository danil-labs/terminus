/**
 * «Cuenta de este workspace», dentro de su tarjeta en Workspaces: de qué cuenta
 * de Danil es, cambiarla por otra con sesión aquí o conectar otra cuenta, y con
 * quién se sincroniza. Chunk aparte. Con un motor sin sesiones por cuenta no
 * pinta nada: la cuenta única ya lo dice todo.
 */
import "../../locales/danilPhrases";
import { createEffect, createSignal, For, Show } from "solid-js";
import { t } from "../../lib/i18n";
import { Button } from "../../ui/Button";
import { Select } from "../../ui/Select";
import { createDanilAccounts } from "./danil-accounts";
import { said } from "./danil-session";
import { accountChoices, changeProblem, setWorkspaceAccount, syncLine } from "./danil-sessions";
import { LICENSE_REQUIRED, startTrialInBrowser, TerminusLicense } from "./TerminusLicense";

/** El valor del selector que no es una cuenta: abre el inicio de sesión de otra. */
const OTHER = "+other";

export default function WorkspaceAccount(props: { workspace: string; name: string }) {
  const accounts = createDanilAccounts({ workspace: () => props.workspace });
  const [saving, setSaving] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);

  const choices = () => accountChoices(accounts.sessions(), accounts.of());
  const current = () => accounts.of()?.account ?? "";
  const line = () => syncLine(accounts.of(), accounts.sessions());
  const adding = () => accounts.pending()?.status === "pending";
  const message = () => problem() ?? accounts.problem();
  let picker: HTMLSelectElement | undefined;
  // Las opciones se rehacen con cada evento de sesiones: la elegida se vuelve a poner después.
  createEffect(() => {
    choices();
    const value = current();
    if (picker) picker.value = value;
  });
  const lineText = () => {
    const l = line();
    if (l.kind === "synced") return t("danil.workspace.synced", { email: l.email });
    if (l.kind === "unlinked") return t("danil.workspace.unlinked", { email: l.email });
    return l.email ? t("danil.workspace.unsynced_account", { email: l.email }) : t("danil.workspace.unsynced");
  };
  /** Un código que el catálogo no conoce dice que no se pudo cambiar, no que falló iniciar sesión. */
  const problemText = (code: string) => {
    const text = said(code);
    return code === "failed" || text === t("danil.account.failed") ? t("danil.workspace.failed") : text;
  };

  async function choose(value: string, select: HTMLSelectElement) {
    if (value === OTHER) {
      // El selector se queda en la cuenta actual: la otra se elige cuando tenga sesión.
      select.value = current();
      setProblem(null);
      await accounts.add();
      select.value = current();
      return;
    }
    if (!value || value === current()) return;
    setSaving(true);
    setProblem(null);
    try {
      const result = await setWorkspaceAccount(props.workspace, value);
      accounts.setOf(result);
      setProblem(changeProblem(result));
    } catch (e) {
      select.value = current();
      setProblem(changeProblem(null, e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Show when={accounts.sessions() && accounts.of()}>
      <div class="grid gap-1 pl-[27px] text-xs" data-workspace-account={line().kind}>
        <span class="text-neutral-500">{t("danil.workspace.title")}</span>
        <Show
          when={choices().length}
          fallback={
            <div class="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={accounts.busy() || adding()} onClick={() => void accounts.add()}>
                {t("danil.account.sign_in")}
              </Button>
            </div>
          }
        >
          <Select
            ref={(el: HTMLSelectElement) => {
              picker = el;
              queueMicrotask(() => {
                el.value = current();
              });
            }}
            class="max-w-xs"
            aria-label={t("danil.workspace.label", { name: props.name })}
            disabled={saving() || accounts.busy()}
            onChange={(e) => void choose(e.currentTarget.value, e.currentTarget)}
            data-workspace-account-select=""
          >
            <For each={choices()}>
              {(c) => (
                <option value={c.value} disabled={!c.signedIn}>
                  {c.signedIn ? c.label : t("danil.workspace.signed_out_option", { email: c.label })}
                </option>
              )}
            </For>
            <option value={OTHER}>{t("danil.workspace.connect_other")}</option>
          </Select>
        </Show>
        <p class="m-0 text-neutral-500" data-workspace-sync="">
          {lineText()}
        </p>
        <Show when={adding()}>
          <p class="m-0 text-neutral-500" data-workspace-adding="">
            {t("danil.account.pending", { code: accounts.pending()?.user_code ?? "" })}{" "}
            <button type="button" class="cursor-pointer border-0 bg-transparent p-0 text-xs text-primary underline" onClick={accounts.reopen}>
              {t("danil.account.open_again")}
            </button>
          </p>
        </Show>
        <Show when={message() === LICENSE_REQUIRED}>
          <TerminusLicense onStart={startTrialInBrowser} onRetry={() => void accounts.add()} busy={accounts.busy()} compact />
        </Show>
        <Show when={message() !== LICENSE_REQUIRED && message()}>
          {(code) => (
            <p class="m-0 text-error-strong" role="alert">
              {problemText(code())}
            </p>
          )}
        </Show>
      </div>
    </Show>
  );
}
