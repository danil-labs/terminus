import { open } from "@tauri-apps/plugin-dialog";
import ImagePlus from "lucide-solid/icons/image-plus";
import Monitor from "lucide-solid/icons/monitor";
import Moon from "lucide-solid/icons/moon";
import Sun from "lucide-solid/icons/sun";
import Trash2 from "lucide-solid/icons/trash-2";
import X from "lucide-solid/icons/x";
import { For, Show, createResource, createSignal, onCleanup, onMount, type Component } from "solid-js";
import { invoke } from "../../lib/invoke.ts";
import { t } from "../../lib/i18n";
import type { AgentProfile, AgenteDeMaquina, CatalogoDeAgentes } from "../../lib/model";
import {
  FONDOS,
  claseDeFondo,
  type FondoDeChat,
} from "../../lib/chat-background";
import { elegirFondoDeChat, elegirFondoPropio, elegirVeloDeFondo, fondoDeChat, fondoPropio, quitarFondoPropio, veloDeFondo } from "../../lib/chat-background-store";
import type { Preview } from "../artifacts/Preview";
import {
  apariencia,
  chooseDarkStyle,
  chooseLightStyle,
  darkStyle,
  elegirApariencia,
  lightStyle,
  type Apariencia,
  type DarkStyle,
  type LightStyle,
} from "../../lib/theme";
import { cn } from "../../lib/utils";
import { Button } from "../../ui/Button";
import { prosaDe } from "../../ui/Failure";
import { AstroAvatar } from "../projects/AstroAvatar";
import { displayName, notifyProfiles } from "../projects/profiles";
import { SettingsPanel, SettingsRow, SettingsSection } from "./layout";
import { LogoDelWorkspace } from "./Workspaces";
import { createWorkspaces } from "./workspaces-store";

const IMAGES = ["png", "jpg", "jpeg", "webp"];
const VISIBILITY_ID = "settings-appearance-background-visibility";

const temas = (): { id: Apariencia; Icono: Component<{ size?: number }>; label: string }[] => [
  { id: "sistema", Icono: Monitor, label: t("settings.appearance.theme.system") },
  { id: "claro", Icono: Sun, label: t("settings.appearance.theme.light") },
  { id: "oscuro", Icono: Moon, label: t("settings.appearance.theme.dark") },
];

const darkStyles = (): { id: DarkStyle; label: string }[] => [
  { id: "graphite", label: t("settings.appearance.dark_style.graphite") },
  { id: "navy", label: t("settings.appearance.dark_style.navy") },
];

const lightStyles = (): { id: LightStyle; label: string }[] => [
  { id: "violet", label: t("settings.appearance.light_style.violet") },
  { id: "graphite", label: t("settings.appearance.light_style.graphite") },
];

const fondos = (): { id: FondoDeChat; label: string }[] =>
  FONDOS.map((id) => ({ id, label: t(`settings.appearance.background.${id}`) }));

type Fila = {
  id: string;
  name: string;
  project: string | null;
  profile: AgentProfile;
};

function proyectoDe(
  abierto: string,
  scope: AgenteDeMaquina["agent"]["own_scope"],
  folders: string[],
): string | null {
  if (scope?.kind === "project") return scope.id;
  return folders[0] || abierto || null;
}

/**
 * Tema, fondo de los chats y la cara propia de cada agente.
 *
 * El fondo de un agente sigue siendo el suyo: el de aquí solo pinta el chat
 * que no tiene uno. La imagen de la cara no entra al catálogo de cuerpos.
 */
export default function Appearance(props: { proyecto: string }) {
  const [tema, setTema] = createSignal<Apariencia>(apariencia());
  const [estilo, setEstilo] = createSignal<DarkStyle>(darkStyle());
  const [estiloClaro, setEstiloClaro] = createSignal<LightStyle>(lightStyle());
  const [fondo, setFondo] = createSignal<FondoDeChat>(fondoDeChat());
  const [propia, setPropia] = createSignal<string | null>(fondoPropio());
  const [velo, setVelo] = createSignal(veloDeFondo());
  const visibilidad = () => Math.round((1 - velo()) * 100);
  const espacios = createWorkspaces();
  const [filas, setFilas] = createSignal<Fila[]>([]);
  const [cargado, setCargado] = createSignal(false);
  const [fallo, setFallo] = createSignal<string | null>(null);
  const [backgroundFailure, setBackgroundFailure] = createSignal<string | null>(null);
  const [ocupada, setOcupada] = createSignal<string | null>(null);
  let lectura = 0;

  async function recargar() {
    const esta = ++lectura;
    try {
      const catalogo = await invoke<CatalogoDeAgentes>("list_machine_agents");
      if (esta !== lectura) return;
      setFilas(filasDe(catalogo));
      setFallo(null);
    } catch (error) {
      if (esta === lectura) setFallo(prosaDe(error));
    } finally {
      if (esta === lectura) setCargado(true);
    }
  }

  function filasDe(catalogo: CatalogoDeAgentes): Fila[] {
    const propias = catalogo.own.map((a) =>
      filaDe(
        a.agent.name,
        a.profile,
        proyectoDe(props.proyecto, a.agent.own_scope, a.folders),
        `own:${a.agent.name}`,
      ),
    );
    const delRepositorio = catalogo.repository.map((r) =>
      filaDe(r.agent.name, r.profile, r.folders[0] ?? null, `repo:${r.agent.origin}`),
    );
    return [...propias, ...delRepositorio].sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
  }

  onMount(() => {
    void recargar();
    const deFuera = () => void recargar();
    window.addEventListener("harness:profiles", deFuera);
    window.addEventListener("harness:encargados", deFuera);
    window.addEventListener("harness:workspace", deFuera);
    onCleanup(() => {
      lectura++;
      window.removeEventListener("harness:profiles", deFuera);
      window.removeEventListener("harness:encargados", deFuera);
      window.removeEventListener("harness:workspace", deFuera);
    });
  });

  async function ponerAvatar(fila: Fila, source: string | null) {
    if (!fila.project) {
      setFallo(t("settings.appearance.avatar.no_folder"));
      return;
    }
    setOcupada(fila.id);
    setFallo(null);
    try {
      await invoke<AgentProfile>("set_agent_avatar", {
        project: fila.project,
        name: fila.name,
        source,
      });
      notifyProfiles();
    } catch (error) {
      setFallo(prosaDe(error));
    } finally {
      setOcupada(null);
    }
  }

  async function elegirImagen(fila: Fila) {
    const chosen = await open({
      multiple: false,
      directory: false,
      filters: [{ name: t("settings.appearance.avatar.images"), extensions: IMAGES }],
    });
    if (typeof chosen !== "string") return;
    await ponerAvatar(fila, chosen);
  }

  /* La miniatura lee el archivo por el servicio: la ventana no pinta
     `file://` (`AGENTS.md` § el guarda `csp`). */
  const [vistaPropia] = createResource(propia, async (ruta) => {
    if (!ruta) return null;
    try {
      return (await invoke<Preview>("preview_file", { path: ruta, rel: ruta })).data_url;
    } catch {
      return null;
    }
  });

  async function elegirImagenPropia() {
    const chosen = await open({
      multiple: false,
      directory: false,
      filters: [{ name: t("settings.appearance.avatar.images"), extensions: IMAGES }],
    });
    if (typeof chosen !== "string") return;
    setBackgroundFailure(null);
    try {
      setFondo(await elegirFondoPropio(chosen));
      setPropia(fondoPropio());
    } catch (error) {
      setBackgroundFailure(prosaDe(error));
    }
  }

  function pulsarFondo(id: FondoDeChat) {
    if (id === "propia" && !propia()) {
      void elegirImagenPropia();
      return;
    }
    setFondo(elegirFondoDeChat(id));
  }

  return (
    <SettingsPanel>
      <SettingsSection title={t("settings.appearance.title")}>
        <Show when={espacios.actual()}>
          {(w) => <LogoDelWorkspace fila workspace={w()} onCambio={() => void espacios.cargar()} />}
        </Show>
        <SettingsRow label={t("settings.appearance.theme.title")}>
          <div
            role="radiogroup"
            aria-label={t("settings.appearance.theme.title")}
            class="inline-flex gap-0.5 rounded-lg border border-border bg-surface-muted p-0.5"
          >
            <For each={temas()}>
              {({ id, Icono, label }) => (
                <button
                  role="radio"
                  aria-checked={tema() === id}
                  aria-label={label}
                  title={label}
                  class={cn(
                    "flex h-7 w-8 items-center justify-center rounded-md border",
                    tema() === id
                      ? "border-border bg-surface text-neutral-950"
                      : "border-transparent text-neutral-500 hover:text-neutral-950",
                  )}
                  onClick={() => setTema(elegirApariencia(id))}
                >
                  <Icono size={16} />
                </button>
              )}
            </For>
          </div>
        </SettingsRow>

        <StylePicker
          theme="dark"
          title={t("settings.appearance.dark_style.title")}
          description={t("settings.appearance.dark_style.description")}
          options={darkStyles()}
          value={estilo()}
          onPick={(id) => setEstilo(chooseDarkStyle(id as DarkStyle))}
        />
        <StylePicker
          theme="light"
          title={t("settings.appearance.light_style.title")}
          description={t("settings.appearance.light_style.description")}
          options={lightStyles()}
          value={estiloClaro()}
          onPick={(id) => setEstiloClaro(chooseLightStyle(id as LightStyle))}
        />

        <SettingsRow
          label={t("settings.appearance.background.title")}
          description={t("settings.appearance.background.description")}
        >
          <Show when={propia()}>
            <Button size="sm" variant="ghost" onClick={() => void elegirImagenPropia()}>
              <ImagePlus size={14} />
              {t("settings.appearance.background.change")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setFondo(quitarFondoPropio());
                setPropia(null);
              }}
            >
              <Trash2 size={14} />
              {t("settings.appearance.background.clear")}
            </Button>
          </Show>
          <div class="flex gap-2" role="list">
            <For each={fondos()}>
              {({ id, label }) => (
                <div role="listitem">
                  <button
                    type="button"
                    aria-pressed={fondo() === id}
                    aria-label={label}
                    title={label}
                    class={cn(
                      "relative block h-11 w-[72px] overflow-hidden rounded-md bg-surface outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                      fondo() === id
                        ? "border-2 border-primary"
                        : id === "propia" && !propia()
                          ? "border border-dashed border-border-strong"
                          : "border border-border",
                    )}
                    onClick={() => pulsarFondo(id)}
                  >
                    <Show
                      when={id === "propia" ? vistaPropia() : undefined}
                      fallback={
                        <span
                          class={cn(
                            "absolute inset-0",
                            id === "propia"
                              ? "grid place-items-center bg-surface-muted text-neutral-500"
                              : claseDeFondo(id),
                          )}
                          aria-hidden="true"
                        >
                          <Show when={id === "propia"}>
                            <ImagePlus size={16} />
                          </Show>
                        </span>
                      }
                    >
                      {(url) => (
                        <span
                          class="absolute inset-0 bg-cover bg-center"
                          style={{ "background-image": `url("${url()}")` }}
                          aria-hidden="true"
                        />
                      )}
                    </Show>
                    <Show when={id !== "propia"}>
                      <span
                        class="absolute inset-0 bg-surface"
                        style={{ opacity: String(velo()) }}
                        aria-hidden="true"
                      />
                    </Show>
                  </button>
                </div>
              )}
            </For>
          </div>
        </SettingsRow>

        <SettingsRow
          label={
            <label for={VISIBILITY_ID}>
              {t("settings.appearance.background.visibility", { percent: visibilidad() })}
            </label>
          }
        >
          <input
            id={VISIBILITY_ID}
            type="range"
            min="0"
            max="100"
            step="5"
            class="w-40 accent-primary"
            value={visibilidad()}
            onInput={(e) => setVelo(elegirVeloDeFondo(1 - Number(e.currentTarget.value) / 100))}
          />
        </SettingsRow>
        <Show when={backgroundFailure()}>
          {(text) => <p role="alert" class="m-0 text-xs text-error-strong">{text()}</p>}
        </Show>
      </SettingsSection>

      <SettingsSection title={t("settings.appearance.avatar.title")}>
        <Show when={cargado() && filas().length === 0}>
          <p class="m-0 py-3.5 text-[0.8125rem] text-neutral-500">
            {t("settings.appearance.avatar.empty")}
          </p>
        </Show>
        <div role="list" class="grid min-w-0">
          <For each={filas()}>
            {(fila) => (
              <SettingsRow
                role="listitem"
                lead={
                  <AstroAvatar
                    name={fila.name}
                    body={fila.profile.body}
                    avatar={fila.profile.avatar}
                    status="awake"
                    size={32}
                  />
                }
                label={<span class="block truncate">{displayName(fila.name, fila.profile)}</span>}
              >
                <Show when={fila.profile.avatar}>
                  <Button
                    size="iconCompact"
                    variant="ghost"
                    disabled={ocupada() === fila.id}
                    aria-label={t("settings.appearance.avatar.clear")}
                    onClick={() => void ponerAvatar(fila, null)}
                  >
                    <X size={14} />
                  </Button>
                </Show>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={ocupada() === fila.id || !fila.project}
                  title={fila.project ? undefined : t("settings.appearance.avatar.no_folder")}
                  onClick={() => void elegirImagen(fila)}
                >
                  <ImagePlus size={14} />
                  {fila.profile.avatar
                    ? t("settings.appearance.avatar.change")
                    : t("settings.appearance.avatar.pick")}
                </Button>
              </SettingsRow>
            )}
          </For>
        </div>
        <Show when={fallo()}>{(text) => <p class="m-0 text-xs text-error-strong">{text()}</p>}</Show>
      </SettingsSection>
    </SettingsPanel>
  );
}

/** Las muestras de un estilo: cada una se pinta con su propio tema y estilo. */
function StylePicker(props: {
  theme: "light" | "dark";
  title: string;
  description: string;
  options: { id: string; label: string }[];
  value: string;
  onPick: (id: string) => void;
}) {
  return (
    <SettingsRow label={props.title} description={props.description}>
      <div role="radiogroup" aria-label={props.title} class="flex gap-2">
        <For each={props.options}>
          {({ id, label }) => (
            <button
              type="button"
              role="radio"
              aria-checked={props.value === id}
              aria-label={label}
              title={label}
              /* Sin ellos la muestra se pinta con el tema de `<html>`. */
              data-theme={props.theme}
              data-dark-style={props.theme === "dark" ? id : undefined}
              data-light-style={props.theme === "light" ? id : undefined}
              class={cn(
                "grid w-[104px] gap-1.5 overflow-hidden rounded-md bg-bg p-1.5 text-left outline-offset-2 outline-primary focus-visible:outline-2 focus-visible:outline-solid",
                props.value === id ? "border-2 border-primary" : "border border-border-strong",
              )}
              onClick={() => props.onPick(id)}
            >
              <span class="flex h-8 gap-1" aria-hidden="true">
                <span class="w-4 rounded-sm bg-rail" />
                <span class="flex flex-1 flex-col justify-end gap-1 rounded-sm bg-surface p-1">
                  <span class="h-1 w-3/4 rounded-full bg-neutral-500" />
                  <span class="flex items-center justify-between">
                    <span class="h-1 w-1/2 rounded-full bg-neutral-950" />
                    <span class="size-2 rounded-full bg-primary" />
                  </span>
                </span>
              </span>
              <span class="truncate px-0.5 text-[0.6875rem] text-neutral-950">{label}</span>
            </button>
          )}
        </For>
      </div>
    </SettingsRow>
  );
}

function filaDe(name: string, profile: AgentProfile, project: string | null, id: string): Fila {
  return { id, name, project, profile };
}
