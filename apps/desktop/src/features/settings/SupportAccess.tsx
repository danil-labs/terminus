/**
 * «Acceso de soporte de Danil» en Workspaces: quién del equipo de Danil entra a
 * un workspace de Danil que la persona administra, con qué nivel, por qué y
 * hasta cuándo. Solo la web (`capabilities().supportAccess`); un workspace de
 * Danil no es un workspace de Terminus, por eso se elige aparte.
 */
import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import type { SupportGrant, SupportWorkspace } from "../../../../../packages/attention/src/support-access.ts";
import { manifiesto, t } from "../../lib/i18n";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { Select } from "../../ui/Select";
import { SettingsRow, SettingsSection } from "./layout";

export type SupportAccessSource = {
  demo: boolean;
  workspaces: () => Promise<SupportWorkspace[]>;
  list: (account: number) => Promise<{ grants: SupportGrant[]; canRevokeAll: boolean }>;
  /** Sin ella no hay botón: la entrada alfa todavía no deja pasar escrituras. */
  revoke?: (account: number, grant: number) => Promise<string>;
};

const HISTORY = 5;
const TONE = { active: "info", expired: "neutral", revoked: "neutral" } as const;

const failure = (cause: unknown) => (cause instanceof Error && /^HTTP 403$/.test(cause.message) ? "denied" : "failed");

const when = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : new Intl.DateTimeFormat(manifiesto().formato, { dateStyle: "medium", timeStyle: "short" }).format(date);
};

export default function SupportAccess(props: { source: SupportAccessSource }) {
  const [workspaces, setWorkspaces] = createSignal<SupportWorkspace[]>([]);
  const [account, setAccount] = createSignal<number | null>(null);
  const [grants, setGrants] = createSignal<SupportGrant[]>([]);
  const [canRevoke, setCanRevoke] = createSignal(false);
  /** La concesión que espera confirmación antes de revocarse, y si falló. */
  const [confirming, setConfirming] = createSignal<number | null>(null);
  const [revoking, setRevoking] = createSignal(false);
  const [revokeFailed, setRevokeFailed] = createSignal(false);
  const [busy, setBusy] = createSignal(true);
  /** `denied`: el BFF dijo 403 (no administra usuarios); `failed`: cualquier otra falla. */
  const [error, setError] = createSignal<"" | "denied" | "failed">("");
  let epoch = 0;
  onCleanup(() => { epoch++; });

  onMount(async () => {
    const request = ++epoch;
    try {
      const rows = await props.source.workspaces();
      if (request !== epoch) return;
      setWorkspaces(rows);
      setAccount(rows[0]?.id ?? null);
      if (rows.length === 0) setBusy(false);
    } catch (cause) {
      if (request === epoch) { setError(failure(cause)); setBusy(false); }
    }
  });

  createEffect(on(account, async (id) => {
    if (id === null) return;
    const request = ++epoch;
    setBusy(true); setError(""); setGrants([]);
    try {
      const value = await props.source.list(id);
      if (request === epoch) { setGrants(value.grants); setCanRevoke(value.canRevokeAll); }
    } catch (cause) {
      if (request === epoch) setError(failure(cause));
    } finally {
      if (request === epoch) setBusy(false);
    }
  }, { defer: false }));

  const revoke = async (g: SupportGrant) => {
    const run = props.source.revoke;
    if (!run || revoking()) return;
    setRevoking(true); setRevokeFailed(false);
    try {
      await run(g.account_id, g.id);
      setConfirming(null);
      const value = await props.source.list(g.account_id);
      setGrants(value.grants);
    } catch {
      setRevokeFailed(true);
    } finally {
      setRevoking(false);
    }
  };

  const active = () => grants().filter((g) => g.status === "active");
  const past = () => grants().filter((g) => g.status !== "active").slice(0, HISTORY);
  const level = (g: SupportGrant) => (g.level === "read" ? t("settings.support_access.level_read") : t("settings.support_access.level_write"));

  return (
    <SettingsSection
      title={t("settings.support_access.title")}
      description={props.source.demo ? t("settings.support_access.demo") : t("settings.support_access.description")}
    >
      <Show when={workspaces().length > 1}>
        <SettingsRow label={t("settings.support_access.workspace")}>
          <Select
            aria-label={t("settings.support_access.workspace")}
            value={String(account() ?? "")}
            onChange={(e) => setAccount(Number(e.currentTarget.value))}
          >
            <For each={workspaces()}>{(w) => <option value={String(w.id)}>{w.name || t("settings.support_access.unnamed", { id: w.id })}</option>}</For>
          </Select>
        </SettingsRow>
      </Show>
      <Show when={busy()}><p role="status" class="m-0 text-xs text-neutral-500">{t("settings.support_access.loading")}</p></Show>
      <Show when={error()}>
        <p role="alert" class="m-0 text-sm text-error-strong">
          {error() === "denied" ? t("settings.support_access.denied") : t("settings.support_access.error")}
        </p>
      </Show>
      <Show when={!busy() && !error() && workspaces().length === 0}>
        <p role="status" class="m-0 text-sm text-neutral-500">{t("settings.support_access.no_workspaces")}</p>
      </Show>
      <Show when={!busy() && !error() && workspaces().length > 0 && grants().length === 0}>
        <p role="status" class="m-0 text-sm text-neutral-500">{t("settings.support_access.empty")}</p>
      </Show>
      <For each={active()}>{(g) => (
        <SettingsRow
          label={g.operator_email}
          description={t("settings.support_access.active_line", { level: level(g), until: when(g.expires_at), reason: g.reason })}
        >
          <div class="flex items-center gap-2">
            <Badge tone={TONE.active}>{t("settings.support_access.status_active")}</Badge>
            <Show when={props.source.revoke && canRevoke() && confirming() !== g.id}>
              <Button size="sm" variant="secondary" onClick={() => { setRevokeFailed(false); setConfirming(g.id); }}>
                {t("settings.support_access.revoke")}
              </Button>
            </Show>
          </div>
        </SettingsRow>
      )}</For>
      <Show when={active().find((g) => g.id === confirming())}>
        {(g) => (
          <div role="group" aria-label={t("settings.support_access.revoke")} class="grid gap-2 rounded-md border border-border p-3">
            <p class="m-0 text-sm text-neutral-800">{t("settings.support_access.revoke_confirm", { email: g().operator_email })}</p>
            <Show when={revokeFailed()}><p role="alert" class="m-0 text-sm text-error-strong">{t("settings.support_access.revoke_error")}</p></Show>
            <div class="flex gap-2">
              <Button size="sm" variant="danger" disabled={revoking()} onClick={() => void revoke(g())}>{t("settings.support_access.revoke")}</Button>
              <Button size="sm" variant="ghost" disabled={revoking()} onClick={() => setConfirming(null)}>{t("settings.support_access.cancel")}</Button>
            </div>
          </div>
        )}
      </Show>
      <Show when={past().length > 0}>
        <h4 class="m-0 mt-2 text-xs font-[560] text-neutral-500">{t("settings.support_access.history")}</h4>
        <For each={past()}>{(g) => (
          <SettingsRow
            label={g.operator_email}
            description={t("settings.support_access.past_line", { level: level(g), since: when(g.created_at), reason: g.reason })}
          >
            <Badge tone={TONE[g.status]}>{t(`settings.support_access.status_${g.status}`)}</Badge>
          </SettingsRow>
        )}</For>
      </Show>
    </SettingsSection>
  );
}
