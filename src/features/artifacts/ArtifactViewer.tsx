import { createEffect, createSignal, on } from "solid-js";
import { invoke } from "../../lib/invoke.ts";
import PreviewPane, { type Preview } from "./Preview";
import { prosaDe } from "../../ui/Failure";

/**
 * Un artefacto abierto como pestaña del espacio principal, con preview propio
 * por pestaña.
 *
 * **Carga al montarse y solo entonces.** Cada pestaña se monta una vez y se
 * esconde al cambiar de una a otra (`App.tsx`): volver a ella no vuelve a
 * pedir el archivo. Si el artefacto se reescribe durante un turno, se lee lo
 * que había al abrirlo; cerrar y reabrir lo trae otra vez. Un refresco
 * automático aquí pisaría una edición sin guardar del documento (ver
 * `FileViewer.tsx`).
 *
 * La ruta absoluta viaja en la pestaña y no se resuelve aquí: la lista es de
 * la columna y esta pantalla no la tiene.
 */
export default function VisorDeArtefacto(props: {
  /** Dónde vive: la carpeta de trabajo de la tarea más su `rel`. */
  path: string;
  /** Su ruta dentro de la carpeta de trabajo, que es lo que se lee. */
  rel: string;
  /** Lo produjo el agente («output»), lo adjuntó la persona («input») o vive fuera de la tarea («external»). */
  kind: "output" | "input" | "external";
}) {
  const [preview, setPreview] = createSignal<Preview | null>(null);
  const [fallo, setFallo] = createSignal<string | null>(null);

  // Por `path` y no al montar a secas: la pestaña se identifica por su `rel`
  // dentro de la tarea, y la carpeta de datos puede mudarse bajo ella.
  createEffect(
    on(
      () => props.path,
      (path) => {
        setFallo(null);
        invoke<Preview>("preview_file", { path, rel: props.rel })
          .then(setPreview)
          .catch((e) => {
            setPreview(null);
            setFallo(prosaDe(e));
          });
      },
    ),
  );

  return (
    // El relleno lo decide `PreviewPane`, no esta pantalla: un artefacto web
    // va a sangre, y qué forma tiene lo sabe el visor. Es el mismo relleno que
    // la transcripción (`Chat.tsx`).
    <div class="h-full">
      <PreviewPane
        preview={preview()}
        absPath={props.path}
        /* Un adjunto no tiene cadena de versiones: la sesión no lo produjo, lo
           recibió. Editarlo aquí lo convertiría en producto sin que nadie lo
           decidiera. */
        esArtefacto={props.kind === "output"}
        error={fallo()}
      />
    </div>
  );
}
