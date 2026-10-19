import { For, Match, Show, Switch, createSignal } from "solid-js";
import { invoke } from "../../../lib/invoke.ts";
import { open } from "@tauri-apps/plugin-dialog";
import FolderOpen from "lucide-solid/icons/folder-open";
import { t } from "../../../lib/i18n";
import { Button } from "../../../ui/Button";
import { Input } from "../../../ui/Input";
import RepositoryPicker from "../../projects/RepositoryPicker";
import { Pantalla } from "../Screen";
import { URL_DE_REPO, type Alta } from "../onboarding-store";

/**
 * Paso 6: la fuente principal del workspace. Una carpeta existente o un
 * repositorio —escrito o elegido de GitHub o Bitbucket—; sin carpeta nueva, y
 * se puede dejar para después.
 */
export default function Contexto(props: { alta: Alta }) {
  const [trabajando, setTrabajando] = createSignal(false);
  const [error, setError] = createSignal<unknown>(null);
  const c = () => props.alta.estado.contexto;
  const destino = () => (c().modo === "folder" ? c().ruta : c().url.trim());
  const listo = () => {
    if (c().modo === "folder") return Boolean(c().ruta);
    return c().modo === "clone" && URL_DE_REPO.test(c().url.trim());
  };
  const ejemplos = () => [
    t("onboarding.context.example.vision"),
    t("onboarding.context.example.mission"),
    t("onboarding.context.example.values"),
    t("onboarding.context.example.rules"),
    t("onboarding.context.example.policies"),
    t("onboarding.context.example.website"),
  ];

  async function elegirCarpeta() {
    const r = await open({ directory: true, multiple: false });
    if (typeof r === "string") props.alta.set("contexto", { modo: "folder", ruta: r });
  }

  async function usar() {
    if (!listo() || trabajando()) return;
    if (c().fuente && c().usado === destino()) {
      props.alta.set("paso", "workdir");
      return;
    }
    setTrabajando(true);
    setError(null);
    try {
      let id: string;
      if (c().modo === "folder") {
        id = (await invoke<{ id: string }>("set_workspace_source", { kind: "folder", locator: destino() })).id;
      } else {
        // Con GitHub o Bitbucket conectado se clona con su token; sin conexión, como público.
        id = (await invoke<{ id: string }>("add_repo_url", { cloneUrl: destino(), branch: null })).id;
        await invoke("set_root", { source: id });
      }
      props.alta.set("contexto", { fuente: id, usado: destino() });
      window.dispatchEvent(new CustomEvent("harness:sources"));
      props.alta.set("paso", "workdir");
    } catch (e) {
      setError(e);
    } finally {
      setTrabajando(false);
    }
  }

  return (
    <Pantalla
      titulo={t("onboarding.context.title")}
      lede={t("onboarding.context.lede")}
      pie={t("onboarding.context.footer")}
      atras={() => props.alta.set("paso", "sources")}
      primario={{
        rotulo: trabajando()
          ? t("onboarding.context.working")
          : listo()
            ? t("onboarding.context.use")
            : t("onboarding.context.later"),
        onClick: () => (listo() ? void usar() : props.alta.set("paso", "workdir")),
        disabled: trabajando(),
      }}
      error={error()}
    >
      <div class="mb-6 flex flex-wrap gap-2">
        <For each={ejemplos()}>
          {(x) => <span class="rounded-sm border border-border px-2 py-0.5 text-xs text-neutral-500">{x}</span>}
        </For>
      </div>
      <Switch>
        <Match when={c().modo === null}>
          <Show when={props.alta.estado.workspace?.id} keyed>
            {(workspace) => (
              <RepositoryPicker
                workspace={workspace}
                disabled={trabajando()}
                onUrl={() => props.alta.set("contexto", { modo: "clone", url: "" })}
                onFolder={() => void elegirCarpeta()}
                onRepository={(repo) => props.alta.set("contexto", { modo: "clone", url: repo.url })}
              />
            )}
          </Show>
        </Match>
        <Match when={c().modo === "folder"}>
          <div class="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface-raised px-4 py-3">
            <FolderOpen size={16} class="shrink-0 text-neutral-500" aria-hidden="true" />
            <span class="min-w-0 flex-1 truncate text-sm text-neutral-950">
              {c().ruta || t("onboarding.context.no_folder")}
            </span>
            <Button size="sm" variant="secondary" onClick={() => void elegirCarpeta()}>
              {t("onboarding.context.pick_folder")}
            </Button>
          </div>
        </Match>
        <Match when={c().modo === "clone"}>
          <label class="grid gap-1.5">
            <span class="text-[0.8125rem] font-semibold">{t("onboarding.context.url")}</span>
            <Input
              value={c().url}
              placeholder={t("onboarding.context.url_placeholder")}
              onInput={(ev) => props.alta.set("contexto", "url", ev.currentTarget.value)}
            />
            <small class="text-xs text-neutral-500">{t("onboarding.context.url_hint")}</small>
          </label>
        </Match>
      </Switch>
      <Show when={c().modo !== null}>
        <Button
          size="sm"
          variant="ghost"
          class="mt-2"
          disabled={trabajando()}
          onClick={() => props.alta.set("contexto", { modo: null, ruta: "", url: "" })}
        >
          {t("onboarding.pick_another")}
        </Button>
      </Show>
      <div class="mt-6 grid gap-2 rounded-md border border-border bg-surface-muted px-4 py-3 text-sm text-neutral-500">
        <p class="m-0 font-medium text-neutral-950">{t("onboarding.context.read_only")}</p>
        <p class="m-0">{t("onboarding.context.notice")}</p>
      </div>
    </Pantalla>
  );
}
