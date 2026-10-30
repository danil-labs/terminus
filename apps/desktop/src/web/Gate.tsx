import { hasAccountWorkspaces, hasLinkedWorkspaces, listWorkspaces } from "@terminus/computers";
import { type JSX, For, Match, onMount, Show, Switch, createSignal } from "solid-js";
import { t } from "../lib/i18n";
import { startTrialInPage, TerminusLicense } from "../features/settings/TerminusLicense";
import { Button } from "../ui/Button";
import { ConnectMachine } from "../features/machines/ConnectMachine";
import { type Answer, type Computer, listComputers } from "./computers";
import type { WebAccountsSource } from "../lib/platform";
import type { Session } from "./session";
import { BrowserAccount } from "./BrowserAccount";
import { AccessRequest } from "./AccessRequest";
import type { AccessRequestSource } from "./access-request";

/** What stands between the page and the app: the session, the license, having a computer and a workspace linked to the account. `access`: alfa, without any workspace. */
export type GateView = { t: "waiting" } | { t: "license" } | { t: "no_account" } | { t: "not_yours" } | { t: "none" } | { t: "no_workspaces" } | { t: "access" } | { t: "error" };

/** The list with a token the API accepts: a refused token is refreshed once. */
export async function computersOf(endpoint: string, session: Session): Promise<Answer<Computer[]>> {
  const answer = await listComputers(endpoint, await session.getToken());
  if (answer.kind !== "unauthorized" || !(await session.unauthorized())) return answer;
  return listComputers(endpoint, await session.getToken());
}

/** Whether the account registry has a workspace (of `computer`, if given); `null`: it could not be read. */
async function accountHasWorkspaces(endpoint: string, session: Session, computer?: string): Promise<boolean | null> {
  const answer = await listWorkspaces(endpoint, await session.getToken()).catch(() => null);
  if (answer?.kind !== "ok") return null;
  return hasAccountWorkspaces(computer ? answer.value.filter((w) => w.computers.includes(computer)) : answer.value);
}

/**
 * Opening is not intent to work: every computer of the person mounts as it is,
 * on or off, and wakes with the first action. `?computer=` opens only that one.
 */
export function Gate(props: { session: Session; endpoint: string; initial?: GateView; onOpen?: (computers: Computer[]) => void; accounts?: WebAccountsSource; access?: AccessRequestSource }) {
  const [view, setView] = createSignal<GateView>(props.initial ?? { t: "waiting" });

  /** Without a workspace. With `access` a failed read is an error: nobody who belongs may land on the request. */
  const withoutWorkspace = (has: boolean | null): GateView => (!props.access ? { t: "no_workspaces" } : has === null ? { t: "error" } : { t: "access" });

  async function load() {
    setView({ t: "waiting" });
    const answer = await computersOf(props.endpoint, props.session).catch((): Answer<Computer[]> => ({ kind: "unauthorized" }));
    if (answer.kind === "unauthorized") return;
    if (answer.kind === "no_account" && props.access) return setView({ t: "access" });
    if (answer.kind === "license" || answer.kind === "no_account") return setView({ t: answer.kind });
    if (answer.kind !== "ok") return setView({ t: "error" });
    const computers = answer.value;
    const asked = new URLSearchParams(window.location.search).get("computer");
    if (asked) {
      const one = computers.find((c) => c.computer_id === asked);
      if (!one) return setView({ t: "not_yours" });
      if (hasLinkedWorkspaces([one])) return props.onOpen?.([one]);
      const has = await accountHasWorkspaces(props.endpoint, props.session, asked);
      return has ? props.onOpen?.([one]) : setView(withoutWorkspace(has));
    }
    if (computers.length === 0) {
      if (!props.access) return setView({ t: "none" });
      // Connecting the first machine is only for whoever already has a workspace.
      const has = await accountHasWorkspaces(props.endpoint, props.session);
      return setView(has ? { t: "none" } : withoutWorkspace(has));
    }
    // Each computer shows only the workspaces linked to the account: with none there nor in the account, the app would be empty.
    if (!hasLinkedWorkspaces(computers)) {
      const has = await accountHasWorkspaces(props.endpoint, props.session);
      if (!has) return setView(withoutWorkspace(has));
    }
    props.onOpen?.(computers);
  }

  onMount(() => {
    if (!props.initial) void load();
  });

  const message = (text: string, action?: JSX.Element) => (
    <>
      <p class="m-0 max-w-[60ch] text-sm text-neutral-950">{text}</p>
      <Show when={action}>
        <div class="mt-6">{action}</div>
      </Show>
    </>
  );
  const retry = () => (
    <Button size="sm" variant="secondary" onClick={() => void load()}>
      {t("web.computers.retry")}
    </Button>
  );

  const account = () => <BrowserAccount session={props.session} onChange={props.accounts ? () => props.accounts?.add() : undefined} />;

  const openable = () => (props.accounts?.others() ?? []).filter((a) => a.signedIn && a.workspaces.length > 0);

  // Sobre la app ya montada (sin `onOpen`) solo una carga nueva vuelve a abrir las sesiones.
  const retryLicense = () => (props.onOpen ? void load() : window.location.reload());

  return (
    <main class="flex h-full flex-col overflow-y-auto bg-bg px-10 py-10" data-web-gate={view().t}>
      <h1 class="m-0 mb-5 text-3xl leading-tight font-display font-bold tracking-[-0.03em] text-neutral-950">{view().t === "access" ? "Danil" : "Terminus"}</h1>
      <Show when={view().t !== "access"}>{account()}</Show>
      <Switch>
        <Match when={view().t === "waiting"}>
          <p class="m-0 text-sm text-neutral-500">{t("web.computers.waiting")}</p>
        </Match>
        <Match when={view().t === "license"}>
          <TerminusLicense onStart={startTrialInPage} onRetry={retryLicense} />
        </Match>
        <Match when={view().t === "no_account"}>{message(t("web.computers.no_account"), retry())}</Match>
        <Match when={view().t === "not_yours"}>{message(t("web.computers.not_yours"))}</Match>
        <Match when={view().t === "none"}>
          {message(t("web.computers.none"))}
          {/* La primera máquina propia, sin salir de aquí: en línea, la puerta vuelve a leer y abre. */}
          <div class="mt-6 max-w-[60ch]" data-web-connect="">
            <ConnectMachine
              list={() => computersOf(props.endpoint, props.session)}
              onReady={() => void load()}
            />
          </div>
        </Match>
        <Match when={view().t === "no_workspaces"}>{message(t("web.computers.no_workspaces"), retry())}</Match>
        <Match when={view().t === "error"}>{message(t("web.computers.error"), retry())}</Match>
        <Match when={view().t === "access" && props.access}>
          {(access) => <AccessRequest source={access()} session={props.session} name={props.accounts?.current.name ?? null} />}
        </Match>
      </Switch>
      {/* En la solicitud, «Cambiar de cuenta» va al final: primero lo que se puede hacer y el formulario. */}
      <Show when={view().t === "access"}>
        <div class="mt-8">{account()}</div>
      </Show>
      {/* Esta cuenta no abre (licencia, sin computadoras): las otras de este navegador sí pueden. */}
      <Show when={view().t !== "waiting" && openable().length > 0}>
        <div class="mt-8 max-w-[60ch]" data-web-gate-accounts="">
          <p class="m-0 mb-3 text-sm text-neutral-700">{t("web.computers.other_accounts")}</p>
          <div class="flex flex-wrap gap-2">
            <For each={openable()}>
              {(a) => (
                <Button size="sm" variant="secondary" onClick={() => props.accounts?.open(a.workspaces[0].id)}>
                  {t("web.computers.open_account", { email: a.email ?? a.user_id })}
                </Button>
              )}
            </For>
          </div>
        </div>
      </Show>
    </main>
  );
}
