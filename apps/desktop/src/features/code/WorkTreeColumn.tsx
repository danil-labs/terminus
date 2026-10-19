import { createEffect, createSignal, For, type JSX, Show } from "solid-js";
import { t } from "../../lib/i18n";
import { Button } from "../../ui/Button";
import { asFailure, type Failure, FailureNote } from "../../ui/Failure";
import RightPanelHeader from "../shell/RightPanelHeader";
import Codigo from "./Code";
import VistaPreviaDeTarea from "./TaskPreview";

/**
 * La tercera columna: el árbol de trabajo de la tarea abierta, al lado de la
 * conversación que lo pidió. Es el navegador, no el visor: pulsar un archivo
 * abre una pestaña del espacio principal (`lib/tabs.ts`). El ancho y el
 * arrastre son de `features/shell/SideColumn.tsx`.
 */
export default function ColumnaDeTrabajo(props: {
  folderActions: JSX.Element;
  project: string;
  session: string | null;
  baseRef?: string;
  tabs: { project: string; session: string }[];
  visible: boolean;
  /** Escribir la conversación en la carpeta de trabajo y abrirla. */
  onExportarChat: () => Promise<void>;
  /** Abrir un archivo del árbol como pestaña del centro. */
  onAbrirArchivo: (arbol: string, ruta: string, cambiado: boolean) => void;
  /** Algo del árbol cambió de ruta o se borró: sus pestañas lo siguen o se cierran. */
  onArchivoMovido: (session: string, arbol: string, desde: string, hasta: string) => void;
  onArchivoBorrado: (session: string, arbol: string, ruta: string) => void;
  onClose: () => void;
}) {
  const [exportando, setExportando] = createSignal(false);
  const [falloAlExportar, setFalloAlExportar] = createSignal<Failure | null>(null);

  const [panels, setPanels] = createSignal<string[]>([]);
  const key = (project: string, session: string) => JSON.stringify([project, session]);
  const activeKey = () => key(props.project, props.session ?? "");

  createEffect(() => {
    const available = new Set(props.tabs.map((tab) => key(tab.project, tab.session)));
    const active = props.visible && props.session ? activeKey() : null;
    setPanels((previous) => {
      const next = previous.filter((id) => available.has(id));
      if (active && available.has(active) && !next.includes(active)) next.push(active);
      return next;
    });
  });

  async function exportarChat() {
    if (exportando()) return;
    setExportando(true);
    setFalloAlExportar(null);
    try {
      await props.onExportarChat();
    } catch (e) {
      setFalloAlExportar(asFailure(e));
    } finally {
      setExportando(false);
    }
  }

  return (
    <section class="flex h-full min-h-0 flex-col overflow-hidden" classList={{ hidden: !props.visible }}>
      <RightPanelHeader title={t("code.column.title")} actions={props.folderActions}
        closeLabel={t("code.column.close.label")} closeTooltip={t("code.column.close.title")} onClose={props.onClose} />

      <div class="flex min-h-0 flex-1 flex-col">
        <Show when={!props.session}>
          <VistaPreviaDeTarea
            project={props.project}
            baseRef={props.baseRef}
            visible={props.visible}
            onAbrir={props.onAbrirArchivo}
          />
        </Show>
        <For each={panels()}>
          {(id) => {
            const [project, session] = JSON.parse(id) as [string, string];
            const visible = () => props.visible && activeKey() === id;
            return (
              <div class="min-h-0 flex-1" classList={{ hidden: !visible() }}>
                <Codigo
                  project={project}
                  session={session}
                  visible={visible()}
                  onAbrir={props.onAbrirArchivo}
                  onMovido={props.onArchivoMovido}
                  onBorrado={props.onArchivoBorrado}
                />
              </div>
            );
          }}
        </For>

        <Show when={falloAlExportar()}>
          {(f) => (
            <div class="px-2">
              <FailureNote f={f()} />
            </div>
          )}
        </Show>

        <Show when={props.session}>
          <div class="flex shrink-0 items-center gap-2 border-t border-border p-2">
            <Button
              variant="secondary"
              size="sm"
              class="h-7"
              onClick={() => void exportarChat()}
              disabled={exportando()}
            >
              {exportando() ? t("code.column.export_chat.busy") : t("code.column.export_chat")}
            </Button>
          </div>
        </Show>
      </div>
    </section>
  );
}
