import { createSignal } from "solid-js";
import { invoke } from "../../lib/invoke.ts";
import { imagenInerte } from "../../lib/links";

/**
 * El logo del workspace como `data:` URI. La ventana no pinta un `file://`
 * (`AGENTS.md` § el guarda `csp`).
 *
 * La ruta sigue siendo `logo.png` al reemplazar el archivo: sin vaciar esto,
 * el cuadro seguiría con la imagen anterior.
 */
const urls = new Map<string, Promise<string | null>>();
const [generacion, setGeneracion] = createSignal(0);

if (typeof window !== "undefined") {
  window.addEventListener("harness:workspace-name", () => {
    urls.clear();
    setGeneracion((n) => n + 1);
  });
}

export function generacionDeLogo(): number {
  return generacion();
}

export function urlDeLogo(path: string): Promise<string | null> {
  let pendiente = urls.get(path);
  if (!pendiente) {
    pendiente = invoke<{ data_url: string | null }>("preview_file", { path, rel: path })
      .then((v) => imagenInerte(v.data_url))
      .catch(() => null);
    urls.set(path, pendiente);
  }
  return pendiente;
}
