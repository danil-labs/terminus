/**
 * El estado y las acciones de la cuenta de Danil que comparten Configuración y
 * el alta: leer, escuchar `danil-connect`, entrar y cerrar sesión.
 */
import "../../locales/danilPhrases";
import { createSignal, For, onCleanup, onMount } from "solid-js";
import { t } from "../../lib/i18n";
import { invoke } from "../../lib/invoke";
import { listen } from "../../lib/serviceEvents";
import { Button } from "../../ui/Button";
import {
  type DanilConnectOption,
  type DanilConnectStatus,
  failureCode,
  ONE_CLICK_SIGN_IN,
  readDanilAccount,
  readDanilOptions,
  signInWithBrowser,
  signInWithWorkspace,
  signOut,
} from "./danil-account";

export type DanilView =
  | { t: "loading" }
  | { t: "unavailable" }
  | { t: "failed" }
  | { t: "ready"; status: DanilConnectStatus };

/** La frase de un código del motor: los de `Failure` (`danil.error.*`) o los del estado (`danil.status.*`). */
export function said(code: string | null | undefined): string {
  if (!code) return t("danil.account.failed");
  const known = (key: string, text: string) => (text === key ? null : text);
  return (
    known(`danil.error.${code}`, t(`danil.error.${code}`)) ??
    known(`danil.status.${code}`, t(`danil.status.${code}`)) ??
    t("danil.account.failed")
  );
}

/** `oneClick: false` no pide los correos conocidos: para quien solo muestra el estado. */
export function createDanilSession({ oneClick = ONE_CLICK_SIGN_IN } = {}) {
  const [view, setView] = createSignal<DanilView>({ t: "loading" });
  const [options, setOptions] = createSignal<DanilConnectOption[]>([]);
  const [name, setName] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);

  const show = (status: DanilConnectStatus | null) => {
    if (!status) return setView({ t: "unavailable" });
    setView({ t: "ready", status });
    if (status.state === "disconnected" && !name() && status.name) setName(status.name);
  };

  onMount(() => {
    readDanilAccount()
      .then(show)
      .catch(() => {
        setView({ t: "failed" });
        setProblem(t("danil.account.failed"));
      });
    if (oneClick && ONE_CLICK_SIGN_IN) void readDanilOptions().then(setOptions);
    const changes = listen<DanilConnectStatus>("danil-connect", (e) => show(e.payload));
    onCleanup(() => void changes.then((off) => off()));
  });

  const status = () => {
    const v = view();
    return v.t === "ready" ? v.status : null;
  };

  async function run(action: () => Promise<DanilConnectStatus | null>) {
    setBusy(true);
    setProblem(null);
    try {
      show(await action());
    } catch (e) {
      setProblem(said(failureCode(e)));
    } finally {
      setBusy(false);
    }
  }

  return {
    view,
    status,
    options,
    name,
    setName,
    busy,
    /** Lo que falló al pedir algo, o el error que trae el estado. */
    message: () => problem() ?? (status()?.state === "error" || status()?.error ? said(status()?.error) : null),
    withBrowser: () => run(() => signInWithBrowser(name())),
    withWorkspace: (o: DanilConnectOption) => run(() => signInWithWorkspace(name(), o.workspace)),
    signOut: () => run(signOut),
    reopen: () => {
      const url = status()?.verification_uri_complete;
      if (url) void invoke("open_external", { target: url }).catch(() => {});
    },
  };
}

export type DanilSession = ReturnType<typeof createDanilSession>;

/** Las maneras de entrar: un botón por correo conocido (si está encendido) y el navegador. */
export function DanilSignInChoices(props: { session: DanilSession }) {
  const s = props.session;
  return (
    <div class="flex flex-wrap items-center gap-2">
      <For each={s.options()}>
        {(o) => (
          <Button size="sm" disabled={s.busy()} onClick={() => void s.withWorkspace(o)}>
            {t("danil.account.continue_as", { email: o.email })}
          </Button>
        )}
      </For>
      <Button
        size="sm"
        variant={s.options().length ? "secondary" : "primary"}
        disabled={s.busy()}
        onClick={() => void s.withBrowser()}
      >
        {s.options().length ? t("danil.account.sign_in_other") : t("danil.account.sign_in")}
      </Button>
    </div>
  );
}
