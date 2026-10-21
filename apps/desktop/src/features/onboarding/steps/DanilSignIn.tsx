import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { t } from "../../../lib/i18n";
import { Button } from "../../../ui/Button";
import { createDanilSession, DanilSignInChoices } from "../../settings/danil-session";
import { Pantalla } from "../Screen";
import type { Alta } from "../onboarding-store";

/** Lo más que espera el alta a que el motor diga el estado antes de seguir sin este paso. */
const ESPERA_MS = 4000;

/**
 * Paso 1, opcional: iniciar sesión con Danil. Solo se ve si el motor trae el flujo
 * y la computadora está desconectada; cualquier otra cosa sigue al paso 2.
 */
export default function IniciarSesionDanil(props: { alta: Alta }) {
  const session = createDanilSession();
  const [visible, setVisible] = createSignal(false);
  const seguir = () => props.alta.set("paso", "agents");

  onMount(() => {
    const espera = setTimeout(() => {
      if (session.view().t === "loading") seguir();
    }, ESPERA_MS);
    onCleanup(() => clearTimeout(espera));
  });

  createEffect(() => {
    const v = session.view();
    if (v.t === "loading") return;
    const estado = session.status()?.state;
    if (!visible()) {
      if (estado === "disconnected") setVisible(true);
      else seguir();
    } else if (estado === "connected") {
      seguir();
    }
  });

  return (
    <Show when={visible()} fallback={<div class="flex-1" />}>
      <Pantalla
        titulo={t("danil.onboarding.title")}
        lede={t("danil.onboarding.lede")}
        pie={t("danil.onboarding.footer")}
        primario={{ rotulo: t("danil.onboarding.later"), onClick: seguir, variant: "secondary" }}
      >
        <div class="grid gap-3" data-danil-onboarding={session.status()?.state ?? session.view().t}>
          <Show
            when={session.status()?.state === "pending"}
            fallback={<DanilSignInChoices session={session} />}
          >
            <div class="grid gap-2 rounded-md border border-border bg-surface-raised px-4 py-3">
              <strong class="text-sm font-semibold text-neutral-950">
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
        </div>
      </Pantalla>
    </Show>
  );
}
