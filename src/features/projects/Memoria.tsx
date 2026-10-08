import { For, Show, createEffect, createSignal } from "solid-js";
import { invoke } from "../../lib/invoke.ts";
import { confirm } from "@tauri-apps/plugin-dialog";
import Pencil from "lucide-solid/icons/pencil";
import Plus from "lucide-solid/icons/plus";
import Trash2 from "lucide-solid/icons/trash-2";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogTitle } from "../../ui/Dialog";
import { asFailure, FailureNote, type Failure } from "../../ui/Failure";
import { Input } from "../../ui/Input";
import { Textarea } from "../../ui/Textarea";
import { enfocar } from "../../lib/focus";
import { manifiesto, t } from "../../lib/i18n";
import type { Agent, MemoriaEntrada, MemoriaIndice, MemoriaListado, MemoriaScope } from "../../lib/model";
import { EmptyState } from "../../ui/EmptyState";

function scopeIgual(a: MemoriaScope, b: MemoriaScope): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind === "agent" && b.kind === "agent" ? a.name === b.name : true;
}

const fecha = (iso: string) =>
  new Intl.DateTimeFormat(manifiesto().formato, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));

/**
 * El mismo formulario para escribir y para editar. `file` es la identidad:
 * al editar se manda fija, y escribir con el mismo nombre reescribe el
 * cuerpo en el sitio en vez de dejar una segunda versión. No existe para
 * `workspace`: ese alcance sigue en el formato anterior y lo rechaza.
 */
function FormularioDeEntrada(props: {
  abierto: boolean;
  proyecto: string;
  scope: MemoriaScope;
  entrada: MemoriaEntrada | null;
  onCerrar: () => void;
  onGuardado: () => void;
}) {
  const [file, setFile] = createSignal("");
  const [tipo, setTipo] = createSignal("");
  const [texto, setTexto] = createSignal("");
  const [guardando, setGuardando] = createSignal(false);
  const [fallo, setFallo] = createSignal<Failure | null>(null);
  const [archivoInvalido, setArchivoInvalido] = createSignal(false);
  let archivoRef: HTMLInputElement | undefined;

  // Cada apertura parte de la entrada que se edita, o en blanco: sin esto,
  // abrir "editar" en otra fila arrastraría el texto de la anterior.
  createEffect(() => {
    if (!props.abierto) return;
    const e = props.entrada;
    setFile(e?.file ?? "");
    setTipo(e?.type ?? "");
    setTexto(e?.text ?? "");
    setFallo(null);
    setArchivoInvalido(false);
  });

  const editando = () => props.entrada !== null;
  // El archivo no entra aquí: un archivo vacío no deja el botón mudo, lo
  // avisa `guardar` — antes no pasaba nada y no se decía nada.
  const listo = () => Boolean(texto().trim()) && !guardando();

  async function guardar() {
    if (!listo()) return;
    const nombre = file().trim();
    if (!nombre) {
      setArchivoInvalido(true);
      setFallo({ what: t("projects.memory.error_file_required"), detail: "" });
      archivoRef?.focus();
      return;
    }
    setArchivoInvalido(false);
    setGuardando(true);
    setFallo(null);
    try {
      await invoke("write_memory_entry", {
        project: props.proyecto,
        scope: props.scope,
        file: nombre,
        type: tipo().trim() || null,
        text: texto().trim(),
      });
      props.onGuardado();
      props.onCerrar();
    } catch (e) {
      setFallo({ ...asFailure(e), what: t("projects.memory.error_save") });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Dialog open={props.abierto} onOpenChange={(a) => !a && !guardando() && props.onCerrar()}>
      <DialogContent>
        <DialogTitle class="m-0 text-[0.9375rem] font-semibold">
          {editando() ? t("projects.memory.edit_title") : t("projects.memory.new_title")}
        </DialogTitle>
        <form
          class="grid gap-3 pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            void guardar();
          }}
        >
          <label class="grid gap-1 text-[0.8125rem]">
            <span class="text-neutral-500">
              {t("projects.memory.form_file")}{" "}
              <span classList={{ "text-error-strong": archivoInvalido() }}>
                ({t("projects.memory.form_file_required")})
              </span>
            </span>
            <Input
              ref={(el) => {
                archivoRef = el;
                enfocar(el);
              }}
              value={file()}
              disabled={guardando() || editando()}
              aria-required="true"
              aria-invalid={archivoInvalido()}
              class={archivoInvalido() ? "border-error-strong" : undefined}
              placeholder={t("projects.memory.form_file_placeholder")}
              onInput={(e) => {
                setFile(e.currentTarget.value);
                setArchivoInvalido(false);
              }}
            />
          </label>
          <label class="grid gap-1 text-[0.8125rem]">
            <span class="text-neutral-500">{t("projects.memory.form_type")}</span>
            <Input
              value={tipo()}
              disabled={guardando()}
              placeholder={t("projects.memory.form_type_placeholder")}
              onInput={(e) => setTipo(e.currentTarget.value)}
            />
          </label>
          <label class="grid gap-1 text-[0.8125rem]">
            <span class="text-neutral-500">{t("projects.memory.form_text")}</span>
            <Textarea
              placeholder={t("projects.memory.form_text_placeholder")}
              value={texto()}
              disabled={guardando()}
              onInput={(e) => setTexto(e.currentTarget.value)}
            />
          </label>

          <Show when={fallo()}>{(f) => <FailureNote f={f()} />}</Show>

          <div class="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" disabled={guardando()} onClick={props.onCerrar}>
              {t("projects.memory.cancel")}
            </Button>
            <Button type="submit" size="sm" disabled={!listo()}>
              {guardando() ? t("projects.memory.saving") : t("projects.memory.save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * La memoria del proyecto. Espeja `workspace/memoria/comandos.rs`. `workspace`
 * sigue en el formato anterior: se lee, se retira y se borra, pero no se
 * escribe ni se edita desde aquí — `write_memory_entry` lo rechaza. Retirar
 * solo existe ahí; `project` y `agent` reescriben o borran el archivo.
 */
export default function Memoria(props: { project: string; agents: Agent[]; encargados?: string[] }) {
  const [scope, setScope] = createSignal<MemoriaScope>({ kind: "project" });
  const [entradas, setEntradas] = createSignal<MemoriaEntrada[]>([]);
  const [indice, setIndice] = createSignal<MemoriaIndice | null>(null);
  const [fallo, setFallo] = createSignal<Failure | null>(null);
  const [ocupada, setOcupada] = createSignal<string | null>(null);
  const [formulario, setFormulario] = createSignal<"nueva" | MemoriaEntrada | null>(null);

  const encargados = () => props.encargados ?? [];
  const esWorkspace = () => scope().kind === "workspace";

  async function refrescar() {
    setFallo(null);
    try {
      const listado = await invoke<MemoriaListado>("list_memory_entries", {
        project: props.project,
        scope: scope(),
      });
      setEntradas(listado.entries);
      setIndice(listado.index);
    } catch (e) {
      setFallo({ ...asFailure(e), what: t("projects.memory.error_list") });
    }
  }

  // Se relee al cambiar de proyecto o de alcance: es la lista de ese par,
  // no de la pantalla, y arrastrar la del anterior mostraría memoria ajena.
  createEffect(() => {
    props.project;
    scope();
    void refrescar();
  });

  const editando = () => {
    const f = formulario();
    return f === "nueva" ? null : f;
  };

  function nombreDeAgente(id: string) {
    return props.agents.find((a) => a.id === id)?.label ?? id;
  }

  function quien(e: MemoriaEntrada) {
    return e.origin.agent ? nombreDeAgente(e.origin.agent) : t("projects.memory.person");
  }

  async function retirar(file: string) {
    setOcupada(file);
    setFallo(null);
    try {
      await invoke("retire_memory_entry", { project: props.project, scope: scope(), file });
      await refrescar();
    } catch (e) {
      setFallo({ ...asFailure(e), what: t("projects.memory.error_retire") });
    } finally {
      setOcupada(null);
    }
  }

  // El único borrado físico del módulo: pide confirmación antes de mandarlo.
  async function borrar(file: string) {
    if (!(await confirm(t("projects.memory.delete_confirm"), { kind: "warning" }))) return;
    setOcupada(file);
    setFallo(null);
    try {
      await invoke("delete_memory_entry", { project: props.project, scope: scope(), file });
      await refrescar();
    } catch (e) {
      setFallo({ ...asFailure(e), what: t("projects.memory.error_delete") });
    } finally {
      setOcupada(null);
    }
  }

  return (
    <section class="grid gap-2">
      <div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <h2 class="m-0 text-[0.6875rem] font-medium tracking-wide text-neutral-500 uppercase">
          {t("projects.memory.title")}
        </h2>
        <Show when={!esWorkspace()}>
          <Button variant="ghost" size="sm" onClick={() => setFormulario("nueva")}>
            <Plus size={14} />
            {t("projects.memory.write")}
          </Button>
        </Show>
      </div>

      <div class="flex flex-wrap items-center gap-3">
        <div class="flex flex-wrap gap-1" role="group" aria-label={t("projects.memory.scope_label")}>
          <Button
            variant={scope().kind === "project" ? "secondary" : "outline"}
            size="compact"
            aria-pressed={scope().kind === "project"}
            onClick={() => setScope({ kind: "project" })}
          >
            {t("projects.memory.scope_project")}
          </Button>
          <Button
            variant={scope().kind === "workspace" ? "secondary" : "outline"}
            size="compact"
            aria-pressed={scope().kind === "workspace"}
            onClick={() => setScope({ kind: "workspace" })}
          >
            {t("projects.memory.scope_workspace")}
          </Button>
          <For each={encargados()}>
            {(name) => (
              <Button
                variant={scopeIgual(scope(), { kind: "agent", name }) ? "secondary" : "outline"}
                size="compact"
                aria-pressed={scopeIgual(scope(), { kind: "agent", name })}
                onClick={() => setScope({ kind: "agent", name })}
              >
                {t("projects.memory.scope_agent", { name })}
              </Button>
            )}
          </For>
        </div>
        <Show when={!esWorkspace() && indice()}>
          {(idx) => (
            <span
              class="text-[0.6875rem] text-neutral-500"
              classList={{ "text-warning-strong": idx().lines >= idx().line_limit }}
            >
              {t("projects.memory.index_status", { lines: idx().lines, limit: idx().line_limit })}
            </span>
          )}
        </Show>
      </div>

      <Show when={fallo()}>{(f) => <FailureNote f={f()} />}</Show>

      <Show
        when={entradas().length > 0}
        fallback={<EmptyState title={t("projects.memory.empty")} />}
      >
        <ul class="m-0 grid list-none gap-2 p-0">
          <For each={entradas()}>
            {(e) => (
              <li class="grid gap-1.5 rounded-md border border-border px-3 py-2" aria-busy={ocupada() === e.file}>
                <p class="m-0 text-[0.8125rem] text-neutral-950">{e.text}</p>
                <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.6875rem] text-neutral-500">
                  <Show when={e.type}>{(tipo) => <Badge forma="dato">{tipo()}</Badge>}</Show>
                  <Show when={!e.in_index}>
                    <Badge tone="warning">{t("projects.memory.out_of_index_badge")}</Badge>
                  </Show>
                  <span class="font-mono">{e.file}</span>
                  <span>{quien(e)}</span>
                  <Show when={e.origin.handler}>
                    {(encargado) => <span>{t("projects.memory.encargado_named", { encargado: encargado() })}</span>}
                  </Show>
                  <Show when={e.origin.task}>{(tarea) => <span>{t("projects.memory.task_named", { task: tarea() })}</span>}</Show>
                  <span>{fecha(e.modified)}</span>
                  <Show when={e.origin.branch}>{(rama) => <span class="font-mono">{rama()}</span>}</Show>
                  <Show when={e.origin.commit}>{(commit) => <span class="font-mono">{commit()}</span>}</Show>
                </div>
                <div class="flex items-center gap-1">
                  <Show when={!esWorkspace()}>
                    <Button
                      variant="ghost"
                      size="compact"
                      disabled={ocupada() !== null}
                      onClick={() => setFormulario(e)}
                    >
                      <Pencil size={12} />
                      {t("projects.memory.edit")}
                    </Button>
                  </Show>
                  <Show when={esWorkspace()}>
                    <Button
                      variant="ghost"
                      size="compact"
                      disabled={ocupada() !== null}
                      onClick={() => void retirar(e.file)}
                    >
                      {t("projects.memory.retire")}
                    </Button>
                  </Show>
                  <Button
                    variant="ghost"
                    size="compact"
                    disabled={ocupada() !== null}
                    onClick={() => void borrar(e.file)}
                  >
                    <Trash2 size={12} />
                    {t("projects.memory.delete")}
                  </Button>
                </div>
              </li>
            )}
          </For>
        </ul>
      </Show>

      <FormularioDeEntrada
        abierto={formulario() !== null}
        proyecto={props.project}
        scope={scope()}
        entrada={editando()}
        onCerrar={() => setFormulario(null)}
        onGuardado={() => void refrescar()}
      />
    </section>
  );
}
