import { For, Match, Show, Switch, createSignal, onCleanup, onMount } from "solid-js";
import { invoke } from "../../../lib/invoke.ts";
import { listen } from "@tauri-apps/api/event";
import { t } from "../../../lib/i18n";
import { Badge } from "../../../ui/Badge";
import { Button } from "../../../ui/Button";
import { FailureNote, asFailure } from "../../../ui/Failure";
import { MarcaAgente } from "../../../ui/icons";
import Accounts from "../../settings/Accounts";
import type { AccountList, AgentOpt } from "../../settings/accounts-store";
import { Pantalla } from "../Screen";
import { nombreDeAgente, type Alta } from "../onboarding-store";
import { EmptyState } from "../../../ui/EmptyState";

/** Paso 4: las cuentas de los proveedores instalados, que pertenecen al workspace recién creado. */
export default function Cuentas(props: { alta: Alta; nueva: boolean }) {
  const [agentes, setAgentes] = createSignal<AgentOpt[]>([]);
  const [conectadas, setConectadas] = createSignal<Record<string, boolean>>({});
  const [abierto, setAbierto] = createSignal<string | null>(null);
  const e = props.alta.estado;

  async function cargar() {
    const as = await invoke<AgentOpt[]>("list_agents").catch(() => [] as AgentOpt[]);
    setAgentes(as);
    for (const a of as.filter((x) => x.available && !x.sin_cuenta)) {
      invoke<AccountList>("list_accounts", { agent: a.id })
        .then((l) =>
          setConectadas((c) => ({ ...c, [a.id]: l.accounts.some((x) => x.authenticated_at !== null) })),
        )
        .catch(() => {});
    }
  }

  onMount(() => {
    void cargar();
    const instalados = listen("agents", () => void cargar());
    const cuentas = listen<{ kind: string }>("account", (ev) => {
      if (ev.payload.kind === "done") void cargar();
    });
    onCleanup(() => {
      void instalados.then((f) => f());
      void cuentas.then((f) => f());
    });
  });

  // Al agregar otro workspace los proveedores ya están en la máquina: se listan todos los instalados.
  const filas = () =>
    props.nueva ? agentes().filter((a) => a.available) : agentes().filter((a) => e.elegidos.includes(a.id));

  const estado = (a: AgentOpt) => {
    const i = e.instalacion[a.id];
    if (i?.estado === "instalando") return "instalando";
    if (!a.available) return "fallo";
    return "lista";
  };

  const detalle = (a: AgentOpt) => {
    const s = estado(a);
    if (s === "instalando") return t("onboarding.accounts.installing");
    if (s === "fallo") return t("onboarding.accounts.install_failed");
    if (a.sin_cuenta) return t("onboarding.accounts.no_account");
    return conectadas()[a.id] ? t("onboarding.accounts.ready") : t("onboarding.accounts.pending");
  };

  const nombreAbierto = () => {
    const a = agentes().find((x) => x.id === abierto());
    return a ? nombreDeAgente(a) : "";
  };

  return (
    <Pantalla
      titulo={t("onboarding.accounts.title")}
      lede={t("onboarding.accounts.lede", { workspace: e.workspace?.nombre ?? e.nombre })}
      pie={t("onboarding.accounts.footer")}
      atras={() => props.alta.set("paso", "workspace")}
      primario={{ rotulo: t("onboarding.continue"), onClick: () => props.alta.set("paso", "sources") }}
    >
      <Show
        when={abierto()}
        fallback={
          <div class="grid gap-2.5">
            <For each={filas()} fallback={<EmptyState title={t("onboarding.accounts.none")} />}>
              {(a) => (
                <div class="grid gap-2 rounded-md border border-border bg-surface-raised px-4 py-3">
                  <div class="flex items-center gap-3">
                    <MarcaAgente id={a.id} size={20} />
                    <div class="grid min-w-0 flex-1 gap-0.5">
                      <strong class="text-sm font-semibold text-neutral-950">{nombreDeAgente(a)}</strong>
                      <span class="text-xs text-neutral-500">{detalle(a)}</span>
                    </div>
                    <Switch>
                      <Match when={estado(a) === "instalando"}>
                        <Badge tone="info">{t("onboarding.agent.installing")}</Badge>
                      </Match>
                      <Match when={estado(a) === "fallo"}>
                        <Button size="sm" variant="secondary" onClick={() => props.alta.instalar([a.id])}>
                          {t("onboarding.accounts.retry")}
                        </Button>
                      </Match>
                      <Match when={conectadas()[a.id]}>
                        <Badge tone="success">{t("onboarding.accounts.connected")}</Badge>
                      </Match>
                      <Match when={estado(a) === "lista"}>
                        <Button size="sm" variant="secondary" onClick={() => setAbierto(a.id)}>
                          {a.sin_cuenta ? t("onboarding.accounts.manage") : t("onboarding.accounts.connect")}
                        </Button>
                      </Match>
                    </Switch>
                  </div>
                  <Show when={estado(a) === "fallo" ? e.instalacion[a.id]?.error : undefined}>
                    {(error) => <FailureNote f={asFailure(error())} />}
                  </Show>
                </div>
              )}
            </For>
          </div>
        }
      >
        {(id) => (
          <div class="grid gap-3">
            <Button
              size="sm"
              variant="ghost"
              class="justify-self-start"
              onClick={() => {
                setAbierto(null);
                void cargar();
              }}
            >
              {t("onboarding.accounts.back")}
            </Button>
            <h2 class="m-0 text-lg font-display font-bold tracking-[-0.02em] text-neutral-950">{nombreAbierto()}</h2>
            <Accounts agente={id()} enAlta />
          </div>
        )}
      </Show>
    </Pantalla>
  );
}
