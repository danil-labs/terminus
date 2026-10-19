import { For, Show, createSignal, onMount } from "solid-js";
import ChevronDown from "lucide-solid/icons/chevron-down";
import Server from "lucide-solid/icons/server";
import Laptop from "lucide-solid/icons/laptop";
import { ITEM_DE_MENU, Popover, PopoverContent, PopoverTrigger } from "../../ui/Popover";
import { invoke } from "../../lib/invoke";
import { t } from "../../lib/i18n";
import { isMac } from "../../lib/window";

type Machine = { id: string; local: boolean; active: boolean; on: boolean };

const nombre = (m: Machine) =>
  m.local ? t(isMac() ? "machines.this_mac" : "machines.this_computer") : m.id;

/**
 * «Ejecutar en»: la máquina donde corren las tareas que ves y las que crees.
 * Elegir otra la enciende si hace falta y recarga la vista contra su motor;
 * mientras tanto, preguntar el estado no enciende nada.
 */
export function MachinePicker() {
  // Señal y no `createResource`: un recurso suspende la vista entera mientras
  // la lista pregunta a cada máquina.
  const [machines, setMachines] = createSignal<Machine[]>([]);
  const refetch = () =>
    invoke<Machine[]>("machine_list")
      .then(setMachines)
      .catch(() => setMachines([]));
  onMount(() => void refetch());
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
    `inline-block size-1.5 shrink-0 rounded-full ${m.on ? "bg-emerald-500" : "bg-neutral-400"}`;

  return (
    <Show when={(machines()?.length ?? 0) > 1}>
      <Popover open={abierto()} onOpenChange={(v) => { setAbierto(v); if (v) void refetch(); }} placement="top-start" gutter={4}>
        <PopoverTrigger
          class="flex min-h-7 max-w-[260px] items-center gap-1.5 rounded-sm px-1 text-left text-xs text-neutral-500 hover:text-neutral-950"
          aria-label={t("machines.label")}
        >
          <Show when={actual()?.local} fallback={<Server size={12} aria-hidden="true" />}>
            <Laptop size={12} aria-hidden="true" />
          </Show>
          <span class="truncate">
            {cambiando()
              ? t("machines.starting", { name: cambiando() ?? "" })
              : actual()
                ? nombre(actual() as Machine)
                : t("machines.label")}
          </span>
          <Show when={actual() && !cambiando()}>
            <span class={punto(actual() as Machine)} aria-hidden="true" />
          </Show>
          <ChevronDown size={11} aria-hidden="true" />
        </PopoverTrigger>
        <PopoverContent class="w-[260px] overflow-hidden p-0 text-[0.6875rem] text-neutral-500 shadow-lg">
          <p class="m-0 border-b border-border px-2 py-1.5">{t("machines.label")}</p>
          <div class="py-1">
            <For each={machines()}>
              {(m) => (
                <button class={`${ITEM_DE_MENU} flex items-center gap-2`} onClick={() => void elegir(m)}>
                  <span class={punto(m)} aria-hidden="true" />
                  <span class="flex-1 truncate">{nombre(m)}</span>
                  <span class="text-[0.625rem]">
                    {m.active ? t("machines.active") : m.on ? t("machines.on") : t("machines.off")}
                  </span>
                </button>
              )}
            </For>
          </div>
        </PopoverContent>
      </Popover>
      <Show when={error()}>
        <span class="text-xs text-red-600">{t("machines.failed")}</span>
      </Show>
    </Show>
  );
}
