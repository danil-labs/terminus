/**
 * Lo que la ventana ya usa y el motor todavía no publica en su contrato.
 *
 * Los guardas `commands` y `bridge` aceptan estos nombres sin que estén en
 * `commands.json`, cada uno con lo que lo trae. Cuando el contrato copiado ya
 * los tiene, la entrada sobra y los guardas fallan hasta quitarla: esta lista
 * solo se vacía.
 */
export const COMANDOS_PENDIENTES = {
  // Los visuales del chat por partes, con sus imágenes incrustadas (seldon-host `feat/chat-visuals-by-parts`).
  // Hasta que el pin lo traiga, la ventana cae a `tree_show` (512 KiB).
  chat_visual_part: "seldon-host feat/chat-visuals-by-parts",
};

export const EVENTOS_PENDIENTES = {};
