import CircleUserRound from "lucide-solid/icons/circle-user-round";
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { t } from "../../lib/i18n";
import { capabilities } from "../../lib/platform";
import { cn } from "../../lib/utils";
import { engineAccountProfile } from "../settings/account-engine";
import { type AccountProfile, type AccountProfileSource, PROFILE_CHANGED } from "../settings/account-profile";
import { AccountAvatar, createAccountIdentity } from "../settings/AccountIdentity";
import { createDanilSession } from "../settings/danil-session";

/**
 * La cuenta de Danil al pie de la barra lateral: «Iniciar sesión» o la persona
 * (foto o iniciales, nombre) con su punto de en línea. Chunk aparte; sin el flujo
 * en el motor no pinta nada. En la web la persona viene de su sesión.
 */
export default function DanilFooterEntry(props: { collapsed: boolean; onOpen: () => void }) {
  const web = capabilities().accountProfile;
  return web ? <WebEntry {...props} source={web} /> : <MachineEntry {...props} />;
}

function MachineEntry(props: { collapsed: boolean; onOpen: () => void }) {
  const session = createDanilSession({ oneClick: false });
  const identity = createAccountIdentity(engineAccountProfile, session.status, { refresh: false });
  const conectada = () => session.status()?.state === "connected";
  const online = () => (conectada() ? Boolean(session.status()?.online) : null);
  return (
    <Show when={session.status()}>
      <Entry
        {...props}
        state={conectada() ? "connected" : "disconnected"}
        online={online()}
        profile={conectada() ? (identity.profile() ?? { name: null, email: session.status()?.email ?? null, photo: null, source: null }) : null}
      />
    </Show>
  );
}

function WebEntry(props: { collapsed: boolean; onOpen: () => void; source: AccountProfileSource }) {
  const [profile, setProfile] = createSignal<AccountProfile | null>(null);
  // Configuración avisa cuando cambia la foto: el pie no espera a recargar.
  onMount(() => {
    const read = () => void props.source.read().then(setProfile).catch(() => {});
    read();
    window.addEventListener(PROFILE_CHANGED, read);
    onCleanup(() => window.removeEventListener(PROFILE_CHANGED, read));
  });
  return (
    <Show when={profile()}>
      <Entry {...props} state="connected" online={null} profile={profile()} />
    </Show>
  );
}

function Entry(props: {
  collapsed: boolean;
  onOpen: () => void;
  state: "connected" | "disconnected";
  /** null: sin punto (la web no tiene sesión de máquina). */
  online: boolean | null;
  profile: AccountProfile | null;
}) {
  const quien = () => props.profile?.name || props.profile?.email || t("danil.account.your_account");
  const titulo = () => {
    if (props.state !== "connected") return t("danil.footer.sign_in_title");
    if (props.online === null) return quien();
    return props.online ? t("danil.footer.online", { who: quien() }) : t("danil.footer.offline", { who: quien() });
  };

  return (
    <button
      type="button"
      data-danil-foot={props.state}
      aria-label={titulo()}
      title={titulo()}
      onClick={() => props.onOpen()}
      class={cn(
        "flex h-7 min-w-0 cursor-pointer items-center gap-2 rounded-md text-xs text-neutral-700 transition-colors hover:bg-neutral-100",
        props.collapsed ? "w-7 shrink-0 justify-center" : "flex-1 px-1.5",
      )}
    >
      <span class="relative flex size-5 shrink-0 items-center justify-center">
        <Show
          when={props.state === "connected" && (props.profile?.photo || props.profile?.name || props.profile?.email)}
          fallback={
            <span class="flex size-5 items-center justify-center rounded-full bg-surface-muted text-neutral-700">
              <CircleUserRound size={15} aria-hidden="true" />
            </span>
          }
        >
          <AccountAvatar profile={props.profile} class="size-5 text-[10px]" />
        </Show>
        <Show when={props.online !== null && props.state === "connected"}>
          <span
            aria-hidden="true"
            class={cn(
              "absolute -right-0.5 -bottom-0.5 size-2 rounded-full border border-surface-raised",
              props.online ? "bg-success" : "bg-neutral-300",
            )}
          />
        </Show>
      </span>
      <Show when={!props.collapsed}>
        <span class="min-w-0 truncate">{props.state === "connected" ? quien() : t("danil.footer.sign_in")}</span>
      </Show>
    </button>
  );
}
