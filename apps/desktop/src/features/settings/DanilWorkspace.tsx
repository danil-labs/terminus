import { createSignal, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import { t } from "../../lib/i18n";
import { invoke } from "../../lib/invoke";
import { listen } from "../../lib/serviceEvents";
import { Button } from "../../ui/Button";
import { failureCode } from "./danil-account";
import { said } from "./danil-session";
import {
  cancelWorkspaceLink,
  type DanilWorkspaceLinkEvent,
  type DanilWorkspaceLinkStatus,
  linkedLabel,
  linkWorkspace,
  linkWorkspaceWithBrowser,
  readWorkspaceLink,
  unlinkWorkspace,
} from "./danil-workspace";
import { SettingsBlock, SettingsRow, SettingsSection } from "./layout";
import { createWorkspaces } from "./workspaces-store";

type View = { t: "loading" } | { t: "unavailable" } | { t: "ready"; status: DanilWorkspaceLinkStatus };

/**
 * Configuración → Cuenta de Danil → el workspace abierto: con qué cuenta se ve
 * desde la web y el teléfono. Puede ser la de esta computadora, la de su sesión
 * de Radiant u otra que aprueba en el navegador.
 */
export function DanilWorkspace() {
  const espacios = createWorkspaces();
  const [view, setView] = createSignal<View>({ t: "loading" });
  const [busy, setBusy] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);
  let lectura = 0;

  async function load() {
    const esta = ++lectura;
    try {
      const status = await readWorkspaceLink();
      if (esta !== lectura) return;
      setView(status ? { t: "ready", status } : { t: "unavailable" });
    } catch (e) {
      if (esta === lectura) setProblem(said(failureCode(e)));
    }
  }

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setProblem(null);
    try {
      await action();
    } catch (e) {
      setProblem(said(failureCode(e)));
    } finally {
      setBusy(false);
      await load();
    }
  }

  onMount(() => {
    void load();
    const changes = listen<DanilWorkspaceLinkEvent>("danil-workspace-link", (e) => {
      if (e.payload.state === "error") setProblem(said(e.payload.error));
      void load();
      void espacios.cargar();
    });
    const switched = () => {
      setProblem(null);
      void load();
    };
    window.addEventListener("harness:workspace", switched);
    onCleanup(() => {
      lectura++;
      window.removeEventListener("harness:workspace", switched);
      void changes.then((off) => off());
    });
  });

  const status = () => {
    const v = view();
    return v.t === "ready" ? v.status : null;
  };
  const workspace = () => espacios.actual()?.name ?? "";
  const reopen = () => {
    const url = status()?.pending?.verification_uri_complete;
    if (url) void invoke("open_external", { target: url }).catch(() => {});
  };

  return (
    <SettingsSection
      title={workspace() ? t("danil.workspace.title", { workspace: workspace() }) : t("danil.workspace.title_plain")}
      description={t("danil.workspace.description")}
      data-danil-workspace={view().t === "ready" ? (status()?.linked ? "linked" : status()?.pending ? "pending" : "unlinked") : view().t}
    >
      <Switch>
        <Match when={view().t === "loading"}>
          <SettingsBlock>
            <p class="m-0 text-sm text-neutral-500">{t("danil.account.loading")}</p>
          </SettingsBlock>
        </Match>
        <Match when={view().t === "unavailable"}>
          <SettingsBlock>
            <p class="m-0 text-sm text-neutral-500">{t("danil.workspace.unavailable")}</p>
          </SettingsBlock>
        </Match>
        <Match when={status() && !status()?.machine_connected}>
          <SettingsBlock>
            <p class="m-0 text-sm text-neutral-500">{t("danil.workspace.sign_in_first")}</p>
          </SettingsBlock>
        </Match>
        <Match when={status()?.linked}>
          <SettingsRow
            label={t("danil.workspace.linked", { account: linkedLabel(status() as DanilWorkspaceLinkStatus) })}
            description={t("danil.workspace.linked_hint")}
          >
            <Button size="sm" variant="secondary" disabled={busy()} onClick={() => void run(unlinkWorkspace)} data-danil-workspace-unlink="">
              {t("danil.workspace.unlink")}
            </Button>
          </SettingsRow>
        </Match>
        <Match when={status()?.pending}>
          {(pending) => (
            <SettingsRow label={t("danil.account.pending", { code: pending().user_code })} description={t("danil.workspace.pending_hint")}>
              <Show when={pending().verification_uri_complete}>
                <Button size="sm" variant="secondary" onClick={reopen}>
                  {t("danil.account.open_again")}
                </Button>
              </Show>
              <Button size="sm" variant="ghost" disabled={busy()} onClick={() => void run(cancelWorkspaceLink)}>
                {t("danil.account.cancel")}
              </Button>
            </SettingsRow>
          )}
        </Match>
        <Match when={status()}>
          <SettingsBlock>
            <p class="m-0 text-sm text-neutral-500">{t("danil.workspace.unlinked")}</p>
            <div class="flex flex-wrap items-center gap-2">
              <Show when={status()?.machine_email}>
                {(email) => (
                  <Button size="sm" disabled={busy()} onClick={() => void run(() => linkWorkspace("owner"))} data-danil-workspace-link="owner">
                    {t("danil.workspace.use_machine", { email: email() })}
                  </Button>
                )}
              </Show>
              <Show when={status()?.radiant_email}>
                {(email) => (
                  <Button size="sm" variant="secondary" disabled={busy()} onClick={() => void run(() => linkWorkspace("radiant"))} data-danil-workspace-link="radiant">
                    {t("danil.workspace.use_radiant", { email: email() })}
                  </Button>
                )}
              </Show>
              <Button size="sm" variant="secondary" disabled={busy()} onClick={() => void run(linkWorkspaceWithBrowser)} data-danil-workspace-link="other">
                {t("danil.workspace.other")}
              </Button>
            </div>
          </SettingsBlock>
        </Match>
      </Switch>
      <Show when={problem()}>{(text) => <p class="m-0 pt-2 text-[0.8125rem] text-error-strong" role="alert">{text()}</p>}</Show>
    </SettingsSection>
  );
}
