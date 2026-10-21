import Ban from "lucide-solid/icons/ban";
import Check from "lucide-solid/icons/check";
import FolderOpen from "lucide-solid/icons/folder-open";
import Plus from "lucide-solid/icons/plus";
import X from "lucide-solid/icons/x";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { t } from "../../lib/i18n";
import { invoke } from "../../lib/invoke.ts";
import type {
  AgenteDelRepositorio,
  AgenteDeMaquina,
  AgentProfile,
  CambioDeCarpetas,
  CatalogoDeAgentes,
  HandlerScope,
  Project,
} from "../../lib/model";
import { cn } from "../../lib/utils";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogTitle } from "../../ui/Dialog";
import { EmptyState } from "../../ui/EmptyState";
import { prosaDe } from "../../ui/Failure";
import { ITEM_DE_MENU, Popover, PopoverContent, PopoverTrigger } from "../../ui/Popover";
import { Toast } from "../../ui/Toast";
import { AstroAvatar } from "../projects/AstroAvatar";
import NewAgent, { type ModelChoices } from "../projects/NewAgent";
import { displayName } from "../projects/profiles";
import { SettingsPanel, SettingsRow, SettingsSection } from "./layout";

/**
 * Configuración › Agentes: los agentes propios con las carpetas donde trabajan,
 * y los que declara el repositorio de cada carpeta, que solo se leen
 * (`docs/custom-agents.md` § El catálogo).
 */

type Fila = AgenteDeMaquina & { id: string };
type FilaDelRepositorio = AgenteDelRepositorio & { id: string };

type Aviso = {
  id: number;
  error?: boolean;
  titulo: string;
  cuerpo?: string;
  deshacer?: () => Promise<void>;
};

const ENFOCABLE =
  "outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

// El primer hijo del grupo es su rótulo: el punto separa carpeta de carpeta.
const CARPETA =
  "inline-flex items-center nth-[n+3]:before:mr-1.5 nth-[n+3]:before:size-[3px] nth-[n+3]:before:rounded-full nth-[n+3]:before:bg-current";

const claveDeAlcance = (s: HandlerScope | null) =>
  s?.kind === "project" ? `p:${s.id}` : "w";
const claveDeFila = (a: AgenteDeMaquina) => `${claveDeAlcance(a.agent.own_scope)}:${a.agent.name}`;

export default function Agents(props: {
  modelos: ModelChoices;
  /** La carpeta abierta: donde nace por omisión un agente nuevo. */
  proyecto: string;
  onAgentProfile?: (project: string, name: string) => void;
}) {
  const [propios, setPropios] = createStore<Fila[]>([]);
  const [delRepositorio, setDelRepositorio] = createStore<FilaDelRepositorio[]>([]);
  const [carpetas, setCarpetas] = createSignal<Project[]>([]);
  const [cargado, setCargado] = createSignal(false);
  const [falloAlLeer, setFalloAlLeer] = createSignal<string | null>(null);
  const [ocupadas, setOcupadas] = createSignal<ReadonlySet<string>>(new Set());
  const [avisos, setAvisos] = createSignal<Aviso[]>([]);
  const [creando, setCreando] = createSignal(false);
  const [mudanza, setMudanza] = createSignal<{ fila: Fila; folder: string } | null>(null);
  const [mudando, setMudando] = createSignal(false);
  const [falloDeMudanza, setFalloDeMudanza] = createSignal<string | null>(null);
  let raiz: HTMLDivElement | undefined;
  let lectura = 0;

  // Una respuesta vieja no pisa la nueva: cambiar de workspace con la hoja
  // abierta deja en vuelo la lectura del anterior.
  async function recargar() {
    const esta = ++lectura;
    try {
      const [catalogo, proyectos] = await Promise.all([
        invoke<CatalogoDeAgentes>("list_machine_agents"),
        invoke<Project[]>("list_projects"),
      ]);
      if (esta !== lectura) return;
      setCarpetas(proyectos);
      setPropios(reconcile(catalogo.own.map((a) => ({ ...a, id: claveDeFila(a) })), { key: "id" }));
      setDelRepositorio(
        reconcile(catalogo.repository.map((r) => ({ ...r, id: r.agent.origin })), { key: "id" }),
      );
      setFalloAlLeer(null);
    } catch (e) {
      if (esta === lectura) setFalloAlLeer(prosaDe(e));
    } finally {
      if (esta === lectura) setCargado(true);
    }
  }

  // Lo que avisa esta misma sección lleva `detail` y no se relee dos veces.
  // Los perfiles se leen por carpeta: sin releerlos, el agente que entra en una
  // se pinta ahí sin su cara ni su fondo.
  const PROPIO = "settings-agents";
  function avisarAlRiel() {
    window.dispatchEvent(new CustomEvent("harness:encargados", { detail: PROPIO }));
    window.dispatchEvent(new CustomEvent("harness:profiles", { detail: PROPIO }));
  }

  onMount(() => {
    void recargar();
    const deFuera = (e: Event) => {
      if ((e as CustomEvent).detail !== PROPIO) void recargar();
    };
    const workspace = () => {
      setPropios([]);
      setDelRepositorio([]);
      setCargado(false);
      void recargar();
    };
    window.addEventListener("harness:encargados", deFuera);
    window.addEventListener("harness:profiles", deFuera);
    window.addEventListener("harness:workspace", workspace);
    onCleanup(() => {
      window.removeEventListener("harness:encargados", deFuera);
      window.removeEventListener("harness:profiles", deFuera);
      window.removeEventListener("harness:workspace", workspace);
      lectura++;
    });
  });

  const nombreDe = (id: string) => carpetas().find((p) => p.id === id)?.name ?? id;

  // La primera clave que siga en pantalla: quitar o agregar puede llevarse el
  // botón que tenía el foco. Un turno después, cuando la fila ya se soltó.
  function enfocar(...claves: string[]) {
    setTimeout(() => {
      for (const clave of claves) {
        const el = [...(raiz?.querySelectorAll<HTMLElement>("[data-key]") ?? [])].find(
          (x) => x.dataset.key === clave,
        );
        if (el && !el.hasAttribute("disabled")) return el.focus();
      }
    });
  }

  let siguienteAviso = 0;
  function avisar(a: Omit<Aviso, "id">) {
    setAvisos((lista) => [...lista, { ...a, id: ++siguienteAviso }].slice(-3));
  }
  const quitarAviso = (id: number) => setAvisos((lista) => lista.filter((a) => a.id !== id));

  async function cambiar(fila: Fila, change: CambioDeCarpetas) {
    return invoke<string[] | null>("change_agent_folders", {
      scope: fila.agent.own_scope,
      name: fila.agent.name,
      change,
    });
  }

  async function conFila<T>(fila: Fila, trabajo: () => Promise<T>) {
    setOcupadas((s) => new Set(s).add(fila.id));
    try {
      return await trabajo();
    } finally {
      setOcupadas((s) => {
        const otro = new Set(s);
        otro.delete(fila.id);
        return otro;
      });
    }
  }

  async function agregar(fila: Fila, folder: string) {
    await conFila(fila, async () => {
      try {
        await cambiar(fila, { kind: "add", folder });
        await recargar();
        avisarAlRiel();
        avisar({
          titulo: t("settings.agents.added_title", { name: fila.agent.name, folder: nombreDe(folder) }),
          cuerpo: t("settings.agents.added_body"),
        });
      } catch (e) {
        avisar({ error: true, titulo: prosaDe(e) });
      }
      enfocar(`add:${fila.id}`, `pf:${fila.id}`);
    });
  }

  async function quitar(fila: Fila, folder: string) {
    const antes = fila.all_folders ? null : [...fila.folders];
    const i = fila.folders.indexOf(folder);
    const vecina = fila.folders[i + 1] ?? fila.folders[i - 1];
    const name = fila.agent.name;
    const id = fila.id;
    await conFila(fila, async () => {
      try {
        const despues = await cambiar(fila, { kind: "remove", folder });
        await recargar();
        avisarAlRiel();
        const quedan = propios.find((f) => f.id === id)?.folders.length ?? 0;
        enfocar(...(quedan > 1 && vecina ? [`rm:${id}:${vecina}`] : []), `add:${id}`, `pf:${id}`);
        const datos = { name, folder: nombreDe(folder) };
        avisar({
          titulo: antes
            ? t("settings.agents.removed_title", datos)
            : t("settings.agents.removed_all_title", datos),
          cuerpo: antes ? t("settings.agents.removed_body") : t("settings.agents.removed_all_body"),
          deshacer: () => deshacer(fila, despues, antes, folder),
        });
      } catch (e) {
        avisar({ error: true, titulo: prosaDe(e) });
        enfocar(`rm:${id}:${folder}`, `pf:${id}`);
      }
    });
  }

  // Compara y pone: si alguien cambió la lista entre medias, el backend
  // contesta `conflict` y se enseña; no se reintenta.
  async function deshacer(
    fila: Fila,
    expected: string[] | null,
    folders: string[] | null,
    folder: string,
  ) {
    await conFila(fila, async () => {
      try {
        await cambiar(fila, { kind: "restore", expected, folders });
        await recargar();
        avisarAlRiel();
        enfocar(`rm:${fila.id}:${folder}`, `add:${fila.id}`, `pf:${fila.id}`);
      } catch (e) {
        avisar({ error: true, titulo: prosaDe(e) });
        await recargar();
      }
    });
  }

  function elegirCarpeta(fila: Fila, folder: string) {
    if (fila.agent.own_scope?.kind === "project") {
      setFalloDeMudanza(null);
      setMudanza({ fila, folder });
    } else void agregar(fila, folder);
  }

  // El foco vuelve a quien abrió el diálogo; tras mudarse, la fila es otra.
  let volverA: string | null = null;
  async function confirmarMudanza() {
    const m = mudanza();
    if (!m || mudando()) return;
    const home = m.fila.folders[0] ?? "";
    setMudando(true);
    setFalloDeMudanza(null);
    try {
      await cambiar(m.fila, { kind: "add", folder: m.folder });
      await recargar();
      avisarAlRiel();
      volverA = `add:w:${m.fila.agent.name}`;
      setMudanza(null);
      avisar({
        titulo: t("settings.agents.moved_title", { name: m.fila.agent.name }),
        cuerpo: t("settings.agents.moved_body", { home: nombreDe(home), folder: nombreDe(m.folder) }),
      });
    } catch (e) {
      setFalloDeMudanza(prosaDe(e));
    } finally {
      setMudando(false);
    }
  }

  const carpetaPorOmision = () =>
    carpetas().some((p) => p.id === props.proyecto) ? props.proyecto : (carpetas()[0]?.id ?? "");

  function abrirPerfil(fila: { agent: { name: string }; folders: string[] }) {
    const donde = fila.folders[0];
    if (donde) props.onAgentProfile?.(donde, fila.agent.name);
  }

  function FilaPropia(p: { a: Fila }) {
    const ocupada = () => ocupadas().has(p.a.id);
    const faltan = () => carpetas().filter((c) => !p.a.folders.includes(c.id));
    const [menu, setMenu] = createSignal(false);
    const name = () => p.a.agent.name;

    return (
      <SettingsRow
        role="listitem"
        lead={<Avatar name={name()} profile={p.a.profile} />}
        label={<Titulo name={name()} profile={p.a.profile} />}
        description={
          <>
            <div
              role="group"
              aria-label={t("settings.agents.active_in_label", { name: name() })}
              class="flex min-w-0 flex-wrap items-center gap-x-1.5"
            >
              <span>
                {p.a.all_folders ? t("settings.agents.active_in_all") : t("settings.agents.active_in")}
              </span>
              <For each={p.a.folders}>
                {(folder) => (
                  <Show
                    when={p.a.folders.length > 1}
                    fallback={
                      <span class={CARPETA} title={t("settings.agents.last_folder_title")}>
                        {nombreDe(folder)}
                      </span>
                    }
                  >
                    <span class={cn(CARPETA, "gap-0.5")}>
                      {nombreDe(folder)}
                      <button
                        type="button"
                        data-key={`rm:${p.a.id}:${folder}`}
                        aria-label={t("settings.agents.remove", { name: name(), folder: nombreDe(folder) })}
                        disabled={ocupada()}
                        onClick={() => void quitar(p.a, folder)}
                        class={cn(
                          "grid size-4 place-items-center rounded-full border-0 bg-transparent p-0 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-950 disabled:opacity-60",
                          ENFOCABLE,
                        )}
                      >
                        <X size={11} stroke-width={2.4} />
                      </button>
                    </span>
                  </Show>
                )}
              </For>
            </div>
            <Descripcion texto={p.a.agent.description} />
          </>
        }
      >
        <Show when={faltan().length > 0}>
          <Popover open={menu()} onOpenChange={setMenu} placement="bottom-start" gutter={4}>
            <PopoverTrigger
              as={(q: object) => (
                <Button
                  {...q}
                  variant="ghost"
                  size="compact"
                  aria-haspopup="menu"
                  data-key={`add:${p.a.id}`}
                  disabled={ocupada()}
                  class="aria-expanded:bg-neutral-100 aria-expanded:text-neutral-950"
                >
                  <Plus size={14} />
                  {t("settings.agents.add_to_folder")}
                </Button>
              )}
            />
            <MenuDeCarpetas
              fila={p.a}
              onElegir={(folder) => {
                setMenu(false);
                // El menú devuelve el foco a su botón al cerrarse; el
                // diálogo se abre después para quedarse con él.
                setTimeout(() => elegirCarpeta(p.a, folder));
              }}
            />
          </Popover>
        </Show>
        <Show when={p.a.agent.folder}>
          {(folder) => (
            <Button
              variant="ghost"
              size="compact"
              onClick={() =>
                void invoke("open_external", { target: folder() }).catch((e) =>
                  avisar({ error: true, titulo: prosaDe(e) }),
                )
              }
            >
              <FolderOpen size={14} />
              {t("settings.agents.open_folder")}
            </Button>
          )}
        </Show>
        <Button
          variant="secondary"
          size="sm"
          data-key={`pf:${p.a.id}`}
          disabled={p.a.folders.length === 0}
          onClick={() => abrirPerfil(p.a)}
        >
          {t("settings.agents.open_profile")}
        </Button>
      </SettingsRow>
    );
  }

  function MenuDeCarpetas(p: { fila: Fila; onElegir: (folder: string) => void }) {
    let caja: HTMLDivElement | undefined;
    const items = () => [...(caja?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const razon = (id: string) => {
      if (p.fila.folders.includes(id)) return { icono: "aqui" as const, texto: t("settings.agents.menu_here") };
      const b = p.fila.blocked.find((x) => x.folder === id);
      if (!b) return null;
      const datos = { name: p.fila.agent.name, folder: nombreDe(id) };
      return {
        icono: "gana" as const,
        texto: b.repository
          ? t("settings.agents.menu_blocked_repository", datos)
          : t("settings.agents.menu_blocked_own", datos),
      };
    };

    function teclas(e: KeyboardEvent) {
      const todos = items();
      const i = todos.indexOf(document.activeElement as HTMLElement);
      const ir = (n: number) => {
        e.preventDefault();
        todos[(n + todos.length) % todos.length]?.focus();
      };
      if (e.key === "ArrowDown") ir(i + 1);
      else if (e.key === "ArrowUp") ir(i - 1);
      else if (e.key === "Home") ir(0);
      else if (e.key === "End") ir(todos.length - 1);
    }

    return (
      <PopoverContent
        ref={caja}
        role="menu"
        aria-label={t("settings.agents.menu_label", { name: p.fila.agent.name })}
        data-owns-escape
        class="z-[90] grid w-[300px] gap-0.5 p-1"
        onKeyDown={teclas}
        // Como Kobalte, un turno después: al montar, el portal aún no está en
        // el documento y el foco no entra.
        onOpenAutoFocus={(e: Event) => {
          e.preventDefault();
          setTimeout(() => {
            const todos = items();
            (todos.find((b) => b.getAttribute("aria-disabled") !== "true") ?? todos[0])?.focus();
          });
        }}
      >
        <div aria-hidden="true" class="px-2 pt-1.5 pb-1 text-[0.6875rem] text-neutral-500">
          {t("settings.agents.menu_title", { name: p.fila.agent.name })}
        </div>
        <Show
          when={!p.fila.catalog_taken}
          fallback={
            <div role="menuitem" aria-disabled="true" tabindex={-1} class={cn(ITEM_DE_MENU, "text-xs text-neutral-700")}>
              {t("settings.agents.menu_catalog_taken", { origin: p.fila.catalog_taken ?? "" })}
            </div>
          }
        >
          <For each={carpetas()}>
            {(c) => {
              const r = () => razon(c.id);
              const whyId = `agent-menu-why-${p.fila.id}-${c.id}`;
              return (
                <button
                  type="button"
                  role="menuitem"
                  tabindex={-1}
                  aria-disabled={r() ? "true" : undefined}
                  aria-describedby={r() ? whyId : undefined}
                  onClick={() => {
                    if (!r()) p.onElegir(c.id);
                  }}
                  class={cn(
                    ITEM_DE_MENU,
                    "grid grid-cols-[16px_minmax(0,1fr)] items-start gap-2 border-0 bg-transparent aria-disabled:cursor-default aria-disabled:text-neutral-500",
                  )}
                >
                  <span class="mt-0.5 flex size-4 items-center justify-center" aria-hidden="true">
                    <Show when={r()?.icono === "aqui"}>
                      <Check size={14} />
                    </Show>
                    <Show when={r()?.icono === "gana"}>
                      <Ban size={14} />
                    </Show>
                  </span>
                  <span class="min-w-0">
                    <span class="block truncate">{c.name}</span>
                    <Show when={r()}>
                      {(x) => (
                        <span id={whyId} class="mt-px block text-xs text-neutral-500">
                          {x().texto}
                        </span>
                      )}
                    </Show>
                  </span>
                </button>
              );
            }}
          </For>
        </Show>
      </PopoverContent>
    );
  }

  function FilaRepositorio(p: { r: FilaDelRepositorio }) {
    return (
      <SettingsRow
        role="listitem"
        lead={<Avatar name={p.r.agent.name} profile={p.r.profile} />}
        label={<Titulo name={p.r.agent.name} profile={p.r.profile} />}
        description={
          <>
            <p class="m-0 truncate font-mono text-xs" title={p.r.agent.origin}>
              {p.r.agent.origin}
            </p>
            <div class="flex min-w-0 flex-wrap items-center gap-x-1.5">
              <span>{t("settings.agents.declared_in")}</span>
              <For each={p.r.folders}>{(folder) => <span class={CARPETA}>{nombreDe(folder)}</span>}</For>
            </div>
            <Descripcion texto={p.r.agent.description} />
          </>
        }
      >
        <Button
          variant="ghost"
          size="compact"
          onClick={() =>
            void invoke("open_external", { target: p.r.agent.origin }).catch((e) =>
              avisar({ error: true, titulo: prosaDe(e) }),
            )
          }
        >
          {t("settings.agents.view_file")}
        </Button>
      </SettingsRow>
    );
  }

  return (
    <SettingsPanel ref={raiz} class="flex min-h-full flex-col">
      <SettingsSection
        aria-labelledby="agents-own"
        title={<span id="agents-own">{t("settings.agents.own_title")}</span>}
        aside={
          <Button
            variant="secondary"
            size="sm"
            data-key="new-agent"
            disabled={carpetas().length === 0}
            title={carpetas().length === 0 ? t("settings.agents.new_no_folder") : undefined}
            onClick={() => setCreando(true)}
          >
            <Plus size={14} />
            {t("settings.agents.new")}
          </Button>
        }
      >
        <Show when={falloAlLeer()}>
          {(texto) => <p class="m-0 py-2 text-xs text-error-strong">{texto()}</p>}
        </Show>
        <Show when={cargado() && propios.length === 0 && !falloAlLeer()}>
          <EmptyState title={t("settings.agents.own_empty")} />
        </Show>
        <div role="list" class="grid min-w-0">
          <For each={propios}>{(a) => <FilaPropia a={a} />}</For>
        </div>
      </SettingsSection>

      <Show when={delRepositorio.length > 0}>
        <SettingsSection
          aria-labelledby="agents-repository"
          title={<span id="agents-repository">{t("settings.agents.repository_title")}</span>}
          description={t("settings.agents.repository_lead")}
        >
          <div role="list" class="grid min-w-0">
            <For each={delRepositorio}>{(r) => <FilaRepositorio r={r} />}</For>
          </div>
        </SettingsSection>
      </Show>

      <div class="pointer-events-none sticky bottom-0 mt-auto h-0">
        <div class="absolute right-0 bottom-0 grid justify-items-end gap-2" aria-live="polite">
          <For each={avisos()}>{(a) => <AvisoDeAgentes aviso={a} onCerrar={() => quitarAviso(a.id)} />}</For>
        </div>
      </div>

      <NewAgent
        abierto={creando()}
        onAbrir={setCreando}
        project={carpetaPorOmision()}
        carpetas={carpetas()}
        modelos={props.modelos}
        onCreado={() => {}}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          enfocar("new-agent");
        }}
      />

      <Dialog
        open={mudanza() !== null}
        onOpenChange={(abierto) => {
          if (!abierto && !mudando()) setMudanza(null);
        }}
      >
        <Show when={mudanza()}>
          {(m) => {
            const name = m().fila.agent.name;
            const home = nombreDe(m().fila.folders[0] ?? "");
            const folder = nombreDe(m().folder);
            let cancelar: HTMLButtonElement | undefined;
            return (
              <DialogContent
                role="alertdialog"
                data-owns-escape
                aria-describedby="agents-move-body"
                onOpenAutoFocus={(e: Event) => {
                  e.preventDefault();
                  volverA = `add:${m().fila.id}`;
                  setTimeout(() => cancelar?.focus());
                }}
                onCloseAutoFocus={(e: Event) => {
                  e.preventDefault();
                  if (volverA) enfocar(volverA, volverA.replace(/^add:/, "pf:"));
                }}
              >
                <DialogTitle class="m-0 text-[15px] font-semibold">
                  {t("settings.agents.move_title", { name })}
                </DialogTitle>
                <div id="agents-move-body" class="text-[13px] text-neutral-700">
                  <p class="m-0 mt-2">{t("settings.agents.move_body", { name, home })}</p>
                  <ul class="m-0 mt-2.5 grid list-disc gap-0.5 pl-[18px]">
                    <li>{t("settings.agents.move_stays", { home })}</li>
                    <li>{t("settings.agents.move_adds", { folder })}</li>
                  </ul>
                  <p class="m-0 mt-2 text-xs text-neutral-500">{t("settings.agents.move_same")}</p>
                </div>
                <Show when={falloDeMudanza()}>
                  {(texto) => (
                    <p role="alert" class="m-0 mt-3 text-xs text-error-strong">
                      {texto()}
                    </p>
                  )}
                </Show>
                <div class="mt-4 flex justify-end gap-2">
                  <Button
                    ref={cancelar}
                    variant="secondary"
                    size="sm"
                    disabled={mudando()}
                    onClick={() => setMudanza(null)}
                  >
                    {t("settings.agents.move_cancel")}
                  </Button>
                  <Button size="sm" disabled={mudando()} onClick={() => void confirmarMudanza()}>
                    {mudando() ? t("settings.agents.move_working") : t("settings.agents.move_confirm")}
                  </Button>
                </div>
              </DialogContent>
            );
          }}
        </Show>
      </Dialog>
    </SettingsPanel>
  );
}

function Avatar(p: { name: string; profile: AgentProfile }) {
  return (
    <AstroAvatar name={p.name} body={p.profile.body} avatar={p.profile.avatar} status="awake" size={32} />
  );
}

function Titulo(p: { name: string; profile: AgentProfile }) {
  const visible = () => displayName(p.name, p.profile);
  return (
    <div class="flex min-w-0 flex-wrap items-center gap-2">
      <span>{visible()}</span>
      <Show when={visible() !== p.name}>
        <span class="font-mono text-[0.6875rem] text-neutral-500">{p.name}</span>
      </Show>
    </div>
  );
}

function Descripcion(p: { texto: string }) {
  return (
    <Show when={p.texto}>
      <p class="m-0 truncate" title={p.texto}>
        {p.texto}
      </p>
    </Show>
  );
}

// Con «Deshacer» o con error dura 8 s: hay que leerlo y decidir. Se detiene
// mientras el puntero o el foco estén encima.
function AvisoDeAgentes(p: { aviso: Aviso; onCerrar: () => void }) {
  let reloj: ReturnType<typeof setTimeout> | undefined;
  const programar = (ms: number) => {
    clearTimeout(reloj);
    reloj = setTimeout(p.onCerrar, ms);
  };
  programar(p.aviso.deshacer || p.aviso.error ? 8000 : 4500);
  onCleanup(() => clearTimeout(reloj));
  const [deshaciendo, setDeshaciendo] = createSignal(false);

  return (
    <Toast
      tone={p.aviso.error ? "error" : "status"}
      onDismiss={p.onCerrar}
      onPointerEnter={() => clearTimeout(reloj)}
      onPointerLeave={() => programar(3000)}
      onFocusIn={() => clearTimeout(reloj)}
      onFocusOut={() => programar(3000)}
    >
      <p class="m-0 text-[0.8125rem] font-semibold">{p.aviso.titulo}</p>
      <Show when={p.aviso.cuerpo}>
        <p class="m-0 text-xs text-neutral-700">{p.aviso.cuerpo}</p>
      </Show>
      <Show when={p.aviso.deshacer}>
        {(deshacer) => (
          <div class="flex">
            <Button
              variant="secondary"
              size="compact"
              disabled={deshaciendo()}
              onClick={async () => {
                setDeshaciendo(true);
                p.onCerrar();
                await deshacer()();
              }}
            >
              {t("settings.agents.undo")}
            </Button>
          </div>
        )}
      </Show>
    </Toast>
  );
}
