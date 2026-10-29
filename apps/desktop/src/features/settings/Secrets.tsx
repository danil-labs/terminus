/**
 * Configuración → Secretos: las variables de entorno que el motor da a los
 * agentes (`env_secret` en la cuenta). Solo escritura: se ven nombre, alcance,
 * fecha, los últimos 4 y las máquinas; el valor nunca vuelve a la pantalla.
 *
 * Trozo perezoso: lo carga quien abre la sección.
 */
import "../../locales/danilPhrases";
import { type Credential, type CredentialMachine, credentialMachines, credentialSlot, envSecretNameProblem, envSecretOf } from "@terminus/computers";
import { createMemo, createSignal, For, Match, onMount, Show, Switch } from "solid-js";
import { df } from "../../lib/format";
import { t } from "../../lib/i18n";
import { capabilities } from "../../lib/platform";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogTitle } from "../../ui/Dialog";
import { EmptyState } from "../../ui/EmptyState";
import { type Failure, FailureNote } from "../../ui/Failure";
import { Input } from "../../ui/Input";
import { Skeleton } from "../../ui/Skeleton";
import { Spinner } from "../../ui/Spinner";
import { CredentialMachines, LocalKeysBanner, Rotate } from "./credentials/AccountCredentials";
import { act, credentialsBackend, credentialsView, reloadCredentials } from "./credentials/store";
import { SettingsBlock, SettingsPanel, SettingsSection } from "./layout";

const NAME_PROBLEM = {
  empty: () => t("danil.secrets.name_empty"),
  grammar: () => t("danil.secrets.name_grammar"),
  reserved: () => t("danil.secrets.name_reserved"),
} as const;

const nameOf = (c: Credential) => envSecretOf(c.slot)?.name ?? c.slot;
const machineLabel = (m: Pick<CredentialMachine, "computer_id" | "name">) => m.name?.trim() || capabilities().machineName?.(m.computer_id) || m.computer_id;

/** Lo que se escribe en el nombre: mayúsculas, y espacio o guion como `_`. */
export const normalizeSecretName = (raw: string) => raw.toUpperCase().replace(/[\s-]/g, "_");

function updatedOf(c: Credential): string | null {
  const at = c.updated_at ?? c.created_at;
  const date = at ? new Date(at) : null;
  return date && !Number.isNaN(date.getTime()) ? df({ dateStyle: "medium" }).format(date) : null;
}

/** Una fila: nombre en mono, los últimos 4, fecha, Cambiar y Borrar, y sus máquinas. */
function SecretItem(props: { credential: Credential; overrides: boolean }) {
  const [rotating, setRotating] = createSignal(false);
  const [deleting, setDeleting] = createSignal(false);
  const [failure, setFailure] = createSignal<Failure | null>(null);
  const canRotate = () => !!credentialsBackend().rotate;
  const unsupported = createMemo(() => credentialMachines(props.credential).filter((m) => m.state === "unsupported"));
  const pending = () => props.credential.machines.some((m) => m.state === "pending");
  let changeButton: HTMLButtonElement | undefined;
  let cancelButton: HTMLButtonElement | undefined;
  return (
    <SettingsBlock data-secret={props.credential.slot}>
      <div class="flex min-w-0 items-center gap-2">
        <span class="min-w-0 truncate font-mono text-[0.8125rem] text-neutral-950">{nameOf(props.credential)}</span>
        <Show when={props.credential.hint}>{(hint) => <Badge forma="dato">{`••••${hint()}`}</Badge>}</Show>
        <span class="flex-1" />
        <Show when={canRotate()}>
          <Button ref={changeButton} variant="ghost" size="compact" onClick={() => setRotating((r) => !r)} aria-expanded={rotating()}>
            {t("danil.secrets.change")}
          </Button>
        </Show>
        <Button
          variant="ghost"
          size="compact"
          class="hover:text-error-strong"
          onClick={() => {
            setDeleting(true);
            queueMicrotask(() => cancelButton?.focus());
          }}
        >
          {t("danil.secrets.delete")}
        </Button>
      </div>
      <Show when={updatedOf(props.credential)}>{(at) => <p class="m-0 text-xs text-neutral-500">{t("danil.secrets.updated", { date: at() })}</p>}</Show>
      <Show when={props.overrides}>
        <p class="m-0 text-xs text-neutral-500">{t("danil.secrets.overrides")}</p>
      </Show>
      <Show when={deleting()}>
        <div class="grid gap-2 rounded-md border border-border bg-surface-muted px-3 py-2" data-delete-warning="">
          <p class="m-0 text-xs text-neutral-950">{t("danil.secrets.delete_warning")}</p>
          <div class="flex justify-end gap-2">
            <Button ref={cancelButton} variant="outline" size="compact" onClick={() => setDeleting(false)}>
              {t("danil.credentials.cancel")}
            </Button>
            <Button
              variant="danger"
              size="compact"
              onClick={async () => {
                setFailure(await act((b, ws) => b.remove(ws, props.credential.id)));
                setDeleting(false);
              }}
            >
              {t("danil.secrets.delete_yes")}
            </Button>
          </div>
        </div>
      </Show>
      <Show when={failure()}>{(f) => <FailureNote f={f()} />}</Show>
      <Show when={rotating()}>
        <Rotate
          credential={props.credential}
          onDone={() => {
            setRotating(false);
            changeButton?.focus();
          }}
        />
      </Show>
      <CredentialMachines credential={props.credential} />
      <Show when={pending()}>
        <p class="m-0 text-xs text-neutral-500" data-secret-pending-help="">{t("danil.secrets.pending_help")}</p>
      </Show>
      <For each={unsupported()}>
        {(m) => (
          <p class="m-0 text-xs text-neutral-500" data-secret-unsupported-help={m.computer_id}>
            {t("danil.secrets.unsupported_help", { machine: machineLabel(m) })}
          </p>
        )}
      </For>
    </SettingsBlock>
  );
}

/** Alta sellada en este cliente para cada máquina con `secrets_v1`; el valor no viaja en claro. */
function AddSecretDialog(props: { secrets: Credential[]; onClose: () => void }) {
  const [name, setName] = createSignal("");
  const [value, setValue] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [failure, setFailure] = createSignal<Failure | null>(null);
  const problem = () => (name() ? envSecretNameProblem(name()) : null);
  const slot = () => credentialSlot.envSecret(null, name());
  const existing = () => props.secrets.find((c) => c.slot === slot());
  const valid = () => !!value() && !envSecretNameProblem(name());
  async function save(e: Event) {
    e.preventDefault();
    if (busy() || !valid()) return;
    setBusy(true);
    setFailure(null);
    const v = value();
    const f = await act(async (b, ws) => {
      const now = credentialsView();
      if (now.kind !== "ready" || !b.create) return;
      await b.create(ws, { kind: "env_secret", provider: "env", slot: slot(), label: name(), config: { name: name(), folder: null } }, v, now.listing);
    });
    setBusy(false);
    setFailure(f);
    if (!f) props.onClose();
  }
  return (
    <Dialog open onOpenChange={(open) => !open && !busy() && props.onClose()}>
      <DialogContent class="w-[min(460px,100%)] max-w-[460px] p-4" aria-label={t("danil.secrets.add_title")}>
        <form class="grid gap-3" onSubmit={(e) => void save(e)} data-secret-add="">
          <DialogTitle>{t("danil.secrets.add_title")}</DialogTitle>
          <div class="grid gap-1">
            <label for="secret-name" class="text-xs font-semibold">
              {t("danil.secrets.name")}
            </label>
            <Input
              id="secret-name"
              class="font-mono"
              autocomplete="off"
              spellcheck={false}
              autofocus
              disabled={busy()}
              placeholder={t("danil.secrets.name_placeholder")}
              aria-invalid={!!problem()}
              aria-describedby={problem() ? "secret-name-problem" : undefined}
              value={name()}
              onInput={(e) => setName(normalizeSecretName(e.currentTarget.value))}
            />
            <Show when={problem()}>
              {(p) => (
                <p id="secret-name-problem" class="m-0 text-xs text-error-strong" data-secret-name-problem={p()}>
                  {NAME_PROBLEM[p()]()}
                </p>
              )}
            </Show>
            <Show when={!problem() && existing()}>
              {(c) => (
                <p class="m-0 text-xs text-warning-strong" data-secret-exists="">
                  {t("danil.secrets.exists", { name: name(), hint: c().hint ? `••••${c().hint}` : "••••", date: updatedOf(c()) ?? "—" })}
                </p>
              )}
            </Show>
          </div>
          <div class="grid gap-1">
            <label for="secret-value" class="text-xs font-semibold">
              {t("danil.secrets.value")}
            </label>
            <Input
              id="secret-value"
              type="password"
              autocomplete="off"
              disabled={busy()}
              placeholder={t("danil.secrets.value_placeholder")}
              value={value()}
              onInput={(e) => setValue(e.currentTarget.value)}
            />
          </div>
          <p class="m-0 border-t border-border pt-3 text-xs text-neutral-500">{t("danil.secrets.add_help")}</p>
          <Show when={failure()}>{(f) => <FailureNote f={f()} />}</Show>
          <div class="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={busy()} onClick={props.onClose}>
              {t("danil.credentials.cancel")}
            </Button>
            <Button type="submit" disabled={busy() || !valid()}>
              <Show when={busy()} fallback={existing() ? t("danil.secrets.replace") : t("danil.secrets.save")}>
                <Spinner size={12} />
                {t("danil.secrets.saving")}
              </Show>
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** «Solo en esta máquina»: el workspace no está en una cuenta de Danil. */
function ModeLine() {
  return (
    <div class="flex items-center gap-2 py-2" data-secrets-mode="no_session">
      <Badge>{t("danil.secrets.mode_local")}</Badge>
      <p class="m-0 text-xs text-neutral-500">{t("danil.secrets.mode_no_session")}</p>
    </div>
  );
}

export default function Secrets() {
  onMount(() => void reloadCredentials(false));
  const [adding, setAdding] = createSignal(false);
  let addButton: HTMLButtonElement | undefined;
  const secrets = createMemo(() => {
    const v = credentialsView();
    if (v.kind !== "ready") return [];
    return v.listing.credentials.filter((c) => c.kind === "env_secret" && envSecretOf(c.slot));
  });
  /** El workspace primero; luego cada carpeta por nombre, y dentro, por nombre de variable. */
  const groups = createMemo(() => {
    const by = new Map<string | null, Credential[]>();
    for (const c of secrets()) {
      const folder = envSecretOf(c.slot)!.folder;
      by.set(folder, [...(by.get(folder) ?? []), c]);
    }
    return [...by.entries()]
      .sort(([a], [b]) => (a === null ? -1 : b === null ? 1 : a.localeCompare(b)))
      .map(([folder, items]) => ({ folder, items: items.sort((x, y) => nameOf(x).localeCompare(nameOf(y))) }));
  });
  const workspaceNames = createMemo(() => new Set(groups().find((g) => g.folder === null)?.items.map(nameOf) ?? []));
  const failed = () => {
    const v = credentialsView();
    return v.kind === "failed" ? v.failure : null;
  };
  const canCreate = () => credentialsView().kind === "ready" && !!credentialsBackend().create;
  return (
    <SettingsPanel data-settings-secrets="">
      <SettingsSection
        title={t("danil.secrets.title")}
        description={t("danil.secrets.description")}
        aside={
          <Show when={canCreate()}>
            <Button ref={addButton} variant="secondary" size="sm" onClick={() => setAdding(true)}>
              {t("danil.secrets.add")}
            </Button>
          </Show>
        }
      >
        <Switch>
          <Match when={credentialsView().kind === "loading"}>
            <Skeleton filas={3} class="h-[52px]" />
          </Match>
          <Match when={credentialsView().kind === "none"}>
            <ModeLine />
          </Match>
          <Match when={failed()}>
            {(f) => (
              <div class="grid gap-2 pt-3">
                <FailureNote f={f()} />
                <div>
                  <Button variant="ghost" size="compact" onClick={() => void reloadCredentials()}>
                    {t("danil.secrets.retry")}
                  </Button>
                </div>
              </div>
            )}
          </Match>
          <Match when={credentialsView().kind === "ready"}>
            <div class="grid min-w-0 gap-1 pt-2">
              <LocalKeysBanner kinds={["env_secret"]} />
              <Show
                when={secrets().length > 0}
                fallback={<EmptyState class="mt-2" title={t("danil.secrets.empty_title")} description={t("danil.secrets.empty_help")} data-secrets-empty="" />}
              >
                <For each={groups()}>
                  {(g) => (
                    <div class="grid min-w-0" data-secrets-group={g.folder ?? "*"}>
                      <p class="m-0 pt-3 text-[0.8125rem] font-semibold">
                        {g.folder === null ? t("danil.secrets.scope_workspace") : t("danil.secrets.scope_folder", { folder: g.folder })}
                      </p>
                      <For each={g.items}>{(c) => <SecretItem credential={c} overrides={g.folder !== null && workspaceNames().has(nameOf(c))} />}</For>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </Match>
        </Switch>
      </SettingsSection>
      <Show when={adding()}>
        <AddSecretDialog
          secrets={secrets()}
          onClose={() => {
            setAdding(false);
            addButton?.focus();
          }}
        />
      </Show>
    </SettingsPanel>
  );
}
