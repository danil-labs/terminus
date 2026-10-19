import { For, type JSX, Match, onMount, Show, Switch, createSignal } from "solid-js";
import { t } from "../lib/i18n";
import { Button } from "../ui/Button";
import { type Answer, type Computer, listComputers, startComputer } from "./computers";
import type { Session } from "./session";

/** What stands between the page and the app: the session, the license and which computer. */
export type GateView =
  | { t: "waiting" }
  | { t: "license" }
  | { t: "not_yours" }
  | { t: "none" }
  | { t: "error" }
  | { t: "pick"; computers: Computer[] };

const CHOICE = "terminus-web:computer";

export function rememberedComputer(): string | null {
  try {
    return localStorage.getItem(CHOICE);
  } catch {
    return null;
  }
}

function remember(id: string) {
  try {
    localStorage.setItem(CHOICE, id);
  } catch {}
}

/** The list with a token the API accepts: a refused token is refreshed once. */
export async function computersOf(endpoint: string, session: Session): Promise<Answer<Computer[]>> {
  const answer = await listComputers(endpoint, await session.getToken());
  if (answer.kind !== "unauthorized" || !(await session.unauthorized())) return answer;
  return listComputers(endpoint, await session.getToken());
}

const STATES: Record<string, () => string> = {
  online: () => t("web.computers.state.online"),
  offline: () => t("web.computers.state.offline"),
  starting: () => t("web.computers.state.starting"),
  stopped: () => t("web.computers.state.stopped"),
  provisioning: () => t("web.computers.state.provisioning"),
};

export function Gate(props: { session: Session; endpoint: string; initial?: GateView; onOpen?: (id: string) => void }) {
  const [view, setView] = createSignal<GateView>(props.initial ?? { t: "waiting" });
  const [starting, setStarting] = createSignal<string | null>(null);

  /** Opening is not intent to work: an off computer mounts as it is and wakes with the first message. */
  const open = (computer: Computer) => {
    remember(computer.computer_id);
    props.onOpen?.(computer.computer_id);
  };

  async function load() {
    setView({ t: "waiting" });
    const answer = await computersOf(props.endpoint, props.session).catch((): Answer<Computer[]> => ({ kind: "unauthorized" }));
    if (answer.kind === "unauthorized") return;
    if (answer.kind === "license") return setView({ t: "license" });
    if (answer.kind !== "ok") return setView({ t: "error" });
    const computers = answer.value;
    const byId = (id: string | null) => computers.find((c) => c.computer_id === id);
    const asked = new URLSearchParams(window.location.search).get("computer");
    if (asked) return byId(asked) ? open(byId(asked) as Computer) : setView({ t: "not_yours" });
    if (computers.length === 0) return setView({ t: "none" });
    if (computers.length === 1) return open(computers[0]);
    const known = byId(rememberedComputer());
    if (known) return open(known);
    setView({ t: "pick", computers });
  }

  async function start(id: string) {
    setStarting(id);
    const answer = await startComputer(props.endpoint, await props.session.getToken(), id).catch((): Answer<null> => ({ kind: "unauthorized" }));
    setStarting(null);
    if (answer.kind === "unauthorized" && !(await props.session.unauthorized())) return;
    if (answer.kind === "license") return setView({ t: "license" });
    void load();
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

  return (
    <main class="flex h-full flex-col overflow-y-auto bg-bg px-10 py-10" data-web-gate={view().t}>
      <h1 class="m-0 mb-5 text-3xl leading-tight font-display font-bold tracking-[-0.03em] text-neutral-950">Terminus</h1>
      <Switch>
        <Match when={view().t === "waiting"}>
          <p class="m-0 text-sm text-neutral-500">{t("web.computers.waiting")}</p>
        </Match>
        <Match when={view().t === "license"}>{message(t("web.computers.license"))}</Match>
        <Match when={view().t === "not_yours"}>{message(t("web.computers.not_yours"))}</Match>
        <Match when={view().t === "none"}>{message(t("web.computers.none"), retry())}</Match>
        <Match when={view().t === "error"}>{message(t("web.computers.error"), retry())}</Match>
        <Match when={view().t === "pick"}>
          <p class="m-0 mb-4 text-sm text-neutral-500">{t("web.computers.title")}</p>
          <ul class="m-0 flex max-w-xl list-none flex-col gap-2 p-0">
            <For each={(view() as { computers: Computer[] }).computers}>
              {(c) => (
                <li class="flex items-center gap-3 rounded-md border border-border px-3 py-2" data-computer={c.computer_id}>
                  <span class="min-w-0 flex-1 truncate text-sm text-neutral-950">{c.name || c.computer_id}</span>
                  <span class="text-xs text-neutral-500">{(STATES[c.state] ?? (() => c.state))()}</span>
                  <Show when={c.state === "offline" || c.state === "stopped"}>
                    <Button size="sm" variant="secondary" disabled={starting() !== null} onClick={() => void start(c.computer_id)}>
                      {t("web.computers.start")}
                    </Button>
                  </Show>
                  <Button size="sm" onClick={() => open(c)}>
                    {t("web.computers.open")}
                  </Button>
                </li>
              )}
            </For>
          </ul>
        </Match>
      </Switch>
    </main>
  );
}
