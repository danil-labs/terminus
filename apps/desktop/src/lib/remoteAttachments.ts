/**
 * Los adjuntos de un turno que corre en otra máquina. Al adjuntar, la copia
 * queda en el motor de la ventana (`prepare_attachments`), y una ruta de esta
 * Mac no le sirve a la VM: el agente de allá no la puede abrir. Antes de
 * mandar, cada imagen viaja como bytes al motor de la tarea
 * (`guardar_imagen_pegada`) y allá se prepara su copia, igual que en el
 * teléfono (`apps/mobile/src/lib/engine.ts`).
 */

/** Lo que `guardar_imagen_pegada` sabe guardar. */
const UPLOADABLE = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export type AttachmentMover = {
  /** La miniatura del archivo en la máquina de la ventana (`preview_file`). */
  read: (path: string) => Promise<{ data_url?: string | null }>;
  /** Guarda los bytes en la máquina de la tarea y devuelve su ruta allá. */
  save: (mime: string, datos: string) => Promise<string>;
  /** `prepare_attachments` en la máquina de la tarea. */
  prepare: (paths: string[]) => Promise<string[]>;
};

/** Lo que no se pudo llevar: no es una imagen, ya no está o pasa del tope de la miniatura (4 MB). */
export class NotMovable extends Error {
  readonly names: string[];
  constructor(names: string[]) {
    super(`not_movable: ${names.join(", ")}`);
    this.names = names;
  }
}

const nameOf = (path: string) => path.split(/[\\/]/).pop() || path;

function split(dataUrl: string | null | undefined): { mime: string; datos: string } | null {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl ?? "");
  return m && UPLOADABLE.includes(m[1]) ? { mime: m[1], datos: m[2] } : null;
}

/**
 * Las rutas de `paths` en la máquina de la tarea, en el mismo orden. Lee todas
 * antes de subir ninguna: si una no se puede llevar, no deja copias a medias
 * en la otra máquina y el mensaje no sale.
 */
export async function moveAttachments(paths: string[], c: AttachmentMover): Promise<string[]> {
  if (paths.length === 0) return [];
  const read = await Promise.all(paths.map(async (path) => ({ path, image: split((await c.read(path).catch(() => null))?.data_url) })));
  const refused = read.filter((r) => !r.image).map((r) => nameOf(r.path));
  if (refused.length) throw new NotMovable(refused);
  const saved: string[] = [];
  for (const { image } of read) saved.push(await c.save(image!.mime, image!.datos));
  return c.prepare(saved);
}
