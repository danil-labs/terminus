/**
 * La directiva de una visualización del chat, `::terminus-visual{file="x.html"
 * title="…"}`, sola en su línea. Cada cliente decide dónde está en su markdown
 * (fuera de código); aquí está qué línea cuenta y qué archivo se puede pedir.
 */
export const VISUAL_DIRECTIVE = /^::terminus-visual\{file=("(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*")(?: title=("(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"))?\}$/;
export const MAX_CHAT_VISUALS = 8;
/** Lo que el motor guarda en el árbol `terminus-chat-visuals` de la tarea. */
export const VISUAL_TREE = "terminus-chat-visuals";
export const MAX_VISUAL_BYTES = 512 * 1024;
export const VISUAL_FILE = /^[a-z0-9][a-z0-9._-]*\.html$/i;

/** El archivo y el título de una línea de directiva, o `null` si no lo es. */
export function parseVisualDirective(line: string): { file: string; title: string } | null {
  const match = VISUAL_DIRECTIVE.exec(line);
  if (!match) return null;
  const file: string = JSON.parse(match[1]);
  const title: string = match[2] ? JSON.parse(match[2]) : "";
  if (file.length === 0 || file.length > 128 || title.length > 240) return null;
  return { file, title };
}
