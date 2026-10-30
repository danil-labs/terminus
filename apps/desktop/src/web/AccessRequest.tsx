import { createSignal, For, onMount, Show } from "solid-js";
import { lengua, t } from "../lib/i18n";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { type AccessRequestSource, validPhone } from "./access-request";
import type { Session } from "./session";

const POINTS = ["platform", "teams", "permissions"] as const;

/** Quien entra a alfa sin workspace: qué se puede hacer con Danil y su solicitud. Nada de conectar máquinas. */
export function AccessRequest(props: { source: AccessRequestSource; session: Session; name: string | null }) {
  const [email, setEmail] = createSignal("");
  const [phone, setPhone] = createSignal("");
  const [name, setName] = createSignal(props.name ?? "");
  const [company, setCompany] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const [sent, setSent] = createSignal(false);

  onMount(() => {
    document.title = "Danil";
    void props.session.email?.().then((e) => setEmail(e ?? "")).catch(() => {});
    // Si no se pudo leer, se ve el formulario: el BFF no duplica una solicitud ya enviada.
    void props.source.requested().then(setSent).catch(() => {});
  });

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy()) return;
    if (!validPhone(phone())) return setError(t("web.access.phone_invalid"));
    setBusy(true);
    setError("");
    try {
      await props.source.send({ phone: phone(), name: name(), company: company(), locale: lengua() === "en" ? "en" : "es" });
      setSent(true);
    } catch {
      setError(t("web.access.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="grid w-full max-w-[60ch] gap-8 text-sm text-neutral-950" data-access-request={sent() ? "sent" : "form"}>
      <div class="grid gap-2">
        <h2 class="m-0 text-xl font-semibold">{t(sent() ? "web.access.sent_title" : "web.access.title")}</h2>
        <Show when={!sent()}>
          <p class="m-0 text-neutral-500">{t("web.access.intro")}</p>
        </Show>
      </div>
      <section class="grid gap-3">
        <h3 class="m-0 text-base font-semibold">{t("web.access.what")}</h3>
        <p class="m-0 text-neutral-700">{t("web.access.lead")}</p>
        <dl class="m-0 grid gap-3">
          <For each={POINTS}>
            {(point) => (
              <div class="grid gap-0.5">
                <dt class="font-medium">{t(`web.access.${point}_title`)}</dt>
                <dd class="m-0 text-neutral-700">{t(`web.access.${point}`)}</dd>
              </div>
            )}
          </For>
        </dl>
      </section>
      <Show
        when={!sent()}
        fallback={
          <section class="grid gap-1 rounded-md border border-border p-4" role="status" data-access-sent="">
            <p class="m-0 text-neutral-700">{t("web.access.sent")}</p>
          </section>
        }
      >
        <form class="grid max-w-sm gap-3" onSubmit={(e) => void submit(e)} noValidate>
          <h3 class="m-0 text-base font-semibold">{t("web.access.form_title")}</h3>
          <label class="grid gap-1 text-xs text-neutral-500">
            {t("web.access.email")}
            <Input class="min-h-11" value={email()} readOnly aria-readonly="true" data-access-email="" />
          </label>
          <label class="grid gap-1 text-xs text-neutral-500">
            {t("web.access.phone")}
            <Input class="min-h-11" type="tel" autocomplete="tel" maxLength={40} required value={phone()} onInput={(e) => setPhone(e.currentTarget.value)} data-access-phone="" />
          </label>
          <label class="grid gap-1 text-xs text-neutral-500">
            {t("web.access.name")}
            <Input class="min-h-11" autocomplete="name" maxLength={120} value={name()} onInput={(e) => setName(e.currentTarget.value)} data-access-name="" />
          </label>
          <label class="grid gap-1 text-xs text-neutral-500">
            {t("web.access.company")}
            <Input class="min-h-11" autocomplete="organization" maxLength={160} value={company()} onInput={(e) => setCompany(e.currentTarget.value)} data-access-company="" />
          </label>
          <Show when={error()}>
            <p class="m-0 text-sm text-error-strong" role="alert" data-access-error="">{error()}</p>
          </Show>
          <Button class="min-h-11" type="submit" disabled={busy()} data-access-submit="">
            {t(busy() ? "web.access.sending" : "web.access.submit")}
          </Button>
        </form>
      </Show>
    </div>
  );
}
