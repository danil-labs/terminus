import { For, Show, createSignal } from "solid-js";
import Check from "lucide-solid/icons/check";
import ChevronDown from "lucide-solid/icons/chevron-down";
import Server from "lucide-solid/icons/server";
import Laptop from "lucide-solid/icons/laptop";
import { ITEM_DE_MENU, Popover, PopoverContent, PopoverTrigger } from "../../ui/Popover";
import { FailureNote } from "../../ui/Failure";
import { t } from "../../lib/i18n";
import { capabilities } from "../../lib/platform";
import { type Machine, machineName, machines, refetchMachines, runOn, setRunOn } from "./store";
import { cancelWorkspaceHere, dismissWorkspaceHere, startWorkspaceHere, workspaceHere } from "./workspace-here";

let pedida = false;

/**
 * «Ejecutar en»: la máquina donde corre la tarea que se va a crear, recordada por
 * workspace. La ventana sigue en su workspace; elegir una apagada no la enciende,
 * la enciende enviar.
 */
export function MachinePicker(props: { workspace: string | null }) {
  if (!pedida) {
    pedida = true;
    void refetchMachines();
  }

  const [abierto, setAbierto] = createSignal(false);
  const elegida = () => {
    const id = runOn(props.workspace);
    return machines().find((m) => (id ? m.id === id : m.active));
  };
  const nombre = (m: Machine) => machineName(m.id, m.local);

  function elegir(m: Machine) {
    setAbierto(false);
    setRunOn(props.workspace, m.active ? null : m.id);
  }

  const ocupado = () => {
    const w = workspaceHere();
    return !!w && w.phase !== "failed";
  };

  const punto = (m: Machine) =>
    `inline-block size-1.5 shrink-0 rounded-full ${m.on ? "bg-success" : "bg-neutral-300"}`;

  return (
    <Show when={machines().length > 1}>
      <Popover open={abierto()} onOpenChange={(v) => { setAbierto(v); if (v) void refetchMachines(); }} placement="top-start" gutter={4}>
        <PopoverTrigger
          class="flex min-h-7 max-w-[260px] items-center gap-1.5 rounded-sm px-1 text-left text-xs text-neutral-500 hover:text-neutral-950"
          aria-label={t("shell.machines.label")}
        >
          <Show when={elegida()?.local} fallback={<Server size={12} aria-hidden="true" />}>
            <Laptop size={12} aria-hidden="true" />
          </Show>
          <span class="truncate">{elegida() ? nombre(elegida() as Machine) : t("shell.machines.label")}</span>
          <Show when={elegida()}>
            <span class={punto(elegida() as Machine)} aria-hidden="true" />
          </Show>
          <ChevronDown size={11} aria-hidden="true" />
        </PopoverTrigger>
        <PopoverContent class="w-[300px] overflow-hidden p-0 text-[0.6875rem] text-neutral-500 shadow-lg">
          <p class="m-0 border-b border-border px-2 py-1.5">{t("shell.machines.label")}</p>
          <div class="py-1">
            <For each={machines()}>
              {(m) => (
                <Show when={!(m.linked === false && props.workspace && capabilities().workspaceOnMachine)} fallback={
                  <div class="flex min-h-7 items-center gap-2 px-2 opacity-90" data-machine-unlinked={m.id}>
                    <span class={punto(m)} aria-hidden="true" />
                    <span class="flex-1 truncate">{nombre(m)}</span>
                    <span class="text-[0.625rem]" title={t("shell.machines.unlinked_hint", { name: nombre(m) })}>
                      {t("shell.machines.unlinked")}
                    </span>
                    <button
                      class="rounded-sm px-1 text-[0.625rem] text-primary hover:underline disabled:opacity-50"
                      data-workspace-here={m.id}
                      disabled={ocupado()}
                      title={t("shell.machines.here.hint", { name: nombre(m) })}
                      onClick={() => void startWorkspaceHere(props.workspace as string, m.id)}
                    >
                      {t("shell.machines.here.action")}
                    </button>
                  </div>
                }>
                <button
                  class={`${ITEM_DE_MENU} flex items-center gap-2 disabled:opacity-50`}
                  disabled={m.linked === false}
                  title={m.linked === false ? t("shell.machines.unlinked_hint", { name: nombre(m) }) : undefined}
                  onClick={() => elegir(m)}
                >
                  <span class={punto(m)} aria-hidden="true" />
                  <span class="flex-1 truncate">{nombre(m)}</span>
                  <span class="text-[0.625rem]">
                    {m.linked === false ? t("shell.machines.unlinked") : m.on ? t("shell.machines.on") : t("shell.machines.off")}
                  </span>
                  <span class="flex w-3 shrink-0">
                    <Show when={elegida()?.id === m.id}>
                      <Check size={12} aria-hidden="true" />
                    </Show>
                  </span>
                </button>
                </Show>
              )}
            </For>
          </div>
          <Show when={workspaceHere()?.workspace === props.workspace ? workspaceHere() : null}>
            {(w) => <HerePanel state={w()} />}
          </Show>
        </PopoverContent>
      </Popover>
    </Show>
  );
}

/** Cómo va «Usar este workspace aquí»: el código de Radiant si hace falta, y el error si falla. */
function HerePanel(props: { state: NonNullable<ReturnType<typeof workspaceHere>> }) {
  const s = () => props.state;
  const nombre = () => machineName(s().machine);
  return (
    <div class="grid gap-1.5 border-t border-border px-2 py-2 text-neutral-700" data-workspace-here-state={s().phase}>
      <Show when={s().phase === "creating"}>
        <p class="m-0">{t("shell.machines.here.creating", { workspace: s().name, name: nombre() })}</p>
      </Show>
      <Show when={s().phase === "copying"}>
        <p class="m-0">{t("shell.machines.here.copying", { name: nombre() })}</p>
      </Show>
      <Show when={s().phase === "signing_in"}>
        <p class="m-0">{t("shell.machines.here.radiant", { organization: s().organization ?? s().name, name: nombre() })}</p>
        <Show when={s().prompt} fallback={<p class="m-0 text-neutral-500">{t("radiant.session.starting")}</p>}>
          {(prompt) => (
            <div class="grid gap-1" data-radiant-code="">
              <span>{t("radiant.session.code")}</span>
              <span class="font-mono text-base font-semibold tracking-widest text-neutral-950">{prompt().code}</span>
              <a class="font-mono break-all text-primary" href={prompt().uri} target="_blank" rel="noopener noreferrer">
                {prompt().uri}
              </a>
            </div>
          )}
        </Show>
        <div>
          <button class="rounded-sm px-1 hover:underline" onClick={cancelWorkspaceHere}>
            {t("radiant.session.cancel")}
          </button>
        </div>
      </Show>
      <Show when={s().phase === "failed"}>
        <Show when={s().failure}>{(f) => <FailureNote f={f()} />}</Show>
        <div>
          <button class="rounded-sm px-1 hover:underline" onClick={dismissWorkspaceHere}>
            {t("shell.machines.here.dismiss")}
          </button>
        </div>
      </Show>
    </div>
  );
}
