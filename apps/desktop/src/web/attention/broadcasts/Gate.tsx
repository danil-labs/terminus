import { createSignal, For, Show } from 'solid-js';
import Check from 'lucide-solid/icons/check';
import Megaphone from 'lucide-solid/icons/megaphone';
import { t } from '../../../lib/i18n';
import { Button } from '../../../ui/Button';
import { Input } from '../../../ui/Input';
import { errorText, Field, type Context } from './parts';

/** La cuenta no tiene la función: pedir prueba abre un aviso, no concede nada. */
export function FeatureGate(props: { context: Context; account: number }) {
  const [phone, setPhone] = createSignal('');
  const [sent, setSent] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const ready = () => phone().trim().length >= 7 && !busy() && props.context.api.writes;
  async function request(event: Event) {
    event.preventDefault();
    if (!ready()) return;
    setBusy(true); setError('');
    try { await props.context.api.requestAccess(props.account, phone().trim()); setSent(true); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }
  return <div class="grid h-full place-items-center overflow-y-auto p-4">
    <section class="w-full max-w-md rounded-lg border border-border bg-surface p-6" aria-label={t("broadcasts.gate_title")}>
      <span class="grid size-10 place-items-center rounded-md bg-surface-muted text-primary"><Megaphone size={20}/></span>
      <h2 class="m-0 mt-4 text-lg font-semibold text-neutral-950">{t("broadcasts.gate_title")}</h2>
      <p class="m-0 mt-1 text-sm leading-relaxed text-neutral-700">{t("broadcasts.gate_blurb")}</p>
      <ul class="m-0 mt-4 grid list-none gap-2 p-0">
        <For each={[t("broadcasts.gate_bullet1"), t("broadcasts.gate_bullet2"), t("broadcasts.gate_bullet3")]}>{line => <li class="flex items-start gap-2 text-sm text-neutral-700"><Check size={16} class="mt-0.5 shrink-0 text-primary"/><span>{line}</span></li>}</For>
      </ul>
      <Show when={!sent()} fallback={<p role="status" class="m-0 mt-6 flex items-center gap-2 text-sm text-success-strong"><Check size={16} class="shrink-0"/>{t("broadcasts.gate_sent")}</p>}>
        <form class="mt-6 grid gap-3" onSubmit={event => void request(event)}>
          <Field label={t("broadcasts.gate_phone")} for="gate-phone"><Input id="gate-phone" type="tel" inputMode="tel" value={phone()} placeholder={t("broadcasts.gate_phone_placeholder")} onInput={event => setPhone(event.currentTarget.value)}/></Field>
          <Show when={error()}><p role="alert" class="m-0 text-ui font-medium text-error-strong">{error()}</p></Show>
          <Button type="submit" disabled={!ready()}>{busy() ? t("broadcasts.gate_sending") : t("broadcasts.gate_request")}</Button>
          <p class="m-0 text-center text-xs text-neutral-500">{t("broadcasts.gate_hint")}</p>
        </form>
      </Show>
    </section>
  </div>;
}
