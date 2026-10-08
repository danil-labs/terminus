import { listen } from "@tauri-apps/api/event";
import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { invoke } from "../../lib/invoke.ts";
import { t } from "../../lib/i18n";
import { Button } from "../../ui/Button";
import { asFailure, type Failure, FailureNote } from "../../ui/Failure";
import { Toast } from "../../ui/Toast";

/** Espeja `dialects::claude::mcp_sin_sesion`. */
type PendingServer = { name: string; source: string };
/** El evento `mcp_auth` de una tarea. */
type PendingSignIn = { agent: string; servers: PendingServer[] };
/** Lo que emite `mcp::lanzar_login` al terminar; los demás `mcp` no traen nada. */
type LoginEnded = { agent: string; server: string; ok: boolean } | null;

// Por sesión y fuera del componente: el evento llega al arrancar el turno,
// se esté mirando esa tarea o no. Una lista vacía quita el aviso.
const [pendingBySession, setPendingBySession] = createSignal<Record<string, PendingSignIn>>({});

export function noteMcpSignIn(session: string, text: string) {
  let parsed: PendingSignIn;
  try {
    parsed = JSON.parse(text) as PendingSignIn;
  } catch {
    return;
  }
  setPendingBySession((all) => ({ ...all, [session]: parsed }));
}

// La sesión queda en la cuenta, no en la tarea: el servidor deja de faltar en
// todas las tareas de ese agente.
function forgetSignedIn(agent: string, server: string) {
  setPendingBySession((all) =>
    Object.fromEntries(
      Object.entries(all).map(([session, p]) => [
        session,
        p.agent === agent ? { ...p, servers: p.servers.filter((s) => s.name !== server) } : p,
      ]),
    ),
  );
}

/**
 * Las herramientas MCP de la tarea que piden sesión, con su botón. El turno no
 * es interactivo y el agente no puede abrir el OAuth; lo corre `mcp_login` con
 * el CLI y la cuenta de la tarea, sin que ningún token pase por aquí.
 */
export default function McpSignInNotice(props: { session: string | null }) {
  // Todos los cerrados, no el último: cerrar el de otra tarea no reabre este.
  const [dismissed, setDismissed] = createSignal<Set<string>>(new Set());
  const [inProgress, setInProgress] = createSignal<Set<string>>(new Set());
  const [finished, setFinished] = createSignal<Set<string>>(new Set());
  const [loginUrl, setLoginUrl] = createSignal<string | null>(null);
  const [failure, setFailure] = createSignal<Failure | null>(null);
  // Sin tope, un navegador cerrado sin autorizar deja el botón bloqueado: `mcp` no llega.
  const timers = new Map<string, number>();

  const current = () => (props.session ? pendingBySession()[props.session] : undefined);
  const servers = () => current()?.servers ?? [];
  // Con otra lista de servidores, un aviso descartado vuelve.
  const noticeKey = () =>
    props.session ? `${props.session}:${servers().map((s) => s.name).sort().join(",")}` : "";
  const loginKey = (name: string) => `${props.session ?? ""}:${name}`;

  function stopWaiting(key: string) {
    const timer = timers.get(key);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.delete(key);
    }
    setInProgress((s) => {
      const n = new Set(s);
      n.delete(key);
      return n;
    });
  }

  async function signIn(name: string) {
    const agent = current()?.agent;
    if (!agent) return;
    const key = loginKey(name);
    setFailure(null);
    setLoginUrl(null);
    setInProgress((s) => new Set(s).add(key));
    timers.set(key, window.setTimeout(() => stopWaiting(key), 120_000));
    try {
      await invoke("mcp_login", { agent, id: name });
    } catch (e) {
      setFailure(asFailure(e));
      stopWaiting(key);
    }
  }

  onMount(() => {
    // Nombres literales: `scripts/bridge.mjs` solo lee esos.
    const url = listen<string>("mcp-login", (e) => setLoginUrl(e.payload));
    const end = listen<LoginEnded>("mcp", (e) => {
      if (e.payload?.ok) forgetSignedIn(e.payload.agent, e.payload.server);
      // Si salió mal, lo dice el turno siguiente: el botón pasa a «otra vez».
      const done = Array.from(inProgress());
      setFinished((s) => new Set([...s, ...done]));
      for (const key of done) stopWaiting(key);
      setLoginUrl(null);
    });
    onCleanup(() => {
      void url.then((f) => f());
      void end.then((f) => f());
      for (const timer of timers.values()) clearTimeout(timer);
    });
  });

  return (
    <Show when={servers().length > 0 && !dismissed().has(noticeKey())}>
      <Toast tone="status" onDismiss={() => setDismissed((s) => new Set(s).add(noticeKey()))}>
        <p class="m-0 text-[0.8125rem] font-semibold">{t("mcp.task.title")}</p>
        <p class="m-0 text-xs text-neutral-500">{t("mcp.task.body")}</p>
        <ul class="m-0 flex list-none flex-col gap-1.5 p-0">
          <For each={servers()}>
            {(s) => (
              <li class="flex items-center justify-between gap-2">
                <span class="min-w-0 truncate text-xs font-medium">{s.name}</span>
                <Show
                  when={inProgress().has(loginKey(s.name))}
                  fallback={
                    <Button size="sm" variant="outline" onClick={() => void signIn(s.name)}>
                      {finished().has(loginKey(s.name)) ? t("mcp.task.sign_in_again") : t("mcp.task.sign_in")}
                    </Button>
                  }
                >
                  <Show
                    when={loginUrl()}
                    fallback={<span class="text-xs text-neutral-500">{t("settings.tools.opening")}</span>}
                  >
                    {(u) => (
                      <Button
                        size="sm"
                        variant="ghost"
                        class="px-2 text-xs"
                        onClick={() => void invoke("open_external", { target: u() })}
                      >
                        {t("settings.tools.open_login")}
                      </Button>
                    )}
                  </Show>
                </Show>
              </li>
            )}
          </For>
        </ul>
        <Show when={finished().size > 0}>
          <p class="m-0 text-xs text-neutral-500">{t("mcp.task.next_turn")}</p>
        </Show>
        <Show when={failure()}>{(f) => <FailureNote f={f()} />}</Show>
      </Toast>
    </Show>
  );
}
