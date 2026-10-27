import { createSignal, onMount, Show } from "solid-js";
import { t } from "../lib/i18n";
import { Button } from "../ui/Button";
import type { Session } from "./session";

/** Account identity stays visible before approving a machine or resolving access. */
export function BrowserAccount(props: { session: Session; disabled?: boolean; onChange?: () => void }) {
  const [email, setEmail] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  onMount(() => void props.session.email?.().then(setEmail).catch(() => {}));
  async function change() {
    setBusy(true);
    setFailed(false);
    try {
      if (props.onChange) props.onChange();
      else await props.session.signOut?.();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Show when={email()}>
      <div class="mb-6 grid max-w-sm gap-2">
        <p class="m-0 break-words text-sm text-neutral-500">{t("web.auth.active_account", { email: email() ?? "" })}</p>
        <Show when={props.onChange || props.session.signOut}>
          <Button class="min-h-11 justify-self-start" size="sm" variant="ghost" disabled={busy() || props.disabled} onClick={() => void change()}>{t("web.auth.change_account")}</Button>
        </Show>
        <Show when={failed()}><p class="m-0 text-sm text-error-strong" role="alert">{t("web.auth.failed")}</p></Show>
      </div>
    </Show>
  );
}
