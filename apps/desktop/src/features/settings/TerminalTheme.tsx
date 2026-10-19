import { For, Show, createSignal, onMount } from "solid-js";
import { invoke } from "../../lib/invoke.ts";
import { cn } from "../../lib/utils";
import { t } from "../../lib/i18n";
import {
  TEMAS_DE_TERMINAL,
  aplicarTemaDeTerminal,
  temaDeTerminal,
  type TemaDeTerminal,
} from "../../lib/terminal-themes";
import { FailureNote, asFailure, type Failure } from "../../ui/Failure";
import type { Startup } from "./workspaces-store";
import { BARRA_DE_TERMINAL, NOMBRE_DE_TERMINAL } from "../../ui/Terminal";

/**
 * Qué tema pinta la terminal, el código y el diff: la segunda capa de color de
 * `docs/visual-system.md`.
 *
 * Cada opción se pinta como la terminal que va a ser, con su barra, su texto,
 * su gris secundario y sus tres estados. Un desplegable de cinco nombres deja
 * elegir a ciegas.
 */
export function TemaDeLaTerminal() {
  const [workspace, setWorkspace] = createSignal<string | null>(null);
  const [fallo, setFallo] = createSignal<Failure | null>(null);

  onMount(() => {
    void invoke<Startup>("list_workspaces")
      .then((s) => {
        const activo = s.workspaces.find((w) => w.id === s.active);
        if (activo) setWorkspace(activo.id);
      })
      .catch(() => {
        // Sin workspace no hay dónde guardar; las muestras siguen pintándose.
      });
  });

  function elegir(tema: TemaDeTerminal) {
    const id = workspace();
    const anterior = temaDeTerminal();
    setFallo(null);
    // Se pinta antes de guardar: la ventana entera cambia de tema y esperar al
    // disco deja el clic sin respuesta. Si el disco falla, vuelve el anterior.
    aplicarTemaDeTerminal(tema.id);
    if (!id) return;
    void invoke("set_workspace_terminal_theme", { id, theme: tema.id }).catch((error) => {
      aplicarTemaDeTerminal(anterior);
      setFallo({ ...asFailure(error), what: t("settings.terminal_theme.error") });
    });
  }

  return (
    <section class="grid gap-2">
      <h3 class="m-0 text-[0.8125rem] font-semibold">{t("settings.terminal_theme.title")}</h3>
      <div
        role="radiogroup"
        aria-label={t("settings.terminal_theme.title")}
        class="grid gap-3 sm:grid-cols-2"
      >
        <For each={TEMAS_DE_TERMINAL}>
          {(tema) => (
            <button
              role="radio"
              aria-checked={temaDeTerminal() === tema.id}
              aria-label={tema.name}
              /* Quitarlo deja las cinco muestras pintadas con el tema que ya
                 está puesto en `<html>`. */
              data-terminal-theme={tema.id}
              class={cn(
                "grid gap-0 overflow-hidden rounded-md border text-left outline-offset-2 outline-primary focus-visible:outline-2 focus-visible:outline-solid",
                temaDeTerminal() === tema.id
                  ? "border-border-strong shadow-sm"
                  : "border-border hover:border-border-strong",
              )}
              onClick={() => elegir(tema)}
            >
              <span class={BARRA_DE_TERMINAL}>
                <span class={NOMBRE_DE_TERMINAL}>{tema.name}</span>
                <span class="flex-1" />
                <Show when={temaDeTerminal() === tema.id}>
                  <span class="text-terminal-accent" aria-hidden="true">
                    ▍
                  </span>
                </Show>
              </span>
              <span class="grid gap-0.5 bg-terminal px-3 py-2.5 font-mono text-[0.6875rem] leading-5">
                <span class="text-terminal-ok">{t("settings.terminal_theme.sample_ok")}</span>
                <span class="text-terminal-text">{t("settings.terminal_theme.sample_out")}</span>
                <span class="text-terminal-muted">{t("settings.terminal_theme.sample_muted")}</span>
                <span class="text-terminal-warn">{t("settings.terminal_theme.sample_warn")}</span>
                <span class="text-terminal-error">{t("settings.terminal_theme.sample_error")}</span>
              </span>
            </button>
          )}
        </For>
      </div>
      <Show when={fallo()}>{(f) => <FailureNote f={f()} />}</Show>
    </section>
  );
}
