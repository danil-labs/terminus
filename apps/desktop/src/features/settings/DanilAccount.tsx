import "../../locales/danilPhrases";
import { createSignal, For, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import { t } from "../../lib/i18n";
import { invoke } from "../../lib/invoke";
import { listen } from "../../lib/serviceEvents";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import {
  type DanilConnectOption,
  type DanilConnectStatus,
  failureCode,
  readDanilAccount,
  readDanilOptions,
  signInWithBrowser,
  signInWithWorkspace,
  signOut,
} from "./danil-account";
import { SettingsBlock, SettingsPanel, SettingsRow, SettingsSection } from "./layout";

type View = { t: "loading" } | { t: "unavailable" } | { t: "ready"; status: DanilConnectStatus };

/** La frase de un código del motor: los de `Failure` (`danil.error.*`) o los del estado (`danil.status.*`). */
function said(code: string | null | undefined): string {
  if (!code) return t("danil.account.failed");
  const known = (key: string, text: string) => (text === key ? null : text);
  return (
    known(`danil.error.${code}`, t(`danil.error.${code}`)) ??
    known(`danil.status.${code}`, t(`danil.status.${code}`)) ??
    t("danil.account.failed")
  );
}

/** Configuración → Cuenta de Danil. Chunk aparte: solo lo carga quien abre esta sección. */
export default function DanilAccount() {
  const [view, setView] = createSignal<View>({ t: "loading" });
  const [options, setOptions] = createSignal<DanilConnectOption[]>([]);
  const [name, setName] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);

  const show = (status: DanilConnectStatus | null) => {
    if (!status) return setView({ t: "unavailable" });
    setView({ t: "ready", status });
    if (status.state === "disconnected" && !name() && status.name) setName(status.name);
  };
  const reload = () =>
    readDanilAccount()
      .then(show)
      .catch(() => setProblem(t("danil.account.failed")));

  onMount(() => {
    void reload();
    void readDanilOptions().then(setOptions);
    const changes = listen<DanilConnectStatus>("danil-connect", (e) => show(e.payload));
    onCleanup(() => void changes.then((off) => off()));
  });

  const status = () => {
    const v = view();
    return v.t === "ready" ? v.status : null;
  };
  const explain = (e: unknown) => setProblem(said(failureCode(e)));

  async function run(action: () => Promise<DanilConnectStatus | null>) {
    setBusy(true);
    setProblem(null);
    try {
      show(await action());
    } catch (e) {
      explain(e);
    } finally {
      setBusy(false);
    }
  }

  const withBrowser = () => run(() => signInWithBrowser(name()));
  const withWorkspace = (o: DanilConnectOption) => run(() => signInWithWorkspace(name(), o.workspace));
  const reopen = () => {
    const url = status()?.verification_uri_complete;
    if (url) void invoke("open_external", { target: url }).catch(() => {});
  };

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
              <Button size="sm" variant="secondary" disabled={busy()} onClick={() => void run(signOut)}>
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
                <Button size="sm" variant="secondary" onClick={reopen}>
                  {t("danil.account.open_again")}
                </Button>
              </Show>
              <Button size="sm" variant="ghost" disabled={busy()} onClick={() => void run(signOut)}>
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
              <div class="flex flex-wrap items-center gap-2">
                <For each={options()}>
                  {(o) => (
                    <Button size="sm" disabled={busy()} onClick={() => void withWorkspace(o)}>
                      {t("danil.account.continue_as", { email: o.email })}
                    </Button>
                  )}
                </For>
                <Button
                  size="sm"
                  variant={options().length ? "secondary" : "primary"}
                  disabled={busy()}
                  onClick={() => void withBrowser()}
                >
                  {options().length ? t("danil.account.sign_in_other") : t("danil.account.sign_in")}
                </Button>
              </div>
            </SettingsBlock>
          </Match>
        </Switch>
        <Show when={problem() ?? (status()?.state === "error" || status()?.error ? said(status()?.error) : null)}>
          {(text) => <p class="m-0 pt-2 text-[0.8125rem] text-error-strong" role="alert">{text()}</p>}
        </Show>
      </SettingsSection>
      {/* Aquí va la sección de workspaces vinculados cuando el motor los sincronice. */}
    </SettingsPanel>
  );
}
