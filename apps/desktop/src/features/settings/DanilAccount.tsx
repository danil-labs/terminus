import { Match, Show, Switch } from "solid-js";
import { t } from "../../lib/i18n";
import { capabilities } from "../../lib/platform";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { engineAccountProfile } from "./account-engine";
import type { AccountProfileSource } from "./account-profile";
import { AccountIdentityBlock, createAccountIdentity } from "./AccountIdentity";
import type { DanilConnectStatus } from "./danil-account";
import { createDanilSession, DanilSignInChoices } from "./danil-session";
import { SettingsBlock, SettingsPanel, SettingsRow, SettingsSection } from "./layout";

/** Configuración → Cuenta de Danil. Chunk aparte: solo lo carga quien abre esta sección. */
export default function DanilAccount() {
  const web = capabilities().accountProfile;
  return web ? <WebAccount source={web} /> : <MachineAccount />;
}

/** En la web la persona ya entró con su cuenta: aquí solo su foto, nombre y correo. */
function WebAccount(props: { source: AccountProfileSource }) {
  const identity = createAccountIdentity(props.source);
  return (
    <SettingsPanel data-danil-account="web">
      <SettingsSection title={t("danil.account.title")} description={t("danil.account.web_description")}>
        <AccountIdentityBlock identity={identity} />
      </SettingsSection>
    </SettingsPanel>
  );
}

/** En el escritorio: iniciar sesión registra esta computadora en la cuenta. */
function MachineAccount() {
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
            <ConnectedIdentity status={status} />
            <SettingsRow
              label={t("danil.account.this_computer", { name: status()?.name || status()?.computer_id || "" })}
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
                <Input value={name()} onInput={(e) => setName(e.currentTarget.value)} disabled={busy()} data-machine-name="" />
                <span class="text-xs">{t("danil.account.name_hint")}</span>
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

/** Montado solo con sesión: pide el perfil al motor al abrir la sección. */
function ConnectedIdentity(props: { status: () => DanilConnectStatus | null }) {
  const identity = createAccountIdentity(engineAccountProfile, props.status);
  return <AccountIdentityBlock identity={identity} />;
}
