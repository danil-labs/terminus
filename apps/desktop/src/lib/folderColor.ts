// Color estable de una carpeta: FNV-1a de 32 bits sobre su id, sin guardar nada.
const PALETTE = ["#a78bfa", "#38bdf8", "#f59e0b", "#f472b6", "#34d399", "#fb7185", "#60a5fa", "#facc15"];

export function folderColor(id: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}
