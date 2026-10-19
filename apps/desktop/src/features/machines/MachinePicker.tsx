import { For, Show, createRoot, createSignal } from "solid-js";
import ChevronDown from "lucide-solid/icons/chevron-down";
import Server from "lucide-solid/icons/server";
import Laptop from "lucide-solid/icons/laptop";
import { ITEM_DE_MENU, Popover, PopoverContent, PopoverTrigger } from "../../ui/Popover";
import { invoke } from "../../lib/invoke";
import { t } from "../../lib/i18n";
import { isMac } from "../../lib/window";

type Machine = { id: string; local: boolean; active: boolean; on: boolean };

const nombre = (m: Machine) =>
  m.local
    ? isMac()
      ? t("shell.machines.this_mac")
      : t("shell.machines.this_computer")
    : m.id;

// Una sola lista para toda la ventana: se pide la primera vez que se monta el
// selector y de nuevo al abrir el menú. Señal y no
// `createResource`, que suspendería la vista entera mientras contestan.
const [machines, setMachines] = createRoot(() => createSignal<Machine[]>([]));
const refetch = () =>
  invoke<Machine[]>("machine_list")
    .then(setMachines)
    .catch(() => setMachines([]));
let pedida = false;

/**
 * «Ejecutar en»: la máquina donde corren las tareas que ves y las que crees.
 * Elegir otra la enciende si hace falta y recarga la vista contra su motor;
 * mientras tanto, preguntar el estado no enciende nada.
 */
export function MachinePicker() {
  if (!pedida) {
    pedida = true;
    void refetch();
  }

  const [abierto, setAbierto] = createSignal(false);
  const [cambiando, setCambiando] = createSignal<string | null>(null);
  const [error, setError] = createSignal(false);
  const actual = () => machines()?.find((m) => m.active);

  async function elegir(m: Machine) {
    setAbierto(false);
    if (m.active) return;
    setError(false);
    setCambiando(m.id);
    try {
      await invoke("machine_select", { id: m.id });
      // Otro motor: workspaces, tareas y eventos son otros. Se relee todo.
      window.location.reload();
    } catch {
      setCambiando(null);
      setError(true);
      void refetch();
    }
  }

  const punto = (m: Machine) =>
    `inline-block size-1.5 shrink-0 rounded-full ${m.on ? "bg-success" : "bg-neutral-300"}`;

  return (
    <Show when={(machines()?.length ?? 0) > 1}>
      <Popover open={abierto()} onOpenChange={(v) => { setAbierto(v); if (v) void refetch(); }} placement="top-start" gutter={4}>
        <PopoverTrigger
          class="flex min-h-7 max-w-[260px] items-center gap-1.5 rounded-sm px-1 text-left text-xs text-neutral-500 hover:text-neutral-950"
          aria-label={t("shell.machines.label")}
        >
          <Show when={actual()?.local} fallback={<Server size={12} aria-hidden="true" />}>
            <Laptop size={12} aria-hidden="true" />
          </Show>
          <span class="truncate">
            {cambiando()
              ? t("shell.machines.starting", { name: cambiando() ?? "" })
              : actual()
                ? nombre(actual() as Machine)
                : t("shell.machines.label")}
          </span>
          <Show when={actual() && !cambiando()}>
            <span class={punto(actual() as Machine)} aria-hidden="true" />
          </Show>
          <ChevronDown size={11} aria-hidden="true" />
        </PopoverTrigger>
        <PopoverContent class="w-[260px] overflow-hidden p-0 text-[0.6875rem] text-neutral-500 shadow-lg">
          <p class="m-0 border-b border-border px-2 py-1.5">{t("shell.machines.label")}</p>
          <div class="py-1">
            <For each={machines()}>
              {(m) => (
                <button class={`${ITEM_DE_MENU} flex items-center gap-2`} onClick={() => void elegir(m)}>
                  <span class={punto(m)} aria-hidden="true" />
                  <span class="flex-1 truncate">{nombre(m)}</span>
                  <span class="text-[0.625rem]">
                    {m.active ? t("shell.machines.active") : m.on ? t("shell.machines.on") : t("shell.machines.off")}
                  </span>
                </button>
              )}
            </For>
          </div>
        </PopoverContent>
      </Popover>
      <Show when={error()}>
        <span class="text-xs text-error-strong">{t("shell.machines.failed")}</span>
      </Show>
    </Show>
  );
}
