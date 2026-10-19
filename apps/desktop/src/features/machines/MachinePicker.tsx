import { For, Show, createSignal } from "solid-js";
import Check from "lucide-solid/icons/check";
import ChevronDown from "lucide-solid/icons/chevron-down";
import Server from "lucide-solid/icons/server";
import Laptop from "lucide-solid/icons/laptop";
import { ITEM_DE_MENU, Popover, PopoverContent, PopoverTrigger } from "../../ui/Popover";
import { t } from "../../lib/i18n";
import { type Machine, machineName, machines, refetchMachines, runOn, setRunOn } from "./store";

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
        <PopoverContent class="w-[260px] overflow-hidden p-0 text-[0.6875rem] text-neutral-500 shadow-lg">
          <p class="m-0 border-b border-border px-2 py-1.5">{t("shell.machines.label")}</p>
          <div class="py-1">
            <For each={machines()}>
              {(m) => (
                <button
                  class={`${ITEM_DE_MENU} flex items-center gap-2 disabled:opacity-50`}
                  disabled={m.linked === false}
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
              )}
            </For>
          </div>
        </PopoverContent>
      </Popover>
    </Show>
  );
}
