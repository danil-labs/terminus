import { invoke } from "@tauri-apps/api/core";
import { createResource, Show } from "solid-js";
import { imagenInerte } from "../lib/links";
import { EnlargeableImage } from "./EnlargeableImage";
import { FilePreview } from "./FilePreview";

/** En la web el disco es el de la computadora remota: el motor manda la imagen como `data:`. */
export default function RemoteImage(props: { path: string; alt?: string }) {
  const [fuente] = createResource(
    () => props.path,
    (ruta) =>
      invoke<{ data_url?: string | null }>("preview_file", { path: ruta, rel: ruta })
        .then((p) => imagenInerte(p.data_url))
        .catch(() => null),
  );
  return (
    <Show
      when={fuente()}
      fallback={
        <Show when={!fuente.loading} fallback={<span class="text-neutral-500">{props.alt}</span>}>
          <FilePreview path={props.path} alt={props.alt} />
        </Show>
      }
    >
      {(src) => <EnlargeableImage src={src()} alt={props.alt} />}
    </Show>
  );
}
