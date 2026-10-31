/**
 * Qué fila es cada bloque del hilo. La clave nace del primer mensaje del bloque, que
 * sobrevive a plegarse el turno; un bloque vivo aún sin turno guardado lleva una
 * provisional y el bloque que lo cierra la hereda.
 */
export function createBlockKeys() {
  let alias = new Map<string, string>();
  let provisional: string[] = [];
  let seen = new Set<string>();
  let next = 0;
  return {
    reset() {
      alias = new Map();
      provisional = [];
      seen = new Set();
      next = 0;
    },
    assign(sources: readonly (string | null)[]): string[] {
      const queue = [...provisional];
      const used = new Set<string>();
      const nextProvisional: string[] = [];
      const keys = sources.map((source, position) => {
        let key: string;
        if (source === null) {
          key = queue.shift() ?? `vivo:${next++}`;
          nextProvisional.push(key);
        } else {
          key = alias.get(source) ?? source;
          if (key === source && !seen.has(source) && queue.length) {
            key = queue.shift()!;
            alias.set(source, key);
          }
        }
        if (used.has(key)) key = `${key}#${position}`;
        used.add(key);
        return key;
      });
      provisional = nextProvisional;
      seen = new Set(sources.filter((source): source is string => source !== null));
      return keys;
    },
  };
}

export const ESTIMATED_LINE = 22;
const ESTIMATED_CHARS_PER_LINE = 96;
const ESTIMATED_MAX = 1200;

/** Alto probable de un bloque antes de medirlo; solo acerca la barra, no fija la lectura. */
export function estimateBlock(kind: "msg" | "pasos" | "trabajo", text: number, steps: number): number {
  const body = Math.ceil(text / ESTIMATED_CHARS_PER_LINE) * ESTIMATED_LINE;
  if (kind === "pasos") return 32 + Math.min(steps, 3) * ESTIMATED_LINE;
  return Math.min(ESTIMATED_MAX, (kind === "trabajo" ? 64 : 40) + body);
}
