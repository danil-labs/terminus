import { Match, Show, Switch } from "solid-js";
import { t } from "../../lib/i18n";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { createDanilSession, DanilSignInChoices } from "./danil-session";
import { SettingsBlock, SettingsPanel, SettingsRow, SettingsSection } from "./layout";

/** Configuración → Cuenta de Danil. Chunk aparte: solo lo carga quien abre esta sección. */
export default function DanilAccount() {
  const session = createDanilSession();
  const { view, status, name, setName, busy } = session;

  return (
    <SettingsPanel data-danil-account={status()?.state ?? view().t}>
      <SettingsSection title={t("danil.account.title")} description={t("danil.account.description")}>
        <Switch>
          <Match when={view().t === "loading"}>
            <SettingsBlock>
              <p class="m-0 text-sm text-neutral-500">{t("danil.account.loading")}</p>
            </SettingsBlock>
          </Match>
          <Match when={view().t === "unavailable"}>
            <SettingsBlock>
              <p class="m-0 text-sm text-neutral-500">{t("danil.account.unavailable")}</p>
            </SettingsBlock>
          </Match>
          <Match when={status()?.state === "connected"}>
            <SettingsRow
              label={t("danil.account.connected", {
                who: status()?.email || t("danil.account.your_account"),
                name: status()?.name || status()?.computer_id || "",
              })}
              description={status()?.online ? t("danil.account.online") : t("danil.account.offline")}
            >
              <Button size="sm" variant="secondary" disabled={busy()} onClick={() => void session.signOut()}>
                {t("danil.account.sign_out")}
              </Button>
            </SettingsRow>
          </Match>
          <Match when={status()?.state === "pending"}>
            <SettingsRow
              label={t("danil.account.pending", { code: status()?.user_code ?? "" })}
              description={t("danil.account.pending_hint")}
            >
              <Show when={status()?.verification_uri_complete}>
                <Button size="sm" variant="secondary" onClick={session.reopen}>
                  {t("danil.account.open_again")}
                </Button>
              </Show>
              <Button size="sm" variant="ghost" disabled={busy()} onClick={() => void session.signOut()}>
                {t("danil.account.cancel")}
              </Button>
            </SettingsRow>
          </Match>
          <Match when={status()}>
            <SettingsBlock>
              <label class="grid max-w-sm gap-1.5 text-[0.8125rem] text-neutral-500">
                {t("danil.account.name_label")}
                <Input value={name()} onInput={(e) => setName(e.currentTarget.value)} disabled={busy()} />
              </label>
              <DanilSignInChoices session={session} />
            </SettingsBlock>
          </Match>
        </Switch>
        <Show when={session.message()}>
          {(text) => <p class="m-0 pt-2 text-[0.8125rem] text-error-strong" role="alert">{text()}</p>}
        </Show>
      </SettingsSection>
      {/* Aquí va la sección de workspaces vinculados cuando el motor los sincronice. */}
    </SettingsPanel>
  );
}
