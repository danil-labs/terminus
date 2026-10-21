/**
 * Adjuntar desde el navegador, que no tiene rutas: el `File` viaja como bytes.
 * Solo lo carga la web (`capabilities().browserFiles`); el escritorio no lo baja.
 */
import type { Accessor } from "solid-js";
import { base64De } from "../../lib/clipboard";
import { t } from "../../lib/i18n";
import { asFailure, type Failure } from "../../ui/Failure";

/** Lo que `guardar_imagen_pegada` sabe guardar. */
const IMAGENES_SUBIBLES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

type Conversacion = {
  puede: () => boolean;
  marcar: (caja: DOMRect | null) => void;
  conversacion: Accessor<unknown>;
  pegar: (mime: string, datos: string) => Promise<string>;
  agregar: (rutas: string[]) => Promise<void>;
  fallo: (f: Failure | null) => void;
  ocupado: (delta: number) => void;
};

export function adjuntador(c: Conversacion) {
  async function subir(files: File[]) {
    if (!c.puede() || files.length === 0) return;
    const conversation = c.conversacion();
    const fuera = files.filter((f) => !IMAGENES_SUBIBLES.includes(f.type));
    c.fallo(null);
    c.ocupado(1);
    try {
      const rutas: string[] = [];
      for (const f of files) if (IMAGENES_SUBIBLES.includes(f.type)) rutas.push(await c.pegar(f.type, await base64De(f)));
      if (rutas.length) await c.agregar(rutas);
      if (fuera.length && conversation === c.conversacion()) {
        const names = fuera.map((f) => f.name).join(", ");
        c.fallo({ what: t("chat.attachments.web_images_only", { names }), detail: "web_images_only" });
      }
    } catch (err) {
      if (conversation === c.conversacion()) c.fallo(asFailure(err));
    } finally {
      c.ocupado(-1);
    }
  }

  return {
    elegir() {
      const input = document.createElement("input");
      input.type = "file";
      input.multiple = true;
      input.accept = IMAGENES_SUBIBLES.join(",");
      input.onchange = () => void subir([...(input.files ?? [])]);
      input.click();
    },
    /** El `drop` de HTML5 sobre la conversación; devuelve cómo quitarlo. */
    escuchar(zona: HTMLElement): () => void {
      const conArchivos = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");
      const encima = (e: DragEvent) => {
        if (!conArchivos(e)) return;
        e.preventDefault();
        c.marcar(c.puede() ? zona.getBoundingClientRect() : null);
      };
      const fuera = (e: DragEvent) => {
        if (!zona.contains(e.relatedTarget as Node | null)) c.marcar(null);
      };
      const soltar = (e: DragEvent) => {
        if (!conArchivos(e)) return;
        e.preventDefault();
        c.marcar(null);
        void subir([...(e.dataTransfer?.files ?? [])]);
      };
      const eventos = [["dragenter", encima], ["dragover", encima], ["dragleave", fuera], ["drop", soltar]] as const;
      for (const [tipo, f] of eventos) zona.addEventListener(tipo, f);
      return () => {
        for (const [tipo, f] of eventos) zona.removeEventListener(tipo, f);
      };
    },
  };
}
