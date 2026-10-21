import { createEffect, createSignal, For, Match, on, Show, Switch } from "solid-js";
import { t } from "../../lib/i18n";
import { capabilities } from "../../lib/platform";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { engineAccountProfile, engineAccountProfileOf, profileFromStatus } from "./account-engine";
import type { AccountProfile, AccountProfileSource } from "./account-profile";
import { AccountIdentityBlock, type AccountIdentityState, createAccountIdentity } from "./AccountIdentity";
import type { DanilConnectStatus } from "./danil-account";
import { createDanilAccounts, type DanilAccounts } from "./danil-accounts";
import { createDanilSession, DanilSignInChoices, said } from "./danil-session";
import { type DanilSessionInfo, sessionKey, statusOf } from "./danil-sessions";
import { LICENSE_REQUIRED, startTrialInBrowser, TerminusLicense } from "./TerminusLicense";
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

/**
 * En el escritorio: una sesión por cuenta. Sin ninguna (o con un motor que no
 * las trae) es la cuenta única de siempre; con alguna, la lista de cuentas.
 */
function MachineAccount() {
  const accounts = createDanilAccounts();
  return (
    <Switch>
      <Match when={accounts.sessions() === undefined}>
        <SettingsPanel data-danil-account="loading">
          <SettingsSection title={t("danil.accounts.title")}>
            <SettingsBlock>
              <p class="m-0 text-sm text-neutral-500">{t("danil.account.loading")}</p>
            </SettingsBlock>
          </SettingsSection>
        </SettingsPanel>
      </Match>
      <Match when={accounts.connected().length > 0}>
        <AccountList accounts={accounts} />
      </Match>
      <Match when={true}>
        <SingleAccount />
      </Match>
    </Switch>
  );
}

/** Las cuentas con sesión en esta computadora, la que se está agregando y «Agregar otra cuenta». */
function AccountList(props: { accounts: DanilAccounts }) {
  const a = props.accounts;
  const keys = () => a.connected().map(sessionKey).filter((k): k is string => Boolean(k));
  const many = () => keys().length > 1;
  const pending = () => a.pending();
  const problem = () => a.problem() ?? (pending()?.status === "error" ? (pending()?.error ?? "failed") : null);

  return (
    <SettingsPanel data-danil-account="sessions">
      <SettingsSection title={t("danil.accounts.title")} description={t("danil.accounts.description")}>
        <For each={keys()}>
          {(key) => (
            <Show when={a.connected().find((s) => sessionKey(s) === key)}>
              {(session) => <SessionCard session={session()} accounts={a} many={many()} />}
            </Show>
          )}
        </For>
        <Show
          when={pending()?.status === "pending"}
          fallback={
            <SettingsBlock>
              <Button
                size="sm"
                variant="secondary"
                class="justify-self-start"
                disabled={a.busy()}
                onClick={() => void a.add()}
                data-danil-add=""
              >
                {t("danil.accounts.add")}
              </Button>
            </SettingsBlock>
          }
        >
          <SettingsRow
            label={t("danil.account.pending", { code: pending()?.user_code ?? "" })}
            description={t("danil.accounts.adding_hint")}
            data-danil-adding=""
          >
            <Show when={pending()?.verification_uri_complete}>
              <Button size="sm" variant="secondary" onClick={a.reopen}>
                {t("danil.account.open_again")}
              </Button>
            </Show>
          </SettingsRow>
        </Show>
        <Show when={problem() === LICENSE_REQUIRED}>
          <SettingsBlock>
            <TerminusLicense onStart={startTrialInBrowser} onRetry={() => void a.add()} busy={a.busy()} />
          </SettingsBlock>
        </Show>
        <Show when={problem() !== LICENSE_REQUIRED && problem()}>
          {(code) => <p class="m-0 pt-2 text-[0.8125rem] text-error-strong" role="alert">{said(code())}</p>}
        </Show>
      </SettingsSection>
    </SettingsPanel>
  );
}

/** Una cuenta: su persona (con la foto), esta computadora en ella, y sus acciones. */
function SessionCard(props: { session: DanilSessionInfo; accounts: DanilAccounts; many: boolean }) {
  const key = sessionKey(props.session) as string;
  const s = () => props.session;
  const identity = createAccountIdentity(engineAccountProfileOf(key), undefined, {
    watch: () => [s().photo, s().name, s().email],
  });
  // Mientras el motor contesta, la persona sale de la lista.
  const [listed, setListed] = createSignal<AccountProfile | null>(null);
  createEffect(on(s, (session) => void profileFromStatus(statusOf(session)).then(setListed).catch(() => {})));
  const shown: AccountIdentityState = { ...identity, profile: () => identity.profile() ?? listed() ?? null };
  const state = () =>
    t("danil.accounts.row", {
      status: s().online ? t("danil.accounts.online") : t("danil.accounts.offline"),
      workspaces: t("danil.accounts.workspaces", { count: s().workspaces.length }),
    });

  return (
    <div class="grid border-b border-border last:border-b-0" data-danil-session={key} data-default={s().default ? "" : undefined}>
      <AccountIdentityBlock identity={shown} />
      <SettingsRow
        label={t("danil.account.this_computer", { name: s().computer_name || s().computer_id || "" })}
        description={state()}
      >
        <Show when={props.many && s().default}>
          <Badge>{t("danil.accounts.default")}</Badge>
        </Show>
        <Show when={!s().default}>
          <Button size="sm" variant="ghost" disabled={props.accounts.busy()} onClick={() => void props.accounts.makeDefault(key)}>
            {t("danil.accounts.make_default")}
          </Button>
        </Show>
        <Button size="sm" variant="secondary" disabled={props.accounts.busy()} onClick={() => void props.accounts.signOut(key)}>
          {t("danil.account.sign_out")}
        </Button>
      </SettingsRow>
    </div>
  );
}

/** La cuenta única: iniciar sesión registra esta computadora en la cuenta. */
function SingleAccount() {
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
        <Show when={session.license()}>
          <SettingsBlock>
            <TerminusLicense onStart={startTrialInBrowser} onRetry={() => void session.retry()} busy={busy()} />
          </SettingsBlock>
        </Show>
        <Show when={session.message()}>
          {(text) => <p class="m-0 pt-2 text-[0.8125rem] text-error-strong" role="alert">{text()}</p>}
        </Show>
      </SettingsSection>
    </SettingsPanel>
  );
}

/** Montado solo con sesión: pide el perfil al motor al abrir la sección. */
function ConnectedIdentity(props: { status: () => DanilConnectStatus | null }) {
  const identity = createAccountIdentity(engineAccountProfile, props.status);
  return <AccountIdentityBlock identity={identity} />;
}
