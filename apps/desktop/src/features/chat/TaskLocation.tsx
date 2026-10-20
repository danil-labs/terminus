import Folder from "lucide-solid/icons/folder";
import GitBranch from "lucide-solid/icons/git-branch";
import Laptop from "lucide-solid/icons/laptop";
import Server from "lucide-solid/icons/server";
import { createSignal, type JSX, onCleanup, Show } from "solid-js";
import { copyText } from "../../lib/clipboard";
import { t } from "../../lib/i18n";
import { capabilities } from "../../lib/platform";
import { cn } from "../../lib/utils";
import { machineName } from "../machines/store";
import { RETARDO_TOOLTIP, TooltipContent, TooltipRoot, TooltipTrigger } from "../../ui/Tooltip";

export type TaskLocationProps = {
  /** El `machine` de la fila; sin él, la máquina de la ventana. */
  machine?: string;
  on: boolean;
  project?: string;
  /** La carpeta de trabajo de la tarea (su worktree). */
  path?: string;
  branch?: string;
};

const PARTE = "flex h-5.5 min-w-0 items-center gap-1.25 rounded-sm px-1.25 whitespace-nowrap";

function Pista(props: { tip: JSX.Element; children: JSX.Element; class?: string; onClick?: () => void; label?: string }) {
  return (
    <TooltipRoot openDelay={RETARDO_TOOLTIP} placement="bottom-start" gutter={4}>
      <TooltipTrigger
        as={props.onClick ? "button" : "span"}
        type={props.onClick ? "button" : undefined}
        aria-label={props.label}
        class={cn(PARTE, props.onClick && "cursor-pointer border-0 bg-transparent font-[inherit] outline-none hover:bg-neutral-200 hover:text-neutral-950 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-primary", props.class)}
        onClick={props.onClick}
      >
        {props.children}
      </TooltipTrigger>
      <TooltipContent class="font-medium">{props.tip}</TooltipContent>
    </TooltipRoot>
  );
}

/** Máquina / proyecto / rama de la tarea, arriba a la izquierda de su ventana. */
export default function TaskLocation(props: TaskLocationProps) {
  const here = () => capabilities().windowMachine?.();
  const nombre = () => (props.machine ? machineName(props.machine) : (here()?.name ?? machineName("local")));
  // En la web ninguna máquina es la de la ventana: `here().local` es falso.
  const local = () => (props.machine ? !!here()?.local && props.machine === here()?.id : (here()?.local ?? true));
  const [copiada, setCopiada] = createSignal(false);
  let espera: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(espera));
  const copiar = (rama: string) => {
    void copyText(rama).then(() => {
      setCopiada(true);
      clearTimeout(espera);
      espera = setTimeout(() => setCopiada(false), 1500);
    }).catch(() => {});
  };
  const Sep = () => <span aria-hidden="true" class="shrink-0 px-px text-neutral-500/60">/</span>;

  return (
    <nav
      data-task-location=""
      data-task-location-on={props.on ? "true" : "false"}
      aria-label={t("chat.location.label")}
      class="relative z-10 flex min-w-0 shrink-0 items-center gap-px px-3.5 pt-2 text-xs text-neutral-500"
    >
      <Pista
        class={cn("max-w-[40%] shrink", !props.on && "opacity-65")}
        tip={props.on ? t("shell.machines.task_on", { name: nombre() }) : t("shell.machines.task_off", { name: nombre() })}
      >
        {local() ? <Laptop size={13} aria-hidden="true" class="shrink-0" /> : <Server size={13} aria-hidden="true" class="shrink-0" />}
        <span data-task-location-machine="" class="min-w-0 truncate">{nombre()}</span>
        <span
          aria-hidden="true"
          class={cn("size-1.5 shrink-0 rounded-full", !props.on ? "bg-neutral-300" : local() ? "bg-success" : "bg-info")}
        />
      </Pista>
      <Show when={props.project}>
        {(proyecto) => (
          <>
            <Sep />
            <Pista
              class="max-w-[35%] shrink font-medium text-neutral-700"
              tip={<>{t("chat.location.project")}<Show when={props.path}>{(ruta) => <span class="block font-mono text-[0.6875rem] font-normal opacity-80">{ruta()}</span>}</Show></>}
            >
              <Folder size={13} aria-hidden="true" class="shrink-0" />
              <span data-task-location-project="" class="min-w-0 truncate">{proyecto()}</span>
            </Pista>
          </>
        )}
      </Show>
      <Show when={props.branch}>
        {(rama) => (
          <>
            <Sep />
            <Pista
              class="min-w-0 shrink text-neutral-500"
              label={t("chat.location.copy_branch", { branch: rama() })}
              tip={copiada() ? t("chat.location.copied") : t("chat.location.copy_branch", { branch: rama() })}
              onClick={() => copiar(rama())}
            >
              <GitBranch size={13} aria-hidden="true" class="shrink-0" />
              <span data-task-location-branch="" class="min-w-0 truncate font-mono text-[0.71875rem]">{rama()}</span>
            </Pista>
          </>
        )}
      </Show>
    </nav>
  );
}
