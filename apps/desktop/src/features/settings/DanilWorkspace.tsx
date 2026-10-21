import { createSignal, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import { t } from "../../lib/i18n";
import { Toggle } from "../../ui/Toggle";
import { failureCode } from "./danil-account";
import { said } from "./danil-session";
import { accountEmail, type DanilWorkspaceLinkStatus, linkWorkspace, readWorkspaceLink, unlinkWorkspace } from "./danil-workspace";
import { SettingsBlock, SettingsRow, SettingsSection } from "./layout";
import { createWorkspaces } from "./workspaces-store";

type View = { t: "loading" } | { t: "unavailable" } | { t: "ready"; status: DanilWorkspaceLinkStatus };

/**
 * Configuración → Cuenta de Danil → el workspace abierto: si se ve en la web y
 * el teléfono con la cuenta de esta computadora. Un interruptor, como elegir
 * qué carpeta se sincroniza.
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

  async function choose(on: boolean) {
    setBusy(true);
    setProblem(null);
    try {
      await (on ? linkWorkspace() : unlinkWorkspace());
    } catch (e) {
      setProblem(said(failureCode(e)));
    } finally {
      setBusy(false);
      await load();
    }
  }

  onMount(() => {
    void load();
    const switched = () => {
      setProblem(null);
      void load();
    };
    window.addEventListener("harness:workspace", switched);
    onCleanup(() => {
      lectura++;
      window.removeEventListener("harness:workspace", switched);
    });
  });

  const status = () => {
    const v = view();
    return v.t === "ready" ? v.status : null;
  };
  const workspace = () => espacios.actual()?.name ?? "";

  return (
    <SettingsSection
      title={workspace() ? t("danil.workspace.title", { workspace: workspace() }) : t("danil.workspace.title_plain")}
      description={t("danil.workspace.description")}
      data-danil-workspace={view().t === "ready" ? (status()?.linked ? "linked" : "unlinked") : view().t}
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
        <Match when={status()}>
          {(s) => (
            <SettingsRow
              label={t("danil.workspace.sync")}
              description={accountEmail(s()) ? t("danil.workspace.sync_hint", { email: accountEmail(s()) }) : undefined}
            >
              <Toggle
                checked={s().linked}
                label={t("danil.workspace.sync")}
                disabled={busy()}
                onChange={(on) => void choose(on)}
                data-danil-workspace-sync=""
              />
            </SettingsRow>
          )}
        </Match>
      </Switch>
      <Show when={problem()}>{(text) => <p class="m-0 pt-2 text-[0.8125rem] text-error-strong" role="alert">{text()}</p>}</Show>
    </SettingsSection>
  );
}
