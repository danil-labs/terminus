import { createResource, createSignal, Show, For } from "solid-js";
import { invoke } from "../../lib/invoke.ts";
import X from "lucide-solid/icons/x";
import { Dialog, DialogContent, DialogTitle } from "../../ui/Dialog";
import FileText from "lucide-solid/icons/file-text";
import { t } from "../../lib/i18n";
import { extensionDe, nombreDe } from "../../lib/steps";

export default function Adjuntos(props: {
  /** Las rutas del archivo, tal como las guarda el turno. */
  rels: string[];
  /**
   * De relativa a `data:` URI, o `null` si no es una imagen o no cabe. Es una
   * función porque este componente no sabe en qué proyecto y tarea está —
   * `Chat.tsx` tampoco, y dárselos acoplaría la conversación a un dato que solo
   * necesita una miniatura.
   */
  miniatura: (rel: string) => Promise<string | null>;
}) {
  return (
    <div class="mb-2 flex flex-wrap gap-2">
      <For each={props.rels}>{(rel) => <Adjunto rel={rel} miniatura={props.miniatura} />}</For>
    </div>
  );
}
export function Adjunto(props: {
  rel: string;
  compacto?: boolean;
  miniatura: (rel: string) => Promise<string | null>;
}) {
  // Una ruta desaparecida no debe impedir que se lea la conversación.
  const [imagen] = createResource(
    () => props.rel,
    (rel) => props.miniatura(rel).catch(() => null),
  );

  const [abierta, setAbierta] = createSignal(false);
  const [fallo, setFallo] = createSignal(false);
  const abrir = async () => {
    if (imagen()) {
      setFallo(false);
      setAbierta(true);
    } else if (/^(\/|[a-z]:[\\/]|\\\\)/i.test(props.rel)) {
      try {
        await invoke("open_external", { target: props.rel });
      } catch {
        setFallo(true);
        setAbierta(true);
      }
    } else {
      setFallo(true);
      setAbierta(true);
    }
  };

  return (
    <>
      <button
        type="button"
        class="block max-w-full rounded-md text-left focus-visible:outline-2 focus-visible:outline-primary"
        title={t("chat.attachments.open", { name: nombreDe(props.rel) })}
        aria-label={t("chat.attachments.open", { name: nombreDe(props.rel) })}
        onClick={() => void abrir()}
      >
        <Show when={imagen()} fallback={<Tarjeta rel={props.rel} />}>
          {(src) => (
            <img
              src={src()}
              alt={nombreDe(props.rel)}
              class={props.compacto
                ? "size-14 rounded-md border border-border object-cover"
                : "size-48 rounded-md border border-border bg-surface object-contain"}
            />
          )}
        </Show>
      </button>
      <Dialog open={abierta()} onOpenChange={setAbierta}>
        <DialogContent
          class="flex max-h-full w-full max-w-[1100px] flex-col gap-3"
          onKeyDown={(e: KeyboardEvent) => {
            if (e.key === "Escape") e.stopPropagation();
          }}
        >
          <div class="flex items-center justify-between gap-3">
            <DialogTitle class="min-w-0 truncate text-sm">{nombreDe(props.rel)}</DialogTitle>
            <Dialog.CloseButton class="shrink-0 rounded p-1 hover:bg-surface-muted" aria-label={t("chat.attachments.close")}>
              <X size={18} />
            </Dialog.CloseButton>
          </div>
          <Show when={!fallo()} fallback={<p class="text-sm text-error-strong">{t("chat.attachments.open_failed")}</p>}>
            <img src={imagen() ?? undefined} alt={nombreDe(props.rel)} class="min-h-0 max-h-[75vh] w-full object-contain" />
          </Show>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** El archivo que no se puede enseñar: se nombra. Mismas medidas que en la caja. */
function Tarjeta(props: { rel: string }) {
  return (
    <div
      class="flex h-14 w-[150px] items-center gap-2 rounded-md border border-border bg-neutral-100 px-2"
      title={nombreDe(props.rel)}
    >
      <span class="grid size-8 shrink-0 place-items-center rounded bg-surface">
        <FileText size={15} class="text-neutral-500" />
      </span>
      <span class="min-w-0 flex-1">
        <span class="block truncate text-[0.6875rem] font-medium text-neutral-950">
          {nombreDe(props.rel)}
        </span>
        <span class="block text-[0.625rem] tracking-wide text-neutral-500 uppercase">
          {extensionDe(props.rel) || t("chat.attachments.file_type_unknown")}
        </span>
      </span>
    </div>
  );
}
