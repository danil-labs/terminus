import CircleUserRound from "lucide-solid/icons/circle-user-round";
import { Show } from "solid-js";
import { t } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { createDanilSession } from "../settings/danil-session";

/**
 * La cuenta de Danil al pie de la barra lateral: «Iniciar sesión» o el correo con
 * su punto de en línea. Chunk aparte; sin el flujo en el motor no pinta nada.
 */
export default function DanilFooterEntry(props: { collapsed: boolean; onOpen: () => void }) {
  const session = createDanilSession({ oneClick: false });
  const conectada = () => session.status()?.state === "connected";
  const quien = () => session.status()?.email || t("danil.account.your_account");
  const titulo = () => {
    if (!conectada()) return t("danil.footer.sign_in_title");
    return session.status()?.online
      ? t("danil.footer.online", { who: quien() })
      : t("danil.footer.offline", { who: quien() });
  };

  return (
    <Show when={session.status()}>
      <button
        type="button"
        data-danil-foot={conectada() ? "connected" : "disconnected"}
        aria-label={titulo()}
        title={titulo()}
        onClick={() => props.onOpen()}
        class={cn(
          "flex h-7 min-w-0 cursor-pointer items-center gap-2 rounded-md text-xs text-neutral-700 transition-colors hover:bg-neutral-100",
          props.collapsed ? "w-7 shrink-0 justify-center" : "flex-1 px-1.5",
        )}
      >
        <span class="relative flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-muted text-[11px] font-semibold text-neutral-700 uppercase">
          <Show when={conectada() && session.status()?.email} fallback={<CircleUserRound size={15} aria-hidden="true" />}>
            {(email) => email().trim().charAt(0)}
          </Show>
          <Show when={conectada()}>
            <span
              aria-hidden="true"
              class={cn(
                "absolute -right-0.5 -bottom-0.5 size-2 rounded-full border border-surface-raised",
                session.status()?.online ? "bg-success" : "bg-neutral-300",
              )}
            />
          </Show>
        </span>
        <Show when={!props.collapsed}>
          <span class="min-w-0 truncate">{conectada() ? quien() : t("danil.footer.sign_in")}</span>
        </Show>
      </button>
    </Show>
  );
}
