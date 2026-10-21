import Folder from "lucide-solid/icons/folder";
import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { df } from "../../lib/format";
import { t } from "../../lib/i18n";
import { type Space, type SpaceRef, spaceName } from "../../lib/spaces";
import { invoke } from "../../lib/invoke.ts";
import type { Project } from "../../lib/model";
import { EmptyState } from "../../ui/EmptyState";
import { asFailure, FailureNote } from "../../ui/Failure";
import { Input } from "../../ui/Input";
import type { SessionRow } from "./Sessions";

type Archivadas = { tasks: (SessionRow & { folder: string })[]; spaces: SpaceRef[] };

const fecha = (when: number) => df({ dateStyle: "medium", timeStyle: "short" }).format(when);

/**
 * Las tareas archivadas del workspace entero, de todas las carpetas y todas
 * los espacios. Se lee al abrirla y no al arrancar: recorre cada carpeta.
 * Solo se leen: una archivada no se desarchiva, se retoma en una sesión nueva.
 */
export default function ArchivedTasks(props: {
  spaces: Space[];
  proyectos: Project[];
  onAbrir: (project: string, id: string) => void;
}) {
  const [datos, { refetch }] = createResource(() => invoke<Archivadas>("archived_tasks"));
  const [buscar, setBuscar] = createSignal("");
  onMount(() => {
    const alCambiar = () => void refetch();
    window.addEventListener("harness:tasks-changed", alCambiar);
    onCleanup(() => window.removeEventListener("harness:tasks-changed", alCambiar));
  });

  const viva = (id: string | null | undefined) => props.spaces.find((i) => i.id === id) ?? null;
  const referencia = (id: string | null | undefined) => datos()?.spaces.find((r) => r.id === id) ?? null;
  const carpeta = (id: string) => props.proyectos.find((p) => p.id === id)?.name ?? id;
  const nombreDe = (row: SessionRow) => {
    const suya = viva(row.space);
    if (suya) return spaceName(suya);
    const r = referencia(row.space);
    return r ? spaceName(r) : null;
  };
  const filas = createMemo(() => {
    const q = buscar().trim().toLowerCase();
    return (datos()?.tasks ?? [])
      .filter((r) => !q || [r.title, carpeta(r.folder), nombreDe(r) ?? ""].join(" ").toLowerCase().includes(q))
      .sort((a, b) => b.updated_at - a.updated_at);
  });

  return (
    <div class="min-h-0 flex-1 overflow-y-auto" data-archived-page="">
      <div class="mx-auto grid w-full max-w-[860px] gap-5 px-6 pt-4 pb-10">
        <header>
          <h1 class="m-0 font-display text-xl font-bold tracking-[-0.02em] text-neutral-950">{t("spaces.archived.title")}</h1>
          <p class="mt-1 text-sm text-neutral-500">
            {t("spaces.archived.subtitle", { count: filas().length })}
          </p>
        </header>
        <Input
          aria-label={t("spaces.archived.search")}
          placeholder={t("spaces.archived.search")}
          value={buscar()}
          onInput={(e) => setBuscar(e.currentTarget.value)}
        />
        <Show when={datos.error}>{(e) => <FailureNote f={asFailure(e())} />}</Show>
        <Show when={!datos.loading && filas().length === 0 && !datos.error}>
          <EmptyState title={buscar() ? t("spaces.archived.no_match") : t("spaces.archived.empty")} />
        </Show>
        <ul class="m-0 grid list-none p-0" aria-busy={datos.loading}>
          <For each={filas()}>
            {(row) => {
              const eliminada = () => !viva(row.space) && !!row.space;
              return (
                <li class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-border py-3" data-archived-row={row.id}>
                  <div class="grid min-w-0 gap-1">
                    <button
                      class="cursor-pointer truncate border-0 bg-transparent p-0 text-left text-sm font-semibold text-neutral-950 hover:underline focus-visible:outline-2 focus-visible:outline-primary"
                      title={row.title}
                      onClick={() => props.onAbrir(row.folder, row.id)}
                    >
                      {row.title}
                    </button>
                    <span class="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-neutral-500">
                      <Folder size={12} aria-hidden="true" />
                      <span class="truncate">{carpeta(row.folder)}</span>
                      <Show when={nombreDe(row)}>
                        {(n) => (
                          <>
                            <span aria-hidden="true">·</span>
                            <span class="font-medium text-neutral-700">{n()}</span>
                          </>
                        )}
                      </Show>
                      <Show when={eliminada()}>
                        <span
                          data-deleted-space=""
                          class="rounded-sm border border-dashed border-neutral-500 px-1 leading-4 text-neutral-700"
                        >
                          {t("spaces.archived.deleted")}
                        </span>
                      </Show>
                      <span aria-hidden="true">·</span>
                      <time>{fecha(row.updated_at)}</time>
                    </span>
                  </div>
                </li>
              );
            }}
          </For>
        </ul>
      </div>
    </div>
  );
}
