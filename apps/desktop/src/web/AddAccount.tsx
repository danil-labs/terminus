/**
 * «Agregar cuenta» (`?add-account`): sign in to another Danil account in this
 * browser without touching the Danil app's session (`docs/web-multi-account.md`).
 * Each attempt gets a new slot, its own storage key; Google and Microsoft come
 * back here with `?account-callback=<slot>&code=…` and the code is exchanged in
 * that same slot (PKCE). Loaded only on this page.
 */
import { render } from "solid-js/web";
import { createSignal, For, Show } from "solid-js";
import { t } from "../lib/i18n";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { type Account, type ChooserRow, type StorageLike, SLOT_PREFIX, addExtra, chooserRows, newSlot, rememberLast } from "./accounts";
import type { BrowserSession } from "./session";

/** The slot waiting for Google or Microsoft: only that one is accepted back. */
const PENDING_KEY = "terminus.web.pending-slot";
const SLOT = /^[a-z0-9]{8,32}$/;

type Provider = "google" | "azure";

export type AddAccountOptions = {
  storage: StorageLike | null;
  accounts: Account[];
  clientFor: (slot: string) => BrowserSession;
  /** The page without query, where the new account opens. */
  home: string;
  /** Signing in again with an account whose session expired. */
  email: string | null;
  callback: string | null;
  code: string | null;
  error: string | null;
};

/** Forgets what an unfinished attempt left in its slot (the PKCE verifier, a half session). */
function dropSlot(storage: StorageLike | null, slot: string) {
  try {
    for (const suffix of ["", "-code-verifier", "-user"]) storage?.removeItem(SLOT_PREFIX + slot + suffix);
    if (storage?.getItem(PENDING_KEY) === JSON.stringify(slot)) storage.removeItem(PENDING_KEY);
  } catch {
    // Nothing to forget.
  }
}

/** Installed as an app (iOS standalone), the provider's page comes back in the browser, with other storage: only the password works. */
const standalone = () => typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches;

export function startAddAccount(root: HTMLElement, options: AddAccountOptions) {
  root.replaceChildren();
  render(() => <AddAccount {...options} />, root);
}

function AddAccount(props: AddAccountOptions) {
  const [email, setEmail] = createSignal(props.email ?? "");
  const [password, setPassword] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [failure, setFailure] = createSignal<string | null>(props.error);
  // Como Google: primero las cuentas que ya tienen sesión aquí; otra, solo si se pide.
  const rows = chooserRows(props.accounts);
  const [choosing, setChoosing] = createSignal(!props.callback && !props.email && !props.error && rows.length > 0);

  function choose(row: ChooserRow) {
    if (row.action === "open") {
      rememberLast(props.storage, row.user_id);
      window.location.replace(props.home);
      return;
    }
    setEmail(row.email ?? "");
    setChoosing(false);
  }

  /** The session is in `slot`: keep the account and open it. */
  async function finish(slot: string) {
    const client = props.clientFor(slot);
    const added = await addExtra(props.storage, props.accounts, slot, client);
    if (added.kind === "no_session") {
      dropSlot(props.storage, slot);
      setFailure(t("web.add_account.failed"));
      return;
    }
    if (added.kind === "duplicate") dropSlot(props.storage, slot);
    rememberLast(props.storage, added.user.user_id);
    window.location.replace(props.home);
  }

  // Back from Google or Microsoft: only the slot this browser left waiting.
  if (props.callback) {
    const slot = props.callback;
    let pending: string | null = null;
    try {
      pending = JSON.parse(props.storage?.getItem(PENDING_KEY) ?? "null");
    } catch {
      pending = null;
    }
    if (!SLOT.test(slot) || slot !== pending || !props.code) {
      if (SLOT.test(slot) && slot === pending) dropSlot(props.storage, slot);
      setFailure((current) => current ?? t("web.add_account.failed"));
    } else {
      setBusy(true);
      void props
        .clientFor(slot)
        .client.auth.exchangeCodeForSession(props.code)
        .then(async ({ error }) => {
          if (error) {
            dropSlot(props.storage, slot);
            setFailure(error.message);
            return;
          }
          await finish(slot);
        })
        .catch((e: unknown) => setFailure(String(e)))
        .finally(() => setBusy(false));
    }
  }

  async function withProvider(provider: Provider) {
    setFailure(null);
    const slot = newSlot();
    props.storage?.setItem(PENDING_KEY, JSON.stringify(slot));
    const { error } = await props.clientFor(slot).client.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${props.home}?account-callback=${slot}` },
    });
    if (error) {
      dropSlot(props.storage, slot);
      setFailure(error.message);
    }
  }

  async function withPassword(event: Event) {
    event.preventDefault();
    setFailure(null);
    setBusy(true);
    const slot = newSlot();
    try {
      const { error } = await props.clientFor(slot).client.auth.signInWithPassword({ email: email().trim(), password: password() });
      if (error) {
        dropSlot(props.storage, slot);
        setFailure(error.message);
        return;
      }
      await finish(slot);
    } finally {
      setBusy(false);
    }
  }

  const providers: { id: Provider; label: () => string }[] = [
    { id: "google", label: () => t("web.add_account.google") },
    { id: "azure", label: () => t("web.add_account.microsoft") },
  ];

  const chooser = () => (
    <main class="flex h-full flex-col overflow-y-auto bg-bg px-10 py-10" data-account-chooser="">
      <h1 class="m-0 mb-2 text-3xl leading-tight font-display font-bold tracking-[-0.03em] text-neutral-950">{t("web.add_account.choose_title")}</h1>
      <p class="m-0 mb-6 max-w-[60ch] text-sm text-neutral-700">{t("web.add_account.choose_body")}</p>
      <ul class="m-0 flex max-w-sm list-none flex-col gap-2 p-0">
        <For each={rows}>
          {(row) => (
            <li>
              <button
                type="button"
                data-chooser-account={row.user_id}
                data-chooser-action={row.action}
                class="flex w-full items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-left outline-none hover:bg-neutral-200 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-primary"
                onClick={() => choose(row)}
              >
                <span aria-hidden="true" class="grid size-8 shrink-0 place-items-center rounded-full bg-neutral-200 text-sm font-semibold text-neutral-700">
                  {(row.name || row.email || "?").trim().charAt(0).toUpperCase()}
                </span>
                <span class="flex min-w-0 flex-1 flex-col">
                  <span class="truncate text-sm font-medium text-neutral-950">{row.name || row.email}</span>
                  <Show when={row.name}>
                    <span class="truncate text-xs text-neutral-500">{row.email}</span>
                  </Show>
                </span>
                <span class="shrink-0 text-xs text-neutral-500">
                  {row.action === "open" ? t("web.add_account.signed_in") : t("web.add_account.sign_in_again")}
                </span>
              </button>
            </li>
          )}
        </For>
        <li>
          <button
            type="button"
            data-chooser-another=""
            class="flex w-full items-center gap-3 rounded-lg border border-dashed border-neutral-500 px-3 py-2 text-left text-sm text-neutral-700 outline-none hover:bg-neutral-200 hover:text-neutral-950 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-primary"
            onClick={() => setChoosing(false)}
          >
            {t("web.add_account.use_another")}
          </button>
        </li>
      </ul>
      <a class="mt-4 text-sm text-neutral-700 underline" href={props.home}>
        {t("web.add_account.cancel")}
      </a>
    </main>
  );

  const form = () => (
    <main class="flex h-full flex-col overflow-y-auto bg-bg px-10 py-10" data-add-account-page="">
      <h1 class="m-0 mb-2 text-3xl leading-tight font-display font-bold tracking-[-0.03em] text-neutral-950">{t("web.add_account.title")}</h1>
      <p class="m-0 mb-6 max-w-[60ch] text-sm text-neutral-700">{t("web.add_account.body")}</p>
      <div class="flex max-w-sm flex-col gap-3">
        <Show when={!standalone()}>
          <For each={providers}>
            {(p) => (
              <Button variant="secondary" disabled={busy()} onClick={() => void withProvider(p.id)}>
                {p.label()}
              </Button>
            )}
          </For>
          <p class="m-0 text-center text-xs text-neutral-500">{t("web.add_account.or")}</p>
        </Show>
        <form class="flex flex-col gap-2" onSubmit={(e) => void withPassword(e)}>
          <Input type="email" autocomplete="username" required placeholder={t("web.add_account.email")} value={email()} onInput={(e) => setEmail(e.currentTarget.value)} />
          <Input type="password" autocomplete="current-password" required placeholder={t("web.add_account.password")} value={password()} onInput={(e) => setPassword(e.currentTarget.value)} />
          <Button type="submit" disabled={busy()}>
            {t("web.add_account.submit")}
          </Button>
        </form>
        <Show when={failure()}>{(text) => <p role="alert" class="m-0 text-sm text-error-strong">{text()}</p>}</Show>
        <Show when={rows.length > 0}>
          <button type="button" class="self-start text-sm text-neutral-700 underline" data-chooser-back="" onClick={() => (setFailure(null), setChoosing(true))}>
            {t("web.add_account.back_to_accounts")}
          </button>
        </Show>
        <a class="text-sm text-neutral-700 underline" href={props.home}>
          {t("web.add_account.cancel")}
        </a>
      </div>
    </main>
  );

  return <Show when={choosing()} fallback={form()}>{chooser()}</Show>;
}
