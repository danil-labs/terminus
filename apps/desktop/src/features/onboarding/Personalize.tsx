import Pencil from "lucide-solid/icons/pencil";
import { createSignal, onMount, Show } from "solid-js";
import { t } from "../../lib/i18n";
import { invoke } from "../../lib/invoke.ts";
import { capabilities } from "../../lib/platform";
import { Button } from "../../ui/Button";
import { prosaDe } from "../../ui/Failure";
import { Input } from "../../ui/Input";
import { createDanilSession, DanilSignInChoices } from "../settings/danil-session";
import { Comprobacion } from "./ConnectAI";
import { Integraciones, Plugins } from "./ToolCards";

/** La cuenta de Danil es de la computadora: se ofrece aquí mientras no haya sesión. */
function CuentaDanil() {
  const session = createDanilSession();
  const estado = () => session.status()?.state;
  return (
    <Show when={estado() === "disconnected" || estado() === "pending"}>
      <div class="grid gap-2 border-t border-border pt-4" data-danil-onboarding={estado()}>
        <span class="text-[13px] font-semibold text-neutral-950">{t("danil.onboarding.title")}</span>
        <span class="text-xs text-neutral-500">{t("danil.onboarding.lede")}</span>
        <Show when={estado() === "pending"} fallback={<DanilSignInChoices session={session} />}>
          <div class="grid gap-2 rounded-md border border-border bg-surface-raised px-3 py-2.5">
            <strong class="text-[13px] font-semibold text-neutral-950">
              {t("danil.account.pending", { code: session.status()?.user_code ?? "" })}
            </strong>
            <span class="text-xs text-neutral-500">{t("danil.account.pending_hint")}</span>
            <div class="flex flex-wrap items-center gap-2">
              <Show when={session.status()?.verification_uri_complete}>
                <Button size="sm" variant="secondary" onClick={session.reopen}>
                  {t("danil.account.open_again")}
                </Button>
              </Show>
              <Button size="sm" variant="ghost" disabled={session.busy()} onClick={() => void session.signOut()}>
                {t("danil.account.cancel")}
              </Button>
            </div>
          </div>
        </Show>
        <Show when={session.message()}>
          {(text) => <p class="m-0 text-[0.8125rem] text-error-strong" role="alert">{text()}</p>}
        </Show>
        <span class="text-xs text-neutral-500">{t("danil.onboarding.footer")}</span>
      </div>
    </Show>
  );
}

/** La última pantalla del alta: el workspace, las herramientas con que ya se trabaja y los plugins. */
export default function Personalizar(props: {
  workspace: { id: string; nombre: string } | null;
  ia: string[];
  onAtras?: () => void;
  onListo: () => void;
}) {
  const [nombre, setNombre] = createSignal(props.workspace?.nombre ?? "");
  const [editando, setEditando] = createSignal(false);
  const [borrador, setBorrador] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [integraciones, setIntegraciones] = createSignal(0);
  const [plugins, setPlugins] = createSignal({ instalados: 0, instalando: 0 });
  let titulo: HTMLHeadingElement | undefined;

  onMount(() => titulo?.focus({ preventScroll: true }));

  function editar() {
    setBorrador(nombre());
    setEditando(true);
  }

  async function renombrar() {
    const nuevo = borrador().trim();
    setEditando(false);
    const w = props.workspace;
    if (!w || !nuevo || nuevo === nombre()) return;
    const antes = nombre();
    setNombre(nuevo);
    setError(null);
    try {
      await invoke("rename_workspace", { id: w.id, name: nuevo });
      window.dispatchEvent(new CustomEvent("harness:workspace"));
    } catch (e) {
      setNombre(antes);
      setError(prosaDe(e));
    }
  }

  const resumenPlugins = () => {
    const p = plugins();
    if (p.instalados && p.instalando) return t("onboarding.summary.plugins_both", { count: p.instalados, pending: p.instalando });
    if (p.instalados) return t("onboarding.summary.plugins", { count: p.instalados });
    return p.instalando ? t("onboarding.summary.plugins_installing") : t("onboarding.summary.no_plugins");
  };

  return (
    <>
      <div class="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-[minmax(0,36%)_minmax(0,64%)] md:overflow-hidden motion-safe:animate-entrar">
        <section class="flex flex-col gap-[22px] p-7">
          <div>
            <h1
              ref={titulo}
              tabindex="-1"
              class="m-0 text-3xl leading-[1.12] font-display font-bold tracking-[-0.03em] text-neutral-950 outline-none"
            >
              {t("onboarding.personalize.title")}
            </h1>
            <p class="m-0 mt-3.5 max-w-[40ch] text-sm text-neutral-500">{t("onboarding.personalize.lede")}</p>
          </div>
          <div class="grid gap-1.5">
            <span class="text-[13px] font-semibold text-neutral-950">{t("onboarding.workspace.label")}</span>
            <Show
              when={editando()}
              fallback={
                <div class="flex h-9 items-center gap-2 rounded-md border border-border-strong bg-surface-raised px-3">
                  <span class="min-w-0 flex-1 truncate text-[13px] text-neutral-950">{nombre()}</span>
                  <Show when={props.workspace}>
                    <button
                      type="button"
                      class="grid cursor-pointer place-items-center border-0 bg-transparent p-0 text-neutral-500 outline-none hover:text-neutral-950 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                      aria-label={t("onboarding.workspace.rename")}
                      title={t("onboarding.workspace.rename")}
                      onClick={editar}
                    >
                      <Pencil size={14} aria-hidden="true" />
                    </button>
                  </Show>
                </div>
              }
            >
              <Input
                value={borrador()}
                aria-label={t("onboarding.workspace.label")}
                ref={(el) =>
                  queueMicrotask(() => {
                    el.focus();
                    el.select();
                  })
                }
                onInput={(e) => setBorrador(e.currentTarget.value)}
                onBlur={() => void renombrar()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void renombrar();
                  if (e.key === "Escape") setEditando(false);
                }}
              />
            </Show>
            <span class="text-xs text-neutral-500">{error() ?? t("onboarding.workspace.hint")}</span>
          </div>
          <div class="border-t border-border pt-4">
            <Comprobacion
              compacta
              filas={[
                { hecho: true, texto: t("onboarding.check.environment") },
                { hecho: props.ia.length > 0, texto: props.ia.length ? props.ia.join(", ") : t("onboarding.summary.no_ai") },
                { hecho: true, texto: t("onboarding.summary.integrations", { count: integraciones() }) },
                { hecho: plugins().instalados > 0, enCurso: plugins().instalando > 0, texto: resumenPlugins() },
              ]}
            />
          </div>
          <Show when={capabilities().danilAccount}>
            <CuentaDanil />
          </Show>
        </section>
        <section class="flex min-h-0 flex-col gap-3 px-7 pb-5 md:overflow-y-auto md:pt-7 md:pl-2 [&>*]:shrink-0">
          <div class="grid gap-0.5">
            <h2 class="m-0 text-[13px] font-semibold text-neutral-950">{t("onboarding.tools.title")}</h2>
            <p class="m-0 text-xs text-neutral-500">{t("onboarding.tools.lede")}</p>
          </div>
          <Integraciones onCambio={setIntegraciones} />
          <div class="mt-2 grid gap-0.5">
            <h2 class="m-0 text-[13px] font-semibold text-neutral-950">{t("onboarding.plugins.title")}</h2>
            <p class="m-0 text-xs text-neutral-500">{t("onboarding.plugins.lede")}</p>
          </div>
          <Plugins onCambio={setPlugins} />
        </section>
      </div>
      <footer class="flex flex-wrap items-center gap-2.5 border-t border-border px-5 py-3.5">
        <Show when={props.onAtras}>
          {(atras) => (
            <Button size="sm" variant="ghost" onClick={() => atras()()}>
              {t("onboarding.back")}
            </Button>
          )}
        </Show>
        <p class="m-0 text-xs text-neutral-500">
          {plugins().instalando ? t("onboarding.plugins.background", { count: plugins().instalando }) : ""}
        </p>
        <span class="flex-1" />
        <Button size="sm" variant="ghost" onClick={() => props.onListo()}>
          {t("onboarding.personalize.later")}
        </Button>
        <Button size="sm" onClick={() => props.onListo()}>
          {t("onboarding.personalize.start")}
        </Button>
      </footer>
    </>
  );
}
