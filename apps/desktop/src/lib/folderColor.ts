/**
 * El color estable de una carpeta mientras no haya uno guardado: el mismo id
 * da siempre el mismo color, en cualquier ventana y sesión.
 */
const PALETA = ["#a78bfa", "#38bdf8", "#f59e0b", "#f472b6", "#34d399", "#fb7185", "#60a5fa", "#facc15"];

// FNV-1a de 32 bits sobre las unidades UTF-16 del id; cambiarlo recolorea todas las carpetas.
export function folderColor(id: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return PALETA[hash % PALETA.length];
}
