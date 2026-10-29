import {
  type Computer,
  type Connection,
  PERMISSION_MODES,
  listComputers,
  listConnections,
  mcpUrl,
  revokeConnection,
  updateConnection,
} from "@terminus/computers";
import { createResource, createSignal, For, Show } from "solid-js";
import { t } from "../../lib/i18n";
import { invoke } from "../../lib/invoke.ts";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogTitle } from "../../ui/Dialog";
import { EmptyState } from "../../ui/EmptyState";
import { Input } from "../../ui/Input";
import { Select } from "../../ui/Select";
import { SettingsPanel, SettingsRow, SettingsSection } from "./layout";
import { snippets } from "./orchestratorSnippets.ts";

/** `account_relay_token` (`proxy.rs`): el token de cliente de la cuenta y el plano de control. */
type ClientToken = { token: string; expires_at: number; endpoint: string };

type Loaded = { endpoint: string; connections: Connection[]; computers: Computer[] } | { failed: string };

async function token(): Promise<ClientToken> {
  return (await invoke("account_relay_token", {})) as ClientToken;
}

async function load(): Promise<Loaded> {
  try {
    const { token: tok, endpoint } = await token();
    const [connections, computers] = await Promise.all([listConnections(endpoint, tok), listComputers(endpoint, tok)]);
    if (connections.kind !== "ok") return { failed: connections.kind };
    return { endpoint, connections: connections.value, computers: computers.kind === "ok" ? computers.value : [] };
  } catch {
    return { failed: "no_account" };
  }
}

const stateTone = (state: Connection["state"]) =>
  state === "active" ? "success" : state === "pending" ? "warning" : "neutral";

/** Un orquestador de esta máquina (`list_local_orchestrators`, extensión del motor). */
type LocalOrchestrator = {
  id: string;
  label: string;
  task_id: string;
  permission_mode: string | null;
  created_at: number;
  active: boolean;
  credential_file: string;
  cli: string | null;
};

async function loadLocal(workspace: string | null): Promise<LocalOrchestrator[] | null> {
  if (!workspace) return null;
  try {
    return await invoke<LocalOrchestrator[]>("list_local_orchestrators", { workspace });
  } catch {
    // Un motor sin la extensión no conoce la orden: el apartado no aparece.
    return null;
  }
}

/** «En esta máquina»: orquestadores que corren aquí, sin cuenta de Danil. */
function LocalSection(props: { workspace: string | null }) {
  const [rows, { refetch }] = createResource(() => props.workspace, loadLocal);
  const [label, setLabel] = createSignal("");
  const [mode, setMode] = createSignal<string>("manual");
  const [busy, setBusy] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  const [open, setOpen] = createSignal<string | null>(null);
  const [copied, setCopied] = createSignal<string | null>(null);
  const [removing, setRemoving] = createSignal<LocalOrchestrator | null>(null);

  async function connect() {
    setBusy(true);
    setFailed(false);
    try {
      const made = await invoke<LocalOrchestrator>("local_orchestrator_connect", {
        workspace: props.workspace,
        label: label().trim(),
        permissionMode: mode(),
      });
      setLabel("");
      await refetch();
      setOpen(made.id);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect(o: LocalOrchestrator) {
    setBusy(true);
    setFailed(false);
    try {
      await invoke("local_orchestrator_disconnect", { workspace: props.workspace, id: o.id });
      await refetch();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
      setRemoving(null);
    }
  }

  return (
    <Show when={rows() !== null && rows() !== undefined}>
      <SettingsSection title={t("settings.connections.local.title")} description={t("settings.connections.local.description")}>
        <Show when={failed()}>
          <p class="m-0 py-2 text-[0.8125rem] text-error-strong" role="alert">
            {t("settings.connections.failed")}
          </p>
        </Show>
        <For each={rows() ?? []}>
          {(o) => (
            <div class="border-b border-border last:border-b-0">
              <SettingsRow
                class="border-b-0"
                label={
                  <span class="flex items-center gap-2">
                    {o.label}
                    <Badge tone={o.active ? "success" : "neutral"}>
                      {o.active ? t("settings.connections.state.active") : t("settings.connections.local.inactive")}
                    </Badge>
                  </span>
                }
                description={t(`settings.connections.mode.${o.permission_mode ?? "manual"}`)}
              >
                <div class="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setOpen(open() === o.id ? null : o.id)}>
                    {t("settings.connections.local.setup")}
                  </Button>
                  <Button variant="outline" size="sm" disabled={busy()} onClick={() => setRemoving(o)}>
                    {t("settings.connections.local.disconnect")}
                  </Button>
                </div>
              </SettingsRow>
              <Show when={open() === o.id}>
                <div class="grid gap-3 pb-4">
                  <p class="m-0 text-xs text-neutral-500">{t("settings.connections.local.setup_hint")}</p>
                  <For each={snippets(o)}>
                    {(snippet) => (
                      <div class="grid gap-1">
                        <div class="flex items-center justify-between">
                          <span class="text-xs font-semibold text-neutral-700">{t(`settings.connections.local.snippet.${snippet.id}`)}</span>
                          <Button
                            variant="ghost"
                            size="compact"
                            onClick={async () => {
                              await navigator.clipboard.writeText(snippet.text);
                              setCopied(`${o.id}:${snippet.id}`);
                              setTimeout(() => setCopied(null), 2_000);
                            }}
                          >
                            {copied() === `${o.id}:${snippet.id}` ? t("settings.connections.copied") : t("settings.connections.local.copy")}
                          </Button>
                        </div>
                        <pre class="m-0 overflow-x-auto rounded-md border border-border bg-surface-muted px-3 py-2 font-mono text-xs text-neutral-950">{snippet.text}</pre>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          )}
        </For>
        <div class="grid gap-3 pt-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label class="grid gap-1 text-xs text-neutral-500">
            {t("settings.connections.local.name")}
            <Input
              value={label()}
              maxLength={80}
              placeholder={t("settings.connections.local.name_placeholder")}
              onInput={(e) => setLabel(e.currentTarget.value)}
            />
          </label>
          <label class="grid gap-1 text-xs text-neutral-500">
            {t("settings.connections.permissions")}
            <Select value={mode()} onChange={(e) => setMode(e.currentTarget.value)}>
              <For each={PERMISSION_MODES}>{(m) => <option value={m}>{t(`settings.connections.mode.${m}`)}</option>}</For>
            </Select>
          </label>
          <Button size="sm" disabled={busy() || !label().trim()} onClick={connect}>
            {t("settings.connections.local.connect")}
          </Button>
        </div>
      </SettingsSection>
      <Dialog open={removing() !== null} onOpenChange={(open) => { if (!open) setRemoving(null); }}>
        <DialogContent>
          <DialogTitle>{t("settings.connections.local.disconnect_title", { name: removing()?.label ?? "" })}</DialogTitle>
          <p class="m-0 text-sm text-neutral-700">{t("settings.connections.local.disconnect_body")}</p>
          <div class="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRemoving(null)}>
              {t("settings.connections.cancel")}
            </Button>
            <Button variant="danger" disabled={busy()} onClick={() => { const o = removing(); if (o) void disconnect(o); }}>
              {t("settings.connections.local.disconnect")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Show>
  );
}

export default function Connections(props: { workspace?: string | null }) {
  const [data, { refetch }] = createResource(load);
  const [busy, setBusy] = createSignal<string | null>(null);
  const [failure, setFailure] = createSignal<string | null>(null);
  const [revoking, setRevoking] = createSignal<Connection | null>(null);
  const [copied, setCopied] = createSignal(false);

  const ready = () => {
    const d = data();
    return d && !("failed" in d) ? d : null;
  };

  async function act(id: string, run: (endpoint: string, tok: string) => Promise<{ kind: string }>) {
    setBusy(id);
    setFailure(null);
    try {
      const { token: tok, endpoint } = await token();
      const answer = await run(endpoint, tok);
      if (answer.kind !== "ok") setFailure(answer.kind);
      await refetch();
    } catch {
      setFailure("error");
    } finally {
      setBusy(null);
    }
  }

  const machineName = (computers: Computer[], id: string) =>
    computers.find((c) => c.computer_id === id)?.name ?? id;

  return (
    <SettingsPanel>
      <LocalSection workspace={props.workspace ?? null} />
      <SettingsSection
        title={t("settings.connections.title")}
        description={t("settings.connections.description")}
        aside={
          <Show when={ready()}>
            {(d) => (
              <Button
                variant="secondary"
                size="sm"
                onClick={async () => {
                  await navigator.clipboard.writeText(mcpUrl(d().endpoint));
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2_000);
                }}
              >
                {copied() ? t("settings.connections.copied") : t("settings.connections.copy_url")}
              </Button>
            )}
          </Show>
        }
      >
        <Show when={failure()}>
          <p class="m-0 py-2 text-[0.8125rem] text-error-strong" role="alert">
            {t("settings.connections.failed")}
          </p>
        </Show>
        <Show when={data.loading}>
          <p class="m-0 py-3 text-sm text-neutral-500">{t("settings.connections.loading")}</p>
        </Show>
        <Show when={(() => { const d = data(); return d && "failed" in d ? d : null; })()}>
          <EmptyState title={t("settings.connections.unavailable")} description={t("settings.connections.unavailable_hint")} />
        </Show>
        <Show when={ready()}>
          {(d) => (
            <Show
              when={d().connections.length > 0}
              fallback={
                <EmptyState
                  title={t("settings.connections.empty")}
                  description={t("settings.connections.empty_hint", { url: mcpUrl(d().endpoint) })}
                />
              }
            >
              <For each={d().connections}>
                {(c) => (
                  <ConnectionRow
                    connection={c}
                    computers={d().computers}
                    busy={busy() === c.id}
                    machineName={(id) => machineName(d().computers, id)}
                    onActivate={(patch) => act(c.id, (e, tok) => updateConnection(e, tok, c.id, { ...patch, state: "active" }))}
                    onPause={() => act(c.id, (e, tok) => updateConnection(e, tok, c.id, { state: "paused" }))}
                    onResume={() => act(c.id, (e, tok) => updateConnection(e, tok, c.id, { state: "active" }))}
                    onRevoke={() => setRevoking(c)}
                  />
                )}
              </For>
            </Show>
          )}
        </Show>
      </SettingsSection>

      <Dialog open={revoking() !== null} onOpenChange={(open) => { if (!open) setRevoking(null); }}>
        <DialogContent>
          <DialogTitle>{t("settings.connections.revoke_title", { name: revoking()?.client_name ?? "" })}</DialogTitle>
          <p class="m-0 text-sm text-neutral-700">{t("settings.connections.revoke_body")}</p>
          <div class="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRevoking(null)}>
              {t("settings.connections.cancel")}
            </Button>
            <Button
              variant="danger"
              disabled={busy() !== null}
              onClick={async () => {
                const c = revoking();
                if (!c) return;
                await act(c.id, (e, tok) => revokeConnection(e, tok, c.id));
                setRevoking(null);
              }}
            >
              {t("settings.connections.revoke")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </SettingsPanel>
  );
}

function ConnectionRow(props: {
  connection: Connection;
  computers: Computer[];
  busy: boolean;
  machineName: (id: string) => string;
  onActivate: (patch: { permission_mode: string; machines: Array<{ computer_id: string; workspace: string }> }) => void;
  onPause: () => void;
  onResume: () => void;
  onRevoke: () => void;
}) {
  const c = () => props.connection;
  // Solo las máquinas con un workspace atado a la cuenta: el relay no llega a otro.
  const candidates = () => props.computers.filter((m) => (m.workspaces ?? []).length > 0);
  const [machine, setMachine] = createSignal("");
  const [workspace, setWorkspace] = createSignal("");
  const [mode, setMode] = createSignal<string>("manual");
  const workspaces = () => props.computers.find((m) => m.computer_id === machine())?.workspaces ?? [];

  const summary = () => {
    if (c().state === "pending") return t("settings.connections.pending_hint");
    const where = c().machines.map((m) => props.machineName(m.computer_id)).join(", ");
    return t("settings.connections.summary", {
      machines: where || "—",
      mode: t(`settings.connections.mode.${c().permission_mode ?? "manual"}`),
      today: String(c().usage.tasks_created),
    });
  };

  return (
    <div class="border-b border-border last:border-b-0">
      <SettingsRow
        class="border-b-0"
        label={
          <span class="flex items-center gap-2">
            {c().client_name}
            <Badge tone={stateTone(c().state)}>{t(`settings.connections.state.${c().state}`)}</Badge>
          </span>
        }
        description={summary()}
      >
        <div class="flex gap-2">
          <Show when={c().state === "active"}>
            <Button variant="secondary" size="sm" disabled={props.busy} onClick={props.onPause}>
              {t("settings.connections.pause")}
            </Button>
          </Show>
          <Show when={c().state === "paused"}>
            <Button variant="secondary" size="sm" disabled={props.busy} onClick={props.onResume}>
              {t("settings.connections.resume")}
            </Button>
          </Show>
          <Button variant="outline" size="sm" disabled={props.busy} onClick={props.onRevoke}>
            {t("settings.connections.revoke")}
          </Button>
        </div>
      </SettingsRow>
      <Show when={c().state === "pending"}>
        <div class="grid gap-3 pb-4 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
          <label class="grid gap-1 text-xs text-neutral-500">
            {t("settings.connections.machine")}
            <Select value={machine()} onChange={(e) => (setMachine(e.currentTarget.value), setWorkspace(""))}>
              <option value="">{t("settings.connections.choose")}</option>
              <For each={candidates()}>{(m) => <option value={m.computer_id}>{m.name ?? m.computer_id}</option>}</For>
            </Select>
          </label>
          <label class="grid gap-1 text-xs text-neutral-500">
            {t("settings.connections.workspace")}
            <Select value={workspace()} disabled={!machine()} onChange={(e) => setWorkspace(e.currentTarget.value)}>
              <option value="">{t("settings.connections.choose")}</option>
              <For each={workspaces()}>{(w) => <option value={w}>{w}</option>}</For>
            </Select>
          </label>
          <label class="grid gap-1 text-xs text-neutral-500">
            {t("settings.connections.permissions")}
            <Select value={mode()} onChange={(e) => setMode(e.currentTarget.value)}>
              <For each={PERMISSION_MODES}>{(m) => <option value={m}>{t(`settings.connections.mode.${m}`)}</option>}</For>
            </Select>
          </label>
          <Button
            size="sm"
            disabled={props.busy || !machine() || !workspace()}
            onClick={() =>
              props.onActivate({ permission_mode: mode(), machines: [{ computer_id: machine(), workspace: workspace() }] })
            }
          >
            {t("settings.connections.activate")}
          </Button>
          <Show when={candidates().length === 0}>
            <p class="m-0 text-xs text-neutral-500 sm:col-span-4">{t("settings.connections.no_machines")}</p>
          </Show>
        </div>
      </Show>
    </div>
  );
}
