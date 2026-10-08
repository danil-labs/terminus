import { invoke } from "../../lib/invoke.ts";
import Blocks from "lucide-solid/icons/blocks";
import Palette from "lucide-solid/icons/palette";
import Bot from "lucide-solid/icons/bot";
import Puzzle from "lucide-solid/icons/puzzle";
import Radar from "lucide-solid/icons/radar";
import GitBranch from "lucide-solid/icons/git-branch";
import Monitor from "lucide-solid/icons/monitor";
import SlidersHorizontal from "lucide-solid/icons/sliders-horizontal";
import Sparkles from "lucide-solid/icons/sparkles";
import { listen } from "@tauri-apps/api/event";
import { createSignal, For, type JSX, onCleanup, onMount, Show } from "solid-js";
import { t } from "../../lib/i18n";
import { type Superficie } from "../../lib/surfaces";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogTitle } from "../../ui/Dialog";
import { Close, MarcaAgente, MarcaProveedor } from "../../ui/icons";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "../../ui/sidebar";
import type { ModelChoices } from "../projects/NewAgent";
import Agents from "./Agents";
import Appearance from "./Appearance";
import AIProviders from "./AIProviders";
import Environment from "./Environment";
import General from "./General";
import Plugins from "./Plugins";
import Providers from "./Providers";
import Radiant from "./Radiant";
import Skills from "./Skills";
import Workspaces from "./Workspaces";

/**
 * Configuración: el contenedor y su navegación.
 *
 * El riel agrupa las secciones y solo cambia entre ellas. Así una configuración
 * crece por dentro sin volver a crecer a lo largo del riel.
 */

type Destino = {
  id: string;
  name: string;
  /**
   * La silueta de la sección. Se reconoce antes de leer, y este riel se
   * recorre a diario. `undefined` deja el hueco a las marcas de agente y
   * proveedor, que es lo que llena las filas de esas listas.
   */
  icono?: () => JSX.Element;
  /** `null` cuando la app todavía no lo tiene. */
  panel: (() => JSX.Element) | null;
  /**
   * Qué le falta para poder trabajar con esto, en dos palabras, y la frase
   * entera para el `title`. Los trae `list_surfaces`.
   *
   * **Aquí no deshabilitan nada**, y esa es la diferencia con el chat: esta es
   * justo la pantalla donde se conecta lo que falta, así que apagar el renglón
   * dejaría el arreglo sin sitio donde hacerse.
   */
  marca?: string | null;
  porque?: string | null;
};

/**
 * El catálogo de IA viene de Rust: añadir un agente le abre sitio aquí.
 *
 * **Recibe el accesor y no la lista, y eso es carga estructural.** El panel se
 * pinta con `destino().panel?.()`, que es una expresión reactiva: si esta
 * función leyera `superficies()`, `destino()` dependería de ella y **cada
 * refresco de la lista devolvería un objeto nuevo con un `panel` nuevo**, o sea
 * montar `AIProviders` entero desde cero.
 *
 * Sin él: pulsar «Agregar cuenta» emite el evento `account`, la lista se
 * refresca, y el desplegable del proveedor se cierra llevándose el `Accounts` de
 * dentro —con `enCurso`, la URL y el campo del código—. La persona se autentica
 * en el navegador y vuelve a una app sin dónde pegar el código, con el proceso
 * del CLI vivo esperándolo: medido, 36 segundos.
 *
 * Con el accesor, `destino()` deja de depender de la lista: el panel se monta
 * una vez y `AIProviders` recibe el contenido nuevo como prop, que su `Index`
 * aplica sin recrear filas. Cambiar de destino sigue montando uno nuevo, que es
 * lo que esa expresión sí tiene que hacer.
 *
 * `name` es un getter por lo mismo: leído aquí, cambiar de lengua remonta
 * General y su selector relee una lengua que aún no se guardó.
 */
/** Lo que la sección de agentes necesita de la ventana. Getters: leerlos aquí
 *  haría a `destino()` depender de ellos. */
type ContextoDeAgentes = {
  readonly modelos: ModelChoices;
  readonly proyecto: string;
  /** Los agentes de las tareas abiertas: sus proveedores llegan desplegados. */
  readonly agentesEnUso: string[];
  onAgentProfile: (project: string, name: string) => void;
};

const destinosDe = (
  superficies: () => Superficie[],
  agentes: ContextoDeAgentes,
): Destino[] => [
  {
    id: "general",
    get name() {
      return t("settings.nav.general");
    },
    icono: () => <SlidersHorizontal size={15} />,
    panel: () => <General />,
  },
  {
    id: "appearance",
    get name() {
      return t("settings.nav.appearance");
    },
    icono: () => <Palette size={15} />,
    panel: () => <Appearance proyecto={agentes.proyecto} />,
  },
  {
    id: "entorno",
    get name() {
      return t("settings.nav.environment");
    },
    icono: () => <Monitor size={15} />,
    panel: () => <Environment />,
  },
  // Skills y servidores MCP juntos: los dos los añade la persona y ninguno
  // lleva credencial de cliente. Separados, «Conexiones» nombraba servidores
  // MCP sin decirlo y las skills quedaban escondidas dentro de General.
  {
    id: "skills",
    get name() {
      return t("settings.nav.skills");
    },
    icono: () => <Blocks size={15} />,
    panel: () => <Skills />,
  },
  {
    id: "agentes",
    get name() {
      return t("settings.nav.agents");
    },
    icono: () => <Bot size={15} />,
    panel: () => (
      <Agents
        modelos={agentes.modelos}
        proyecto={agentes.proyecto}
        onAgentProfile={agentes.onAgentProfile}
      />
    ),
  },
  {
    id: "plugins",
    get name() {
      return t("settings.nav.plugins");
    },
    icono: () => <Puzzle size={15} />,
    panel: () => <Plugins />,
  },
  {
    id: "proveedores-ia",
    get name() {
      return t("settings.nav.ai_providers");
    },
    icono: () => <Sparkles size={15} />,
    panel: () => <AIProviders superficies={superficies()} agentesEnUso={agentes.agentesEnUso} />,
  },
  {
    id: "fuentes",
    get name() {
      return t("settings.nav.sources");
    },
    icono: () => <GitBranch size={15} />,
    panel: () => <Providers solo={["github", "bitbucket"]} />,
  },
  {
    id: "radiant",
    get name() {
      return t("settings.nav.radiant");
    },
    icono: () => <Radar size={15} />,
    panel: () => <Radiant />,
  },
];

const GRUPOS: { nombre: () => string; ids: string[] }[] = [
  { nombre: () => t("settings.nav.group_app"), ids: ["general", "appearance", "entorno"] },
  { nombre: () => t("settings.nav.group_custom"), ids: ["skills", "agentes", "plugins"] },
  {
    nombre: () => t("settings.nav.group_connections"),
    ids: ["proveedores-ia", "fuentes", "radiant"],
  },
];

const idTab = (id: string) => `cfg-tab-${id}`;

export default function Settings(props: {
  onClose: () => void;
  /** Con qué destino abrir. El menú del riel entra directo a administrar. */
  panel?: string;
  /** Con qué se crea un agente desde Agentes: lo mismo que ofrece el riel. */
  modelos: ModelChoices;
  /** La carpeta abierta, donde nace por omisión un agente nuevo. */
  proyecto?: string;
  /** Los agentes de las tareas abiertas. */
  agentesEnUso?: string[];
  /** Abre el perfil de un agente en esa carpeta; quien llama cierra la hoja. */
  onAgentProfile?: (project: string, name: string) => void;
}) {
  // Lo que se puede elegir para trabajar, que es lo que decide qué proveedores
  // tienen pantalla. Con su estado: aquí no apaga nada, lo enseña.
  const [superficies, setSuperficies] = createSignal<Superficie[]>([]);
  /**
   * **Sólo se guarda si de verdad cambió**, y eso no es una optimización.
   *
   * `list_surfaces` devuelve objetos nuevos en cada llamada, así que escribir la
   * señal con una respuesta idéntica despierta a todo el que la lea para nada.
   *
   * **Es la tercera de tres defensas, y sola no bastaba.** Las otras dos son
   * `destinosDe`, que recibe el accesor para que el panel no se monte de nuevo,
   * y el `Index` de `AIProviders`, que reutiliza la fila cuando el contenido sí
   * cambia. Esta solo cubre el caso fácil —que no haya cambiado nada— y no el
   * otro: **añadir una cuenta cambia la lista de verdad**, porque la insignia del
   * proveedor sale de `surfaces::sin_cuenta`.
   *
   * Comparar por JSON basta: son datos planos que vienen de Rust en un orden
   * fijo (el de `agents::AGENTS`), así que dos respuestas iguales se serializan
   * igual.
   */
  const cargarSuperficies = () => {
    void invoke<Superficie[]>("list_surfaces")
      .then((s) =>
        setSuperficies((antes) =>
          JSON.stringify(antes) === JSON.stringify(s) ? antes : s,
        ),
      )
      .catch(() => setSuperficies([]));
  };
  onMount(cargarSuperficies);

  /**
   * **Instalar un CLI cambia lo que esta pantalla afirma, así que se vuelve a
   * preguntar.**
   *
   * Se leía una sola vez al montar. La insignia de cada proveedor sale de aquí
   * —`superficie.marca`, que dice «no instalado» mirando si hay binario— así que
   * tras instalar desde el propio panel la fila seguía diciendo que no está,
   * mientras el botón de instalar sí desaparecía: `Accounts` vuelve a pedir
   * `list_agents` con este mismo evento y esta lista no: quedan dos verdades
   * sobre lo mismo en la misma tarjeta, y la que se lee primero es la falsa —«se
   * instaló pero sale no instalado, y ya no sale instalar»—. `App.tsx` hace lo
   * mismo para el menú del chat.
   */
  onMount(() => {
    const cambios = listen("agents", cargarSuperficies);
    // **Y conectar una cuenta también cambia lo que esta pantalla afirma.** La
    // insignia de un proveedor dice «sin cuenta» mirando cuál está elegida
    // (`surfaces::sin_cuenta`), así que guardar una clave la deja mintiendo
    // igual que la dejaba instalar un CLI. `App.tsx` ya escuchaba este evento
    // para el menú del chat, con el motivo escrito ahí; faltaba aquí.
    const cuenta = listen("account", cargarSuperficies);
    // La insignia de «Local» mira el motor y los pesos en disco
    // (`surfaces::estado_local`), y los dos cambian desde esta misma pantalla.
    const motor = listen("local-engine", cargarSuperficies);
    const pesos = listen<{ kind: string }>("local-model", (e) => {
      if (e.payload.kind === "done") cargarSuperficies();
    });
    window.addEventListener("harness:consentimiento", cargarSuperficies);
    onCleanup(() => {
      window.removeEventListener("harness:consentimiento", cargarSuperficies);
      void cambios.then((f) => f());
      void cuenta.then((f) => f());
      void motor.then((f) => f());
      void pesos.then((f) => f());
    });
  });
  const TODOS = () =>
    destinosDe(superficies, {
      get modelos() {
        return props.modelos;
      },
      get proyecto() {
        return props.proyecto ?? "";
      },
      get agentesEnUso() {
        return props.agentesEnUso ?? [];
      },
      onAgentProfile: (project, name) => props.onAgentProfile?.(project, name),
    });

  const [activo, setActivo] = createSignal(props.panel ?? "general");
  // El foco viaja con las flechas sin arrastrar la selección: así se puede
  // recorrer la lista entera —incluidos los que aún no existen, que sí se
  // enfocan y anuncian por qué no— sin cambiar de panel en cada paso.
  const [foco, setFoco] = createSignal("general");
  onMount(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Un campo marcado cancela lo suyo con Esc y se queda con la tecla:
        // esta escucha va en captura y de otro modo llega antes que él.
        if ((e.target as Element | null)?.closest?.("[data-owns-escape]")) return;
        // La superficie está encima de todo: se queda con el Esc y no deja que
        // llegue a cerrar la columna de artefactos que hay detrás.
        e.stopPropagation();
        props.onClose();
      }
    };
    window.addEventListener("keydown", alTeclear, true);
    onCleanup(() => window.removeEventListener("keydown", alTeclear, true));
  });

  function mover(paso: number | "inicio" | "fin") {
    const destinos = TODOS();
    const i = destinos.findIndex((d) => d.id === foco());
    const j =
      paso === "inicio"
        ? 0
        : paso === "fin"
          ? destinos.length - 1
          : (i + paso + destinos.length) % destinos.length;
    const id = destinos[j].id;
    setFoco(id);
    document.getElementById(idTab(id))?.focus();
  }

  function teclas(e: KeyboardEvent) {
    const pasos: Record<string, number | "inicio" | "fin"> = {
      ArrowDown: 1,
      ArrowUp: -1,
      Home: "inicio",
      End: "fin",
    };
    const paso = pasos[e.key];
    if (paso === undefined) return;
    e.preventDefault();
    mover(paso);
  }

  function abrir(d: Destino) {
    setFoco(d.id);
    // WebKit no le da el foco a un botón al pulsarlo, así que sin esto el
    // primer clic deja las flechas sin punto de partida: se pulsa un destino,
    // se pulsa abajo, y no se mueve nada.
    document.getElementById(idTab(d.id))?.focus({ focusVisible: false } as FocusOptions);
    if (d.panel) setActivo(d.id);
  }

  function Fila(p: { d: Destino }) {
    const existe = () => p.d.panel !== null;
    // **Lo que falta se ve aquí, porque dejó de verse en el chat.** Su menú
    // ofrece solo lo utilizable, así que este riel es el único sitio donde se
    // descubre que algo existe y qué le falta para poder usarse.
    const marca = () =>
      !existe()
        ? { texto: t("settings.nav.soon"), porque: t("settings.nav.soon_why") }
        : p.d.marca
          ? { texto: p.d.marca, porque: p.d.porque ?? undefined }
          : null;

    return (
      <SidebarMenuItem role="presentation">
        <SidebarMenuButton
          id={idTab(p.d.id)}
          role="tab"
          aria-selected={activo() === p.d.id}
          aria-controls="cfg-panel"
          aria-disabled={existe() ? undefined : true}
          tabindex={foco() === p.d.id ? 0 : -1}
          isActive={activo() === p.d.id}
          selectionMark={false}
          title={marca()?.porque}
          // El fondo del activo vive en el átomo. En este riel basta junto con
          // el peso del nombre: la barra de acento pertenece a la navegación
          // principal y aquí duplicaba una señal sobre una lista corta.
          // **Apagada por color y no por opacidad**, y no es una preferencia:
          // el 45 % se aplicaba a la fila entera, así que se llevaba por delante
          // la palabra que dice POR QUÉ está apagada. «pronto» medía **1,77:1 en
          // claro y 1,72:1 en oscuro** —la peor medición de toda la revisión de
          // diseño, y simétrica: no la salvaba ningún tema—, y el nombre de la
          // fila quedaba en 3,04 y 4,33. Una fila apagada que no se puede leer
          // no dice que no está disponible: dice nada.
          //
          // `neutral-500` es el gris de lo secundario del sistema y pasa AA en
          // las cuatro superficies de los dos temas. Lo que marca «no
          // disponible» sigue estando: el cursor, `aria-disabled`, la ausencia
          // de hover y el propio rótulo.
          class="pestana-fundida h-10 min-h-10 grid-cols-[18px_minmax(0,1fr)_auto] gap-2.5 rounded-l-[10px] rounded-r-none border-0 py-0 pl-3.5 pr-3 focus-visible:outline-offset-[-2px] data-[active=true]:bg-surface data-[active=true]:font-semibold data-[active=true]:hover:bg-surface aria-disabled:cursor-default aria-disabled:text-neutral-500 aria-disabled:hover:bg-transparent"
          onClick={() => abrir(p.d)}
          onKeyDown={teclas}
        >
          {/* Su marca, cuando la hay. Reconocer «Claude» o «GitHub» por su
              silueta es más rápido que leer, y esta lista se recorre a diario.
              Los que no tienen —Jira, Confluence, Opencode— dejan el hueco: un
              símbolo inventado afirmaría de quién es algo que no sabemos. */}
          <Show
            when={p.d.icono}
            fallback={
              <span class="flex size-4 items-center justify-center text-neutral-950">
                <MarcaAgente id={p.d.id} size={15} />
                <MarcaProveedor id={p.d.id} size={15} />
              </span>
            }
          >
            {/* Sin color propio: hereda el del botón, que ya sale de `@theme` y
                se invierte con el tema. Clavado, el icono desaparece en oscuro. */}
            {(icono) => (
              <span class="flex size-4 items-center justify-center">
                {icono()()}
              </span>
            )}
          </Show>
          <span class="truncate">{p.d.name}</span>
          <Show when={marca()}>
            {(m) => (
              <span class="ui-sidebar-menu-badge text-[0.625rem] font-normal text-neutral-500">
                {m().texto}
              </span>
            )}
          </Show>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  const destino = () => TODOS().find((d) => d.id === activo()) ?? TODOS()[0];

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && props.onClose()}>
        <DialogContent
          // **880×640 era un tope por debajo de la ventana**, así que la hoja
          // nacía tocándolo: con la ventana por omisión —1000×720, menos los
          // 24 px del margen del diálogo por lado— el área útil ya es 952×672, y
          // agrandar la ventana no daba ni un píxel más. Medido a 1440×900 y a
          // 1512×982: la hoja seguía en 880×640.
          //
          // El ancho conserva tope porque el panel de la derecha es prosa y
          // controles: pasado el ancho de una columna legible, estirarlo no
          // añade nada. El alto sí crece con la ventana, porque lo que crece
          // aquí es el riel — un agente más es una fila más.
          class="flex h-[min(900px,100%)] w-[min(1120px,100%)] max-w-[1120px] flex-col overflow-hidden p-0"
          aria-label={t("settings.title")}
        >
          {/* **La fila tiene que ser `minmax(0,1fr)` y no la implícita.** Sin
              declararla, `grid-auto-rows: auto` la dimensiona por su contenido:
              el riel medía lo que sumaban sus grupos, crecía por debajo del
              fondo de la hoja —163 px a 720×520— y se llevaba el pie con él. Y
              como el `SidebarContent` heredaba esa altura, su `overflow-y-auto`
              no tenía nada que desplazar: `scrollHeight` era igual a
              `clientHeight`. Acotar la fila es lo que hace que el riel se
              desplace; el `overflow` por sí solo no hacía nada. */}
          <div class="grid min-h-0 flex-1 grid-cols-[224px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)]">
            <Sidebar
              role="tablist"
              aria-orientation="vertical"
              aria-label={t("settings.nav.label")}
              class="border-0 bg-rail"
            >
              <SidebarHeader class="pb-6 pl-5 pr-3 pt-4">
                <DialogTitle class="m-0 text-[0.9375rem] font-semibold">
                  {t("settings.title")}
                </DialogTitle>
              </SidebarHeader>

              <SidebarContent class="flex flex-col gap-6 overflow-y-auto px-0 pb-4 pl-2">
                <For each={GRUPOS}>
                  {(g) => (
                    <div role="presentation" class="flex flex-col gap-3">
                      <p class="m-0 px-3 text-xs text-neutral-500">{g.nombre()}</p>
                      <SidebarMenu role="presentation" class="gap-1.5">
                        <For each={g.ids}>
                          {(id) => (
                            <Show when={TODOS().find((d) => d.id === id)}>
                              {(d) => <Fila d={d()} />}
                            </Show>
                          )}
                        </For>
                      </SidebarMenu>
                    </div>
                  )}
                </For>
              </SidebarContent>
            </Sidebar>

            <div class="relative min-h-0 min-w-0 bg-surface">
              <Button
                variant="ghost"
                size="iconCompact"
                class="absolute right-8 top-3 z-10 size-7"
                onClick={props.onClose}
                aria-label={t("settings.close")}
              >
                <Close size={16} />
              </Button>
            {/* Sin franja de título: el renglón activo del sidebar ya nombra lo
                que hay aquí, y repetirlo arriba es el rótulo redundante que
                el sistema visual descarta.

                `destino().panel?.()` vive dentro de una expresión reactiva:
                cambiar de destino la vuelve a evaluar y monta el panel que
                corresponde, sin conservar las cuentas del anterior. */}
            <div
              id="cfg-panel"
              role="tabpanel"
              aria-labelledby={activo() === "workspaces" ? undefined : idTab(destino().id)}
              class="h-full min-w-0 overflow-auto px-8 pb-10 pt-[76px]"
            >
              <Show when={activo() === "workspaces"} fallback={destino().panel?.()}>
                <Workspaces />
              </Show>
            </div>
            </div>
          </div>
      </DialogContent>
    </Dialog>
  );
}
