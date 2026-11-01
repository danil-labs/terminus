import { SignalDot } from "../../ui/SignalDot";
import { For, Show, createSignal } from "solid-js";
import Check from "lucide-solid/icons/check";
import ChevronDown from "lucide-solid/icons/chevron-down";
import Plus from "lucide-solid/icons/plus";
import { Dialog, DialogContent, DialogTitle } from "../../ui/Dialog";
import { ITEM_DE_MENU, Popover, PopoverContent, PopoverTrigger } from "../../ui/Popover";
import { t } from "../../lib/i18n";
import { ConnectMachine, connectSource } from "./ConnectMachine";
import { MachineIcon } from "./MachineIcon";
import { type Machine, type ProjectPlace, machineName, machines, refetchMachines, runOn, setRunOn, unavailable, wakesOf } from "./store";

let pedida = false;

/**
 * «Ejecutar en»: la máquina donde corre la tarea que se va a crear, recordada por
 * workspace. La ventana sigue en su workspace; elegir una apagada no la enciende,
 * la enciende enviar. Una máquina sin el workspace lo crea con el mismo id al
 * enviar; la que no puede se ve desactivada con la razón. Un proyecto sin
 * remoto se lleva desde su máquina mientras esté encendida (`carry.ts`).
 */
export function MachinePicker(props: { workspace: string | null; project?: ProjectPlace }) {
  if (!pedida) {
    pedida = true;
    void refetchMachines();
  }

  const [abierto, setAbierto] = createSignal(false);
  const [conectando, setConectando] = createSignal(false);
  const fuente = connectSource();
  const elegida = () => {
    const id = runOn(props.workspace, props.project);
    return machines().find((m) => (id ? m.id === id : m.active));
  };
  const nombre = (m: Machine) => machineName(m.id, m.local);

  function elegir(m: Machine) {
    setAbierto(false);
    setRunOn(props.workspace, m.active ? null : m.id);
  }

  const razon = (m: Machine) => {
    const falta = props.workspace ? unavailable(m, props.project) : null;
    if (falta === "workspace") return { label: t("shell.machines.unlinked"), hint: t("shell.machines.unlinked_hint", { name: nombre(m) }) };
    if (falta === "project") return { label: t("shell.machines.no_project"), hint: t("shell.machines.no_project_hint", { project: props.project?.name ?? "" }) };
    return null;
  };

  return (
    <Show when={machines().length > 1}>
      <Popover open={abierto()} onOpenChange={(v) => { setAbierto(v); if (v) void refetchMachines(); }} placement="top-start" gutter={4}>
        <PopoverTrigger
          class="flex min-h-7 max-w-[260px] items-center gap-1.5 rounded-sm px-1 text-left text-xs text-neutral-500 hover:text-neutral-950"
          aria-label={t("shell.machines.label")}
        >
          <MachineIcon wakes={elegida() ? wakesOf(elegida() as Machine) : false} size={12} />
          <span class="truncate">{elegida() ? nombre(elegida() as Machine) : t("shell.machines.label")}</span>
          <Show when={elegida()}>
            <SignalDot tone={(elegida() as Machine).on ? "success" : "off"} />
          </Show>
          <ChevronDown size={11} aria-hidden="true" />
        </PopoverTrigger>
        <PopoverContent class="w-[300px] overflow-hidden p-0 text-caption text-neutral-500 shadow-lg">
          <p class="m-0 border-b border-border px-2 py-1.5">{t("shell.machines.label")}</p>
          <div class="py-1">
            <For each={machines()}>
              {(m) => (
                <button
                  class={`${ITEM_DE_MENU} flex items-center gap-2 disabled:opacity-50`}
                  data-machine-option={m.id}
                  disabled={!!razon(m)}
                  title={razon(m)?.hint}
                  onClick={() => elegir(m)}
                >
                  <MachineIcon wakes={wakesOf(m)} size={12} />
                  <SignalDot tone={m.on ? "success" : "off"} />
                  <span class="flex-1 truncate">{nombre(m)}</span>
                  <span class="text-2xs" data-machine-reason={razon(m) ? "" : undefined}>
                    {razon(m)?.label ?? (m.on ? t("shell.machines.on") : t("shell.machines.off"))}
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
          <Show when={fuente}>
            <button
              class={`${ITEM_DE_MENU} flex items-center gap-2 border-t border-border`}
              data-connect-machine-item=""
              onClick={() => {
                setAbierto(false);
                setConectando(true);
              }}
            >
              <Plus size={12} aria-hidden="true" />
              <span class="flex-1 truncate">{t("danil.connect_machine.button")}</span>
            </button>
          </Show>
        </PopoverContent>
      </Popover>
      <Show when={fuente}>
        {(f) => (
          <Dialog open={conectando()} onOpenChange={setConectando}>
            <DialogContent class="max-w-[520px]">
              <DialogTitle class="mb-3 text-sm font-semibold">{t("danil.connect_machine.title")}</DialogTitle>
              <Show when={conectando()}>
                <ConnectMachine
                  {...f()}
                  onReady={(c) => {
                    setConectando(false);
                    f().onReady(c);
                    void refetchMachines();
                  }}
                />
              </Show>
            </DialogContent>
          </Dialog>
        )}
      </Show>
    </Show>
  );
}
