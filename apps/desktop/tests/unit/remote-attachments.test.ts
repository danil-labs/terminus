import assert from "node:assert/strict";
import test from "node:test";

import { moveAttachments, NotMovable, type AttachmentMover } from "../../src/lib/remoteAttachments.ts";

/** Dos motores: la Mac de la ventana tiene los archivos; la VM, lo que se le sube. */
function motores(mac: Record<string, string | null>) {
  const vm: Record<string, string> = {};
  const llamadas: string[] = [];
  const c: AttachmentMover = {
    async read(ruta) {
      llamadas.push(`mac:preview_file ${ruta}`);
      if (!(ruta in mac)) throw new Error("No se pudo leer");
      return { data_url: mac[ruta] };
    },
    async save(mime, datos) {
      const ruta = `/tmp/captura-${Object.keys(vm).length}.${mime.split("/")[1]}`;
      vm[ruta] = datos;
      llamadas.push(`vm:guardar_imagen_pegada ${mime}`);
      return ruta;
    },
    async prepare(rutas) {
      llamadas.push(`vm:prepare_attachments ${rutas.join(",")}`);
      return rutas.map((r) => `/home/alberto/.terminus/attachments/x/${r.split("/").pop()}`);
    },
  };
  return { c, vm, llamadas };
}

test("una imagen arrastrada en la Mac llega a la VM como bytes y vuelve con su ruta de allá", async () => {
  const { c, vm, llamadas } = motores({ "/Users/alberto/Desktop/Captura.png": "data:image/png;base64,iVBORw0K" });
  const rutas = await moveAttachments(["/Users/alberto/Desktop/Captura.png"], c);
  assert.deepEqual(rutas, ["/home/alberto/.terminus/attachments/x/captura-0.png"]);
  assert.deepEqual(Object.values(vm), ["iVBORw0K"]);
  assert.deepEqual(llamadas, [
    "mac:preview_file /Users/alberto/Desktop/Captura.png",
    "vm:guardar_imagen_pegada image/png",
    "vm:prepare_attachments /tmp/captura-0.png",
  ]);
});

test("un archivo que no es imagen, o que pasa del tope, no sale y no deja nada a medias en la VM", async () => {
  const { c, vm } = motores({
    "/Users/alberto/a.png": "data:image/png;base64,AAAA",
    "/Users/alberto/informe.pdf": null,
    "/Users/alberto/logo.svg": "data:image/svg+xml;base64,PHN2Zz4=",
  });
  await assert.rejects(
    moveAttachments(["/Users/alberto/a.png", "/Users/alberto/informe.pdf", "/Users/alberto/logo.svg", "/Users/alberto/borrada.png"], c),
    (e: unknown) => e instanceof NotMovable && e.names.join() === "informe.pdf,logo.svg,borrada.png",
  );
  assert.deepEqual(vm, {});
});

test("sin adjuntos no se llama a ningún motor", async () => {
  const { c, llamadas } = motores({});
  assert.deepEqual(await moveAttachments([], c), []);
  assert.deepEqual(llamadas, []);
});
