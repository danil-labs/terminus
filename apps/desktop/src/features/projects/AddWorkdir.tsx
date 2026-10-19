import { Channel } from "@tauri-apps/api/core";
import { invoke } from "../../lib/invoke.ts";
import { open } from "@tauri-apps/plugin-dialog";
import { Show, createEffect, createSignal, on } from "solid-js";
import RepositoryPicker from "./RepositoryPicker";
import { type ProjectRepository } from "../../lib/projectRepositories";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogTitle } from "../../ui/Dialog";
import { FailureNote, asFailure, type Failure } from "../../ui/Failure";
import { Input } from "../../ui/Input";
import { ProgressBar } from "../../ui/ProgressBar";
import { enfocar } from "../../lib/focus";
import { t } from "../../lib/i18n";
import type { Project } from "../../lib/model";

/**
 * El clon que corre ahora mismo, tal y como lo pinta el riel.
 *
 * Hasta que `git clone` termina no hay proyecto que listar: el backend escribe
 * `project.json` con el árbol ya en disco. Esto es lo único que el riel puede
 * enseñar mientras tanto.
 */
export type ClonEnCurso = {
  /** El id con el que se cancela. `null` es un clon que ya falló. */
  operation: string | null;
  /** Cómo se va a llamar la carpeta: lo escrito, o el final de la dirección. */
  name: string;
  /** La fase que reporta git, sin traducir. Ver [`faseDeClon`]. */
  phase: string | null;
  percent: number | null;
  failed: boolean;
};

/** Cómo se lee la fase que git reporta. La comparten el diálogo y el riel. */
export function faseDeClon(phase: string | null | undefined) {
  switch (phase) {
    case "counting":
      return t("projects.add.counting");
    case "compressing":
      return t("projects.add.compressing");
    case "receiving":
      return t("projects.add.receiving");
    case "resolving":
      return t("projects.add.resolving");
    case "checkout":
      return t("projects.add.checkout");
    default:
      return t("projects.add.waiting");
  }
}

/**
 * Añadir una carpeta de trabajo: la que ya está en el disco, una clonada de un
 * repositorio, o una vacía.
 *
 * Los tres caminos existían y solo se ofrecía uno: el diálogo proponía una ruta
 * bajo Documentos y un botón de elegir. Quien trae un repositorio tenía que
 * clonarlo fuera y volver.
 */
export default function AnadirCarpeta(props: {
  abierto: boolean;
  workspace: string | null;
  /** El escritorio activo: la carpeta nueva queda fijada en él. */
  space?: string | null;
  onCerrar: () => void;
  /** Recarga la lista. Rechaza si el backend no aceptó, con su motivo. */
  onHecho: (p: Project, activate: boolean) => Promise<void> | void;
  /** Lo que el riel enseña del clon. `null` es que no hay ninguno. */
  onClon: (clon: ClonEnCurso | null) => void;
}) {
  const [camino, setCamino] = createSignal<"clonar" | "vacia" | null>(null);
  const [directorio, setDirectorio] = createSignal<string | null>(null);
  const [destino, setDestino] = createSignal<string | null>(null);
  const [eligiendo, setEligiendo] = createSignal(false);
  const [url, setUrl] = createSignal("");
  const [provider, setProvider] = createSignal<string | null>(null);
  const [repositoryName, setRepositoryName] = createSignal("");
  const [nombre, setNombre] = createSignal("");
  const [fallo, setFallo] = createSignal<Failure | null>(null);
  const [trabajando, setTrabajando] = createSignal(false);
  const [operation, setOperation] = createSignal<string | null>(null);
  const [progress, setProgress] = createSignal<{ phase: string; percent: number | null } | null>(null);
  const [cancelling, setCancelling] = createSignal(false);
  // Un fallo del formulario —la dirección vacía— no es un clon fallido. Sin
  // esto el riel pintaría una fila por cada intento que no llegó a git.
  const [intentado, setIntentado] = createSignal(false);
  const phase = () => faseDeClon(progress()?.phase);
  const etiqueta = () =>
    nombre().trim() ||
    url()
      .trim()
      .replace(/\/+$/, "")
      .split("/")
      .pop()
      ?.replace(/\.git$/, "") ||
    "";

  createEffect(() => {
    const op = operation();
    const fallado = intentado() && fallo() !== null;
    props.onClon(
      op || fallado
        ? {
            operation: op,
            name: etiqueta(),
            phase: progress()?.phase ?? null,
            percent: progress()?.percent ?? null,
            failed: !op && fallado,
          }
        : null,
    );
  });

  createEffect(on(() => props.workspace, () => {
    if (!operation()) { limpiar(); setTrabajando(false); }
  }));

  async function clone() {
    if (trabajando() || !props.workspace) return;
    const id = crypto.randomUUID();
    setOperation(id);
    setProgress(null);
    setCancelling(false);
    setIntentado(true);
    await terminar(invoke<Project>("clone_project", {
      url: url(), name: nombre(), directory: destino(), operation: id,
      workspace: props.workspace, provider: provider(), space: props.space ?? undefined,
      progress: new Channel<{ phase: string; percent: number | null }>(value => {
        if (operation() === id) setProgress(value);
      }),
    }));
    setOperation(null);
  }

  async function cancelClone() {
    const id = operation();
    if (!id || cancelling()) return;
    setCancelling(true);
    try {
      await invoke("cancel_project_clone", { operation: id });
    } catch (error) {
      setFallo(asFailure(error));
      setCancelling(false);
    }
  }

  function limpiar() {
    setCamino(null);
    setDirectorio(null);
    setDestino(null);
    setUrl("");
    setProvider(null);
    setRepositoryName("");
    setNombre("");
    setFallo(null);
    setIntentado(false);
    setProgress(null);
  }

  function alCambiar(abierto: boolean) {
    if (abierto || eligiendo()) return;
    // Escondido, no cancelado: el clon sigue, la fila del riel lo dice y lo
    // escrito queda intacto para cuando se vuelva a abrir desde ahí.
    if (operation()) {
      props.onCerrar();
      return;
    }
    if (trabajando()) return;
    limpiar();
    props.onCerrar();
  }

  async function terminar(hecho: Promise<Project>) {
    const workspace = props.workspace;
    setTrabajando(true);
    setFallo(null);
    try {
      const p = await hecho;
      if (workspace === props.workspace) await props.onHecho(p, props.abierto);
      limpiar();
      props.onCerrar();
    } catch (e) {
      setFallo(asFailure(e));
    } finally {
      setTrabajando(false);
    }
  }

  async function explorar() {
    const workspace = props.workspace;
    const dir = await open({
      directory: true,
      multiple: false,
      title: t("projects.add.browse"),
    });
    if (typeof dir !== "string" || workspace !== props.workspace) return;
    // Sin nombre, Rust usa el de la carpeta y lo recorta al tope (`projects::crear`).
    await terminar(
      invoke<Project>("create_project", { name: "", workingDirectory: dir, space: props.space ?? undefined }),
    );
  }

  async function elegirCamino(value: "clonar" | "vacia") {
    const workspace = props.workspace;
    setTrabajando(true);
    setFallo(null);
    try {
      const directory = await invoke<string>("get_project_directory");
      if (workspace !== props.workspace) return;
      setDirectorio(directory);
      setCamino(value);
    } catch (e) {
      if (workspace === props.workspace) setFallo(asFailure(e));
    } finally {
      if (workspace === props.workspace) setTrabajando(false);
    }
  }

  async function elegirDestino() {
    setEligiendo(true);
    setFallo(null);
    try {
      const dir = await open({
        directory: true,
        multiple: false,
        defaultPath: destino() ?? directorio() ?? undefined,
        title: t("projects.add.clone_directory"),
      });
      if (typeof dir === "string") setDestino(dir);
    } catch (e) {
      setFallo(asFailure(e));
    } finally {
      setEligiendo(false);
    }
  }

  async function chooseRepository(repo: ProjectRepository) {
    // Ya está clonado para un proyecto de este workspace: se abre ese, no un
    // segundo clon al lado.
    if (repo.project && props.workspace) {
      await terminar(invoke<Project>("reuse_project", {
        workspace: props.workspace, project: repo.project, space: props.space ?? undefined,
      }));
      return;
    }
    setUrl(repo.url);
    setProvider(repo.provider);
    setRepositoryName(repo.name);
    await elegirCamino("clonar");
  }

  return (
    <Dialog open={props.abierto} onOpenChange={alCambiar}>
      <DialogContent class="max-w-[560px]">
        <DialogTitle class="m-0 text-[0.9375rem] font-semibold">
          {t("projects.add.title")}
        </DialogTitle>

        <div class="grid gap-2 pt-3">
          <Show when={camino() === null}>
            <Show when={props.abierto ? props.workspace : null} keyed>{workspace =>
              <RepositoryPicker workspace={workspace} disabled={trabajando()}
                onUrl={() => { setProvider(null); setRepositoryName(""); void elegirCamino("clonar"); }}
                onFolder={() => void explorar()} onEmpty={() => void elegirCamino("vacia")}
                onRepository={repo => void chooseRepository(repo)} />
            }</Show>
          </Show>

          <Show when={camino() === "clonar"}>
            <form
              class="grid gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void clone();
              }}
            >
              <Show when={repositoryName()}><p class="m-0 text-[0.8125rem] font-medium">{repositoryName()}</p></Show>
              <label class="grid gap-1 text-[0.8125rem]">
                <span class="text-neutral-500">
                  {t("projects.add.clone_url")}
                </span>
                <Input
                  ref={enfocar}
                  class="font-mono text-xs"
                  placeholder="https://github.com/organizacion/repo"
                  value={url()}
                  disabled={trabajando()}
                  onInput={(e) => { setUrl(e.currentTarget.value); setProvider(null); setRepositoryName(""); }}
                />
              </label>
              <div class="grid gap-1">
                <span class="text-[0.8125rem] text-neutral-500">{t("projects.add.clone_directory")}</span>
                <p class="m-0 break-all font-mono text-xs">{destino() ?? directorio()}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  class="justify-self-start"
                  disabled={trabajando() || eligiendo()}
                  onClick={() => void elegirDestino()}
                >
                  {t("projects.add.change_directory")}
                </Button>
              </div>
              <Show when={fallo()}>{(f) => <FailureNote f={f()} />}</Show>
              <Show when={operation()}>
                <div class="grid gap-2">
                  <p class="text-xs text-neutral-500" role="status">{phase()}</p>
                  <Show when={progress()?.percent != null}>
                    <ProgressBar value={progress()?.percent ?? 0} max={100} label={phase()} />
                    <span class="text-xs text-neutral-500">{t("projects.add.percent", { percent: progress()?.percent ?? 0 })}</span>
                  </Show>
                  <div class="flex justify-end gap-2">
                    <Button type="button" variant="ghost" size="sm" onClick={() => alCambiar(false)}>{t("projects.add.hide")}</Button>
                    <Button type="button" variant="outline" size="sm" disabled={!progress() || cancelling()} onClick={() => void cancelClone()}>
                      {cancelling() ? t("projects.add.cancelling") : t("projects.new.cancel")}
                    </Button>
                  </div>
                </div>
              </Show>
              <div class="flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={trabajando()}
                  onClick={limpiar}
                >
                  {t("projects.add.back")}
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={!url().trim() || trabajando() || eligiendo()}
                >
                  {trabajando()
                    ? t("projects.add.cloning")
                    : t("projects.add.clone_do")}
                </Button>
              </div>
            </form>
          </Show>

          <Show when={camino() === "vacia"}>
            <form
              class="grid gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void terminar(
                  invoke<Project>("create_project", { name: nombre(), space: props.space ?? undefined }),
                );
              }}
            >
              <label class="grid gap-1 text-[0.8125rem]">
                <span class="text-neutral-500">
                  {t("projects.add.empty_name")}
                </span>
                <Input
                  ref={enfocar}
                  placeholder={t("projects.new.placeholder")}
                  value={nombre()}
                  disabled={trabajando()}
                  onInput={(e) => setNombre(e.currentTarget.value)}
                />
              </label>
              <Show when={fallo()}>{(f) => <FailureNote f={f()} />}</Show>
              <div class="flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={trabajando()}
                  onClick={limpiar}
                >
                  {t("projects.add.back")}
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={!nombre().trim() || trabajando()}
                >
                  {t("projects.add.create")}
                </Button>
              </div>
            </form>
          </Show>

          <Show when={camino() === null && fallo()}>
            {(f) => <FailureNote f={f()} />}
          </Show>
        </div>
      </DialogContent>
    </Dialog>
  );
}
