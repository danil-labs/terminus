import { For, Show, createSignal, type JSX } from "solid-js";
import FolderOpen from "lucide-solid/icons/folder-open";
import { Button } from "../../ui/Button";
import ChevronDown from "lucide-solid/icons/chevron-down";
import Search from "lucide-solid/icons/search";
import {
  ITEM_DE_MENU,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../ui/Popover";
import { enfocar } from "../../lib/focus";
import { t } from "../../lib/i18n";
import { type Project, type Source } from "../../lib/model";
import { lineaDeProcedencia, procedencia } from "../../lib/sourceOrigin";
import { Badge } from "../../ui/Badge";
import WorkdirIcon from "../code/WorkdirIcon";


/**
 * Un workspace sin fuente de contexto. **Nace inerte**: sabe qué alcanza y no
 * tiene nada en disco.
 *
 * **No es una puerta.** Ocupando la ventana entera mientras `context_root` sea
 * `null`, sin señalar una carpeta no hay riel lateral, ni proyectos, ni forma de
 * escribir nada — y un proyecto no es un repo, así que trabajar no puede
 * depender de que exista uno. Vive al lado del selector de proyecto, que es
 * donde se decide de qué es esta conversación, y no impide empezar sin
 * material.
 *
 * No lleva párrafo. El renglón dice qué falta —que es estado, no glosa— y los
 * botones dicen por dónde se sale.
 */
export function EmptyContext(props: {
  onPickFolder: () => void;
  onConnect: () => void;
}) {
  return (
    <div class="flex flex-wrap items-center justify-center gap-1 text-xs text-neutral-500">
      <span class="px-1">{t("projects.context.empty")}</span>
      <Button variant="ghost" size="sm" onClick={props.onConnect}>
        {t("projects.context.connect")}
      </Button>
      <Button variant="ghost" size="sm" onClick={props.onPickFolder}>
        <FolderOpen size={14} />
        {t("projects.context.pick_folder")}
      </Button>
    </div>
  );
}

/**
 * Con qué proyecto se trabaja, debajo de la caja y no en la cabecera: es una
 * decisión del mismo gesto que escribir, como el «Choose project» de ChatGPT.
 */
export function ProjectPicker(props: {
  branch?: JSX.Element;
  /** The conversation already belongs to this project, like one of its agents' chats. */
  locked?: boolean;
  projects: Project[];
  project: string;
  /** Las fuentes del workspace, para poder nombrar las que este proyecto lee. */
  sources: Source[];
  onPick: (id: string) => void;
  /** Abre el diálogo de nombre. El nombre no se decide aquí. */
  onNuevoProyecto: () => void;
}) {
  const [abierto, setAbierto] = createSignal(false);
  const [busca, setBusca] = createSignal("");

  const actual = () => props.projects.find((p) => p.id === props.project) ?? null;

  /** Sin acentos ni mayúsculas: buscar «administracion» encuentra la con tilde. */
  const plano = (s: string) =>
    s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const filtradas = () => {
    const q = plano(busca().trim());
    return q ? props.projects.filter((p) => plano(p.name).includes(q)) : props.projects;
  };
  const sinNada = () => filtradas().length === 0;

  function elegir(id: string) {
    setAbierto(false);
    setBusca("");
    props.onPick(id);
  }
  const material = () =>
    actual()
      ?.sources.map((id) => props.sources.find((s) => s.id === id))
      .filter((s): s is Source => Boolean(s)) ?? [];

  return (
    <div class="flex w-full max-w-[860px] flex-wrap items-center gap-x-2 gap-y-1 px-4 pt-1.5">
      <WorkdirIcon
        kind={actual()?.kind ?? "folder"} cloud={actual()?.cloud}
        class="shrink-0 text-neutral-500"
      />
      <Show when={!props.locked} fallback={
        <span class="flex min-h-7 max-w-[420px] items-center px-1 text-xs text-neutral-500">
          <span class="truncate">{actual()?.name ?? t("projects.picker.none")}</span>
        </span>
      }>
      <Popover open={abierto()} onOpenChange={setAbierto} placement="top-start" gutter={4}>
        <PopoverTrigger
          class="flex min-h-7 max-w-[420px] items-center gap-1 rounded-sm px-1 text-left text-xs text-neutral-500 hover:text-neutral-950"
          aria-label={t("projects.picker.label")}
        >
          <span class="truncate">
            {actual()?.name ?? t("projects.picker.none")}
          </span>
          <ChevronDown size={11} aria-hidden="true" />
        </PopoverTrigger>

        <PopoverContent class="w-[300px] overflow-hidden p-0 text-[0.6875rem] text-neutral-500 shadow-lg">
          <div class="relative border-b border-border">
            <Search
              size={11}
              class="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2"
              aria-hidden="true"
            />
            <input
              ref={enfocar}
              class="w-full bg-transparent py-1 pr-2 pl-6 text-[0.6875rem] outline-none"
              placeholder={t("projects.picker.search")}
              value={busca()}
              onInput={(e) => setBusca(e.currentTarget.value)}
            />
          </div>

          <div class="max-h-[260px] overflow-y-auto py-1">
            <Show when={!busca().trim()}>
              <button class={ITEM_DE_MENU} onClick={() => elegir("")}>
                {t("projects.picker.none")}
              </button>
            </Show>

            <For each={filtradas()}>
              {(p) => (
                <button
                  class={`${ITEM_DE_MENU} truncate`}
                  onClick={() => elegir(p.id)}
                >
                  {p.name}
                </button>
              )}
            </For>

            <Show when={sinNada()}>
              <p class="m-0 px-2 py-3 text-center text-[0.6875rem]">
                {t("projects.picker.no_match")}
              </p>
            </Show>
          </div>

          <button
            class={`${ITEM_DE_MENU} border-t border-border`}
            onClick={() => {
              setAbierto(false);
              props.onNuevoProyecto();
            }}
          >
            {t("projects.picker.new")}
          </button>
        </PopoverContent>
      </Popover>
      </Show>

      {props.branch}

      {/* Qué va a leer el agente. Es estado, no glosa: sin esto, que el
          proyecto lea tres carpetas o ninguna se ve exactamente igual. */}
      <Show when={actual() && material().length > 0}>
        <span class="flex min-w-0 flex-wrap items-center gap-1">
          <For each={material()}>
            {(s) => (
              <Badge
                forma="dato"
                class="text-[0.625rem]"
                title={lineaDeProcedencia(
                  procedencia(s),
                  t("projects.view.origin_folder"),
                )}
              >
                {s.missing
                  ? t("projects.picker.source_missing", { name: s.name })
                  : s.name}
              </Badge>
            )}
          </For>
        </span>
      </Show>

      {/* Sin botón de «Nuevo proyecto» al lado: el selector ya lo ofrece como
          su última opción, y dos puertas al mismo sitio hacen dudar de si van
          al mismo sitio. */}
    </div>
  );
}

/* Aquí vivía `Destino`, el selector de a dónde publica el proyecto. Se fue con
   el campo: ver `workspace/projects.rs`. Prometía Confluence y Repositorio, que no
   existen, a alguien que no programa.

   Y aquí vivían `Project`, `Source` y `Agent`, que ahora están en
   `lib/model.ts`: siete archivos importaban tipos de un módulo que además
   pinta un selector. */
