import { Match, Show, Switch, createSignal, onMount } from "solid-js";
import { Channel } from "@tauri-apps/api/core";
import { invoke } from "../../../lib/invoke.ts";
import { open } from "@tauri-apps/plugin-dialog";
import FolderOpen from "lucide-solid/icons/folder-open";
import { t } from "../../../lib/i18n";
import type { Space } from "../../../lib/spaces";
import type { Project } from "../../../lib/model";
import { Button } from "../../../ui/Button";
import { Input } from "../../../ui/Input";
import { faseDeClon } from "../../projects/AddWorkdir";
import RepositoryPicker from "../../projects/RepositoryPicker";
import { Pantalla } from "../Screen";
import { URL_DE_REPO, type Alta } from "../onboarding-store";

type Avance = { phase: string; percent: number | null };

/** Un workspace nace con un espacio: su primera carpeta queda fijada en él. */
async function fijarEnLaPrimera(folder: string) {
  try {
    const [primera] = await invoke<Space[]>("list_spaces");
    if (primera && !primera.folders.includes(folder)) {
      await invoke("set_space_folders", { id: primera.id, folders: [...primera.folders, folder] });
    }
  } catch {
    // Sin fijar sigue alcanzable desde «Carpetas…» y aparece con su primera tarea.
  }
}

/**
 * Paso 7: la primera carpeta de trabajo. Se elige como en «Añadir un proyecto»
 * —repositorio de GitHub o Bitbucket, dirección de git, carpeta existente o
 * vacía— y al terminar se entra a la app.
 */
export default function CarpetaDeTrabajo(props: { alta: Alta; onListo: () => void }) {
  const [trabajando, setTrabajando] = createSignal(false);
  const [error, setError] = createSignal<unknown>(null);
  const [directorio, setDirectorio] = createSignal<string | null>(null);
  const [avance, setAvance] = createSignal<Avance | null>(null);
  const w = () => props.alta.estado.carpeta;

  onMount(() => {
    invoke<string>("get_project_directory")
      .then(setDirectorio)
      .catch(() => {});
  });

  const listo = () => {
    if (w().modo === "new") return Boolean(w().nombre.trim());
    if (w().modo === "existing") return Boolean(w().ruta);
    return w().modo === "clone" && URL_DE_REPO.test(w().url.trim());
  };

  async function elegirCarpeta() {
    const r = await open({ directory: true, multiple: false });
    if (typeof r === "string") props.alta.set("carpeta", { modo: "existing", ruta: r });
  }

  /** La ubicación es la del workspace: lo que se elige aquí es lo que sugerirá después. */
  async function cambiarUbicacion() {
    setError(null);
    try {
      const r = await open({ directory: true, multiple: false, defaultPath: directorio() ?? undefined });
      if (typeof r !== "string") return;
      setDirectorio(await invoke<string>("set_project_directory", { directory: r }));
    } catch (e) {
      setError(e);
    }
  }

  function otraEleccion() {
    props.alta.set("carpeta", { modo: null, ruta: "", url: "", proveedor: null, repositorio: "" });
  }

  async function terminar() {
    if (!listo() || trabajando()) return;
    if (w().proyecto) {
      props.onListo();
      return;
    }
    setTrabajando(true);
    setError(null);
    try {
      // Sin nombre, Rust usa el de la carpeta o el final de la dirección del repositorio.
      const nombre = w().nombre.trim();
      const p =
        w().modo === "clone"
          ? await invoke<Project>("clone_project", {
              url: w().url.trim(),
              name: nombre,
              directory: null,
              operation: crypto.randomUUID(),
              workspace: props.alta.estado.workspace?.id ?? "",
              provider: w().proveedor,
              progress: new Channel<Avance>((v) => setAvance(v)),
            })
          : await invoke<Project>("create_project", {
              name: nombre,
              workingDirectory: w().modo === "existing" ? w().ruta : undefined,
            });
      await fijarEnLaPrimera(p.id);
      props.alta.set("carpeta", "proyecto", p.id);
      props.onListo();
    } catch (e) {
      setError(e);
    } finally {
      setTrabajando(false);
      setAvance(null);
    }
  }

  const rotulo = () => {
    if (!trabajando()) return t("onboarding.done");
    return w().modo === "clone" ? t("onboarding.workdir.cloning") : t("onboarding.workdir.creating");
  };

  return (
    <Pantalla
      titulo={t("onboarding.workdir.title")}
      lede={t("onboarding.workdir.lede")}
      pie={t("onboarding.workdir.footer")}
      atras={() => props.alta.set("paso", "context")}
      primario={{ rotulo: rotulo(), onClick: () => void terminar(), disabled: !listo() || trabajando() }}
      error={error()}
    >
      <Show
        when={w().modo !== null}
        fallback={
          <Show when={props.alta.estado.workspace?.id} keyed>
            {(workspace) => (
              <RepositoryPicker
                workspace={workspace}
                disabled={trabajando()}
                onUrl={() => props.alta.set("carpeta", { modo: "clone", url: "", proveedor: null, repositorio: "" })}
                onFolder={() => void elegirCarpeta()}
                onEmpty={() => props.alta.set("carpeta", "modo", "new")}
                onRepository={(repo) =>
                  props.alta.set("carpeta", {
                    modo: "clone",
                    url: repo.url,
                    proveedor: repo.provider,
                    repositorio: repo.name,
                  })
                }
              />
            )}
          </Show>
        }
      >
        <div class="grid gap-5">
          <Show when={w().modo === "clone" && w().repositorio}>
            <p class="m-0 text-sm font-medium">{w().repositorio}</p>
          </Show>
          <label class="grid gap-1.5">
            <span class="text-[0.8125rem] font-semibold">{t("onboarding.workdir.name")}</span>
            <Input value={w().nombre} onInput={(ev) => props.alta.set("carpeta", "nombre", ev.currentTarget.value)} />
          </label>
          <Switch>
            <Match when={w().modo === "existing"}>
              <div class="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface-raised px-4 py-3">
                <FolderOpen size={16} class="shrink-0 text-neutral-500" aria-hidden="true" />
                <span class="min-w-0 flex-1 truncate text-sm text-neutral-950">
                  {w().ruta || t("onboarding.context.no_folder")}
                </span>
                <Button size="sm" variant="secondary" onClick={() => void elegirCarpeta()}>
                  {t("onboarding.context.pick_folder")}
                </Button>
              </div>
            </Match>
            <Match when={w().modo === "clone"}>
              <label class="grid gap-1.5">
                <span class="text-[0.8125rem] font-semibold">{t("onboarding.context.url")}</span>
                <Input
                  value={w().url}
                  placeholder={t("onboarding.context.url_placeholder")}
                  onInput={(ev) =>
                    props.alta.set("carpeta", { url: ev.currentTarget.value, proveedor: null, repositorio: "" })
                  }
                />
                <small class="text-xs text-neutral-500">{t("onboarding.workdir.url_hint")}</small>
              </label>
            </Match>
          </Switch>
          <Show when={w().modo !== "existing"}>
            <div class="grid gap-1.5">
              <span class="text-[0.8125rem] font-semibold">{t("onboarding.workdir.location")}</span>
              <div class="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface-raised px-4 py-3">
                <FolderOpen size={16} class="shrink-0 text-neutral-500" aria-hidden="true" />
                <span class="min-w-0 flex-1 truncate font-mono text-xs text-neutral-950">{directorio() ?? ""}</span>
                <Button size="sm" variant="secondary" disabled={trabajando()} onClick={() => void cambiarUbicacion()}>
                  {t("onboarding.workdir.change_location")}
                </Button>
              </div>
            </div>
          </Show>
          <p class="m-0 rounded-md border border-border bg-surface-muted px-4 py-3 text-sm text-neutral-500">
            <Switch>
              <Match when={w().modo === "existing"}>{t("onboarding.workdir.summary_existing")}</Match>
              <Match when={w().modo === "clone"}>
                {t("onboarding.workdir.summary_clone", { path: directorio() ?? "" })}
              </Match>
              <Match when={true}>{t("onboarding.workdir.summary_new", { path: directorio() ?? "" })}</Match>
            </Switch>
          </p>
          <Show when={avance()}>
            {(a) => (
              <p class="m-0 text-xs text-neutral-500" role="status">
                {faseDeClon(a().phase)}
                {a().percent !== null ? ` · ${a().percent} %` : ""}
              </p>
            )}
          </Show>
          <Button size="sm" variant="ghost" class="justify-self-start" disabled={trabajando()} onClick={otraEleccion}>
            {t("onboarding.pick_another")}
          </Button>
        </div>
      </Show>
    </Pantalla>
  );
}
